import { formatUsd, formatCrypto } from "../../lib/format";
import { PnlDisplay } from "../dashboard/PnlDisplay";
import type { PositionStats } from "../../types/token-detail";

interface StatCardProps {
  label: string;
  children: React.ReactNode;
}

function StatCard({ label, children }: StatCardProps) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      <p className="mb-1 text-xs text-gray-400">{label}</p>
      <div className="text-sm font-medium text-white">{children}</div>
    </div>
  );
}

interface TokenStatsCardsProps {
  position: PositionStats | null;
}

export function TokenStatsCards({ position }: TokenStatsCardsProps) {
  const dash = <span className="text-gray-400">—</span>;
  const priceUnavailable = position?.priceUnavailable === true;

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
      <StatCard label="Balance">
        {position ? formatCrypto(position.totalBalance) : dash}
      </StatCard>

      <StatCard label="Current Price">
        {!position || priceUnavailable || position.currentPrice === null
          ? dash
          : formatUsd(position.currentPrice)}
      </StatCard>

      <StatCard label="Current Value">
        {!position || priceUnavailable || position.totalCurrentValue === null
          ? dash
          : formatUsd(position.totalCurrentValue)}
      </StatCard>

      <StatCard label="WAC">
        {position ? formatUsd(position.wacAggregated) : dash}
      </StatCard>

      <StatCard label="Cost Basis">
        {position ? formatUsd(position.totalCostBasis) : dash}
      </StatCard>

      <StatCard label="P&L">
        {!position || priceUnavailable ? (
          dash
        ) : (
          <PnlDisplay value={position.pnlUsd} kind="usd" />
        )}
      </StatCard>
    </div>
  );
}
