const { ethers } = require('ethers');
const fs = require('fs');
(async ()=>{
  try{
    const rpc='https://data-seed-prebsc-1-s1.binance.org:8545/';
    const provider=new ethers.JsonRpcProvider(rpc);
    const txHash='0x5042118b275816ee54e5ed14bdb8eadbb9633d512ca4133a46b2a1700d7d4ef8';
    const contract='0x7AA098f346740d6Ad31596d2B80E2F9FeB2fe7f4';
    const tokenW='0xae13d989dac2f0debff460ac112a837c89baa7cd';
    const tokenB='0xed24fc36d5ee211ea25a80239fb8c4cfd80f12ee';
    const signer='0xf00a8aa4da9a7857aae2a45c82a4b722717ae167';

    const receipt = await provider.getTransactionReceipt(txHash);
    const tx = await provider.getTransaction(txHash);
    const block = await provider.getBlock(receipt.blockNumber);

    const erc20 = new ethers.Interface(["function balanceOf(address) view returns (uint256)","event Transfer(address indexed from,address indexed to,uint256 value)"]);
    const transfers=[];
    for(const log of receipt.logs){
      try{
        const parsed = erc20.parseLog(log);
        transfers.push({token:log.address,from:parsed.args.from,to:parsed.args.to,value:parsed.args.value.toString()});
      }catch(e){}
    }

    const tokenWContract = new ethers.Contract(tokenW, ["function balanceOf(address) view returns (uint256)","function symbol() view returns (string)"], provider);
    const tokenBContract = new ethers.Contract(tokenB, ["function balanceOf(address) view returns (uint256)","function symbol() view returns (string)"], provider);
    const [wbalanceContract,bbalanceContract,wbalanceUser,bbalanceUser, wSymbol, bSymbol] = await Promise.all([
      tokenWContract.balanceOf(contract),
      tokenBContract.balanceOf(contract),
      tokenWContract.balanceOf(signer),
      tokenBContract.balanceOf(signer),
      tokenWContract.symbol().catch(()=>'WBNB'),
      tokenBContract.symbol().catch(()=>'BUSD')
    ]);

    const report = [];
    report.push('Arbitrage run report');
    report.push('TX: '+txHash);
    report.push('Block: '+receipt.blockNumber+' (timestamp '+new Date(block.timestamp*1000).toISOString()+')');
    report.push('From: '+tx.from+' To: '+tx.to+' Status: '+receipt.status+' GasUsed: '+receipt.gasUsed.toString());
    report.push('Transfers found:');
    for(const t of transfers){
      report.push(` - ${t.token} ${t.from} -> ${t.to} : ${t.value}`);
    }
    report.push('Current balances:');
    report.push(` - ${wSymbol} contract ${ethers.formatUnits(wbalanceContract,18)}`);
    report.push(` - ${bSymbol} contract ${ethers.formatUnits(bbalanceContract,18)}`);
    report.push(` - ${wSymbol} you ${ethers.formatUnits(wbalanceUser,18)}`);
    report.push(` - ${bSymbol} you ${ethers.formatUnits(bbalanceUser,18)}`);

    report.push('BscScan (testnet) link: https://testnet.bscscan.com/tx/'+txHash);

    const outPath='C:\\Users\\user\\.copilot\\session-state\\e6db8938-9342-4a73-8ca2-03eac442e998\\files\\arbitrage-run-report-'+Date.now()+'.txt';
    fs.writeFileSync(outPath, report.join('\n'));
    console.log('Report written to', outPath);
    console.log(report.join('\n'));
  }catch(e){console.error(e);process.exit(1);} 
})();