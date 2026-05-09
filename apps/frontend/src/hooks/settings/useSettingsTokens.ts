import { useState, useEffect, useCallback } from "react";
import { apiClient } from "../../lib/api-client";
import type { SettingsToken, TokenNetwork } from "../../types/settings";

interface TokenApiRow {
  id: string;
  symbol: string;
  name: string | null;
  network: TokenNetwork;
  contract_address: string | null;
  binance_symbol: string | null;
  is_hidden: boolean;
  target_exit_price: string | null;
}

function toSettingsToken(row: TokenApiRow): SettingsToken {
  return {
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    network: row.network,
    contractAddress: row.contract_address,
    binanceSymbol: row.binance_symbol,
    isHidden: row.is_hidden,
    targetExitPrice: row.target_exit_price,
  };
}

interface TokenPatch {
  is_hidden?: boolean;
  target_exit_price?: string | null;
}

export interface UseSettingsTokensResult {
  data: SettingsToken[] | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  updateToken: (
    id: string,
    patch: Partial<Pick<SettingsToken, "isHidden" | "targetExitPrice">>,
  ) => Promise<void>;
}

export function useSettingsTokens(): UseSettingsTokensResult {
  const [data, setData] = useState<SettingsToken[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchTokens = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<TokenApiRow[]>("/api/tokens");
      setData(res.map(toSettingsToken));
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTokens();
  }, [fetchTokens]);

  const updateToken = useCallback(
    async (
      id: string,
      patch: Partial<Pick<SettingsToken, "isHidden" | "targetExitPrice">>,
    ): Promise<void> => {
      // Translate camelCase patch to snake_case for the API
      const apiPatch: TokenPatch = {};
      if ("isHidden" in patch) {
        apiPatch.is_hidden = patch.isHidden;
      }
      if ("targetExitPrice" in patch) {
        apiPatch.target_exit_price = patch.targetExitPrice;
      }

      const updated = await apiClient.put<TokenApiRow>(`/api/tokens/${id}`, apiPatch);

      // Update local data only on success
      setData((prev) => {
        if (prev === null) return prev;
        return prev.map((t) => (t.id === id ? toSettingsToken(updated) : t));
      });
    },
    [],
  );

  return { data, loading, error, refetch: fetchTokens, updateToken };
}
