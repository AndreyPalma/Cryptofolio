import { useState } from "react";
import { Link } from "react-router-dom";
import { TokenLogo } from "./TokenLogo";
import { NetworkBadge } from "./NetworkBadge";
import { PnlDisplay } from "./PnlDisplay";
import { PortfolioRowExpanded } from "./PortfolioRowExpanded";
import { formatUsd, formatCrypto } from "../../lib/format";
import type { PortfolioItem } from "../../types/portfolio";

interface PortfolioRowProps {
  item: PortfolioItem;
}

export function PortfolioRow({ item }: PortfolioRowProps) {
  const [expanded, setExpanded] = useState(false);

  const priceCell =
    item.priceUnavailable === true || item.currentPrice === null ? (
      <span className="text-gray-400">—</span>
    ) : (
      formatUsd(item.currentPrice)
    );

  const valueCell =
    item.priceUnavailable || item.totalCurrentValue === null ? (
      <span className="text-gray-400">—</span>
    ) : (
      formatUsd(item.totalCurrentValue)
    );

  const showWalletCount =
    item.sourceType === "ON_CHAIN" && item.walletCount > 1;

  return (
    <>
      <tr className="border-b border-gray-800">
        {/* Expand toggle */}
        <td className="w-8 px-2 py-3">
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => {
              setExpanded((prev) => !prev);
            }}
            className="flex items-center justify-center text-gray-400 hover:text-white"
          >
            <svg
              className={`h-4 w-4 transition-transform ${expanded ? "rotate-90" : ""}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
        </td>

        {/* Logo */}
        <td className="px-2 py-3">
          <TokenLogo
            symbol={item.symbol}
            contractAddress={item.contractAddress}
            network={item.network}
            sourceType={item.sourceType}
            size="sm"
          />
        </td>

        {/* Symbol + wallet count */}
        <td className="px-4 py-3">
          <Link
            to={`/token/${item.contractAddress ?? ""}/${item.network}`}
            className="font-medium text-white hover:text-indigo-300 transition-colors"
          >
            {item.symbol}
          </Link>
          {showWalletCount && (
            <span className="ml-2 rounded bg-gray-700 px-1.5 py-0.5 text-xs text-gray-300">
              {item.walletCount} wallets
            </span>
          )}
        </td>

        {/* Network badge */}
        <td className="px-4 py-3">
          <NetworkBadge network={item.network} sourceType={item.sourceType} />
        </td>

        {/* Balance */}
        <td className="px-4 py-3 text-right text-sm">
          {formatCrypto(item.totalBalance)}
        </td>

        {/* Current Price */}
        <td className="px-4 py-3 text-right text-sm">{priceCell}</td>

        {/* Current Value */}
        <td className="px-4 py-3 text-right text-sm">{valueCell}</td>

        {/* WAC */}
        <td className="px-4 py-3 text-right text-sm">
          {formatUsd(item.wacAggregated)}
        </td>

        {/* Cost Basis */}
        <td className="px-4 py-3 text-right text-sm">
          {formatUsd(item.totalCostBasis)}
        </td>

        {/* P&L USD */}
        <td className="px-4 py-3 text-right text-sm">
          <PnlDisplay
            value={item.priceUnavailable ? null : item.pnlUsd}
            kind="usd"
          />
        </td>

        {/* P&L % */}
        <td className="px-4 py-3 text-right text-sm">
          <PnlDisplay
            value={item.priceUnavailable ? null : item.pnlPct}
            kind="pct"
          />
        </td>
      </tr>

      {expanded && <PortfolioRowExpanded item={item} />}
    </>
  );
}
