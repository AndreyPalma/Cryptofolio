import { SummaryCard } from "./SummaryCard";
import { formatUsd, formatPct } from "../../lib/format";
import type { DecimalString } from "../../types/portfolio";

interface SummaryCardsProps {
  totalValueUsd: DecimalString;
  totalCostBasis: DecimalString;
  totalPnlUsd: DecimalString;
  totalPnlPct: DecimalString | null;
}

function pnlSign(
  value: DecimalString,
): "positive" | "negative" | "neutral" {
  const n = parseFloat(value);
  if (n > 0) return "positive";
  if (n < 0) return "negative";
  return "neutral";
}

export function SummaryCards({
  totalValueUsd,
  totalCostBasis,
  totalPnlUsd,
  totalPnlPct,
}: SummaryCardsProps) {
  const pnlUsdSign = pnlSign(totalPnlUsd);
  const pnlPctSign =
    totalPnlPct !== null ? pnlSign(totalPnlPct) : "neutral";

  // Prepend "+" for positive P&L USD card
  const pnlUsdFormatted = (() => {
    const n = parseFloat(totalPnlUsd);
    const formatted = formatUsd(totalPnlUsd);
    return n > 0 ? `+${formatted}` : formatted;
  })();

  const pnlPctFormatted =
    totalPnlPct === null ? "—" : formatPct(totalPnlPct);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <SummaryCard
        label="Total Portfolio Value"
        value={formatUsd(totalValueUsd)}
        testId="card-total-value"
      />
      <SummaryCard
        label="Total Cost Basis"
        value={formatUsd(totalCostBasis)}
        testId="card-cost-basis"
      />
      <SummaryCard
        label="Total P&L"
        value={pnlUsdFormatted}
        pnlSign={pnlUsdSign}
        testId="card-pnl-usd"
      />
      <SummaryCard
        label="Total P&L %"
        value={pnlPctFormatted}
        pnlSign={totalPnlPct !== null ? pnlPctSign : undefined}
        testId="card-pnl-pct"
      />
    </div>
  );
}
