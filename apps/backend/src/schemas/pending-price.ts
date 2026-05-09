// schemas/pending-price.ts — US-012 A6

import { z } from 'zod';

export const PendingTransferSchema = z.object({
  id: z.string().min(1),
  wallet_id: z.string().min(1),
  token_id: z.string().min(1),
  token_symbol: z.string(),
  token_network: z.enum(['ETH', 'BSC', 'CEX_BINANCE']),
  amount: z.string(),
  block_timestamp: z.string(), // ISO string
  tx_hash: z.string().nullable(),
  from_address: z.string().nullable(),
  contract_address: z.string().nullable(),
});
export type PendingTransfer = z.infer<typeof PendingTransferSchema>;

export const PendingPriceResponseSchema = z.object({
  transactions: z.array(PendingTransferSchema).max(100),
  count: z.number().int().nonnegative(),
});
export type PendingPriceResponse = z.infer<typeof PendingPriceResponseSchema>;
