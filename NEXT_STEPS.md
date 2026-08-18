## Next steps & Checklist

Before merging this scaffold into `main`, follow this checklist:

- [ ] Replace placeholder router & token addresses in `.env.testnet.example` and `.env.example` with valid testnet addresses.
- [ ] Run all tests locally (`npx hardhat test`) and fix any failing tests.
- [ ] Optionally add Etherscan/BscScan API key as a secret `BSC_ETHERSCAN_API_KEY` for contract verification.
- [ ] Configure GitHub Secrets for CI if you plan to run network-dependent tests or verification workflows.
- [ ] Review `bot/executor.ts` and ensure `AUTO_EXECUTE` remains `false` until extensive testnet validation is complete.

When you're ready, open the PR using the link or `gh` CLI in CONTRIBUTING.md and merge after review.
