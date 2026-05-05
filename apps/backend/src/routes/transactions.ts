// Route plugin — /api/transactions — US-006
// authPlugin already adds onRequest hook for all /api/* routes.
// No preHandler per route needed here.

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import pg from 'pg';
import { createTransaction, listTransactions } from '../services/transaction.js';
import { InsufficientBalanceError } from '../position-engine/index.js';

const { Pool } = pg;

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
};
