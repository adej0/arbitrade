import "@nomicfoundation/hardhat-chai-matchers";
import { expect } from "chai";
import { ethers } from "hardhat";

const ONE = ethers.parseEther("1");
const SUPPLY = ethers.parseEther("1000000");
const SLIPPAGE_BPS = 50;

async function futureDeadline(): Promise<number> {
  const block = await ethers.provider.getBlock("latest");
  return (block!.timestamp ?? 0) + 600;
}

async function deployFixture() {
  const [owner, trader] = await ethers.getSigners();

  const tokenFactory = await ethers.getContractFactory("MockERC20");
  const tokenA = await tokenFactory.deploy("Token A", "TKA", SUPPLY);
  const tokenB = await tokenFactory.deploy("Token B", "TKB", SUPPLY);

  const routerFactory = await ethers.getContractFactory("MockRouter");
  // 1 A -> 2 B, then 1 B -> 1 A: a profitable round trip.
  const router1 = await routerFactory.deploy(2, 1);
  const router2 = await routerFactory.deploy(1, 1);

  const arbitrage = await (await ethers.getContractFactory("Arbitrage")).deploy();

  // Fund the routers so they can pay out swaps, and the trader so it can trade.
  await tokenB.mint(await router1.getAddress(), SUPPLY);
  await tokenA.mint(await router2.getAddress(), SUPPLY);
  await tokenA.mint(trader.address, ethers.parseEther("100"));

  return { owner, trader, tokenA, tokenB, router1, router2, arbitrage };
}

describe("Arbitrage error propagation", () => {
  it("rejects invalid parameters before touching any token", async () => {
    const { trader, tokenA, tokenB, router1, router2, arbitrage } = await deployFixture();
    const deadline = await futureDeadline();
    const args = [
      await tokenA.getAddress(),
      await tokenB.getAddress(),
      ONE,
      await router1.getAddress(),
      await router2.getAddress(),
      SLIPPAGE_BPS,
      0,
      deadline
    ] as const;

    // No allowance granted yet: the failed pull must abort the call.
    await expect(arbitrage.connect(trader).executeArbitrage(...args)).to.be.reverted;

    await expect(
      arbitrage.connect(trader).executeArbitrage(args[0], args[1], 0n, args[3], args[4], SLIPPAGE_BPS, 0, deadline)
    ).to.be.revertedWith("amountIn=0");

    await expect(
      arbitrage.connect(trader).executeArbitrage(args[0], args[0], ONE, args[3], args[4], SLIPPAGE_BPS, 0, deadline)
    ).to.be.revertedWith("tokenIn==tokenOut");

    await expect(
      arbitrage
        .connect(trader)
        .executeArbitrage(ethers.ZeroAddress, args[1], ONE, args[3], args[4], SLIPPAGE_BPS, 0, deadline)
    ).to.be.revertedWith("token=0");

    await expect(
      arbitrage
        .connect(trader)
        .executeArbitrage(args[0], args[1], ONE, ethers.ZeroAddress, args[4], SLIPPAGE_BPS, 0, deadline)
    ).to.be.revertedWith("router=0");
  });

  it("reports an expired deadline instead of failing inside the router", async () => {
    const { trader, tokenA, tokenB, router1, router2, arbitrage } = await deployFixture();
    const block = await ethers.provider.getBlock("latest");

    await expect(
      arbitrage
        .connect(trader)
        .executeArbitrage(
          await tokenA.getAddress(),
          await tokenB.getAddress(),
          ONE,
          await router1.getAddress(),
          await router2.getAddress(),
          SLIPPAGE_BPS,
          0,
          block!.timestamp - 1
        )
    ).to.be.revertedWith("deadline passed");
  });

  it("reports a missing route instead of using a zero slippage bound", async () => {
    const { trader, tokenA, tokenB, router1, router2, arbitrage } = await deployFixture();
    await tokenA.connect(trader).approve(await arbitrage.getAddress(), ONE);
    // A zero output ratio makes the router quote 0, i.e. there is no usable route.
    await router1.setRatio(0, 1);

    await expect(
      arbitrage
        .connect(trader)
        .executeArbitrage(
          await tokenA.getAddress(),
          await tokenB.getAddress(),
          ONE,
          await router1.getAddress(),
          await router2.getAddress(),
          SLIPPAGE_BPS,
          0,
          await futureDeadline()
        )
    ).to.be.revertedWith("no route");
  });

  it("reverts when a router delivers less than it quoted", async () => {
    const { trader, tokenA, tokenB, router1, router2, arbitrage } = await deployFixture();
    await tokenA.connect(trader).approve(await arbitrage.getAddress(), ONE);
    // Quote stays the same but only 90% of the output is actually transferred, far beyond
    // the 0.5% slippage tolerance.
    await router1.setDeliveryBps(9000);

    await expect(
      arbitrage
        .connect(trader)
        .executeArbitrage(
          await tokenA.getAddress(),
          await tokenB.getAddress(),
          ONE,
          await router1.getAddress(),
          await router2.getAddress(),
          SLIPPAGE_BPS,
          0,
          await futureDeadline()
        )
    ).to.be.revertedWith("swap output below min");
  });

  it("reverts when the round trip is not profitable enough", async () => {
    const { trader, tokenA, tokenB, router1, router2, arbitrage } = await deployFixture();
    const arbitrageAddress = await arbitrage.getAddress();
    await tokenA.connect(trader).approve(arbitrageAddress, ONE * 2n);
    const deadline = await futureDeadline();

    // 1 A -> 2 B -> 1 A: no profit at all.
    await router2.setRatio(1, 2);
    await expect(
      arbitrage
        .connect(trader)
        .executeArbitrage(
          await tokenA.getAddress(),
          await tokenB.getAddress(),
          ONE,
          await router1.getAddress(),
          await router2.getAddress(),
          SLIPPAGE_BPS,
          0,
          deadline
        )
    ).to.be.revertedWith("no profit");

    // Profitable, but short of the requested minimum profit.
    await router2.setRatio(1, 1);
    await expect(
      arbitrage
        .connect(trader)
        .executeArbitrage(
          await tokenA.getAddress(),
          await tokenB.getAddress(),
          ONE,
          await router1.getAddress(),
          await router2.getAddress(),
          SLIPPAGE_BPS,
          ethers.parseEther("100"),
          deadline
        )
    ).to.be.revertedWith("insufficient profit");
  });

  it("does not treat a token that returns false as a successful transfer", async () => {
    const { trader, tokenB, router1, router2, arbitrage } = await deployFixture();
    const silentToken = await (await ethers.getContractFactory("MockSilentFailERC20")).deploy(SUPPLY);
    await silentToken.mint(trader.address, ethers.parseEther("100"));
    await silentToken.mint(await router2.getAddress(), SUPPLY);
    await silentToken.connect(trader).approve(await arbitrage.getAddress(), ONE);

    const args = [
      await silentToken.getAddress(),
      await tokenB.getAddress(),
      ONE,
      await router1.getAddress(),
      await router2.getAddress(),
      SLIPPAGE_BPS,
      0,
      await futureDeadline()
    ] as const;

    await silentToken.setFailures(false, true, false);
    await expect(arbitrage.connect(trader).executeArbitrage(...args)).to.be.revertedWith(
      "SafeERC20: ERC20 operation did not succeed"
    );

    await silentToken.setFailures(false, false, true);
    await expect(arbitrage.connect(trader).executeArbitrage(...args)).to.be.revertedWith(
      "SafeERC20: ERC20 operation did not succeed"
    );
  });

  it("propagates rescueToken failures to the owner", async () => {
    const { owner, arbitrage } = await deployFixture();
    const silentToken = await (await ethers.getContractFactory("MockSilentFailERC20")).deploy(SUPPLY);
    await silentToken.mint(await arbitrage.getAddress(), ONE);
    await silentToken.setFailures(true, false, false);

    await expect(
      arbitrage.connect(owner).rescueToken(await silentToken.getAddress(), owner.address, ONE)
    ).to.be.revertedWith("SafeERC20: ERC20 operation did not succeed");

    await expect(
      arbitrage.connect(owner).rescueToken(await silentToken.getAddress(), ethers.ZeroAddress, ONE)
    ).to.be.revertedWith("to=0");
  });

  it("clears router allowances and pays out on a successful arbitrage", async () => {
    const { trader, tokenA, tokenB, router1, router2, arbitrage } = await deployFixture();
    const arbitrageAddress = await arbitrage.getAddress();
    await tokenA.connect(trader).approve(arbitrageAddress, ONE);
    const balanceBefore = await tokenA.balanceOf(trader.address);

    await expect(
      arbitrage
        .connect(trader)
        .executeArbitrage(
          await tokenA.getAddress(),
          await tokenB.getAddress(),
          ONE,
          await router1.getAddress(),
          await router2.getAddress(),
          SLIPPAGE_BPS,
          0,
          await futureDeadline()
        )
    ).to.emit(arbitrage, "ArbitrageExecuted");

    expect(await tokenA.balanceOf(trader.address)).to.equal(balanceBefore + ONE);
    expect(await tokenA.allowance(arbitrageAddress, await router1.getAddress())).to.equal(0n);
    expect(await tokenB.allowance(arbitrageAddress, await router2.getAddress())).to.equal(0n);
  });
});
