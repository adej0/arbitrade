import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Arbitrage, MockERC20, MockFailingERC20, MockRouter } from "../typechain-types";

const ONE = ethers.parseEther("1");
const DEADLINE = 4_000_000_000;

async function deployFixture() {
  const [owner, other] = await ethers.getSigners();

  const ERC20Factory = await ethers.getContractFactory("MockERC20");
  const tokenIn = (await ERC20Factory.deploy("TokenIn", "TIN", ethers.parseEther("1000000"))) as MockERC20;
  const tokenOut = (await ERC20Factory.deploy("TokenOut", "TOUT", ethers.parseEther("1000000"))) as MockERC20;

  const RouterFactory = await ethers.getContractFactory("MockRouter");
  // router1: 1 tokenIn -> 2 tokenOut, router2: 1 tokenOut -> 1 tokenIn => net 2x
  const router1 = (await RouterFactory.deploy(2, 1)) as MockRouter;
  const router2 = (await RouterFactory.deploy(1, 1)) as MockRouter;

  const arbitrage = (await (await ethers.getContractFactory("Arbitrage")).deploy()) as Arbitrage;

  // fund routers so they can pay out swaps
  await tokenOut.mint(await router1.getAddress(), ethers.parseEther("1000000"));
  await tokenIn.mint(await router2.getAddress(), ethers.parseEther("1000000"));

  return { owner, other, tokenIn, tokenOut, router1, router2, arbitrage };
}

describe("Arbitrage", () => {
  let owner: HardhatEthersSigner;
  let other: HardhatEthersSigner;
  let tokenIn: MockERC20;
  let tokenOut: MockERC20;
  let router1: MockRouter;
  let router2: MockRouter;
  let arbitrage: Arbitrage;

  beforeEach(async () => {
    ({ owner, other, tokenIn, tokenOut, router1, router2, arbitrage } = await deployFixture());
  });

  describe("ownership", () => {
    it("assigns the deployer as owner", async () => {
      expect(await arbitrage.owner()).to.equal(owner.address);
    });

    it("lets the owner approve a router to spend a token", async () => {
      await arbitrage.approveToken(await tokenIn.getAddress(), await router1.getAddress(), ONE);
      expect(await tokenIn.allowance(await arbitrage.getAddress(), await router1.getAddress())).to.equal(ONE);
    });

    it("rejects approveToken from a non-owner", async () => {
      await expect(
        arbitrage.connect(other).approveToken(await tokenIn.getAddress(), await router1.getAddress(), ONE)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("rejects rescueToken from a non-owner", async () => {
      await expect(
        arbitrage.connect(other).rescueToken(await tokenIn.getAddress(), other.address, ONE)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("getAmountsOut", () => {
    it("forwards the quote from the router", async () => {
      const path = [await tokenIn.getAddress(), await tokenOut.getAddress()];
      const amounts = await arbitrage.getAmountsOut(await router1.getAddress(), ONE, path);
      expect(amounts.map((a) => a.toString())).to.deep.equal([ONE.toString(), (ONE * 2n).toString()]);
    });

    it("bubbles up router validation errors", async () => {
      await expect(
        arbitrage.getAmountsOut(await router1.getAddress(), ONE, [await tokenIn.getAddress()])
      ).to.be.revertedWith("bad path");
    });
  });

  describe("rescueToken", () => {
    it("transfers stuck tokens to the given recipient and emits Withdrawn", async () => {
      await tokenIn.transfer(await arbitrage.getAddress(), ONE);

      await expect(arbitrage.rescueToken(await tokenIn.getAddress(), other.address, ONE))
        .to.emit(arbitrage, "Withdrawn")
        .withArgs(await tokenIn.getAddress(), other.address, ONE);

      expect(await tokenIn.balanceOf(other.address)).to.equal(ONE);
      expect(await tokenIn.balanceOf(await arbitrage.getAddress())).to.equal(0n);
    });

    it("reverts when the token reports a failed transfer", async () => {
      const failing = (await (
        await ethers.getContractFactory("MockFailingERC20")
      ).deploy("Failing", "FAIL", ethers.parseEther("10"))) as MockFailingERC20;
      await failing.transfer(await arbitrage.getAddress(), ONE);
      await failing.setFailTransfer(true);

      await expect(
        arbitrage.rescueToken(await failing.getAddress(), other.address, ONE)
      ).to.be.revertedWith("rescue failed");
    });
  });

  describe("executeArbitrage", () => {
    const swap = (overrides: Partial<{ amountIn: bigint; slippageBps: bigint; minProfit: bigint }> = {}) => ({
      amountIn: ONE,
      slippageBps: 50n,
      minProfit: 0n,
      ...overrides,
    });

    beforeEach(async () => {
      await tokenIn.approve(await arbitrage.getAddress(), ethers.parseEther("1000"));
    });

    const execute = (args: ReturnType<typeof swap>) =>
      arbitrage.executeArbitrage(
        tokenIn.getAddress(),
        tokenOut.getAddress(),
        args.amountIn,
        router1.getAddress(),
        router2.getAddress(),
        args.slippageBps,
        args.minProfit,
        DEADLINE
      );

    it("returns the full output to the caller and emits ArbitrageExecuted", async () => {
      const before = await tokenIn.balanceOf(owner.address);

      await expect(execute(swap()))
        .to.emit(arbitrage, "ArbitrageExecuted")
        .withArgs(
          owner.address,
          await tokenIn.getAddress(),
          await tokenOut.getAddress(),
          ONE,
          ONE * 2n,
          ONE
        );

      // pays ONE in, receives 2 * ONE back
      expect(await tokenIn.balanceOf(owner.address)).to.equal(before + ONE);
      expect(await tokenIn.balanceOf(await arbitrage.getAddress())).to.equal(0n);
      expect(await tokenOut.balanceOf(await arbitrage.getAddress())).to.equal(0n);
    });

    it("leaves no residual router allowance for the input token", async () => {
      await execute(swap());
      expect(await tokenIn.allowance(await arbitrage.getAddress(), await router1.getAddress())).to.equal(0n);
    });

    it("rejects a zero amountIn", async () => {
      await expect(execute(swap({ amountIn: 0n }))).to.be.revertedWith("amountIn=0");
    });

    it("rejects a slippage above 100%", async () => {
      await expect(execute(swap({ slippageBps: 10001n }))).to.be.revertedWith("slippage>10000");
    });

    it("accepts the maximum slippage of 10000 bps", async () => {
      await expect(execute(swap({ slippageBps: 10000n }))).to.emit(arbitrage, "ArbitrageExecuted");
    });

    it("reverts when the round trip is not profitable", async () => {
      await router1.setRatio(1, 1);
      await expect(execute(swap())).to.be.revertedWith("no profit");
    });

    it("reverts when the round trip breaks even exactly", async () => {
      await router1.setRatio(1, 1);
      await router2.setRatio(1, 1);
      await expect(execute(swap())).to.be.revertedWith("no profit");
    });

    it("reverts when the profit is below minProfit", async () => {
      await expect(execute(swap({ minProfit: ONE * 2n }))).to.be.revertedWith("insufficient profit");
    });

    it("succeeds when the profit exactly meets minProfit", async () => {
      await expect(execute(swap({ minProfit: ONE }))).to.emit(arbitrage, "ArbitrageExecuted");
    });

    it("reverts when the caller has not approved the contract", async () => {
      await tokenIn.approve(await arbitrage.getAddress(), 0n);
      await expect(execute(swap())).to.be.revertedWith("ERC20: insufficient allowance");
    });

    it("reverts when the input token reports a failed transferFrom", async () => {
      const failing = (await (
        await ethers.getContractFactory("MockFailingERC20")
      ).deploy("Failing", "FAIL", ethers.parseEther("100"))) as MockFailingERC20;
      await failing.approve(await arbitrage.getAddress(), ethers.parseEther("100"));
      await failing.setFailTransferFrom(true);

      await expect(
        arbitrage.executeArbitrage(
          failing.getAddress(),
          tokenOut.getAddress(),
          ONE,
          router1.getAddress(),
          router2.getAddress(),
          50n,
          0n,
          DEADLINE
        )
      ).to.be.revertedWith("transferFrom failed");
    });
  });
});
