// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/*
  Arbitrage contract:
  - Executes two-step token arbitrage between two UniswapV2-style routers (PancakeSwap V2 / Biswap).
  - Routers must be explicitly allowlisted by the owner before they can be used.
  - Accounting is based on measured token balance deltas, never on router-reported amounts.
  - The contract enforces slippage + minimum profit and returns proceeds to the caller.
*/

import "./interfaces/IUniswapV2Router02.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract Arbitrage is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Routers that executeArbitrage is allowed to interact with.
    mapping(address => bool) public allowedRouters;

    event ArbitrageExecuted(address indexed caller, address tokenIn, address tokenOut, uint amountIn, uint finalAmountOut, uint profit);
    event Withdrawn(address indexed token, address to, uint amount);
    event RouterAllowanceUpdated(address indexed router, bool allowed);

    constructor() {}

    /// @notice Allow or disallow a router for use in executeArbitrage.
    function setRouterAllowed(address router, bool allowed) external onlyOwner {
        require(router != address(0), "router=0");
        allowedRouters[router] = allowed;
        emit RouterAllowanceUpdated(router, allowed);
    }

    /// @notice Approve tokens for an allowlisted router (owner-only helper)
    function approveToken(address token, address router, uint amount) external onlyOwner {
        require(allowedRouters[router], "router not allowed");
        IERC20(token).forceApprove(router, amount);
    }

    /// @notice Estimate amounts out from an allowlisted router
    function getAmountsOut(address router, uint amountIn, address[] calldata path) external view returns (uint[] memory) {
        require(allowedRouters[router], "router not allowed");
        return IUniswapV2Router02(router).getAmountsOut(amountIn, path);
    }

    /// @notice Execute a two-hop arbitrage:
    /// - swap tokenIn -> tokenOut on router1
    /// - swap tokenOut -> tokenIn on router2
    /// Requirements:
    ///  - Both routers must be allowlisted by the owner.
    ///  - Caller must have approved this contract for tokenIn.
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
    ) external nonReentrant returns (uint finalBalance, uint profit) {
        require(amountIn > 0, "amountIn=0");
        require(tokenIn != tokenOut, "same token");
        require(allowedRouters[router1] && allowedRouters[router2], "router not allowed");
        require(deadline >= block.timestamp, "deadline passed");

        // Pull tokenIn from the caller and measure what actually arrived, so that
        // pre-existing contract balances are never part of the traded amount.
        uint tradeAmount = IERC20(tokenIn).balanceOf(address(this));
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        tradeAmount = IERC20(tokenIn).balanceOf(address(this)) - tradeAmount;
        require(tradeAmount > 0, "nothing received");

        uint receivedTokenOut = _swap(router1, tokenIn, tokenOut, tradeAmount, slippageBps, deadline);
        uint finalAmount = _swap(router2, tokenOut, tokenIn, receivedTokenOut, slippageBps, deadline);

        // profit in tokenIn, measured against what the caller actually supplied
        require(finalAmount > tradeAmount, "no profit");
        profit = finalAmount - tradeAmount;
        require(profit >= minProfit, "insufficient profit");

        IERC20(tokenIn).safeTransfer(msg.sender, finalAmount);

        emit ArbitrageExecuted(msg.sender, tokenIn, tokenOut, tradeAmount, finalAmount, profit);
        return (finalAmount, profit);
    }

    /// @dev Swaps `amountIn` of `tokenFrom` for `tokenTo` on `router` and returns the measured
    /// increase of the contract's `tokenTo` balance. Router-reported amounts are only used to
    /// derive the slippage floor, never as the settled amount.
    function _swap(
        address router,
        address tokenFrom,
        address tokenTo,
        uint amountIn,
        uint slippageBps,
        uint deadline
    ) internal returns (uint received) {
        address[] memory path = new address[](2);
        path[0] = tokenFrom;
        path[1] = tokenTo;

        uint[] memory quoted = IUniswapV2Router02(router).getAmountsOut(amountIn, path);
        uint amountOutMin = _applySlippage(quoted[quoted.length - 1], slippageBps);

        received = IERC20(tokenTo).balanceOf(address(this));
        IERC20(tokenFrom).forceApprove(router, amountIn);
        IUniswapV2Router02(router).swapExactTokensForTokens(amountIn, amountOutMin, path, address(this), deadline);
        IERC20(tokenFrom).forceApprove(router, 0);
        received = IERC20(tokenTo).balanceOf(address(this)) - received;
        require(received >= amountOutMin, "swap output short");
    }

    function _applySlippage(uint amount, uint slippageBps) internal pure returns (uint) {
        // slippageBps is in basis points (1 bps = 0.01%)
        require(slippageBps <= 10000, "slippage>10000");
        uint numerator = (10000 - slippageBps);
        return (amount * numerator) / 10000;
    }

    // Owner can rescue tokens accidentally sent to contract
    function rescueToken(address token, address to, uint amount) external onlyOwner {
        require(to != address(0), "to=0");
        IERC20(token).safeTransfer(to, amount);
        emit Withdrawn(token, to, amount);
    }
}
