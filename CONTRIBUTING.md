# Contributing

Thank you for contributing to the BSC Arbitrage Bot scaffold.

Guidelines
- Use the `bsc-arb/init` branch for initial scaffold and development.
- Run tests locally before opening PRs.
- Do not commit secrets. Use `.env` (gitignored) or repository secrets in CI.

Local development steps
1. Clone the repo and checkout the branch:
   ```bash
   git clone git@github.com:adej0/arbitrade.git
   cd arbitrade
   git fetch origin
   git checkout bsc-arb/init
   ```

2. Install dependencies:
   ```bash
   npm ci
   ```

3. Compile & run tests:
   ```bash
   npx hardhat compile
   npx hardhat test
   ```

4. Run the scanner (testnet only):
   - Copy `.env.example` to `.env` and populate RPC, PRIVATE_KEY (testnet only), routers, WBNB and tokens.
   - Start scanner:
     ```bash
     npm run start:scanner
     ```

5. To open the PR from this branch into `main` using GitHub CLI:
   ```bash
   gh pr create --title "Initial BSC arbitrage bot scaffold" --body "Initial scaffold: contracts, scripts, bot, CI, and tests." --head bsc-arb/init --base main
   ```

If you prefer the web UI, visit the compare page:
https://github.com/adej0/arbitrade/compare/main...bsc-arb/init?expand=1

Security and safety
- Keep PRIVATE_KEY offline or use a dedicated test account on testnet.
- AUTO_EXECUTE is disabled by default. Thoroughly test on testnet before enabling any automatic execution.
