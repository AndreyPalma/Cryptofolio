// schemas/credentials.ts — US-012 A2
// Zod schemas for GET /api/credentials and POST /api/credentials/test/:service

import { z } from 'zod';

// ── GET /api/credentials response ─────────────────────────────────────────────

export const CredentialsPresenceSchema = z.object({
  ETHERSCAN_API_KEY: z.boolean(),
  BSCTRACE_API_KEY: z.boolean(),
  BINANCE_API_KEY: z.boolean(),
  BINANCE_SECRET_KEY: z.boolean(),
});
export type CredentialsPresence = z.infer<typeof CredentialsPresenceSchema>;

// ── POST /api/credentials/test/:service param ─────────────────────────────────

export const CredentialServiceParamSchema = z.object({
  service: z.enum(['etherscan', 'bsctrace', 'binance']),
});
export type CredentialServiceParam = z.infer<typeof CredentialServiceParamSchema>;

// ── POST /api/credentials/test/:service response ──────────────────────────────

export const CredentialTestSuccessSchema = z.object({
  status: z.literal('connected'),
  meta: z
    .object({
      assetCount: z.number().int().nonnegative().optional(),
      latencyMs: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export const CredentialTestFailureSchema = z.object({
  status: z.literal('failed'),
  reason: z.string().min(1),
});

export const CredentialTestResultSchema = z.discriminatedUnion('status', [
  CredentialTestSuccessSchema,
  CredentialTestFailureSchema,
]);
export type CredentialTestResult = z.infer<typeof CredentialTestResultSchema>;
