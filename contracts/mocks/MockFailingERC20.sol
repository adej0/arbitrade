// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev ERC20 whose transfer/transferFrom return false instead of reverting,
/// used to exercise callers that check the boolean return value.
contract MockFailingERC20 is ERC20 {
    bool public failTransfer;
    bool public failTransferFrom;

    constructor(string memory name_, string memory symbol_, uint initialSupply) ERC20(name_, symbol_) {
        _mint(msg.sender, initialSupply);
    }

    function setFailTransfer(bool value) external {
        failTransfer = value;
    }

    function setFailTransferFrom(bool value) external {
        failTransferFrom = value;
    }

    function mint(address to, uint amount) external {
        _mint(to, amount);
    }

    function transfer(address to, uint amount) public override returns (bool) {
        if (failTransfer) return false;
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint amount) public override returns (bool) {
        if (failTransferFrom) return false;
        return super.transferFrom(from, to, amount);
    }
}
