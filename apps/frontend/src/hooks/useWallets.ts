import { useState, useEffect } from "react";
import { apiClient } from "../lib/api-client";
import type { WalletEntry } from "../types/token-detail";

export interface UseWalletsResult {
  data: WalletEntry[] | null;
  loading: boolean;
  error: Error | null;
}

export function useWallets(): UseWalletsResult {
  const [data, setData] = useState<WalletEntry[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchWallets = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiClient.get<WalletEntry[]>("/api/wallets");
        if (cancelled) return;
        setData(res);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void fetchWallets();

    return () => {
      cancelled = true;
    };
  }, []);

  return { data, loading, error };
}
