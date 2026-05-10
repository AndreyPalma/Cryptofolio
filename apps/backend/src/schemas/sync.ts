// Zod schemas for the sync route — US-008-A / US-008-B
import { z } from 'zod';

export const SyncParamsSchema = z.object({
  walletId: z.uuid(),
});
export type SyncParams = z.infer<typeof SyncParamsSchema>;

// Slim response shape — full Transaction shape lives in types/transaction.ts
const SyncedTxSchema = z.object({
  id: z.uuid(),
  type: z.enum(['BUY', 'SELL', 'SWAP_IN', 'SWAP_OUT', 'TRANSFER_IN', 'TRANSFER_OUT', 'FIAT_IN', 'FIAT_OUT']),
  txHash: z.string(),
  blockTimestamp: z.string(),                  // ISO string
  amount: z.string(),
  priceUsd: z.string().nullable(),
  costSource: z.enum(['MARKET', 'INHERITED', 'MANUAL']).nullable(),
});

export const SyncResultSchema = z.object({
  synced: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  swapsDecomposed: z.number().int().nonnegative(),
  transfersPendingCost: z.number().int().nonnegative(),
  transfersInheritedFromCEX: z.number().int().nonnegative(),
  newTransactions: z.array(SyncedTxSchema).max(10),
});
export type SyncResult = z.infer<typeof SyncResultSchema>;

// ─── BinanceSyncResult — US-008-B ─────────────────────────────────────────────

export const BinanceSyncResultSchema = z.object({
  trades: z.object({
    synced: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    symbolsProcessed: z.number().int().nonnegative(),
  }),
  converts: z.object({
    synced: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  }),
  withdrawals: z.object({
    synced: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  }),
  deposits: z.object({
    synced: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    inherited: z.number().int().nonnegative(),
    manual: z.number().int().nonnegative(),
  }),
  fiat: z.number().int().nonnegative(),
  tokensCreated: z.number().int().nonnegative(),
});
export type BinanceSyncResult = z.infer<typeof BinanceSyncResultSchema>;
