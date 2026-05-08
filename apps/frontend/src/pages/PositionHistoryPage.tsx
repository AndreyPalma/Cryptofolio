import { useParams, Link } from "react-router-dom";
import { usePositionHistory } from "../hooks/usePositionHistory";
import { PnlDisplay } from "../components/dashboard/PnlDisplay";
import { CycleBadge } from "../components/token-detail/CycleBadge";
import type { PositionHistoryEntry } from "../types/token-detail";

interface CycleCardProps {
  entry: PositionHistoryEntry;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function CycleCard({ entry }: CycleCardProps) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      <div className="flex items-center justify-between">
        <CycleBadge cycleNumber={entry.cycleNumber} />
        <PnlDisplay value={entry.realizedPnlUsd} kind="usd" />
      </div>
      <p className="mt-2 text-xs text-gray-500">
        {formatDate(entry.openedAt)} → {formatDate(entry.closedAt)}
      </p>
    </div>
  );
}

export function PositionHistoryPage() {
  const { contractAddress, network } = useParams<{
    contractAddress: string;
    network: string;
  }>();

  const { data, loading, error } = usePositionHistory(
    contractAddress ?? "",
    network ?? "",
  );

  return (
    <main className="p-6">
      <Link
        to={`/token/${contractAddress ?? ""}/${network ?? ""}`}
        className="mb-4 inline-block text-sm text-gray-400 hover:text-white"
      >
        ← Token Detail
      </Link>

      <h1 className="mb-6 text-2xl font-bold text-white">Position History</h1>

      {loading && (
        <p className="text-center text-gray-400">Loading…</p>
      )}

      {error && (
        <div className="rounded border border-red-800 bg-red-950 px-4 py-2 text-sm text-red-300">
          Error: {error.message}
        </div>
      )}

      {!loading && !error && data && (
        <>
          {data.cycles.length === 0 ? (
            <p className="py-8 text-center text-gray-400">No closed cycles yet</p>
          ) : (
            <div className="space-y-4">
              {data.cycles.map((entry) => (
                <CycleCard key={entry.cycleNumber} entry={entry} />
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}
