const { ethers } = require('ethers');
(async ()=>{
  try{
    const provider = new ethers.JsonRpcProvider('https://data-seed-prebsc-1-s1.binance.org:8545/');
    const contract = '0x7AA098f346740d6Ad31596d2B80E2F9FeB2fe7f4'.toLowerCase();
    const signer = '0xf00A8aa4Da9A7857aaE2A45C82A4b722717ae167'.toLowerCase();
    const latest = await provider.getBlockNumber();
    const start = Math.max(0, latest - 800);
    console.log('scanning blocks', start, '->', latest);
    let found = null;
    for(let b = latest; b >= start; b--) {
      // eth_getBlockByNumber with transactions
      const hex = '0x' + b.toString(16);
      const block = await provider.send('eth_getBlockByNumber', [hex, true]);
      if(!block || !block.transactions) continue;
      for(const tx of block.transactions) {
        if(!tx.to) continue;
        if(tx.to.toLowerCase() === contract && tx.from.toLowerCase() === signer) {
          // normalize tx fields to match ethers Transaction
          const foundTx = { hash: tx.hash, from: tx.from, to: tx.to, value: tx.value };
          found = { tx: foundTx, blockNumber: b };
          break;
        }
      }
      if(found) break;
    }
    if(!found) {
      console.log('No tx found to contract from signer in last', latest - start, 'blocks');
      return;
    }
    console.log('Found tx', found.tx.hash, 'in block', found.blockNumber);
    const receipt = await provider.getTransactionReceipt(found.tx.hash);
    console.log('status', receipt.status, 'gasUsed', receipt.gasUsed.toString());
    const ifaceERC = new ethers.Interface(["event Transfer(address indexed from,address indexed to,uint256 value)"]);
    const transfers = [];
    for(const log of receipt.logs){
      try{
        const parsed = ifaceERC.parseLog(log);
        transfers.push({ address: log.address, from: parsed.args.from, to: parsed.args.to, value: parsed.args.value.toString() });
      }catch(e){}
    }
    console.log('Transfers:', transfers);
    console.log('Raw logs count', receipt.logs.length);
    console.log('tx:', {hash: found.tx.hash, from: found.tx.from, to: found.tx.to, value: found.tx.value?.toString()});
    console.log('receipt summary:',{transactionHash:receipt.transactionHash,blockNumber:receipt.blockNumber,status:receipt.status,gasUsed:receipt.gasUsed.toString(),logsLength:receipt.logs.length});
    for(let i=0;i<Math.min(10,receipt.logs.length);i++){
      console.log('log',i,receipt.logs[i].address,receipt.logs[i].topics[0],receipt.logs[i].data);
    }
    // print block timestamp
    const blockInfo = await provider.getBlock(receipt.blockNumber);
    console.log('block timestamp', blockInfo.timestamp);
  }catch(e){
    console.error('error', e);
    process.exit(1);
  }
})();