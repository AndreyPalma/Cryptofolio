// Route plugin — /api/tokens — US-005
// authPlugin already adds onRequest hook for all /api/* routes.
// No preHandler per route needed here.

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { createToken, findAll, updateToken } from '../services/token.js';
import { pool } from '../db/pool.js';

const CreateTokenBodySchema = z.object({
  symbol: z.string().min(1),
  name: z.string().optional(),
  network: z.string().min(1),
  contract_address: z.string().optional(),
  binance_symbol: z.string().optional(),
  decimals: z.number().int().positive().optional(),
});

const UpdateTokenBodySchema = z.object({
  is_hidden: z.boolean().optional(),
  target_exit_price: z.string().nullable().optional(),
  binance_symbol: z.string().nullable().optional(),
});

const TokenIdParamsSchema = z.object({
  id: z.string().min(1),
});

const TokenQuerySchema = z.object({
  network: z.string().optional(),
  includeHidden: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
});

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async signature; no top-level await needed here
export const tokenRoutes: FastifyPluginAsync = async (fastify) => {

  // GET / — list tokens with optional filters
  fastify.get('/', async (request, reply) => {
    const queryResult = TokenQuerySchema.safeParse(request.query);
    const filter = queryResult.success
      ? {
          network: queryResult.data.network,
          includeHidden: queryResult.data.includeHidden,
        }
      : {};

    const tokens = await findAll(pool, filter);
    return reply.status(200).send(tokens);
  });

  // POST / — create token
  fastify.post('/', async (request, reply) => {
    const parseResult = CreateTokenBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        issues: parseResult.error.issues,
      });
    }

    const token = await createToken(pool, parseResult.data);
    return reply.status(201).send(token);
  });

  // PUT /:id — update token
  fastify.put('/:id', async (request, reply) => {
    const paramsResult = TokenIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid id' });
    }

    const bodyResult = UpdateTokenBodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        issues: bodyResult.error.issues,
      });
    }

    const token = await updateToken(pool, paramsResult.data.id, bodyResult.data);
    return reply.status(200).send(token);
  });
};
