import { useState, useEffect, useCallback } from "react";
import { apiClient } from "../../lib/api-client";
import type { PendingTransfer, TokenNetwork } from "../../types/settings";

interface PendingTransferApiRow {
  id: string;
  wallet_id: string;
  token_id: string;
  token_symbol: string;
  token_network: TokenNetwork;
  amount: string;
  block_timestamp: string;
  tx_hash: string | null;
  from_address: string | null;
  contract_address: string | null;
}

interface PendingPriceApiResponse {
  transactions: PendingTransferApiRow[];
  count: number;
}

interface PendingPriceData {
  transactions: PendingTransfer[];
  count: number;
}

function toPendingTransfer(row: PendingTransferApiRow): PendingTransfer {
  return {
    id: row.id,
    walletId: row.wallet_id,
    tokenId: row.token_id,
    tokenSymbol: row.token_symbol,
    tokenNetwork: row.token_network,
    amount: row.amount,
    blockTimestamp: new Date(row.block_timestamp),
    txHash: row.tx_hash,
    fromAddress: row.from_address,
    contractAddress: row.contract_address,
  };
}

export interface UsePendingPriceTransfersResult {
  data: PendingPriceData | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function usePendingPriceTransfers(): UsePendingPriceTransfersResult {
  const [data, setData] = useState<PendingPriceData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchPending = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<PendingPriceApiResponse>(
        "/api/transactions/pending-price",
      );
      setData({
        transactions: res.transactions.map(toPendingTransfer),
        count: res.count,
      });
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPending();
  }, [fetchPending]);

  return { data, loading, error, refetch: fetchPending };
}
