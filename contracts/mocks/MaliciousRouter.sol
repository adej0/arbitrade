// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./../interfaces/IUniswapV2Router02.sol";

/// @dev Test-only router that reports arbitrary output amounts without ever moving tokens.
/// Used to verify that Arbitrage never settles on router-reported amounts.
contract MaliciousRouter is IUniswapV2Router02 {
    uint public reportedAmountOut;

    constructor(uint _reportedAmountOut) {
        reportedAmountOut = _reportedAmountOut;
    }

    function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts) {
        amounts = new uint[](path.length);
        amounts[0] = amountIn;
        for (uint i = 1; i < path.length; i++) {
            amounts[i] = reportedAmountOut;
        }
    }

    function swapExactTokensForTokens(
        uint amountIn,
        uint,
        address[] calldata path,
        address,
        uint
    ) external view returns (uint[] memory amounts) {
        amounts = new uint[](path.length);
        amounts[0] = amountIn;
        for (uint i = 1; i < path.length; i++) {
            amounts[i] = reportedAmountOut;
        }
    }
}
