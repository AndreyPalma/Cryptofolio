import { usePortfolio } from "../hooks/usePortfolio";
import { useRelativeTime } from "../hooks/useRelativeTime";
import { SummaryCards } from "../components/dashboard/SummaryCards";
import { PortfolioTable } from "../components/dashboard/PortfolioTable";
import { PortfolioTableEmptyState } from "../components/dashboard/PortfolioTableEmptyState";
import { RefreshIndicator } from "../components/dashboard/RefreshIndicator";

// --------------- Local sub-components (not exported) ---------------

function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-lg bg-gray-900 p-4">
      <div className="mb-2 h-3 w-1/2 rounded bg-gray-800" />
      <div className="h-7 w-3/4 rounded bg-gray-800" />
    </div>
  );
}

function RowSkeleton() {
  return (
    <div className="flex gap-4 border-b border-gray-800 px-4 py-3">
      {Array.from({ length: 11 }).map((_, i) => (
        <div key={i} className="animate-pulse h-4 flex-1 rounded bg-gray-800" />
      ))}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <main className="min-h-screen bg-gray-950 p-6 text-white">
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
      <div className="overflow-x-auto">
        <RowSkeleton />
        <RowSkeleton />
        <RowSkeleton />
        <RowSkeleton />
        <RowSkeleton />
      </div>
    </main>
  );
}

interface DashboardErrorStateProps {
  onRetry: () => void;
}

function DashboardErrorState({ onRetry }: DashboardErrorStateProps) {
  return (
    <main className="min-h-screen bg-gray-950 p-6 text-white">
      <div aria-live="polite">
        <div className="rounded-lg bg-gray-900 p-6 text-center">
          <p className="mb-4 text-gray-300">Couldn't load portfolio.</p>
          <button
            type="button"
            onClick={onRetry}
            aria-label="Retry loading portfolio"
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Retry
          </button>
        </div>
      </div>
    </main>
  );
}

// --------------- DashboardPage ---------------

export function DashboardPage() {
  const { data, loading, error, lastUpdated, isRefetching, refresh } =
    usePortfolio();
  const { label: relativeTime } = useRelativeTime(lastUpdated);

  if (loading && data === null) {
    return <DashboardSkeleton />;
  }

  if (error !== null && data === null) {
    return <DashboardErrorState onRetry={refresh} />;
  }

  if (data === null) {
    // Unreachable defensive branch
    return null;
  }

  return (
    <main className="min-h-screen bg-gray-950 p-6 text-white">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Portfolio</h1>
        <RefreshIndicator
          relativeTime={relativeTime}
          isRefetching={isRefetching}
          stale={error !== null}
          onRetry={refresh}
        />
      </header>

      <SummaryCards
        totalValueUsd={data.totalValueUsd}
        totalCostBasis={data.totalCostBasis}
        totalPnlUsd={data.totalPnlUsd}
        totalPnlPct={data.totalPnlPct}
      />

      <div className="mt-6">
        {data.tokens.length === 0 ? (
          <PortfolioTableEmptyState />
        ) : (
          <PortfolioTable items={data.tokens} />
        )}
      </div>
    </main>
  );
}
