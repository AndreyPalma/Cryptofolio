import { useState } from "react";
import { apiClient } from "../../lib/api-client";
import type { SyncState, OnChainSyncResult, CexSyncResult } from "../../types/settings";

interface OnChainApiResponse {
  synced: number;
  skipped: number;
  swapsDecomposed: number;
  transfersPendingCost: number;
  transfersInheritedFromCEX: number;
}

interface CexApiResponse {
  trades: { synced: number; skipped: number; symbolsProcessed: number };
  converts: { synced: number; skipped: number };
  withdrawals: { synced: number; skipped: number };
  deposits: { synced: number; skipped: number; inherited: number; manual: number };
  tokensCreated: number;
}

function parseOnChain(raw: OnChainApiResponse): OnChainSyncResult {
  return {
    kind: "on-chain",
    synced: raw.synced,
    skipped: raw.skipped,
    swapsDecomposed: raw.swapsDecomposed,
    transfersPendingCost: raw.transfersPendingCost,
    transfersInheritedFromCEX: raw.transfersInheritedFromCEX,
  };
}

function parseCex(raw: CexApiResponse): CexSyncResult {
  return {
    kind: "cex",
    trades: raw.trades,
    converts: raw.converts,
    withdrawals: raw.withdrawals,
    deposits: raw.deposits,
    tokensCreated: raw.tokensCreated,
  };
}

export interface UseSyncWalletResult {
  states: Record<string, SyncState>;
  sync: (walletId: string, kind: "on-chain" | "cex") => Promise<void>;
}

export function useSyncWallet(): UseSyncWalletResult {
  const [states, setStates] = useState<Record<string, SyncState>>({});

  const sync = async (walletId: string, kind: "on-chain" | "cex"): Promise<void> => {
    setStates((prev) => ({ ...prev, [walletId]: { status: "syncing" } }));

    try {
      if (kind === "on-chain") {
        const raw = await apiClient.post<OnChainApiResponse>(`/api/sync/${walletId}`);
        const result = parseOnChain(raw);
        setStates((prev) => ({
          ...prev,
          [walletId]: { status: "success", result, finishedAt: new Date() },
        }));
      } else {
        const raw = await apiClient.post<CexApiResponse>(`/api/sync/${walletId}`);
        const result = parseCex(raw);
        setStates((prev) => ({
          ...prev,
          [walletId]: { status: "success", result, finishedAt: new Date() },
        }));
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setStates((prev) => ({
        ...prev,
        [walletId]: { status: "error", message },
      }));
    }
  };

  return { states, sync };
}
