import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
dotenv.config();

/**
 * Hardhat configuration for BSC testnet & mainnet.
 *
 * Reads RPC and private key from environment variables:
 * - RPC_URL_TESTNET
 * - RPC_URL_MAINNET
 * - PRIVATE_KEY
 *
 * Optional:
 * - BSC_ETHERSCAN_API_KEY for contract verification
 *
 * Notes:
 * - Do NOT commit real private keys to VCS. Use .env (gitignored).
 */

const RPC_TESTNET = process.env.RPC_URL_TESTNET || "";
const RPC_MAINNET = process.env.RPC_URL_MAINNET || "";
const PRIVATE_KEY = process.env.PRIVATE_KEY && process.env.PRIVATE_KEY.length > 0 ? process.env.PRIVATE_KEY : "";
const BSCSCAN_API_KEY = process.env.BSC_ETHERSCAN_API_KEY || "";
const bscNetwork = (url: string, chainId: number) => ({
  url,
  chainId,
  accounts: PRIVATE_KEY ? [PRIVATE_KEY] : []
});

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },

  networks: {
    hardhat: {
      // default hardhat config
    },
    bscTestnet: {
      ...bscNetwork(RPC_TESTNET, 97)
    },
    bscMainnet: {
      ...bscNetwork(RPC_MAINNET, 56)
    }
  },

  etherscan: {
    // Etherscan / BscScan API keys (optionally set BSC_ETHERSCAN_API_KEY in .env)
    apiKey: {
      bsc: BSCSCAN_API_KEY,
      bscTestnet: BSCSCAN_API_KEY
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
