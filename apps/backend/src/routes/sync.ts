import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import pg from 'pg';
import { OnChainSyncService } from '../services/on-chain-sync.js';
import { createPriceService } from '../services/price.js';
import { createEtherscanClient } from '../sync/clients/etherscan.js';
import { createBSCTraceClient } from '../sync/clients/bsctrace.js';
import { SyncParamsSchema, SyncResultSchema } from '../schemas/sync.js';

const { Pool } = pg;

export const syncRoutes: FastifyPluginAsync = async (fastify) => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const priceService = createPriceService(fastify.log);

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/:walletId',
    {
      schema: {
        params: SyncParamsSchema,
        response: { 200: SyncResultSchema },
      },
    },
    async (req) => {
      // Clients are created per-request so env var overrides in tests take effect.
      // In production env vars never change at runtime — no performance concern.
      const etherscanClient = createEtherscanClient({
        apiKey: process.env.ETHERSCAN_API_KEY ?? '',
        log: fastify.log,
      });
      const bsctraceClient = createBSCTraceClient({
        apiKey: process.env.BSCTRACE_API_KEY ?? '',
        log: fastify.log,
      });
      const service = new OnChainSyncService({
        pool, priceService, etherscanClient, bsctraceClient,
      });
      const userId: string = (req.user as { sub?: string }).sub ?? '';
      return service.sync(req.params.walletId, userId);
    },
  );
};
