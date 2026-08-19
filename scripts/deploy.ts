import { ethers } from "hardhat";

async function main() {
  console.log("Deploying Arbitrage contract...");
  const Factory = await ethers.getContractFactory("Arbitrage");
  const arb = await Factory.deploy();
  await arb.waitForDeployment();
  console.log("Arbitrage deployed to:", await arb.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
