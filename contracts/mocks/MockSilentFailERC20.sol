// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Token that reports failures by returning false instead of reverting, like some
/// widely deployed non-standard ERC20s. Used to verify callers do not treat a false
/// return value as success.
contract MockSilentFailERC20 is ERC20 {
    bool public failTransfer;
    bool public failTransferFrom;
    bool public failApprove;

    constructor(uint initialSupply) ERC20("Silent Fail", "SFAIL") {
        _mint(msg.sender, initialSupply);
    }

    function mint(address to, uint amount) external {
        _mint(to, amount);
    }

    function setFailures(bool _transfer, bool _transferFrom, bool _approve) external {
        failTransfer = _transfer;
        failTransferFrom = _transferFrom;
        failApprove = _approve;
    }

    function transfer(address to, uint amount) public override returns (bool) {
        if (failTransfer) {
            return false;
        }
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint amount) public override returns (bool) {
        if (failTransferFrom) {
            return false;
        }
        return super.transferFrom(from, to, amount);
    }

    function approve(address spender, uint amount) public override returns (bool) {
        if (failApprove) {
            return false;
        }
        return super.approve(spender, amount);
    }
}
