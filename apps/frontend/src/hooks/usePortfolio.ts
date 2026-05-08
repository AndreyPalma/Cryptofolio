import { useState, useEffect, useRef } from "react";
import { apiClient, UnauthorizedError } from "../lib/api-client";
import type { PortfolioResponse } from "../types/portfolio";

export interface UsePortfolioResult {
  data: PortfolioResponse | null;
  loading: boolean;
  error: Error | null;
  lastUpdated: Date | null;
  isRefetching: boolean;
  refresh: () => Promise<void>;
}

export function usePortfolio(): UsePortfolioResult {
  const [data, setData] = useState<PortfolioResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRefetching, setIsRefetching] = useState<boolean>(false);

  const isMountedRef = useRef<boolean>(true);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isFetchingRef = useRef<boolean>(false);

  // Stable ref to current data so we can check inside the async callback
  const dataRef = useRef<PortfolioResponse | null>(null);
  dataRef.current = data;

  const refresh = async (): Promise<void> => {
    // Guard: don't fire if already fetching
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    if (dataRef.current === null) {
      setLoading(true);
    } else {
      setIsRefetching(true);
    }

    try {
      const res = await apiClient.get<PortfolioResponse>("/api/portfolio");
      if (!isMountedRef.current) return;
      setData(res);
      setLastUpdated(new Date());
      setError(null);
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        isFetchingRef.current = false;
        throw e;
      }
      if (!isMountedRef.current) return;
      setError(e instanceof Error ? e : new Error(String(e)));
      // Do NOT clear data — stale-while-error UX requirement
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
        setIsRefetching(false);
      }
      isFetchingRef.current = false;
    }
  };

  // Stable ref to refresh so the interval doesn't close over stale state
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    isMountedRef.current = true;

    // Initial fetch
    void refreshRef.current();

    // Poll every 60s
    pollIntervalRef.current = setInterval(() => {
      void refreshRef.current();
    }, 60_000);

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        // Pause polling
        if (pollIntervalRef.current !== null) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      } else {
        // Tab became visible — immediate refetch + re-arm
        void refreshRef.current();
        pollIntervalRef.current = setInterval(() => {
          void refreshRef.current();
        }, 60_000);
      }
    };

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      isMountedRef.current = false;
      if (pollIntervalRef.current !== null) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return { data, loading, error, lastUpdated, isRefetching, refresh };
}
