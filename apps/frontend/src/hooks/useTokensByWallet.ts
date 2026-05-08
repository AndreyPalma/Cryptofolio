/**
 * useTokensByWallet — fetches tokens filtered by wallet network.
 * Module-level cache keyed by network prevents duplicate requests.
 */
import { useState, useEffect } from "react";
import { apiClient } from "../lib/api-client";
import type { WalletEntry } from "../types/token-detail";

// Raw backend token shape (snake_case)
interface TokenApiRow {
  id: string;
  symbol: string;
  name: string | null;
  network: string;
  contract_address: string;
  decimals: number;
  binance_symbol: string | null;
  is_hidden: boolean;
  target_exit_price: string | null;
  created_at: string;
}

// Consumer-facing token type (camelCase)
export interface Token {
  id: string;
  symbol: string;
  name: string | null;
  network: string;
  contractAddress: string;
  decimals: number;
  binanceSymbol: string | null;
  isHidden: boolean;
  targetExitPrice: string | null;
}

function toToken(row: TokenApiRow): Token {
  return {
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    network: row.network,
    contractAddress: row.contract_address,
    decimals: row.decimals,
    binanceSymbol: row.binance_symbol,
    isHidden: row.is_hidden,
    targetExitPrice: row.target_exit_price,
  };
}

// Module-level cache keyed by network
const tokenCache = new Map<string, Token[]>();

export interface UseTokensByWalletResult {
  data: Token[] | null;
  loading: boolean;
  error: Error | null;
}

export function useTokensByWallet(wallet: WalletEntry | null): UseTokensByWalletResult {
  const [data, setData] = useState<Token[] | null>(null);
  // Start loading=true when a wallet is provided (fetch will happen immediately)
  const [loading, setLoading] = useState<boolean>(wallet !== null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (wallet === null) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    const network = wallet.network;

    // Cache hit — return synchronously
    const cached = tokenCache.get(network);
    if (cached !== undefined) {
      setData(cached);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    apiClient
      .get<TokenApiRow[]>(`/api/tokens?network=${network}`)
      .then((rows) => {
        if (cancelled) return;
        const tokens = rows.filter((r) => !r.is_hidden).map(toToken);
        tokenCache.set(network, tokens);
        setData(tokens);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e : new Error(String(e)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [wallet?.id, wallet?.network]);

  return { data, loading, error };
}
