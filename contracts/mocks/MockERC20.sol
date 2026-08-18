// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_, uint initialSupply) ERC20(name_, symbol_) {
        _mint(msg.sender, initialSupply);
    }

    function mint(address to, uint amount) external {
        _mint(to, amount);
    }
}
