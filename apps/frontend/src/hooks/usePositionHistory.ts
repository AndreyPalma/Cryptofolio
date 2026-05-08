import { useState, useEffect } from "react";
import { apiClient } from "../lib/api-client";
import type { PositionHistoryResponse } from "../types/token-detail";

export interface UsePositionHistoryResult {
  data: PositionHistoryResponse | null;
  loading: boolean;
  error: Error | null;
}

export function usePositionHistory(
  contractAddress: string,
  network: string,
): UsePositionHistoryResult {
  const [data, setData] = useState<PositionHistoryResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchHistory = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const url = `/api/portfolio/token/${contractAddress}/${network}/history`;
        const res = await apiClient.get<PositionHistoryResponse>(url);
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

    void fetchHistory();

    return () => {
      cancelled = true;
    };
  }, [contractAddress, network]);

  return { data, loading, error };
}
