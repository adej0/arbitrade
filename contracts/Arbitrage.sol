// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/*
  Arbitrage contract:
  - Executes two-step token arbitrage between two UniswapV2-style routers (PancakeSwap V2 / Biswap).
  - Caller deposits input tokens to the contract prior to calling executeArbitrage or uses ERC20 transferFrom.
  - The contract checks expected outputs via the routers' getAmountsOut and enforces slippage + minimum profit.
  - The contract returns profit to the caller and emits events.
*/

import "./interfaces/IUniswapV2Router02.sol";
import "./libraries/SwapUtils.sol";
import "./libraries/TokenUtils.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Arbitrage is Ownable {
    event ArbitrageExecuted(address indexed caller, address tokenIn, address tokenOut, uint amountIn, uint finalAmountOut, uint profit);
    event Withdrawn(address indexed token, address to, uint amount);

    constructor() {}

    /// @notice Approve tokens for a router (owner-only helper)
    function approveToken(address token, address router, uint amount) external onlyOwner {
        IERC20(token).approve(router, amount);
    }

    /// @notice Estimate amounts out from router
    function getAmountsOut(address router, uint amountIn, address[] calldata path) external view returns (uint[] memory) {
        return IUniswapV2Router02(router).getAmountsOut(amountIn, path);
    }

    /// @notice Execute a two-hop arbitrage:
    /// - swap tokenIn -> tokenOut on router1
    /// - swap tokenOut -> tokenIn on router2
    /// Requirements:
    ///  - Caller must have approved this contract for tokenIn if using transferFrom.
    ///  - minProfit is absolute profit in tokenIn units (not wei of native)
    function executeArbitrage(
        address tokenIn,
        address tokenOut,
        uint amountIn,
        address router1,
        address router2,
        uint slippageBps,   // e.g. 50 = 0.5%
        uint minProfit,     // minimum desired profit in tokenIn units
        uint deadline       // timestamp for swaps
    ) external returns (uint finalBalance, uint profit) {
        require(amountIn > 0, "amountIn=0");

        // Transfer tokenIn from caller
        TokenUtils.safeTransferFrom(IERC20(tokenIn), msg.sender, address(this), amountIn);

        uint receivedTokenOut = _swapLeg(router1, tokenIn, tokenOut, amountIn, slippageBps, deadline);
        uint finalAmount = _swapLeg(router2, tokenOut, tokenIn, receivedTokenOut, slippageBps, deadline);

        // profit in tokenIn
        require(finalAmount > amountIn, "no profit");
        profit = finalAmount - amountIn;
        require(profit >= minProfit, "insufficient profit");

        // Send the finalAmount back to caller
        TokenUtils.safeTransfer(IERC20(tokenIn), msg.sender, finalAmount);

        emit ArbitrageExecuted(msg.sender, tokenIn, tokenOut, amountIn, finalAmount, profit);
        return (finalAmount, profit);
    }

    function _swapLeg(
        address router,
        address tokenFrom,
        address tokenTo,
        uint amountIn,
        uint slippageBps,
        uint deadline
    ) internal returns (uint amountOut) {
        TokenUtils.safeApprove(IERC20(tokenFrom), router, amountIn);
        address[] memory path = SwapUtils.pairPath(tokenFrom, tokenTo);
        uint expected = SwapUtils.last(IUniswapV2Router02(router).getAmountsOut(amountIn, path));
        uint minOut = SwapUtils.applySlippage(expected, slippageBps);
        return SwapUtils.last(IUniswapV2Router02(router).swapExactTokensForTokens(amountIn, minOut, path, address(this), deadline));
    }

    // Owner can rescue tokens accidentally sent to contract
    function rescueToken(address token, address to, uint amount) external onlyOwner {
        TokenUtils.safeTransfer(IERC20(token), to, amount);
        emit Withdrawn(token, to, amount);
    }
}
