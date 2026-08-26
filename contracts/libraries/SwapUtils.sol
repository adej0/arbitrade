// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library SwapUtils {
    function pairPath(address tokenIn, address tokenOut) internal pure returns (address[] memory path) {
        path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;
    }

    function applySlippage(uint amount, uint slippageBps) internal pure returns (uint) {
        require(slippageBps <= 10000, "slippage>10000");
        uint numerator = (10000 - slippageBps);
        return (amount * numerator) / 10000;
    }

    function last(uint[] memory amounts) internal pure returns (uint) {
        return amounts[amounts.length - 1];
    }
}
