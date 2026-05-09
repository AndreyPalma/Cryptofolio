// schemas/balance-validation.ts — US-012 A7

import { z } from 'zod';

export const BalanceDifferenceSchema = z.object({
  asset: z.string(),
  engineBalance: z.string(),
  snapshotBalance: z.string(),
  diff: z.string(),
});
export type BalanceDifference = z.infer<typeof BalanceDifferenceSchema>;

export const BalanceValidationResponseSchema = z.object({
  differences: z.array(BalanceDifferenceSchema),
  totalEngineUsd: z.string(),
  totalSnapshotUsd: z.string(),
  takenAt: z.string(),
  dustNote: z.string(),
});
export type BalanceValidationResponse = z.infer<typeof BalanceValidationResponseSchema>;
