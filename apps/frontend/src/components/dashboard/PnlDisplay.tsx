import { cn } from "../../lib/cn";
import { formatUsd, formatPct } from "../../lib/format";
import type { DecimalString } from "../../types/portfolio";

interface PnlDisplayProps {
  value: DecimalString | number | null;
  kind: "usd" | "pct";
}

export function PnlDisplay({ value, kind }: PnlDisplayProps) {
  if (value === null) {
    return <span className="text-gray-400">—</span>;
  }

  const n = typeof value === "number" ? value : parseFloat(value);
  const formatted = kind === "usd" ? formatUsd(value) : formatPct(value);

  const colorClass = cn({
    "text-pnl-positive": n > 0,
    "text-pnl-negative": n < 0,
    "text-gray-300": n === 0,
  });

  return <span className={colorClass}>{formatted}</span>;
}
