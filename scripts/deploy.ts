import "dotenv/config";
import { ethers } from "ethers";
import fs from "fs";

async function main() {
  const rpc = process.env.RPC_URL_MAINNET || "https://bsc-dataseed.binance.org/";
  const pk = process.env.PRIVATE_KEY || "";
  if (!pk) {
    throw new Error("PRIVATE_KEY is required");
  }

  const abi = JSON.parse(fs.readFileSync("artifacts/contracts/Arbitrage.sol/Arbitrage.json", "utf8")).abi;
  const bytecode = JSON.parse(fs.readFileSync("artifacts/contracts/Arbitrage.sol/Arbitrage.json", "utf8")).bytecode;
  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(pk, provider);
  console.log("Deployer:", await wallet.getAddress());

  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  console.log("Arbitrage deployed to:", await contract.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
