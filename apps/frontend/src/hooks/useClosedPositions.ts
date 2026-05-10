import { useEffect, useRef, useState } from "react";
import { apiClient, UnauthorizedError } from "../lib/api-client";
import type { DecimalString, Network } from "../types/portfolio";

export interface ClosedCycle {
  cycleNumber: number;
  walletId: string;
  walletLabel: string | null;
  openedAt: string;
  closedAt: string;
  totalCostUsd: DecimalString;
  totalProceedsUsd: DecimalString;
  realizedPnlUsd: DecimalString;
  realizedPnlPct: DecimalString | null;
}

export interface ClosedTokenGroup {
  tokenId: string;
  symbol: string;
  network: Network;
  contractAddress: string | null;
  totalRealizedPnlUsd: DecimalString;
  cycleCount: number;
  cycles: ClosedCycle[];
}

export interface ClosedPositionsResponse {
  totalRealizedPnlUsd: DecimalString;
  totalClosedCycles: number;
  byToken: ClosedTokenGroup[];
}

export interface UseClosedPositionsFilters {
  walletId?: string;
  network?: Network;
  from?: string;
  to?: string;
}

export interface UseClosedPositionsResult {
  data: ClosedPositionsResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

function buildClosedPositionsUrl(filters: UseClosedPositionsFilters): string {
  const searchParams = new URLSearchParams();

  if (filters.walletId) {
    searchParams.set("walletId", filters.walletId);
  }

  if (filters.network) {
    searchParams.set("network", filters.network);
  }

  if (filters.from) {
    searchParams.set("from", filters.from);
  }

  if (filters.to) {
    searchParams.set("to", filters.to);
  }

  const queryString = searchParams.toString();
  return queryString === ""
    ? "/api/portfolio/closed"
    : `/api/portfolio/closed?${queryString}`;
}

export function useClosedPositions(
  filters: UseClosedPositionsFilters = {},
): UseClosedPositionsResult {
  const { walletId, network, from, to } = filters;
  const [data, setData] = useState<ClosedPositionsResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const isMountedRef = useRef<boolean>(true);
  const isFetchingRef = useRef<boolean>(false);
  const dataRef = useRef<ClosedPositionsResponse | null>(null);
  dataRef.current = data;

  const fetchClosedPositions = async (): Promise<void> => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    if (dataRef.current === null) {
      setLoading(true);
    }

    try {
      const url = buildClosedPositionsUrl({ walletId, network, from, to });
      const response = await apiClient.get<ClosedPositionsResponse>(url);
      if (!isMountedRef.current) return;
      setData(response);
      setError(null);
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        isFetchingRef.current = false;
        throw e;
      }

      if (!isMountedRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
      isFetchingRef.current = false;
    }
  };

  const refresh = (): void => {
    void fetchClosedPositions().catch(() => {
      // Unauthorized redirects are handled by apiClient.
    });
  };

  useEffect(() => {
    isMountedRef.current = true;
    setData(null);
    setError(null);
    setLoading(true);
    dataRef.current = null;

    refresh();

    return () => {
      isMountedRef.current = false;
    };
  }, [walletId, network, from, to]);

  return { data, loading, error, refresh };
}
