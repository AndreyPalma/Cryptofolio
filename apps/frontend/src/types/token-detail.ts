/**
 * Frontend domain types for the Token Detail page (US-010).
 * All numeric fields are DecimalString — never JS number (PRD invariant).
 */

import type { DecimalString, Network } from "./portfolio";

// ─── Enums (as const objects + typeof extraction) ────────────────────────────

export const TRANSACTION_TYPE = {
  BUY: "BUY",
  SELL: "SELL",
  SWAP_IN: "SWAP_IN",
  SWAP_OUT: "SWAP_OUT",
  TRANSFER_IN: "TRANSFER_IN",
  TRANSFER_OUT: "TRANSFER_OUT",
} as const;
export type TransactionType = (typeof TRANSACTION_TYPE)[keyof typeof TRANSACTION_TYPE];

export const TRANSACTION_SOURCE = {
  ETHERSCAN: "ETHERSCAN",
  BSCTRACE: "BSCTRACE",
  BINANCE: "BINANCE",
  MANUAL: "MANUAL",
} as const;
export type TransactionSource = (typeof TRANSACTION_SOURCE)[keyof typeof TRANSACTION_SOURCE];

export const COST_SOURCE = {
  MARKET: "MARKET",
  INHERITED: "INHERITED",
  MANUAL: "MANUAL",
} as const;
export type CostSource = (typeof COST_SOURCE)[keyof typeof COST_SOURCE] | null;

export type CostInheritedFrom = "ONCHAIN" | "BINANCE" | null;

// ─── P&L discriminated union ─────────────────────────────────────────────────

export type PnlInfo =
  | { kind: "INBOUND"; lotPnlUsd: DecimalString | null; lotPnlPct: DecimalString | null }
  | { kind: "OUTBOUND"; displayAs: "Sold/Out"; realizedPnlUsd: DecimalString | null };

// ─── Transaction with per-lot P&L ────────────────────────────────────────────

export interface TransactionWithPnl {
  id: string;
  walletId: string;
  tokenId: string;
  positionId: string | null;
  type: TransactionType;
  source: TransactionSource;
  blockTimestamp: string; // ISO-8601
  amount: DecimalString;
  priceUsd: DecimalString | null;
  costSource: CostSource;
  txHash: string | null;
  cexTradeId: string | null;
  relatedTxId: string | null;
  costInheritedFrom: CostInheritedFrom;
  pnl: PnlInfo;
}

// ─── Token info ───────────────────────────────────────────────────────────────

export interface TokenInfo {
  id: string;
  symbol: string;
  name: string | null;
  network: Network;
  contractAddress: string;
  binanceSymbol: string | null;
  decimals: number;
  targetExitPrice: DecimalString | null;
}

// ─── Position stats (mirrors backend TokenPortfolioRowSchema) ─────────────────

export interface WalletBreakdown {
  walletId: string;
  label: string | null;
  balance: DecimalString;
  wac: DecimalString;
}

export interface PositionStats {
  symbol: string;
  network: Network;
  sourceType: "ON_CHAIN" | "CEX";
  contractAddress: string;
  binanceSymbol: string | null;
  totalBalance: DecimalString;
  wacAggregated: DecimalString;
  totalCostBasis: DecimalString;
  currentPrice: DecimalString | null;
  totalCurrentValue: DecimalString | null;
  pnlUsd: DecimalString | null;
  pnlPct: DecimalString | null;
  walletCount: number;
  walletBreakdown: WalletBreakdown[];
  cycleNumber: number;
  priceUnavailable?: boolean;
}

// ─── Token detail response ────────────────────────────────────────────────────

export interface TokenDetail {
  token: TokenInfo;
  position: PositionStats | null;
  transactions: TransactionWithPnl[];
  priceUnavailable?: boolean;
}

// ─── Position history ─────────────────────────────────────────────────────────

export interface PositionHistoryEntry {
  cycleNumber: number;
  openedAt: string; // ISO-8601
  closedAt: string; // ISO-8601
  realizedPnlUsd: DecimalString;
}

export interface PositionHistoryResponse {
  cycles: PositionHistoryEntry[];
}

// ─── Wallet entry for selector ────────────────────────────────────────────────

export interface WalletEntry {
  id: string;
  label: string | null;
  walletType: "ON_CHAIN" | "CEX";
  network: string;
}
