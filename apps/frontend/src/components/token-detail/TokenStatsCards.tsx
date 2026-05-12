import { formatUsd, formatCrypto } from "../../lib/format";
import { PnlDisplay } from "../dashboard/PnlDisplay";
import type { PositionStats, TokenInfo } from "../../types/token-detail";
import type { DecimalString } from "../../types/portfolio";

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
  token: TokenInfo;
  transactionsCount: number;
  currentPrice: DecimalString | null;
  priceUnavailable?: boolean;
}

export function TokenStatsCards({
  position,
  token: _token,
  transactionsCount,
  currentPrice,
  priceUnavailable,
}: TokenStatsCardsProps) {
  const dash = <span className="text-gray-400">—</span>;
  const isPriceUnavailable = priceUnavailable === true;

  // When no open position but we have transactions, show current price
  // and zeroes for balance/value
  const hasNoPosition = position === null;
  const showEmptyState = hasNoPosition && transactionsCount > 0;

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
      <StatCard label="Balance">
        {position ? formatCrypto(position.totalBalance) : showEmptyState ? formatCrypto("0") : dash}
      </StatCard>

      <StatCard label="Current Price">
        {isPriceUnavailable || currentPrice === null ? dash : formatUsd(currentPrice)}
      </StatCard>

      <StatCard label="Current Value">
        {!position || isPriceUnavailable || position.totalCurrentValue === null
          ? showEmptyState
            ? formatUsd("0")
            : dash
          : formatUsd(position.totalCurrentValue)}
      </StatCard>

      <StatCard label="WAC">{position ? formatUsd(position.wacAggregated) : dash}</StatCard>

      <StatCard label="Cost Basis">
        {position ? formatUsd(position.totalCostBasis) : showEmptyState ? formatUsd("0") : dash}
      </StatCard>

      <StatCard label="P&L">
        {!position || isPriceUnavailable ? dash : <PnlDisplay value={position.pnlUsd} kind="usd" />}
      </StatCard>
    </div>
  );
}
