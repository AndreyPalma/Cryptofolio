import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useTokenDetail } from "../hooks/useTokenDetail";
import { usePositionHistory } from "../hooks/usePositionHistory";
import { NETWORK } from "../types/portfolio";
import { TokenDetailHeader } from "../components/token-detail/TokenDetailHeader";
import { TokenStatsCards } from "../components/token-detail/TokenStatsCards";
import { TransactionTable } from "../components/token-detail/TransactionTable";

export function TokenDetailPage() {
  const { contractAddress, network } = useParams<{
    contractAddress: string;
    network: string;
  }>();
  const navigate = useNavigate();
  const [selectedWalletId, setSelectedWalletId] = useState<string | undefined>();

  // Guard: invalid network → redirect
  useEffect(() => {
    if (!network || !(Object.values(NETWORK) as string[]).includes(network)) {
      void navigate("/", { replace: true });
    }
  }, [network, navigate]);

  const { data, loading, error } = useTokenDetail(
    contractAddress ?? "",
    network ?? "",
    selectedWalletId,
  );

  const { data: historyData } = usePositionHistory(
    contractAddress ?? "",
    network ?? "",
  );

  const closedCycleCount = historyData?.cycles.length ?? 0;

  if (loading && data === null) {
    return (
      <main className="p-6">
        <Link to="/" className="mb-4 inline-block text-sm text-gray-400 hover:text-white">
          ← Portfolio
        </Link>
        <p className="mt-8 text-center text-gray-400">Loading…</p>
      </main>
    );
  }

  return (
    <main className="p-6">
      <Link to="/" className="mb-4 inline-block text-sm text-gray-400 hover:text-white">
        ← Portfolio
      </Link>

      {/* Error banner (stale-while-error: show stale data + error) */}
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
            <TokenStatsCards position={data.position} />
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
