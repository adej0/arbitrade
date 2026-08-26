import { expect } from "chai";
import { ethers } from "hardhat";

describe("Arbitrage security", () => {
  const parse = (value: string) => ethers.parseEther(value);

  async function deployFixture() {
    const [owner, attacker] = await ethers.getSigners();

    const tokenFactory = await ethers.getContractFactory("MockERC20");
    const tokenIn = await tokenFactory.deploy("Token In", "TIN", parse("1000000"));
    const tokenOut = await tokenFactory.deploy("Token Out", "TOUT", parse("1000000"));

    const arbitrage = await (await ethers.getContractFactory("Arbitrage")).deploy();

    // Tokens sitting in the contract, e.g. leftovers from earlier runs.
    await tokenIn.mint(await arbitrage.getAddress(), parse("500"));

    const maliciousRouter = await (await ethers.getContractFactory("MaliciousRouter")).deploy(parse("500"));

    await tokenIn.mint(attacker.address, parse("1"));
    await tokenIn.connect(attacker).approve(await arbitrage.getAddress(), parse("1"));

    return { owner, attacker, tokenIn, tokenOut, arbitrage, maliciousRouter };
  }

  const deadline = async () => (await ethers.provider.getBlock("latest"))!.timestamp + 600;

  it("rejects routers that the owner has not allowlisted", async () => {
    const { attacker, tokenIn, tokenOut, arbitrage, maliciousRouter } = await deployFixture();
    const router = await maliciousRouter.getAddress();

    await expect(
      arbitrage
        .connect(attacker)
        .executeArbitrage(
          await tokenIn.getAddress(),
          await tokenOut.getAddress(),
          parse("1"),
          router,
          router,
          50,
          0,
          await deadline()
        )
    ).to.be.revertedWith("router not allowed");
  });

  it("does not pay out on router-reported amounts, so contract funds cannot be drained", async () => {
    const { owner, attacker, tokenIn, tokenOut, arbitrage, maliciousRouter } = await deployFixture();
    const router = await maliciousRouter.getAddress();
    await arbitrage.connect(owner).setRouterAllowed(router, true);

    await expect(
      arbitrage
        .connect(attacker)
        .executeArbitrage(
          await tokenIn.getAddress(),
          await tokenOut.getAddress(),
          parse("1"),
          router,
          router,
          50,
          0,
          await deadline()
        )
    ).to.be.revertedWith("swap output short");

    expect(await tokenIn.balanceOf(await arbitrage.getAddress())).to.equal(parse("500"));
  });

  it("rejects expired deadlines", async () => {
    const { owner, attacker, tokenIn, tokenOut, arbitrage, maliciousRouter } = await deployFixture();
    const router = await maliciousRouter.getAddress();
    await arbitrage.connect(owner).setRouterAllowed(router, true);

    await expect(
      arbitrage
        .connect(attacker)
        .executeArbitrage(
          await tokenIn.getAddress(),
          await tokenOut.getAddress(),
          parse("1"),
          router,
          router,
          50,
          0,
          1
        )
    ).to.be.revertedWith("deadline passed");
  });

  it("only lets the owner manage the router allowlist", async () => {
    const { attacker, arbitrage, maliciousRouter } = await deployFixture();

    await expect(
      arbitrage.connect(attacker).setRouterAllowed(await maliciousRouter.getAddress(), true)
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("settles profit against a well-behaved router pair", async () => {
    const { owner, attacker, tokenIn, tokenOut, arbitrage } = await deployFixture();

    const routerFactory = await ethers.getContractFactory("MockRouter");
    const router1 = await routerFactory.deploy(2, 1); // tokenIn -> tokenOut at 2x
    const router2 = await routerFactory.deploy(1, 1); // tokenOut -> tokenIn at 1x

    await tokenOut.mint(await router1.getAddress(), parse("1000"));
    await tokenIn.mint(await router2.getAddress(), parse("1000"));

    await arbitrage.connect(owner).setRouterAllowed(await router1.getAddress(), true);
    await arbitrage.connect(owner).setRouterAllowed(await router2.getAddress(), true);

    const before = await tokenIn.balanceOf(attacker.address);
    await arbitrage
      .connect(attacker)
      .executeArbitrage(
        await tokenIn.getAddress(),
        await tokenOut.getAddress(),
        parse("1"),
        await router1.getAddress(),
        await router2.getAddress(),
        50,
        parse("1"),
        await deadline()
      );

    // 1 in -> 2 tokenOut -> 2 tokenIn back to the caller.
    expect(await tokenIn.balanceOf(attacker.address)).to.equal(before - parse("1") + parse("2"));
    expect(await tokenIn.balanceOf(await arbitrage.getAddress())).to.equal(parse("500"));
  });
});
