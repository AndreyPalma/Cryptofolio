import { useState, useEffect, useCallback } from "react";
import { apiClient } from "../../lib/api-client";
import type { SettingsWallet } from "../../types/settings";

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

function toSettingsWallet(row: WalletApiRow): SettingsWallet {
  return {
    id: row.id,
    walletType: row.wallet_type,
    address: row.address,
    network: row.network,
    label: row.label,
    lastSyncedAt: row.last_synced_at !== null ? new Date(row.last_synced_at) : null,
    createdAt: new Date(row.created_at),
  };
}

export interface UseSettingsWalletsResult {
  data: SettingsWallet[] | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useSettingsWallets(): UseSettingsWalletsResult {
  const [data, setData] = useState<SettingsWallet[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchWallets = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<WalletApiRow[]>("/api/wallets");
      setData(res.map(toSettingsWallet));
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchWallets();
  }, [fetchWallets]);

  return { data, loading, error, refetch: fetchWallets };
}
