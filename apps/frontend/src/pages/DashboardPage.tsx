import { useState } from "react";
import { Link } from "react-router-dom";
import { SummaryCards } from "../components/dashboard/SummaryCards";
import {
  ClosedPositionsSection,
  ClosedTokensList,
} from "../components/dashboard/ClosedPositionsSection";
import { PortfolioTable } from "../components/dashboard/PortfolioTable";
import { PortfolioTableEmptyState } from "../components/dashboard/PortfolioTableEmptyState";
import { RefreshIndicator } from "../components/dashboard/RefreshIndicator";
import { cn } from "../lib/cn";
import { getTokenIdentityKey } from "../lib/token-path";
import { useClosedPositions } from "../hooks/useClosedPositions";
import { usePortfolio } from "../hooks/usePortfolio";
import { useRelativeTime } from "../hooks/useRelativeTime";

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

const PORTFOLIO_VISIBILITY_FILTER = {
  ACTIVE: "active",
  CLOSED: "closed",
  ALL: "all",
} as const;

type PortfolioVisibilityFilter =
  (typeof PORTFOLIO_VISIBILITY_FILTER)[keyof typeof PORTFOLIO_VISIBILITY_FILTER];

interface PortfolioVisibilityToggleProps {
  value: PortfolioVisibilityFilter;
  onChange: (value: PortfolioVisibilityFilter) => void;
}

function PortfolioVisibilityToggle({
  value,
  onChange,
}: PortfolioVisibilityToggleProps) {
  return (
    <div className="inline-flex rounded-full bg-gray-950 p-1">
      {[
        { label: "Activos", value: PORTFOLIO_VISIBILITY_FILTER.ACTIVE },
        { label: "Cerrados", value: PORTFOLIO_VISIBILITY_FILTER.CLOSED },
        { label: "Todos", value: PORTFOLIO_VISIBILITY_FILTER.ALL },
      ].map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => {
            onChange(option.value);
          }}
          className={cn(
            "rounded-full px-3 py-1.5 text-sm font-semibold transition-colors",
            value === option.value
              ? "bg-indigo-600 text-white"
              : "text-gray-400 hover:text-white",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function DashboardPage() {
  const [portfolioFilter, setPortfolioFilter] = useState<PortfolioVisibilityFilter>(
    PORTFOLIO_VISIBILITY_FILTER.ACTIVE,
  );
  const { data, loading, error, lastUpdated, isRefetching, refresh } =
    usePortfolio();
  const {
    data: closedPositionsData,
    loading: closedPositionsLoading,
    error: closedPositionsError,
    refresh: refreshClosedPositions,
  } = useClosedPositions();
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

  const activeTokenKeys = new Set(
    data.tokens.map((item) =>
      getTokenIdentityKey(item.network, item.contractAddress, item.symbol),
    ),
  );
  const closedOnlyTokens = (closedPositionsData?.byToken ?? []).filter(
    (token) =>
      !activeTokenKeys.has(
        getTokenIdentityKey(token.network, token.contractAddress, token.symbol),
      ),
  );

  return (
    <main className="min-h-screen bg-gray-950 p-6 text-white">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Portfolio</h1>
        <div className="flex items-center gap-3">
          <Link
            to="/settings"
            className="rounded-md bg-gray-800 px-3 py-1.5 text-sm font-semibold text-gray-300 hover:bg-gray-700 hover:text-white"
          >
            ⚙ Settings
          </Link>
          <Link
            to="/transactions/new"
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            Add Transaction
          </Link>
          <RefreshIndicator
            relativeTime={relativeTime}
            isRefetching={isRefetching}
            stale={error !== null}
            onRetry={refresh}
          />
        </div>
      </header>

      <SummaryCards
        totalValueUsd={data.totalValueUsd}
        totalCostBasis={data.totalCostBasis}
        totalPnlUsd={data.totalPnlUsd}
        totalPnlPct={data.totalPnlPct}
      />

      <section className="mt-6 rounded-xl border border-gray-800 bg-gray-900/30 p-4">
        <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Tokens</h2>
            <p className="mt-1 text-sm text-gray-400">
              Alterná entre posiciones activas y tokens ya cerrados sin alterar los totales del portfolio.
            </p>
          </div>

          <PortfolioVisibilityToggle
            value={portfolioFilter}
            onChange={setPortfolioFilter}
          />
        </div>

        {portfolioFilter === PORTFOLIO_VISIBILITY_FILTER.ACTIVE && (
          <>
            {data.tokens.length === 0 ? (
              <PortfolioTableEmptyState />
            ) : (
              <PortfolioTable items={data.tokens} />
            )}
          </>
        )}

        {portfolioFilter === PORTFOLIO_VISIBILITY_FILTER.CLOSED && (
          <ClosedTokensList
            tokens={closedOnlyTokens}
            loading={closedPositionsLoading}
            error={closedPositionsError}
            onRetry={refreshClosedPositions}
            emptyMessage="No hay tokens completamente cerrados todavía."
          />
        )}

        {portfolioFilter === PORTFOLIO_VISIBILITY_FILTER.ALL && (
          <div className="space-y-6">
            <div>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                Activos
              </h3>
              {data.tokens.length === 0 ? (
                <PortfolioTableEmptyState />
              ) : (
                <PortfolioTable items={data.tokens} />
              )}
            </div>

            <div>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                Cerrados
              </h3>
              <ClosedTokensList
                tokens={closedOnlyTokens}
                loading={closedPositionsLoading}
                error={closedPositionsError}
                onRetry={refreshClosedPositions}
                emptyMessage="No hay tokens completamente cerrados todavía."
                showClosedBadge
              />
            </div>
          </div>
        )}
      </section>

      <ClosedPositionsSection
        data={closedPositionsData}
        loading={closedPositionsLoading}
        error={closedPositionsError}
        onRetry={refreshClosedPositions}
      />
    </main>
  );
}
