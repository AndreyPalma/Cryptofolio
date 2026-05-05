// Portfolio routes — US-007

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import pg from 'pg';
import { getPortfolioSummary, getTokenDetail, getPositionHistory } from '../services/portfolio.js';
import { createPriceService } from '../services/price.js';
import { TokenNetworkSchema } from '../types/portfolio.js';

const { Pool } = pg;

const TokenParamsSchema = z.object({
  contractAddress: z.string().min(1),
  network: TokenNetworkSchema,
});

const TokenDetailQuerySchema = z.object({
  wallet_id: z.string().optional(),
});

export const portfolioRoutes: FastifyPluginAsync = async (fastify) => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const priceService = createPriceService(fastify.log);

  // GET /api/portfolio
  fastify.get('/', async (_req, reply) => {
    const summary = await getPortfolioSummary(pool, priceService);
    return reply.status(200).send(summary);
  });

  // GET /api/portfolio/token/:contractAddress/:network
  fastify.get('/token/:contractAddress/:network', async (req, reply) => {
    const params = TokenParamsSchema.parse(req.params);
    const query = TokenDetailQuerySchema.parse(req.query);
    const detail = await getTokenDetail(
      pool,
      priceService,
      params.contractAddress,
      params.network,
      query.wallet_id,
    );
    return reply.status(200).send(detail);
  });

  // GET /api/portfolio/token/:contractAddress/:network/history
  fastify.get('/token/:contractAddress/:network/history', async (req, reply) => {
    const params = TokenParamsSchema.parse(req.params);
    const query = TokenDetailQuerySchema.parse(req.query);
    const cycles = await getPositionHistory(
      pool,
      params.contractAddress,
      params.network,
      query.wallet_id,
    );
    return reply.status(200).send({ cycles });
  });
};
