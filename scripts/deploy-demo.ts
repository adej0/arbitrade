import fs from "fs";
import path from "path";
import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const demoAccount = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
  const initialSupply = ethers.parseEther("1000000");

  const tokenFactory = await ethers.getContractFactory("MockERC20", deployer);
  const tokenA = await tokenFactory.deploy("Demo Token A", "DTA", initialSupply);
  const tokenB = await tokenFactory.deploy("Demo Token B", "DTB", initialSupply);

  const routerFactory = await ethers.getContractFactory("MockRouter", deployer);
  const router1 = await routerFactory.deploy(200, 100);
  const router2 = await routerFactory.deploy(150, 100);

  const arbitrageFactory = await ethers.getContractFactory("Arbitrage", deployer);
  const arbitrage = await arbitrageFactory.deploy();

  await tokenA.mint(demoAccount, ethers.parseEther("1000"));
  await tokenB.mint(demoAccount, ethers.parseEther("1000"));

  const market = {
    network: "localhost",
    rpcUrl: "http://127.0.0.1:8545",
    deployer: await deployer.getAddress(),
    trader: demoAccount,
    tokenA: await tokenA.getAddress(),
    tokenB: await tokenB.getAddress(),
    router1: await router1.getAddress(),
    router2: await router2.getAddress(),
    arbitrage: await arbitrage.getAddress(),
    sampleAmount: ethers.parseEther("1").toString(),
    generatedAt: new Date().toISOString(),
  };

  const outPath = path.join(__dirname, "..", "public", "demo-market.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(market, null, 2));

  console.log("Demo market deployed");
  console.log(JSON.stringify(market, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
