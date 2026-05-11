import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  PositionCyclesSection,
  type ActiveCycleSummary,
} from "../components/token-detail/PositionCyclesSection";
import { TokenDetailHeader } from "../components/token-detail/TokenDetailHeader";
import { TokenStatsCards } from "../components/token-detail/TokenStatsCards";
import { TransactionTable } from "../components/token-detail/TransactionTable";
import { useClosedPositions } from "../hooks/useClosedPositions";
import { useTokenDetail } from "../hooks/useTokenDetail";
import { getTokenIdentityKey } from "../lib/token-path";
import { NETWORK, type Network } from "../types/portfolio";

export function TokenDetailPage() {
  const { contractAddress, network } = useParams<{
    contractAddress: string;
    network: string;
  }>();
  const navigate = useNavigate();
  const [selectedWalletId, setSelectedWalletId] = useState<string | undefined>();

  const normalizedNetwork =
    network && (Object.values(NETWORK) as string[]).includes(network)
      ? (network as Network)
      : undefined;

  useEffect(() => {
    if (!normalizedNetwork) {
      void navigate("/", { replace: true });
    }
  }, [normalizedNetwork, navigate]);

  const { data, loading, error } = useTokenDetail(
    contractAddress ?? "",
    network ?? "",
    selectedWalletId,
  );
  const {
    data: closedPositionsData,
    loading: closedPositionsLoading,
    error: closedPositionsError,
  } = useClosedPositions({
    walletId: selectedWalletId,
    network: normalizedNetwork,
  });

  const closedTokenGroup =
    data && normalizedNetwork
      ? (closedPositionsData?.byToken.find(
          (token) =>
            getTokenIdentityKey(token.network, token.contractAddress, token.symbol) ===
            getTokenIdentityKey(data.token.network, data.token.contractAddress, data.token.symbol),
        ) ?? null)
      : null;

  const activeCycleOpenedAt =
    data?.position && data.transactions.length > 0
      ? data.transactions.reduce<string | null>((earliest, transaction) => {
          if (earliest === null) {
            return transaction.blockTimestamp;
          }

          return new Date(transaction.blockTimestamp) < new Date(earliest)
            ? transaction.blockTimestamp
            : earliest;
        }, null)
      : null;

  const activeCycle: ActiveCycleSummary | null =
    data?.position !== null && data?.position !== undefined
      ? {
          cycleNumber: data.position.cycleNumber,
          openedAt: activeCycleOpenedAt,
          totalCostUsd: data.position.totalCostBasis,
          totalCurrentValueUsd: data.position.totalCurrentValue,
          unrealizedPnlUsd: data.position.priceUnavailable ? null : data.position.pnlUsd,
          unrealizedPnlPct: data.position.priceUnavailable ? null : data.position.pnlPct,
          walletLabel:
            selectedWalletId !== undefined
              ? (data.position.walletBreakdown.find(
                  (wallet) => wallet.walletId === selectedWalletId,
                )?.label ?? null)
              : null,
        }
      : null;

  const closedCycleCount = closedTokenGroup?.cycleCount ?? 0;

  if (loading && data === null) {
    return (
      <main className="min-h-screen bg-gray-950 p-6 text-white">
        <Link to="/" className="mb-4 inline-block text-sm text-gray-400 hover:text-white">
          ← Portfolio
        </Link>
        <p className="mt-8 text-center text-gray-400">Loading…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-950 p-6 text-white">
      <Link to="/" className="mb-4 inline-block text-sm text-gray-400 hover:text-white">
        ← Portfolio
      </Link>

      {error && (
        <div className="mb-4 rounded border border-red-800 bg-red-950 px-4 py-2 text-sm text-red-300">
          Error: {error.message}
        </div>
      )}

      {data && (
        <>
          <TokenDetailHeader
            token={data.token}
            position={data.position}
            closedCycleCount={closedCycleCount}
            selectedWalletId={selectedWalletId}
            onWalletChange={setSelectedWalletId}
          />

          <div className="mt-6">
            <TokenStatsCards
              position={data.position}
              token={data.token}
              transactionsCount={data.transactions.length}
              currentPrice={data.currentPrice}
              priceUnavailable={data.priceUnavailable}
            />
          </div>

          <div className="mt-6">
            <PositionCyclesSection
              activeCycle={activeCycle}
              closedCycles={closedTokenGroup?.cycles ?? []}
              loading={closedPositionsLoading}
              error={closedPositionsError}
            />
          </div>

          <div className="mt-6">
            <TransactionTable
              transactions={data.transactions}
              currentPrice={data.position?.currentPrice ?? null}
            />
          </div>
        </>
      )}
    </main>
  );
}
