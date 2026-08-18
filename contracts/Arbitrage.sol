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
        require(IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn), "transferFrom failed");

        // Approve routers
        _safeApprove(tokenIn, router1, amountIn);

        address[] memory pathA = new address[](2);
        pathA[0] = tokenIn;
        pathA[1] = tokenOut;

        // Query expected out1
        uint[] memory out1 = IUniswapV2Router02(router1).getAmountsOut(amountIn, pathA);
        uint amountOutMin1 = _applySlippage(out1[1], slippageBps);

        // Execute first swap
        uint[] memory amountsA = IUniswapV2Router02(router1).swapExactTokensForTokens(amountIn, amountOutMin1, pathA, address(this), deadline);

        uint receivedTokenOut = amountsA[amountsA.length - 1];

        // Approve router2 to spend tokenOut
        _safeApprove(tokenOut, router2, receivedTokenOut);

        address[] memory pathB = new address[](2);
        pathB[0] = tokenOut;
        pathB[1] = tokenIn;

        // Query expected out2
        uint[] memory out2 = IUniswapV2Router02(router2).getAmountsOut(receivedTokenOut, pathB);
        uint amountOutMin2 = _applySlippage(out2[1], slippageBps);

        // Execute second swap
        uint[] memory amountsB = IUniswapV2Router02(router2).swapExactTokensForTokens(receivedTokenOut, amountOutMin2, pathB, address(this), deadline);

        uint finalAmount = amountsB[amountsB.length - 1];

        // profit in tokenIn
        require(finalAmount > amountIn, "no profit");
        profit = finalAmount - amountIn;
        require(profit >= minProfit, "insufficient profit");

        // Send the finalAmount back to caller
        require(IERC20(tokenIn).transfer(msg.sender, finalAmount), "transfer final failed");

        emit ArbitrageExecuted(msg.sender, tokenIn, tokenOut, amountIn, finalAmount, profit);
        return (finalAmount, profit);
    }

    function _applySlippage(uint amount, uint slippageBps) internal pure returns (uint) {
        // slippageBps is in basis points (1 bps = 0.01%)
        require(slippageBps <= 10000, "slippage>10000");
        uint numerator = (10000 - slippageBps);
        return (amount * numerator) / 10000;
    }

    function _safeApprove(address token, address spender, uint amount) internal {
        // reset to 0 first per ERC20 standard issues
        IERC20 erc = IERC20(token);
        bytes memory returned;
        // Try low-level to avoid revert issues; but for simplicity, do standard approve
        erc.approve(spender, 0);
        erc.approve(spender, amount);
    }

    // Owner can rescue tokens accidentally sent to contract
    function rescueToken(address token, address to, uint amount) external onlyOwner {
        require(IERC20(token).transfer(to, amount), "rescue failed");
        emit Withdrawn(token, to, amount);
    }
}
