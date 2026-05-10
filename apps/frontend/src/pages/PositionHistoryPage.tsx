import { Link, useParams } from "react-router-dom";
import { PositionCyclesSection } from "../components/token-detail/PositionCyclesSection";
import { useClosedPositions } from "../hooks/useClosedPositions";
import { getTokenIdentityKey } from "../lib/token-path";
import { NETWORK, type Network } from "../types/portfolio";

export function PositionHistoryPage() {
  const { contractAddress, network } = useParams<{
    contractAddress: string;
    network: string;
  }>();

  const normalizedNetwork =
    network && (Object.values(NETWORK) as string[]).includes(network)
      ? (network as Network)
      : undefined;

  const { data, loading, error } = useClosedPositions({
    network: normalizedNetwork,
  });

  const tokenGroup =
    contractAddress && normalizedNetwork
      ? (data?.byToken.find(
          (token) =>
            getTokenIdentityKey(
              token.network,
              token.contractAddress,
              token.symbol,
            ) ===
            getTokenIdentityKey(normalizedNetwork, contractAddress, contractAddress),
        ) ?? null)
      : null;

  return (
    <main className="min-h-screen bg-gray-950 p-6 text-white">
      <Link
        to={`/token/${contractAddress ?? ""}/${network ?? ""}`}
        className="mb-4 inline-block text-sm text-gray-400 hover:text-white"
      >
        ← Token Detail
      </Link>

      <h1 className="mb-6 text-2xl font-bold text-white">
        Position History
      </h1>

      <PositionCyclesSection
        activeCycle={null}
        closedCycles={tokenGroup?.cycles ?? []}
        loading={loading}
        error={error}
      />
    </main>
  );
}
