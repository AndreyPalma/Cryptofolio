// Tipos de dominio para portfolio — US-007

import { z } from 'zod';
import { NETWORKS, TRANSACTION_TYPES, TRANSACTION_SOURCES, COST_SOURCES } from '../db/types.js';

// ─── Network / SourceType ─────────────────────────────────────────────────────

export const TokenNetworkSchema = z.enum(NETWORKS);
export type TokenNetwork = z.infer<typeof TokenNetworkSchema>;

export const TokenSourceTypeSchema = z.enum(['ON_CHAIN', 'CEX'] as const);
export type TokenSourceType = z.infer<typeof TokenSourceTypeSchema>;

// ─── Wallet breakdown ─────────────────────────────────────────────────────────

export const WalletBreakdownEntrySchema = z.object({
  walletId: z.string(),
  label: z.string().nullable(),
  balance: z.string(),
  wac: z.string(),
});
export type WalletBreakdownEntry = z.infer<typeof WalletBreakdownEntrySchema>;

// ─── Portfolio summary row ────────────────────────────────────────────────────

export const TokenPortfolioRowSchema = z.object({
  symbol: z.string(),
  network: TokenNetworkSchema,
  sourceType: TokenSourceTypeSchema,
  contractAddress: z.string(),
  binanceSymbol: z.string().nullable(),
  totalBalance: z.string(),
  wacAggregated: z.string(),
  totalCostBasis: z.string(),
  currentPrice: z.string().nullable(),
  totalCurrentValue: z.string().nullable(),
  pnlUsd: z.string().nullable(),
  pnlPct: z.string().nullable(),
  walletCount: z.number().int().nonnegative(),
  walletBreakdown: z.array(WalletBreakdownEntrySchema),
  priceUnavailable: z.boolean().optional(),
});
export type TokenPortfolioRow = z.infer<typeof TokenPortfolioRowSchema>;

// ─── Portfolio summary ────────────────────────────────────────────────────────

export const PortfolioSummarySchema = z.object({
  totalValueUsd: z.string(),
  totalCostBasis: z.string(),
  totalPnlUsd: z.string(),
  totalPnlPct: z.string().nullable(),
  tokens: z.array(TokenPortfolioRowSchema),
});
export type PortfolioSummary = z.infer<typeof PortfolioSummarySchema>;

// ─── Per-lot P&L (discriminated union) ───────────────────────────────────────

export const InboundPnlSchema = z.object({
  kind: z.literal('INBOUND'),
  lotPnlUsd: z.string().nullable(),
  lotPnlPct: z.string().nullable(),
});

export const OutboundPnlSchema = z.object({
  kind: z.literal('OUTBOUND'),
  displayAs: z.literal('Sold/Out'),
});

export const PnlInfoSchema = z.discriminatedUnion('kind', [InboundPnlSchema, OutboundPnlSchema]);
export type PnlInfo = z.infer<typeof PnlInfoSchema>;

// ─── Transaction with per-lot P&L enrichment ─────────────────────────────────

export const TransactionWithPnlSchema = z.object({
  id: z.string(),
  walletId: z.string(),
  tokenId: z.string(),
  positionId: z.string().nullable(),
  type: z.enum(TRANSACTION_TYPES),
  source: z.enum(TRANSACTION_SOURCES),
  blockTimestamp: z.string(),
  amount: z.string(),
  priceUsd: z.string().nullable(),
  costSource: z.enum(COST_SOURCES).nullable(),
  pnl: PnlInfoSchema,
});
export type TransactionWithPnl = z.infer<typeof TransactionWithPnlSchema>;

// ─── Token detail ─────────────────────────────────────────────────────────────

export const TokenDetailSchema = z.object({
  token: z.object({
    id: z.string(),
    symbol: z.string(),
    name: z.string().nullable(),
    network: TokenNetworkSchema,
    contractAddress: z.string(),
    binanceSymbol: z.string().nullable(),
    decimals: z.number().int(),
    targetExitPrice: z.string().nullable(),
  }),
  position: TokenPortfolioRowSchema.nullable(),
  transactions: z.array(TransactionWithPnlSchema),
  priceUnavailable: z.boolean().optional(),
});
export type TokenDetail = z.infer<typeof TokenDetailSchema>;

// ─── Position history ─────────────────────────────────────────────────────────

export const PositionHistoryEntrySchema = z.object({
  cycleNumber: z.number().int().positive(),
  openedAt: z.string(),
  closedAt: z.string(),
  realizedPnlUsd: z.string(),
});
export type PositionHistoryEntry = z.infer<typeof PositionHistoryEntrySchema>;

export const PositionHistoryResponseSchema = z.object({
  cycles: z.array(PositionHistoryEntrySchema),
});
export type PositionHistoryResponse = z.infer<typeof PositionHistoryResponseSchema>;

// ─── PriceService result type ─────────────────────────────────────────────────

export type PriceResult =
  | { readonly priceUsd: string }
  | { readonly priceUnavailable: true };
