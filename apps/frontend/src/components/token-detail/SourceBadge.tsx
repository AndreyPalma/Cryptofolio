import { cn } from "../../lib/cn";
import type { TransactionSource } from "../../types/token-detail";

interface SourceBadgeProps {
  source: TransactionSource;
  tooltip?: string;
}

const SOURCE_CONFIG = {
  ETHERSCAN: { label: "Etherscan", className: "bg-indigo-900 text-indigo-300" },
  BSCTRACE: { label: "BSCScan", className: "bg-yellow-900 text-yellow-300" },
  BINANCE: { label: "Binance", className: "bg-amber-900 text-amber-300" },
  MANUAL: { label: "Manual", className: "bg-gray-700 text-gray-400" },
} as const satisfies Record<TransactionSource, { label: string; className: string }>;

export function SourceBadge({ source, tooltip }: SourceBadgeProps) {
  const cfg = SOURCE_CONFIG[source];
  return (
    <span
      className={cn("rounded px-2 py-0.5 text-xs font-medium", cfg.className)}
      {...(tooltip !== undefined ? { title: tooltip } : {})}
    >
      {cfg.label}
    </span>
  );
}
