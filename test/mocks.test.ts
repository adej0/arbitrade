import { expect } from "chai";
import { ethers } from "hardhat";
import { MockERC20, MockRouter } from "../typechain-types";

const ONE = ethers.parseEther("1");
const DEADLINE = 4_000_000_000;

describe("MockERC20", () => {
  let token: MockERC20;

  beforeEach(async () => {
    token = (await (await ethers.getContractFactory("MockERC20")).deploy("Token", "TKN", ONE)) as MockERC20;
  });

  it("mints the initial supply to the deployer", async () => {
    const [owner] = await ethers.getSigners();
    expect(await token.name()).to.equal("Token");
    expect(await token.symbol()).to.equal("TKN");
    expect(await token.totalSupply()).to.equal(ONE);
    expect(await token.balanceOf(owner.address)).to.equal(ONE);
  });

  it("mints to an arbitrary address", async () => {
    const [, other] = await ethers.getSigners();
    await token.mint(other.address, ONE);
    expect(await token.balanceOf(other.address)).to.equal(ONE);
    expect(await token.totalSupply()).to.equal(ONE * 2n);
  });
});

describe("MockRouter", () => {
  let router: MockRouter;
  let tokenA: MockERC20;
  let tokenB: MockERC20;

  beforeEach(async () => {
    const erc20 = await ethers.getContractFactory("MockERC20");
    tokenA = (await erc20.deploy("A", "A", ethers.parseEther("1000"))) as MockERC20;
    tokenB = (await erc20.deploy("B", "B", ethers.parseEther("1000"))) as MockERC20;
    router = (await (await ethers.getContractFactory("MockRouter")).deploy(3, 2)) as MockRouter;
    await tokenB.mint(await router.getAddress(), ethers.parseEther("1000"));
  });

  it("rejects a zero denominator at construction", async () => {
    await expect((await ethers.getContractFactory("MockRouter")).deploy(1, 0)).to.be.revertedWith("den=0");
  });

  it("exposes the configured ratio and allows updating it", async () => {
    expect(await router.num()).to.equal(3n);
    expect(await router.den()).to.equal(2n);

    await router.setRatio(5, 4);
    expect(await router.num()).to.equal(5n);
    expect(await router.den()).to.equal(4n);
  });

  describe("getAmountsOut", () => {
    it("applies the ratio once per hop", async () => {
      const path = [await tokenA.getAddress(), await tokenB.getAddress(), await tokenA.getAddress()];
      const amounts = await router.getAmountsOut(ONE, path);
      expect(amounts[0]).to.equal(ONE);
      expect(amounts[1]).to.equal((ONE * 3n) / 2n);
      expect(amounts[2]).to.equal(((ONE * 3n) / 2n) * 3n / 2n);
    });

    it("reverts on a path shorter than two hops", async () => {
      await expect(router.getAmountsOut(ONE, [await tokenA.getAddress()])).to.be.revertedWith("bad path");
    });
  });

  describe("swapExactTokensForTokens", () => {
    it("pulls the input token and pays the ratio-derived output to the recipient", async () => {
      const [owner, recipient] = await ethers.getSigners();
      await tokenA.approve(await router.getAddress(), ONE);

      const path = [await tokenA.getAddress(), await tokenB.getAddress()];
      await router.swapExactTokensForTokens(ONE, 0, path, recipient.address, DEADLINE);

      expect(await tokenA.balanceOf(await router.getAddress())).to.equal(ONE);
      expect(await tokenB.balanceOf(recipient.address)).to.equal((ONE * 3n) / 2n);
      expect(await tokenA.balanceOf(owner.address)).to.equal(ethers.parseEther("1000") - ONE);
    });

    it("ignores amountOutMin, as the mock performs no slippage check", async () => {
      const [, recipient] = await ethers.getSigners();
      await tokenA.approve(await router.getAddress(), ONE);

      const path = [await tokenA.getAddress(), await tokenB.getAddress()];
      await router.swapExactTokensForTokens(ONE, ethers.parseEther("1000"), path, recipient.address, DEADLINE);

      expect(await tokenB.balanceOf(recipient.address)).to.equal((ONE * 3n) / 2n);
    });

    it("reverts when the caller has not approved the router", async () => {
      const [, recipient] = await ethers.getSigners();
      const path = [await tokenA.getAddress(), await tokenB.getAddress()];
      await expect(
        router.swapExactTokensForTokens(ONE, 0, path, recipient.address, DEADLINE)
      ).to.be.revertedWith("ERC20: insufficient allowance");
    });

    it("reverts when the router cannot cover the output amount", async () => {
      const [, recipient] = await ethers.getSigners();
      const drained = (await (await ethers.getContractFactory("MockRouter")).deploy(3, 2)) as MockRouter;
      await tokenA.approve(await drained.getAddress(), ONE);

      const path = [await tokenA.getAddress(), await tokenB.getAddress()];
      await expect(
        drained.swapExactTokensForTokens(ONE, 0, path, recipient.address, DEADLINE)
      ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
    });
  });
});
