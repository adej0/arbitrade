const LIVE_CONTRACT_ADDRESS = '0x7AA098f346740d6Ad31596d2B80E2F9FeB2fe7f4';
const BSC_TESTNET_CHAIN_ID = '0x61';
const BSC_TESTNET_RPC = 'https://data-seed-prebsc-1-s1.binance.org:8545/';
const WBNB_ADDRESS = '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd';
const ARBITRAGE_ABI = [
  'function owner() view returns (address)',
  'function approveToken(address token, address router, uint amount) external',
  'function getAmountsOut(address router, uint amountIn, address[] calldata path) external view returns (uint[] memory)',
  'function executeArbitrage(address tokenIn, address tokenOut, uint amountIn, address router1, address router2, uint slippageBps, uint minProfit, uint deadline) external returns (uint finalBalance, uint profit)'
];
const WBNB_ABI = [
  'function deposit() payable',
  'function withdraw(uint256 wad) external',
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)'
];
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function symbol() view returns (string)'
];

const statusEl = document.getElementById('status');
const phaseEl = document.getElementById('phase');
const networkEl = document.getElementById('network');
const walletEl = document.getElementById('wallet');
const bnbBalanceEl = document.getElementById('bnb-balance');
const wbnbBalanceEl = document.getElementById('wbnb-balance');
const ownerEl = document.getElementById('owner');
const contractStatusEl = document.getElementById('contract-status');

const state = {
  provider: null,
  signer: null,
  signerAddress: null,
  contract: null,
  contractAddress: LIVE_CONTRACT_ADDRESS,
  approved: false,
};

function setPhase(phase) {
  phaseEl.textContent = phase;
}

function log(message) {
  statusEl.textContent = `${message}\n${statusEl.textContent}`;
}

function readField(id) {
  return document.getElementById(id).value.trim();
}

function normalizeAddress(value, label) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  try {
    return ethers.getAddress(trimmed);
  } catch (error) {
    const lower = trimmed.toLowerCase();
    if (ethers.isAddress(lower)) {
      return ethers.getAddress(lower);
    }

    throw new Error(`Invalid ${label} address: ${trimmed}. Use the exact checksum case from BscScan or a lowercase/valid address.`);
  }
}

function ensureWallet() {
  if (!state.provider || !state.signerAddress) {
    throw new Error('Please connect your wallet first.');
  }
}

function setNetworkLabel(chainId) {
  if (!chainId) {
    networkEl.textContent = 'not connected';
    return;
  }

  const label = Number(chainId) === 97 ? 'BSC Testnet' : `Chain ${chainId}`;
  networkEl.textContent = label;
}

async function updateWalletBalances() {
  if (!state.provider || !state.signerAddress) {
    return;
  }

  const network = await state.provider.getNetwork();
  const balance = await state.provider.getBalance(state.signerAddress);
  const wbnb = new ethers.Contract(WBNB_ADDRESS, WBNB_ABI, state.provider);
  const wrappedBalanceRaw = await wbnb.balanceOf(state.signerAddress).catch(() => 0n);

  bnbBalanceEl.textContent = `${ethers.formatEther(balance)} BNB`;
  wbnbBalanceEl.textContent = `${ethers.formatEther(wrappedBalanceRaw)} WBNB`;
  setNetworkLabel(network.chainId.toString());
}

async function connectWallet() {
  if (!window.ethereum) {
    throw new Error('MetaMask or a compatible wallet is required.');
  }

  const provider = new ethers.BrowserProvider(window.ethereum);
  state.provider = provider;

  const accounts = await provider.send('eth_requestAccounts', []);
  state.signer = await provider.getSigner();
  state.signerAddress = accounts[0] || await state.signer.getAddress();
  walletEl.textContent = state.signerAddress;
  setPhase('Wallet connected');

  const network = await provider.getNetwork();
  setNetworkLabel(network.chainId.toString());

  if (Number(network.chainId) !== 97) {
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: BSC_TESTNET_CHAIN_ID }],
      });
      const updatedNetwork = await provider.getNetwork();
      setNetworkLabel(updatedNetwork.chainId.toString());
    } catch (switchError) {
      log(`Network switch failed: ${switchError.message}`);
    }
  }

  await updateWalletBalances();
  log(`Wallet connected: ${state.signerAddress}`);
}

async function loadContract() {
  ensureWallet();

  const contractAddress = normalizeAddress(readField('contract-address') || LIVE_CONTRACT_ADDRESS, 'contract');
  state.contractAddress = contractAddress;
  state.contract = new ethers.Contract(contractAddress, ARBITRAGE_ABI, state.signer || state.provider);

  const owner = await state.contract.owner();
  ownerEl.textContent = owner;
  contractStatusEl.textContent = contractAddress;
  setPhase('Contract loaded');
  log(`Contract ready at ${contractAddress}. Owner: ${owner}`);
}

async function approveContract(forceMax = false) {
  // Approve the Arbitrage contract to transfer user's tokenIn (ERC20 approve)
  if (!state.contract) {
    throw new Error('Load the contract first.');
  }

  const tokenIn = normalizeAddress(readField('token-in'), 'token in');
  const amountIn = readField('amount-in');

  if (!tokenIn || !amountIn) {
    throw new Error('Please fill in token and amount fields.');
  }

  const useMax = forceMax || Boolean(document.getElementById('approve-max') && document.getElementById('approve-max').checked);
  const token = new ethers.Contract(tokenIn, ERC20_ABI.concat(['function approve(address,uint256) returns (bool)']), state.signer);

  let approveAmount;
  if (useMax) {
    approveAmount = (1n << 256n) - 1n;
    setPhase('Sending approval to contract (max allowance)');
  } else {
    approveAmount = ethers.parseUnits(amountIn, 18);
    setPhase('Sending approval to contract');
  }

  const tx = await token.approve(state.contractAddress, approveAmount);
  log(`Approve tx submitted: ${tx.hash}`);

  const receipt = await tx.wait();
  setPhase('Approval confirmed');
  log(`Token approve${useMax ? ' (max)' : ''} confirmed in block ${receipt.blockNumber}.`);
}

async function wrapBnb() {
  ensureWallet();
  const network = await state.provider.getNetwork();
  if (Number(network.chainId) !== 97) {
    throw new Error('Switch MetaMask to BSC Testnet (97) before wrapping BNB.');
  }

  const amount = readField('amount-in') || '0.01';
  const value = ethers.parseEther(amount);

  // sanity checks: ensure user has native BNB available
  const nativeBalance = await state.provider.getBalance(state.signerAddress);
  log(`Native BNB balance: ${ethers.formatEther(nativeBalance)}. Attempting to wrap: ${amount} BNB`);
  // leave small gas buffer (0.001 BNB)
  const gasBuffer = ethers.parseEther('0.001');
  if (BigInt(nativeBalance.toString()) < BigInt(value.toString()) + BigInt(gasBuffer.toString())) {
    throw new Error(`Insufficient native BNB to wrap ${amount}. Fund wallet or reduce amount. Keep ~0.001 BNB for gas.`);
  }

  const wbnb = new ethers.Contract(WBNB_ADDRESS, WBNB_ABI, state.signer);

  setPhase('Wrapping BNB');
  try {
    // Some RPCs estimateGas without value and fail; set a conservative gasLimit and include value explicitly.
    const tx = await wbnb.deposit({ value, gasLimit: 100000 });
    log(`Wrapping BNB: ${tx.hash}`);
    const receipt = await tx.wait();
    const balance = await wbnb.balanceOf(state.signerAddress);
    const wrapped = ethers.formatEther(balance);
    await updateWalletBalances();
    setPhase('Wrapped WBNB');
    log(`BNB wrapped successfully. WBNB balance: ${wrapped} in block ${receipt.blockNumber}.`);
  } catch (err) {
    log(`Wrap attempt failed: ${err.message}`);
    // fallback: construct raw transaction via signer (some wallets accept this better)
    try {
      const iface = new ethers.Interface(WBNB_ABI);
      const data = iface.encodeFunctionData('deposit', []);
      const rawTx = await state.signer.sendTransaction({ to: WBNB_ADDRESS, data, value, gasLimit: 100000 });
      log(`Wrapping BNB (fallback) submitted: ${rawTx.hash}`);
      const receipt2 = await rawTx.wait();
      const balance2 = await wbnb.balanceOf(state.signerAddress);
      const wrapped2 = ethers.formatEther(balance2);
      await updateWalletBalances();
      setPhase('Wrapped WBNB');
      log(`BNB wrapped successfully (fallback). WBNB balance: ${wrapped2} in block ${receipt2.blockNumber}.`);
    } catch (err2) {
      log(`Fallback wrap failed: ${err2.message}`);
      throw new Error(`Wrap failed: ${err.message}; fallback: ${err2.message}`);
    }
  }
}

// convenience: wrap more using the same button so user can top-up quickly
const wrapMoreBtn = document.getElementById('wrap-more');
if (wrapMoreBtn) {
  wrapMoreBtn.addEventListener('click', async () => {
    try {
      await wrapBnb();
    } catch (err) {
      log(`Error: ${err.message}`);
    }
  });
}

// force max approval button
const approveMaxBtn = document.getElementById('approve-contract-max');
if (approveMaxBtn) {
  approveMaxBtn.addEventListener('click', async () => {
    try {
      await approveContract(true);
    } catch (err) {
      log(`Error: ${err.message}`);
    }
  });
}

async function autoFillKnownRouters() {
  if (!state.provider) {
    throw new Error('Connect your wallet first before auto-filling routers.');
  }

  const network = await state.provider.getNetwork();
  // Always set a sensible default for router-1 (Pancake testnet)
  const pancakeTest = '0xD99D1c33F9fC3444f8101754aBC46c52416550D1';
  document.getElementById('router-1').value = pancakeTest;

  // Chain-aware candidate lists (non-exhaustive)
  const knownCandidates = {
    '97': [ // BSC Testnet
      '0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8', // BiSwap (commonly referenced; may be mainnet)
      '0xD99D1c33F9fC3444f8101754aBC46c52416550D1', // Pancake test (also a router)
      '0x05fF2B0DB69458A0750badebc4f9e13aDd608C7F'  // Example (may not exist on testnet)
    ],
    '56': [ // BSC Mainnet
      '0x10ED43C718714eb63d5aA57B78B54704E256024E', // PancakeSwap v2 router
      '0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8', // BiSwap mainnet
      '0xCDe540d7eAFE93aC5fE6233Bee57E1270D3E330F'  // BakerySwap
    ]
  };

  const chainId = String(network.chainId || '97');
  const candidates = (knownCandidates[chainId] || []).concat(document.getElementById('router-2').value || '');

  const found = [];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const code = await state.provider.getCode(c);
      const ok = code && code !== '0x';
      found.push({ address: c, hasCode: ok });
      log(`Probe ${c}: ${ok ? 'contract' : 'no code'} (${chainId})`);
      if (ok) {
        // prefer the first contract found that differs from router-1
        if (c.toLowerCase() !== pancakeTest.toLowerCase()) {
          document.getElementById('router-2').value = c;
          log(`Auto-filled router-2 with ${c}`);
          return;
        }
      }
    } catch (err) {
      found.push({ address: c, hasCode: false, error: err.message });
      log(`Probe ${c}: error (${err.message})`);
    }
  }

  // If none found, log summary and guidance
  log('No router candidate with deployed code was found on the connected RPC. Results:');
  found.forEach(f => log(`${f.address} => ${f.hasCode ? 'contract' : 'no code'}`));
  log('If nothing appears, confirm MetaMask is on the intended network (BSC Testnet = chainId 97). You can also paste a router address into the Router 2 field manually.');

  // Helpful suggestion: set a tested router and min-profit if available (recommended)
  try {
    const tested = '0xcde540d7eafe93ac5fe6233bee57e1270d3e330f';
    document.getElementById('router-2').value = tested;
    document.getElementById('min-profit').value = '0.03';
    log(`Suggested router-2: ${tested} and min-profit 0.03 WBNB (based on live probe). Click Preflight then Execute if you want to try this route.`);
  } catch (e) {
    // DOM may not be available in some contexts
  }
}

async function checkRoute() {
  ensureWallet();
  if (!state.contract) {
    throw new Error('Load the contract first.');
  }

  const tokenIn = normalizeAddress(readField('token-in'), 'token in');
  const tokenOut = normalizeAddress(readField('token-out'), 'token out');
  const router1 = normalizeAddress(readField('router-1'), 'router 1');
  const router2 = normalizeAddress(readField('router-2'), 'router 2');
  const amountIn = readField('amount-in');

  if (!amountIn || Number(amountIn) <= 0) {
    throw new Error('Amount in must be greater than zero.');
  }

  const path1 = [tokenIn, tokenOut];
  const path2 = [tokenOut, tokenIn];
  const parsedAmount = ethers.parseUnits(amountIn, 18);

  setPhase('Checking route');
  const [out1, out2, router1Code, router2Code] = await Promise.all([
    state.contract.getAmountsOut(router1, parsedAmount, path1).catch(() => null),
    state.contract.getAmountsOut(router2, parsedAmount, path2).catch(() => null),
    state.provider.getCode(router1),
    state.provider.getCode(router2)
  ]);

  if (!router1Code || router1Code === '0x') {
    throw new Error(`Router 1 is not a contract: ${router1}`);
  }

  if (!router2Code || router2Code === '0x') {
    throw new Error(`Router 2 is not a contract on the selected chain: ${router2}. Confirm you're connected to BSC Testnet (chainId 97) and that the router address is correct for testnet (the default Pancake test router is 0xD99D1c33F9fC3444f8101754aBC46c52416550D1). If this address is on another chain or is an EOA, pick a different router.`);
  }

  if (!out1 || out1.length < 2) {
    throw new Error(`No valid route from ${tokenIn} to ${tokenOut} on router 1: ${router1}`);
  }

  if (!out2 || out2.length < 2) {
    throw new Error(`No valid reverse route from ${tokenOut} to ${tokenIn} on router 2: ${router2}`);
  }

  const out1Val = ethers.formatUnits(out1[1], 18);
  const out2Val = ethers.formatUnits(out2[1], 18);
  log(`Route check passed. Router1 output: ${out1Val}. Router2 reverse output: ${out2Val}.`);
  setPhase('Route valid');
}

async function preflightCheck() {
  ensureWallet();

  const network = await state.provider.getNetwork();
  const balance = await state.provider.getBalance(state.signerAddress);
  const bnbBalance = ethers.formatEther(balance);

  if (Number(network.chainId) !== 97) {
    throw new Error(`Your wallet is on chain ${network.chainId}. Switch MetaMask to BSC Testnet (97) before trading.`);
  }

  if (Number(balance) <= 0) {
    throw new Error(`No BNB balance on BSC Testnet for ${state.signerAddress}. Fund the wallet with testnet BNB first.`);
  }

  const tokenIn = normalizeAddress(readField('token-in'), 'token in');
  const tokenOut = normalizeAddress(readField('token-out'), 'token out');
  const router1 = normalizeAddress(readField('router-1'), 'router 1');
  const router2 = normalizeAddress(readField('router-2'), 'router 2');
  const amountIn = readField('amount-in');

  if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
    throw new Error('Token in and token out must be different addresses.');
  }

  if (!amountIn || Number(amountIn) <= 0) {
    throw new Error('Amount in must be greater than zero.');
  }

  const tokenContract = new ethers.Contract(tokenIn, ERC20_ABI, state.provider);
  const [tokenBalanceRaw, tokenAllowanceRaw, tokenSymbol] = await Promise.all([
    tokenContract.balanceOf(state.signerAddress),
    tokenContract.allowance(state.signerAddress, state.contractAddress),
    tokenContract.symbol().catch(() => 'UNKNOWN')
  ]);

  const tokenBalance = ethers.formatUnits(tokenBalanceRaw, 18);
  const tokenAllowance = ethers.formatUnits(tokenAllowanceRaw, 18);

  if (Number(tokenBalance) <= 0) {
    throw new Error(`Your wallet has no ${tokenSymbol} balance to trade. You need tokenIn in the same wallet on BSC Testnet.`);
  }

  if (Number(tokenAllowance) < Number(amountIn)) {
    throw new Error(`Token allowance is too low for ${tokenSymbol}. Approve the router before executing the trade.`);
  }

  try {
    const path = [tokenIn, tokenOut];
    const amountOut = await state.contract.getAmountsOut(router1, ethers.parseUnits(amountIn, 18), path);
    if (!amountOut || amountOut.length < 2) {
      throw new Error('Router path check returned no valid output estimate.');
    }
    log(`Preflight passed. Network: BSC Testnet. Wallet BNB: ${bnbBalance}. ${tokenSymbol} balance: ${tokenBalance}. Route estimate: ${ethers.formatUnits(amountOut[1], 18)}.`);
  } catch (routeError) {
    throw new Error(`No valid arbitrage route found for this pair on the selected routers. This usually means the token pair or liquidity does not exist on-chain, or the selected amount is too large. ${routeError.message}`);
  }

  setPhase('Preflight OK');
}

async function executeTrade() {
  if (!state.contract) {
    throw new Error('Load the contract first.');
  }

  ensureWallet();

  const tokenIn = normalizeAddress(readField('token-in'), 'token in');
  const tokenOut = normalizeAddress(readField('token-out'), 'token out');
  const router1 = normalizeAddress(readField('router-1'), 'router 1');
  const router2 = normalizeAddress(readField('router-2'), 'router 2');
  const amountIn = readField('amount-in');
  const slippageBps = Number(readField('slippage-bps') || '50');
  const minProfit = readField('min-profit') || '0';
  const deadline = Math.floor(Date.now() / 1000) + 600;

  if (!tokenIn || !tokenOut || !router1 || !router2 || !amountIn) {
    throw new Error('Please fill in token, router, and trade parameters before executing.');
  }

  const parsedAmount = ethers.parseUnits(amountIn, 18);
  const parsedMinProfit = ethers.parseUnits(minProfit, 18);

  // If tokenIn is WBNB, ensure wrapped balance and allowance — auto-wrap and auto-approve if needed
  if (tokenIn.toLowerCase() === WBNB_ADDRESS.toLowerCase()) {
    const wbnb = new ethers.Contract(WBNB_ADDRESS, WBNB_ABI.concat(['function allowance(address,address) view returns (uint256)']), state.signer);
    const balance = await wbnb.balanceOf(state.signerAddress);
    if (BigInt(balance.toString()) < BigInt(parsedAmount.toString())) {
      log('WBNB balance too low — attempting to wrap native BNB now.');
      await wrapBnb();
    }

    const allowance = await wbnb.allowance(state.signerAddress, state.contractAddress);
    if (BigInt(allowance.toString()) < BigInt(parsedAmount.toString())) {
      log('WBNB allowance too low — attempting to approve max automatically.');
      // force max approval
      await approveContract(true);
    }
  }

  // Run an eth_call simulation first to capture revert reasons early (provider.call)
  setPhase('Simulating execution (eth_call)');
  try {
    const iface = new ethers.Interface(ARBITRAGE_ABI);
    const data = iface.encodeFunctionData('executeArbitrage', [
      tokenIn,
      tokenOut,
      parsedAmount,
      router1,
      router2,
      slippageBps,
      parsedMinProfit,
      deadline
    ]);

    // provider.call will throw with revert data when the contract reverts
    await state.provider.call({ to: state.contractAddress, from: state.signerAddress, data });
    log('Simulation succeeded — sending transaction now.');
  } catch (simErr) {
    // Try to surface a useful message and decode common revert reasons
    let msg = simErr?.error?.message || simErr?.message || JSON.stringify(simErr);
    const revertData = simErr?.error?.data || simErr?.data || null;
    if (revertData && typeof revertData === 'string' && revertData !== '0x') {
      try {
        // standard Error(string) selector 0x08c379a0 -> abi-encoded string follows
        if (revertData.startsWith('0x08c379a0')) {
          const reason = ethers.toUtf8String('0x' + revertData.slice(10));
          msg = reason;
        } else {
          msg = `Revert data: ${revertData}`;
        }
      } catch (e) {
        msg = `Revert decoding failed: ${e.message}`;
      }
    }

    log(`Simulation failed: ${msg}`);
    throw new Error(`Simulation failed: ${msg}`);
  }

  setPhase('Execution pending');
  const tx = await state.contract.executeArbitrage(
    tokenIn,
    tokenOut,
    parsedAmount,
    router1,
    router2,
    slippageBps,
    parsedMinProfit,
    deadline
  );

  log(`Execution submitted: ${tx.hash}`);
  const receipt = await tx.wait();
  setPhase('Execution complete');
  log(`Trade executed in block ${receipt.blockNumber}.`);
}

document.getElementById('connect-wallet').addEventListener('click', async () => {
  try {
    await connectWallet();
  } catch (error) {
    log(`Error: ${error.message}`);
  }
});

document.getElementById('load-contract').addEventListener('click', async () => {
  try {
    await loadContract();
  } catch (error) {
    log(`Error: ${error.message}`);
  }
});

document.getElementById('wrap-bnb').addEventListener('click', async () => {
  try {
    await wrapBnb();
  } catch (error) {
    log(`Error: ${error.message}`);
  }
});

document.getElementById('check-route').addEventListener('click', async () => {
  try {
    await checkRoute();
  } catch (error) {
    log(`Error: ${error.message}`);
  }
});

// Router presets and autofill
const presets = document.getElementById('router-presets');
if (presets) {
  presets.addEventListener('change', (e) => {
    const v = e.target.value;
    if (v === 'pancake-test') {
      document.getElementById('router-1').value = '0xD99D1c33F9fC3444f8101754aBC46c52416550D1';
      document.getElementById('router-2').value = '';
    } else if (v === 'pancake-main') {
      document.getElementById('router-1').value = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
      document.getElementById('router-2').value = '';
    }
  });
}

const autoFillBtn = document.getElementById('auto-fill-routers');
if (autoFillBtn) {
  autoFillBtn.addEventListener('click', async () => {
    try {
      await autoFillKnownRouters();
    } catch (error) {
      log(`Error: ${error.message}`);
    }
  });
}

document.getElementById('preflight-check').addEventListener('click', async () => {
  try {
    await preflightCheck();
  } catch (error) {
    log(`Error: ${error.message}`);
  }
});

document.getElementById('approve-contract').addEventListener('click', async () => {
  try {
    await approveContract();
  } catch (error) {
    log(`Error: ${error.message}`);
  }
});

document.getElementById('execute-trade').addEventListener('click', async () => {
  try {
    await executeTrade();
  } catch (error) {
    log(`Error: ${error.message}`);
  }
});

// Diagnostics: show allowance, balances and attempt a callStatic simulation
async function runDiagnostics() {
  ensureWallet();
  if (!state.contract) {
    throw new Error('Load the contract first.');
  }

  const tokenIn = normalizeAddress(readField('token-in'), 'token in');
  const amountIn = readField('amount-in');
  const parsedAmount = ethers.parseUnits(amountIn, 18);

  const tokenContract = new ethers.Contract(tokenIn, ERC20_ABI.concat(['function allowance(address,address) view returns (uint256)']), state.provider);
  const [balanceRaw, allowanceRaw] = await Promise.all([
    tokenContract.balanceOf(state.signerAddress).catch(() => 0n),
    tokenContract.allowance(state.signerAddress, state.contractAddress).catch(() => 0n)
  ]);

  log(`Diagnostics: ${ethers.formatUnits(balanceRaw, 18)} balance; allowance to contract: ${ethers.formatUnits(allowanceRaw, 18)}`);

  // Simulate via provider.call to reveal revert reason
  try {
    setPhase('Running simulation (diagnostics)');
    const iface = new ethers.Interface(ARBITRAGE_ABI);
    const data = iface.encodeFunctionData('executeArbitrage', [
      tokenIn,
      normalizeAddress(readField('token-out'), 'token out'),
      parsedAmount,
      normalizeAddress(readField('router-1'), 'router 1'),
      normalizeAddress(readField('router-2'), 'router 2'),
      Number(readField('slippage-bps') || '50'),
      ethers.parseUnits(readField('min-profit') || '0', 18),
      Math.floor(Date.now() / 1000) + 600
    ]);

    await state.provider.call({ to: state.contractAddress, from: state.signerAddress, data });
    log('Simulation succeeded (diagnostics).');
  } catch (err) {
    let msg = err?.error?.message || err?.message || JSON.stringify(err);
    const revertData = err?.error?.data || err?.data || null;
    if (revertData && typeof revertData === 'string' && revertData !== '0x') {
      try {
        if (revertData.startsWith('0x08c379a0')) {
          msg = ethers.toUtf8String('0x' + revertData.slice(10));
        } else {
          msg = `Revert data: ${revertData}`;
        }
      } catch (e) {
        msg = `Revert decode failed: ${e.message}`;
      }
    }
    log(`Simulation error (diagnostics): ${msg}`);
  } finally {
    setPhase('Diagnostics complete');
  }
}

const diagBtn = document.getElementById('diagnostics');
if (diagBtn) {
  diagBtn.addEventListener('click', async () => {
    try {
      await runDiagnostics();
    } catch (err) {
      log(`Error: ${err.message}`);
    }
  });
}

setPhase('Waiting for wallet');
log('Ready. Connect your MetaMask wallet to continue.');
