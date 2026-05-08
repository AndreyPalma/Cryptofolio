import { useState, useEffect, useRef } from "react";
import { apiClient, UnauthorizedError } from "../lib/api-client";
import type { TokenDetail } from "../types/token-detail";

export interface UseTokenDetailResult {
  data: TokenDetail | null;
  loading: boolean;
  error: Error | null;
  lastUpdated: Date | null;
  isRefetching: boolean;
  refresh: () => Promise<void>;
}

export function useTokenDetail(
  contractAddress: string,
  network: string,
  walletId?: string,
): UseTokenDetailResult {
  const [data, setData] = useState<TokenDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRefetching, setIsRefetching] = useState<boolean>(false);

  const isMountedRef = useRef<boolean>(true);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isFetchingRef = useRef<boolean>(false);

  // Stable ref to current data so we can check inside the async callback
  const dataRef = useRef<TokenDetail | null>(null);
  dataRef.current = data;

  const buildUrl = (ca: string, net: string, wId?: string): string => {
    const base = `/api/portfolio/token/${ca}/${net}`;
    return wId ? `${base}?wallet_id=${wId}` : base;
  };

  const refresh = async (): Promise<void> => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    if (dataRef.current === null) {
      setLoading(true);
    } else {
      setIsRefetching(true);
    }

    try {
      const url = buildUrl(contractAddress, network, walletId);
      const res = await apiClient.get<TokenDetail>(url);
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

  // Stable ref to refresh so intervals don't close over stale state
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    isMountedRef.current = true;

    // Reset state on param changes
    setLoading(true);
    setError(null);

    const safeRefresh = (): void => {
      refreshRef.current().catch(() => {
        // UnauthorizedError is re-thrown by refresh(); caller (auth context) handles redirect.
        // We swallow it here to avoid unhandled rejection in the effect.
      });
    };

    // Initial fetch
    safeRefresh();

    // Poll every 30s (half the portfolio poll interval per spec D5)
    pollIntervalRef.current = setInterval(() => {
      safeRefresh();
    }, 30_000);

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        // Pause polling
        if (pollIntervalRef.current !== null) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      } else {
        // Tab became visible — immediate refetch + re-arm
        safeRefresh();
        pollIntervalRef.current = setInterval(() => {
          safeRefresh();
        }, 30_000);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractAddress, network, walletId]);

  return { data, loading, error, lastUpdated, isRefetching, refresh };
}
