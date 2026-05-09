import { useState, useEffect } from "react";
import { apiClient } from "../../lib/api-client";
import type { ApiKeysPresence } from "../../types/settings";

export interface UseApiKeysStatusResult {
  data: ApiKeysPresence | null;
  loading: boolean;
  error: Error | null;
}

export function useApiKeysStatus(): UseApiKeysStatusResult {
  const [data, setData] = useState<ApiKeysPresence | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchStatus = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiClient.get<ApiKeysPresence>("/api/credentials");
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

    void fetchStatus();

    return () => {
      cancelled = true;
    };
  }, []);

  return { data, loading, error };
}
