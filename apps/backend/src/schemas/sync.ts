// Zod schemas for the sync route — US-008-A
import { z } from 'zod';

export const SyncParamsSchema = z.object({
  walletId: z.uuid(),
});
export type SyncParams = z.infer<typeof SyncParamsSchema>;

// Slim response shape — full Transaction shape lives in types/transaction.ts
const SyncedTxSchema = z.object({
  id: z.uuid(),
  type: z.enum(['BUY', 'SELL', 'SWAP_IN', 'SWAP_OUT', 'TRANSFER_IN', 'TRANSFER_OUT']),
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
