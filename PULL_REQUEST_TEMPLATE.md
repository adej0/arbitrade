# Initial PR for BSC arbitrage bot scaffold

This PR adds a full scaffold for the BSC arbitrage bot project including:

- Solidity contracts (Arbitrage.sol and mock contracts)
- Hardhat config and deployment+verification scripts
- Node.js bot scanner and executor (ethers v6)
- Telegram alerts and CSV logging
- Unit tests using mock routers/tokens
- CI workflow (compile + tests)
- README and .env.example

Notes:
- AUTO_EXECUTE is disabled by default. Do not enable automatic execution on mainnet without extensive testing.
- Populate .env with RPC URLs, PRIVATE_KEY, router addresses and tokens before running the bot.
