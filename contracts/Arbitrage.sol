// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/*
  Arbitrage contract:
  - Executes two-step token arbitrage between two UniswapV2-style routers (PancakeSwap V2 / Biswap).
  - Caller deposits input tokens to the contract prior to calling executeArbitrage or uses ERC20 transferFrom.
  - The contract checks expected outputs via the routers' getAmountsOut and enforces slippage + minimum profit.
  - The contract returns profit to the caller and emits events.
  - All ERC20 interactions go through SafeERC20 so tokens that signal failure by returning
    false (instead of reverting) still abort the whole arbitrage.
*/

import "./interfaces/IUniswapV2Router02.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract Arbitrage is Ownable {
    using SafeERC20 for IERC20;

    event ArbitrageExecuted(address indexed caller, address tokenIn, address tokenOut, uint amountIn, uint finalAmountOut, uint profit);
    event Withdrawn(address indexed token, address to, uint amount);

    constructor() {}

    /// @notice Approve tokens for a router (owner-only helper)
    function approveToken(address token, address router, uint amount) external onlyOwner {
        require(token != address(0), "token=0");
        require(router != address(0), "router=0");
        _safeApprove(token, router, amount);
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
        require(tokenIn != address(0) && tokenOut != address(0), "token=0");
        require(tokenIn != tokenOut, "tokenIn==tokenOut");
        require(router1 != address(0) && router2 != address(0), "router=0");
        require(deadline >= block.timestamp, "deadline passed");

        // Transfer tokenIn from caller. SafeERC20 reverts on a false return value as well as
        // on a revert inside the token, so a failed pull can never be mistaken for a success.
        _pull(tokenIn, amountIn);

        // Each leg quotes the router, approves exactly what it is about to spend and returns
        // the balance delta actually received, so a router whose reported amounts do not match
        // the tokens it transfers cannot make the next step operate on phantom funds.
        uint received = _executeLeg(router1, tokenIn, tokenOut, amountIn, slippageBps, deadline);
        uint finalAmount = _executeLeg(router2, tokenOut, tokenIn, received, slippageBps, deadline);

        // profit in tokenIn
        require(finalAmount > amountIn, "no profit");
        profit = finalAmount - amountIn;
        require(profit >= minProfit, "insufficient profit");

        // Send the finalAmount back to caller
        IERC20(tokenIn).safeTransfer(msg.sender, finalAmount);

        emit ArbitrageExecuted(msg.sender, tokenIn, tokenOut, amountIn, finalAmount, profit);
        return (finalAmount, profit);
    }

    /// @dev Pulls `amount` of `token` from the caller and verifies the balance actually grew by
    /// that amount, so a token that under-delivers is rejected instead of silently shrinking
    /// the trade.
    function _pull(address token, uint amount) internal {
        uint balanceBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        require(IERC20(token).balanceOf(address(this)) - balanceBefore == amount, "amountIn mismatch");
    }

    /// @dev Swaps `amountIn` of `tokenFrom` into `tokenTo` on `router`, enforcing the slippage
    /// bound against the tokens actually received, and clearing the router allowance afterwards.
    function _executeLeg(
        address router,
        address tokenFrom,
        address tokenTo,
        uint amountIn,
        uint slippageBps,
        uint deadline
    ) internal returns (uint received) {
        require(amountIn > 0, "leg amountIn=0");

        address[] memory path = new address[](2);
        path[0] = tokenFrom;
        path[1] = tokenTo;

        uint amountOutMin = _quoteWithSlippage(router, amountIn, path, slippageBps);

        _safeApprove(tokenFrom, router, amountIn);

        uint balanceBefore = IERC20(tokenTo).balanceOf(address(this));
        IUniswapV2Router02(router).swapExactTokensForTokens(amountIn, amountOutMin, path, address(this), deadline);
        received = IERC20(tokenTo).balanceOf(address(this)) - balanceBefore;
        require(received >= amountOutMin, "swap output below min");

        // Drop any leftover allowance so a router that spent less than approved cannot move
        // the contract's tokens later.
        _safeApprove(tokenFrom, router, 0);
    }

    /// @dev Asks the router for a quote and validates the response before it is used as a
    /// slippage bound. A router that returns a short array or a zero quote is reported as
    /// such instead of causing an out-of-bounds panic or a silent amountOutMin of 0.
    function _quoteWithSlippage(
        address router,
        uint amountIn,
        address[] memory path,
        uint slippageBps
    ) internal view returns (uint) {
        uint[] memory quote = IUniswapV2Router02(router).getAmountsOut(amountIn, path);
        require(quote.length == path.length, "bad quote length");
        uint expectedOut = quote[quote.length - 1];
        require(expectedOut > 0, "no route");
        return _applySlippage(expectedOut, slippageBps);
    }

    function _applySlippage(uint amount, uint slippageBps) internal pure returns (uint) {
        // slippageBps is in basis points (1 bps = 0.01%)
        require(slippageBps <= 10000, "slippage>10000");
        uint numerator = (10000 - slippageBps);
        return (amount * numerator) / 10000;
    }

    function _safeApprove(address token, address spender, uint amount) internal {
        // forceApprove resets the allowance to 0 first for tokens that reject a non-zero
        // to non-zero approve, and reverts if the token reports failure.
        IERC20(token).forceApprove(spender, amount);
    }

    // Owner can rescue tokens accidentally sent to contract
    function rescueToken(address token, address to, uint amount) external onlyOwner {
        require(to != address(0), "to=0");
        IERC20(token).safeTransfer(to, amount);
        emit Withdrawn(token, to, amount);
    }
}
