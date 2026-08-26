// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./MockERC20.sol";
import "./../interfaces/IUniswapV2Router02.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Simplified mock router that uses a fixed price ratio for getAmountsOut and emulates swapExactTokensForTokens.
contract MockRouter is IUniswapV2Router02 {
    // ratio numerator / denominator:  e.g., 2/1 means 1 tokenA -> 2 tokenB
    uint public num;
    uint public den;

    // Fraction of the quoted output that is actually delivered, in basis points. 10000 delivers
    // exactly what getAmountsOut quoted; lower values emulate a router (or fee-on-transfer
    // token) whose reported amounts do not match the tokens it actually transfers.
    uint public deliveryBps = 10000;

    constructor(uint _num, uint _den) {
        require(_den > 0, "den=0");
        num = _num;
        den = _den;
    }

    function setDeliveryBps(uint _deliveryBps) external {
        require(_deliveryBps <= 10000, "deliveryBps>10000");
        deliveryBps = _deliveryBps;
    }

    function setRatio(uint _num, uint _den) external {
        require(_den > 0, "den=0");
        num = _num; den = _den;
    }

    function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts) {
        return _getAmountsOut(amountIn, path);
    }

    function _getAmountsOut(uint amountIn, address[] memory path) internal view returns (uint[] memory amounts) {
        require(path.length >= 2, "bad path");
        amounts = new uint[](path.length);
        amounts[0] = amountIn;
        for (uint i = 1; i < path.length; i++) {
            // simple ratio every hop
            amounts[i] = (amounts[i-1] * num) / den;
        }
        return amounts;
    }

    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts) {
        require(deadline >= block.timestamp, "EXPIRED");
        // transfer amountIn from caller to this contract
        require(IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn), "transferFrom failed");
        // compute output amount by ratio
        uint[] memory out = _getAmountsOut(amountIn, path);
        require(out[out.length - 1] >= amountOutMin, "INSUFFICIENT_OUTPUT_AMOUNT");
        // send out[last] tokens to `to`
        uint delivered = (out[out.length - 1] * deliveryBps) / 10000;
        require(IERC20(path[path.length - 1]).transfer(to, delivered), "transfer to failed");
        return out;
    }
}
