/**
 * useWalletBalance — looks up the current balance + WAC for a (walletId, contractAddress, network) triple.
 * Fetches GET /api/portfolio/token/:contractAddress/:network and picks the matching breakdown entry.
 */
import { useState, useEffect } from "react";
import { apiClient } from "../lib/api-client";
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

export interface UseWalletBalanceResult {
  balance: DecimalString | null;
  wac: DecimalString | null;
  loading: boolean;
  error: Error | null;
}

export function useWalletBalance(
  walletId: string,
  contractAddress: string,
  network: string,
): UseWalletBalanceResult {
  const [balance, setBalance] = useState<DecimalString | null>(null);
  const [wac, setWac] = useState<DecimalString | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!walletId || !contractAddress || !network) {
      setBalance(null);
      setWac(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    apiClient
      .get<TokenPortfolioResponse>(`/api/portfolio/token/${contractAddress}/${network}`)
      .then((res) => {
        if (cancelled) return;
        const breakdown = res.position?.walletBreakdown ?? [];
        const entry = breakdown.find((b) => b.walletId === walletId);
        setBalance(entry?.balance ?? null);
        setWac(entry?.wac ?? null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setBalance(null);
        setWac(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [walletId, contractAddress, network]);

  return { balance, wac, loading, error };
}
