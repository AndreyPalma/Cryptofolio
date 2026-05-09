// Route plugin — /api/transactions — US-006
// authPlugin already adds onRequest hook for all /api/* routes.
// No preHandler per route needed here.

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import pg from 'pg';
import { createTransaction, listTransactions } from '../services/transaction.js';
import { InsufficientBalanceError } from '../position-engine/index.js';

const { Pool } = pg;

// Pending price SQL — US-012 A6
const PENDING_PRICE_SQL = `
WITH pending AS (
  SELECT
    t.id,
    t.wallet_id,
    t.token_id,
    tk.symbol AS token_symbol,
    tk.network AS token_network,
    t.amount,
    t.block_timestamp,
    t.tx_hash,
    t.from_address,
    tk.contract_address
  FROM transactions t
  JOIN tokens tk ON tk.id = t.token_id
  JOIN wallets w ON w.id = t.wallet_id
  WHERE w.user_id = $1
    AND t.type = 'TRANSFER_IN'
    AND t.cost_source = 'MANUAL'
    AND t.price_usd IS NULL
  ORDER BY t.block_timestamp DESC
  LIMIT 100
)
SELECT
  (SELECT COUNT(*)::int
     FROM transactions t
     JOIN wallets w ON w.id = t.wallet_id
     WHERE w.user_id = $1
       AND t.type = 'TRANSFER_IN'
       AND t.cost_source = 'MANUAL'
       AND t.price_usd IS NULL) AS total_count,
  (SELECT json_agg(p) FROM pending p) AS items
`;

const CreateTransactionBodySchema = z.object({
  wallet_id:         z.uuid(),
  token_id:          z.uuid(),
  type:              z.enum(['BUY', 'SELL', 'SWAP_IN', 'SWAP_OUT', 'TRANSFER_IN', 'TRANSFER_OUT']),
  amount:            z.string().regex(/^\d+(\.\d+)?$/).refine(v => parseFloat(v) > 0, {
                       message: 'amount must be positive',
                     }),
  price_usd_at_time: z.string().regex(/^\d+(\.\d+)?$/).nullable(),
  block_timestamp:   z.iso.datetime(),
  cost_source:       z.enum(['MARKET', 'INHERITED', 'MANUAL']).optional(),
});

const ListTransactionsQuerySchema = z.object({
  wallet_id:   z.uuid(),
  token_id:    z.uuid().optional(),
  position_id: z.uuid().optional(),
  limit:       z.coerce.number().int().min(1).max(100).default(20),
  offset:      z.coerce.number().int().min(0).default(0),
});

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async signature; no top-level await needed here
export const transactionRoutes: FastifyPluginAsync = async (fastify) => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // POST / — create manual transaction
  fastify.post('/', async (request, reply) => {
    const parseResult = CreateTransactionBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        issues: parseResult.error.issues,
      });
    }

    try {
      const result = await createTransaction(pool, parseResult.data);
      return await reply.status(201).send(result);
    } catch (err) {
      // Capture InsufficientBalanceError explicitly — needs extended body with currentBalance/attempted
      if (err instanceof InsufficientBalanceError) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'INSUFFICIENT_BALANCE',
          message: err.message,
          currentBalance: err.currentBalance,
          attempted: err.attempted,
        });
      }
      // DomainError (ValidationError, NotFoundError) → propagate to setErrorHandler global
      throw err;
    }
  });

  // GET / — list transactions
  fastify.get('/', async (request, reply) => {
    const parseResult = ListTransactionsQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        issues: parseResult.error.issues,
      });
    }

    const result = await listTransactions(pool, parseResult.data);
    return reply.status(200).send(result);
  });

  // GET /pending-price — list TRANSFER_IN without a price — US-012 A6
  fastify.get('/pending-price', async (request, reply) => {
    const userId: string = (request.user as { sub?: string } | undefined)?.sub ?? 'unknown';

    const result = await pool.query<{ total_count: string; items: string | null }>(
      PENDING_PRICE_SQL,
      [userId],
    );

    const row = result.rows[0];
    const totalCount = parseInt(row?.total_count ?? '0', 10);
    const items: unknown[] = row?.items ? (JSON.parse(row.items) as unknown[]) : [];

    return reply.status(200).send({ transactions: items, count: totalCount });
  });
};
