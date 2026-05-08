import { formatUsd, formatCrypto } from "../../lib/format";
import { PnlDisplay } from "../dashboard/PnlDisplay";
import { TypeBadge } from "./TypeBadge";
import { SourceBadge } from "./SourceBadge";
import { CostSourceBadge } from "./CostSourceBadge";
import type { TransactionWithPnl } from "../../types/token-detail";

interface TransactionTableProps {
  transactions: TransactionWithPnl[];
  currentPrice: string | null;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

export function TransactionTable({ transactions, currentPrice }: TransactionTableProps) {
  if (transactions.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-gray-500">
        No transactions recorded yet
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 text-left text-xs text-gray-400">
            <th className="px-3 py-2">Date</th>
            <th className="px-3 py-2">Type</th>
            <th className="px-3 py-2">Source</th>
            <th className="px-3 py-2">Amount</th>
            <th className="px-3 py-2">Price at Time</th>
            <th className="px-3 py-2">Value at Time</th>
            <th className="px-3 py-2">Current Price</th>
            <th className="px-3 py-2">Current Value</th>
            <th className="px-3 py-2">P&L</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx) => {
            const isOutbound = tx.type === "SELL" || tx.type === "SWAP_OUT";

            // Value at time = amount × priceUsd (null if either is null)
            const valueAtTime =
              tx.priceUsd !== null
                ? formatUsd(
                    (parseFloat(tx.amount) * parseFloat(tx.priceUsd)).toString(),
                  )
                : null;

            // Current value = amount × currentPrice (null if currentPrice null)
            const currentValue =
              currentPrice !== null
                ? formatUsd(
                    (parseFloat(tx.amount) * parseFloat(currentPrice)).toString(),
                  )
                : null;

            // Source tooltip for Binance TRANSFER_OUT with txHash (AC-10)
            const sourceTip =
              tx.type === "TRANSFER_OUT" && tx.source === "BINANCE" && tx.txHash
                ? `Withdrawal tx: ${tx.txHash}`
                : undefined;

            return (
              <tr key={tx.id} className="border-b border-gray-800">
                {/* Date */}
                <td className="px-3 py-2 text-gray-300">
                  {formatDate(tx.blockTimestamp)}
                </td>

                {/* Type */}
                <td className="px-3 py-2">
                  <TypeBadge
                    type={tx.type}
                    txHash={tx.txHash}
                    cexTradeId={tx.cexTradeId}
                  />
                  {tx.type === "TRANSFER_IN" && tx.costSource !== null && (
                    <CostSourceBadge
                      costSource={tx.costSource}
                      costInheritedFrom={tx.costInheritedFrom}
                    />
                  )}
                </td>

                {/* Source */}
                <td className="px-3 py-2">
                  <SourceBadge source={tx.source} tooltip={sourceTip} />
                </td>

                {/* Amount */}
                <td className="px-3 py-2 text-right">{formatCrypto(tx.amount)}</td>

                {/* Price at Time */}
                <td className="px-3 py-2 text-right">
                  {tx.priceUsd !== null ? (
                    formatUsd(tx.priceUsd)
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>

                {/* Value at Time */}
                <td className="px-3 py-2 text-right">
                  {valueAtTime !== null ? (
                    valueAtTime
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>

                {/* Current Price */}
                <td className="px-3 py-2 text-right">
                  {currentPrice !== null ? (
                    formatUsd(currentPrice)
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>

                {/* Current Value */}
                <td className="px-3 py-2 text-right">
                  {currentValue !== null ? (
                    currentValue
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>

                {/* P&L */}
                <td className={`px-3 py-2 text-right${isOutbound ? " italic" : ""}`}>
                  {tx.pnl.kind === "INBOUND" ? (
                    <PnlDisplay value={tx.pnl.lotPnlUsd} kind="usd" />
                  ) : (
                    <PnlDisplay value={tx.pnl.realizedPnlUsd} kind="usd" />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

    </div>
  );
}
