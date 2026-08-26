// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

library TokenUtils {
    function safeApprove(IERC20 token, address spender, uint amount) internal {
        token.approve(spender, 0);
        token.approve(spender, amount);
    }

    function safeTransfer(IERC20 token, address to, uint amount) internal {
        require(token.transfer(to, amount), "transfer failed");
    }

    function safeTransferFrom(IERC20 token, address from, address to, uint amount) internal {
        require(token.transferFrom(from, to, amount), "transferFrom failed");
    }
}
