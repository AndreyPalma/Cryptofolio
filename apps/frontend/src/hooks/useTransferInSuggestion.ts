/**
 * useTransferInSuggestion — fetches WAC inheritance candidates for TRANSFER_IN.
 * Only fires when type=TRANSFER_IN + ON_CHAIN destination wallet + token selected.
 * Uses cancelled-flag pattern to prevent stale responses.
 */
import { useState, useEffect } from "react";
import { apiClient } from "../lib/api-client";
import type { TransactionType } from "../types/token-detail";
import type { WalletEntry } from "../types/token-detail";
import type { Token } from "./useTokensByWallet";
import type { DecimalString } from "../types/portfolio";

interface WalletBreakdownEntry {
  walletId: string;
  label: string | null;
  balance: DecimalString;
  wac: DecimalString;
}

interface TokenPortfolioResponse {
  position: {
    walletBreakdown: WalletBreakdownEntry[];
  } | null;
}

export interface TransferInCandidate {
  walletId: string;
  label: string;
  wac: DecimalString;
}

export interface UseTransferInSuggestionResult {
  candidate: TransferInCandidate | null;
  loading: boolean;
  error: Error | null;
}

export function useTransferInSuggestion(
  token: Token | null,
  destinationWalletId: string | null,
  type: TransactionType,
  walletsByType: Map<string, WalletEntry>,
): UseTransferInSuggestionResult {
  const [candidate, setCandidate] = useState<TransferInCandidate | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  // Determine if destination wallet is ON_CHAIN
  const destinationWallet = destinationWalletId !== null
    ? walletsByType.get(destinationWalletId)
    : undefined;
  const isOnChainDestination = destinationWallet?.walletType === "ON_CHAIN";

  const shouldFetch =
    type === "TRANSFER_IN" &&
    token !== null &&
    destinationWalletId !== null &&
    isOnChainDestination;

  useEffect(() => {
    if (!shouldFetch || token === null || destinationWalletId === null) {
      setCandidate(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    apiClient
      .get<TokenPortfolioResponse>(
        `/api/portfolio/token/${token.contractAddress}/${token.network}`,
      )
      .then((res) => {
        if (cancelled) return;

        const breakdown = res.position?.walletBreakdown ?? [];

        const candidates = breakdown.filter(
          (b) =>
            b.walletId !== destinationWalletId &&
            parseFloat(b.balance) > 0 &&
            walletsByType.get(b.walletId)?.walletType === "ON_CHAIN",
        );

        if (candidates.length === 0) {
          setCandidate(null);
          return;
        }

        // Pick highest-balance match
        const best = candidates.reduce((max, cur) =>
          parseFloat(cur.balance) > parseFloat(max.balance) ? cur : max,
        );

        setCandidate({
          walletId: best.walletId,
          label: best.label ?? "Unknown Wallet",
          wac: best.wac,
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setCandidate(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [type, token?.contractAddress, token?.network, destinationWalletId, isOnChainDestination]);

  return { candidate, loading, error };
}
