// sync route — US-008-A / US-008-B
// Dispatches POST /api/sync/:walletId to OnChainSyncService (ON_CHAIN wallets)
// or BinanceSyncService (CEX wallets) based on wallet_type.

import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import pg from 'pg';
import { OnChainSyncService } from '../services/on-chain-sync.js';
import { BinanceSyncService } from '../services/binance-sync.js';
import { createPriceService } from '../services/price.js';
import { createEtherscanClient } from '../sync/clients/etherscan.js';
import { createBSCTraceClient } from '../sync/clients/bsctrace.js';
import { createBinanceApiClient } from '../sync/clients/binance-api.js';
import { SyncParamsSchema } from '../schemas/sync.js';
import { NotFoundError } from '../services/errors.js';

const { Pool } = pg;

export const syncRoutes: FastifyPluginAsync = async (fastify) => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const priceService = createPriceService(fastify.log);

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/:walletId',
    {
      schema: {
        params: SyncParamsSchema,
        response: { 200: z.unknown() },
      },
    },
    async (req, reply) => {
      const userId: string = (req.user as { sub?: string }).sub ?? '';

      // Load wallet to determine dispatch branch
      const walletRes = await pool.query<{ wallet_type: 'ON_CHAIN' | 'CEX' }>(
        'SELECT wallet_type FROM wallets WHERE id=$1 AND user_id=$2',
        [req.params.walletId, userId],
      );
      const wallet = walletRes.rows[0];
      if (!wallet) {
        throw new NotFoundError('Wallet not found', 'WALLET_NOT_FOUND');
      }

      if (wallet.wallet_type === 'ON_CHAIN') {
        // Clients created per-request so env var overrides in tests take effect.
        const etherscanClient = createEtherscanClient({
          apiKey: process.env.ETHERSCAN_API_KEY ?? '',
          log: fastify.log,
        });
        const bsctraceClient = createBSCTraceClient({
          apiKey: process.env.BSCTRACE_API_KEY ?? '',
          log: fastify.log,
        });
        const onChainService = new OnChainSyncService({
          pool, priceService, etherscanClient, bsctraceClient,
        });
        const result = await onChainService.sync(req.params.walletId, userId);
        return reply.send(result);
      }

      // wallet_type === 'CEX'
      const binanceService = new BinanceSyncService({
        pool,
        priceService,
        binanceClient: createBinanceApiClient({
          apiKey: process.env.BINANCE_API_KEY ?? '',
          secretKey: process.env.BINANCE_SECRET_KEY ?? '',
          log: fastify.log,
        }),
      });
      const result = await binanceService.sync(req.params.walletId, userId);
      return reply.send(result);
    },
  );
};
