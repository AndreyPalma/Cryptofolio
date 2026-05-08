import { useState, useEffect } from "react";
import { apiClient } from "../lib/api-client";
import type { WalletEntry } from "../types/token-detail";

// Internal type — mirrors raw backend row (snake_case)
interface WalletApiRow {
  id: string;
  user_id: string;
  wallet_type: "ON_CHAIN" | "CEX";
  address: string | null;
  network: string;
  label: string | null;
  last_synced_at: string | null;
  created_at: string;
}

function toWalletEntry(row: WalletApiRow): WalletEntry {
  return {
    id: row.id,
    label: row.label,
    walletType: row.wallet_type,
    network: row.network,
  };
}

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
        const res = await apiClient.get<WalletApiRow[]>("/api/wallets");
        if (cancelled) return;
        setData(res.map(toWalletEntry));
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
