import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
dotenv.config();

const RPC_TESTNET = process.env.RPC_URL_TESTNET || "";
const RPC_MAINNET = process.env.RPC_URL_MAINNET || "";
const PRIVATE_KEY = process.env.PRIVATE_KEY && /^0x[a-fA-F0-9]{64}$/.test(process.env.PRIVATE_KEY.trim()) ? process.env.PRIVATE_KEY.trim() : "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      viaIR: true
    }
  },

  networks: {
    hardhat: {},
    bscTestnet: {
      url: RPC_TESTNET,
      chainId: 97,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : []
    },
    bscMainnet: {
      url: RPC_MAINNET,
      chainId: 56,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : []
    }
  },

  etherscan: {
    apiKey: {
      bsc: process.env.BSC_ETHERSCAN_API_KEY || "",
      bscTestnet: process.env.BSC_ETHERSCAN_API_KEY || ""
    }
  },

  paths: {
    sources: "contracts",
    tests: "test",
    cache: "cache",
    artifacts: "artifacts"
  },

  mocha: {
    timeout: 200000
  }
};

export default config;
