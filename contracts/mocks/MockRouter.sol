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

    constructor(uint _num, uint _den) {
        require(_den > 0, "den=0");
        num = _num;
        den = _den;
    }

    function setRatio(uint _num, uint _den) external {
        num = _num; den = _den;
    }

    function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts) {
        return _getAmountsOut(amountIn, path);
    }

    function _getAmountsOut(uint amountIn, address[] calldata path) internal view returns (uint[] memory amounts) {
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
        uint /*amountOutMin*/,
        address[] calldata path,
        address to,
        uint /*deadline*/
    ) external returns (uint[] memory amounts) {
        // transfer amountIn from caller to this contract
        require(IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn), "transferFrom failed");
        // compute output amount by ratio
        uint[] memory out = _getAmountsOut(amountIn, path);
        // send out[last] tokens to `to`
        require(IERC20(path[path.length - 1]).transfer(to, out[out.length - 1]), "transfer to failed");
        return out;
    }
}
