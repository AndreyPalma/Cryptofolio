import { cn } from "../../lib/cn";
import type { TransactionType } from "../../types/token-detail";

interface TypeBadgeProps {
  type: TransactionType;
  txHash: string | null;
  cexTradeId: string | null;
}

const TYPE_CONFIG = {
  BUY: { label: "BUY", className: "bg-green-900 text-green-300" },
  SELL: { label: "SELL", className: "bg-red-900 text-red-300" },
  SWAP_IN: { label: "SWAP IN", className: "bg-blue-900 text-blue-300" },
  SWAP_OUT: { label: "SWAP OUT", className: "bg-orange-900 text-orange-300" },
  TRANSFER_IN: { label: "TRANSFER IN", className: "bg-gray-700 text-gray-200" },
  TRANSFER_OUT: { label: "TRANSFER OUT", className: "bg-gray-700 text-gray-200" },
} as const satisfies Record<TransactionType, { label: string; className: string }>;

export function TypeBadge({ type, txHash, cexTradeId }: TypeBadgeProps) {
  const cfg = TYPE_CONFIG[type];
  const isSwap = type === "SWAP_IN" || type === "SWAP_OUT";

  let tooltip: string | undefined;
  if (isSwap) {
    if (txHash) {
      tooltip = `Auto-detected swap from TX ${txHash}`;
    } else if (cexTradeId) {
      tooltip = `Binance Convert #${cexTradeId}`;
    }
  }

  return (
    <span
      className={cn("rounded px-2 py-0.5 text-xs font-medium", cfg.className)}
      {...(tooltip !== undefined ? { title: tooltip } : {})}
    >
      {cfg.label}
    </span>
  );
}
