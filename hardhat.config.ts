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

/**
 * A missing RPC URL or private key used to surface much later as an opaque connection or
 * "unknown account" failure, so the requirements of the network being targeted are checked
 * up-front and reported with the name of the variable that has to be set.
 */
function accountsFor(network: string): string[] {
  if (!isSelected(network)) {
    return PRIVATE_KEY ? [PRIVATE_KEY] : [];
  }

  if (!PRIVATE_KEY) {
    throw new Error(`PRIVATE_KEY must be set in the environment to use --network ${network}.`);
  }

  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(PRIVATE_KEY)) {
    throw new Error(
      `PRIVATE_KEY is not a valid 32-byte hex private key (expected 64 hex characters, optionally 0x-prefixed).`
    );
  }

  return [PRIVATE_KEY];
}

function rpcUrlFor(network: string, url: string, variable: string): string {
  if (isSelected(network) && !url) {
    throw new Error(`${variable} must be set in the environment to use --network ${network}.`);
  }

  return url;
}

function isSelected(network: string): boolean {
  const index = process.argv.indexOf("--network");
  return index !== -1 && process.argv[index + 1] === network;
}

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
      url: rpcUrlFor("bscTestnet", RPC_TESTNET, "RPC_URL_TESTNET"),
      chainId: 97,
      accounts: accountsFor("bscTestnet")
    },
    bscMainnet: {
      url: rpcUrlFor("bscMainnet", RPC_MAINNET, "RPC_URL_MAINNET"),
      chainId: 56,
      accounts: accountsFor("bscMainnet")
    }
  },

  etherscan: {
    // Etherscan / BscScan API keys (optionally set BSC_ETHERSCAN_API_KEY in .env)
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
