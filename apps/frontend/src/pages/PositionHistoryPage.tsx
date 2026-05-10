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

  // Find the token group matching this page's URL params.
  // For ON_CHAIN tokens: contractAddress IS the contract address (not null).
  // For CEX_BINANCE tokens: contractAddress is the symbol.lowerCase() because
  // getTokenRouteParam(null, symbol) = symbol.toLowerCase().
  // We match by identity key so the lookup works for both cases.
  const tokenGroup =
    data && normalizedNetwork && contractAddress
      ? (data.byToken.find((tg) => {
          const key = getTokenIdentityKey(
            normalizedNetwork,
            tg.contractAddress,
            tg.symbol,
          );
          // For CEX tokens contractAddress IS the symbol-lowercase from URL.
          // For ON_CHAIN tokens contractAddress IS the contract address.
          const urlKey =
            normalizedNetwork === "CEX_BINANCE"
              ? getTokenIdentityKey(normalizedNetwork, null, contractAddress)
              : getTokenIdentityKey(
                  normalizedNetwork,
                  contractAddress,
                  "", // symbol not needed when we have the real contractAddress
                );
          return key === urlKey;
        }) ?? null)
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
