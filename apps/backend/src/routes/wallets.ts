// Route plugin — /api/wallets — US-005
// authPlugin already adds onRequest hook for all /api/* routes.
// No preHandler per route needed here.

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import pg from 'pg';
import { createWallet, findAll, findById, updateWallet, deleteWallet } from '../services/wallet.js';

const { Pool } = pg;

const CreateWalletBodySchema = z.object({
  wallet_type: z.enum(['ON_CHAIN', 'CEX']),
  label: z.string().optional(),
  address: z.string().optional(),
  network: z.string().min(1),
});

const UpdateWalletBodySchema = z.object({
  label: z.string().nullable().optional(),
});

const WalletIdParamsSchema = z.object({
  id: z.string().min(1),
});

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async signature; no top-level await needed here
export const walletRoutes: FastifyPluginAsync = async (fastify) => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // POST / — create wallet
  fastify.post('/', async (request, reply) => {
    const parseResult = CreateWalletBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        issues: parseResult.error.issues,
      });
    }

    const { wallet_type, label, address, network } = parseResult.data;
    // userId from JWT — request.user is set by @fastify/jwt
    const userId: string = (request.user as { sub?: string }).sub ?? 'unknown';

    const wallet = await createWallet(pool, userId, { wallet_type, label, address, network });
    return reply.status(201).send(wallet);
  });

  // GET / — list all wallets
  fastify.get('/', async (_request, reply) => {
    const wallets = await findAll(pool);
    return reply.status(200).send(wallets);
  });

  // GET /:id — find wallet by id
  fastify.get('/:id', async (request, reply) => {
    const parseResult = WalletIdParamsSchema.safeParse(request.params);
    if (!parseResult.success) {
      return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid id' });
    }

    const wallet = await findById(pool, parseResult.data.id);
    if (!wallet) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Wallet not found' });
    }
    return reply.status(200).send(wallet);
  });

  // PUT /:id — update wallet
  fastify.put('/:id', async (request, reply) => {
    const paramsResult = WalletIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid id' });
    }

    const bodyResult = UpdateWalletBodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        issues: bodyResult.error.issues,
      });
    }

    const wallet = await updateWallet(pool, paramsResult.data.id, bodyResult.data);
    return reply.status(200).send(wallet);
  });

  // DELETE /:id — delete wallet
  fastify.delete('/:id', async (request, reply) => {
    const parseResult = WalletIdParamsSchema.safeParse(request.params);
    if (!parseResult.success) {
      return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid id' });
    }

    await deleteWallet(pool, parseResult.data.id);
    return reply.status(204).send();
  });
};
