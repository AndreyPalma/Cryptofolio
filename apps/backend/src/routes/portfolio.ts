// Portfolio routes — US-007, US-012

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPortfolioSummary, getTokenDetail, getPositionHistory } from '../services/portfolio.js';
import { createPriceService } from '../services/price.js';
import { TokenNetworkSchema } from '../types/portfolio.js';
import { BalanceValidatorService } from '../services/balance-validator.js';
import { createBinanceApiClient } from '../sync/clients/binance-api.js';
import { NotFoundError } from '../services/errors.js';
import { pool } from '../db/pool.js';

const TokenParamsSchema = z.object({
  contractAddress: z.string().min(1),
  network: TokenNetworkSchema,
});

const TokenDetailQuerySchema = z.object({
  wallet_id: z.string().optional(),
});

export const portfolioRoutes: FastifyPluginAsync = async (fastify) => {
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

  // GET /api/portfolio/validate-snapshot — US-012 A7
  fastify.get('/validate-snapshot', async (req, reply) => {
    // Check API keys configured
    const apiKey = process.env.BINANCE_API_KEY?.trim();
    const secretKey = process.env.BINANCE_SECRET_KEY?.trim();

    if (!apiKey || !secretKey) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'BINANCE_NOT_CONFIGURED',
        message: 'Binance API keys not configured',
      });
    }

    const userId: string = (req.user as { sub?: string } | undefined)?.sub ?? 'unknown';

    const silentLog = {
      warn: () => {},
      error: () => {},
      info: () => {},
      debug: () => {},
      trace: () => {},
      fatal: () => {},
      child: function () { return this; },
      level: 'silent',
      silent: () => {},
    } as unknown as import('fastify').FastifyBaseLogger;

    const binanceClient = createBinanceApiClient({ apiKey, secretKey, log: silentLog });
    const validatorService = new BalanceValidatorService(pool, binanceClient);

    try {
      const result = await validatorService.validate(userId);
      return reply.status(200).send(result);
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'NO_CEX_WALLET',
          message: 'No Binance wallet configured',
        });
      }
      // Binance API errors → 502
      return reply.status(502).send({
        statusCode: 502,
        error: 'BINANCE_UNAVAILABLE',
        message: err instanceof Error ? err.message : 'Binance unreachable',
      });
    }
  });
};
