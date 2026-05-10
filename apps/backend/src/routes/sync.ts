// sync route — US-008-A / US-008-B / US-015
// Dispatches POST /api/sync/:walletId to OnChainSyncService (ON_CHAIN wallets)
// or BinanceSyncService (CEX wallets) based on wallet_type.
// GET /api/sync/:walletId/stream — SSE stream for real-time sync progress (US-015).

import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ServerResponse } from 'node:http';
import { z } from 'zod';
import { OnChainSyncService } from '../services/on-chain-sync.js';
import { BinanceSyncService } from '../services/binance-sync.js';
import { createPriceService } from '../services/price.js';
import { createEtherscanClient } from '../sync/clients/etherscan.js';
import { createBSCTraceClient } from '../sync/clients/bsctrace.js';
import { createBinanceApiClient } from '../sync/clients/binance-api.js';
import { SyncParamsSchema } from '../schemas/sync.js';
import { NotFoundError } from '../services/errors.js';
import { pool } from '../db/pool.js';

function writeSse(raw: ServerResponse, data: Record<string, unknown>): void {
  if (!raw.destroyed) {
    raw.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}

export const syncRoutes: FastifyPluginAsync = async (fastify) => {
  const priceService = createPriceService(fastify.log);

  async function validateWalletOwnership(
    walletId: string,
    userId: string,
  ): Promise<{ wallet_type: 'ON_CHAIN' | 'CEX' }> {
    const res = await pool.query<{ wallet_type: 'ON_CHAIN' | 'CEX' }>(
      'SELECT wallet_type FROM wallets WHERE id=$1 AND user_id=$2',
      [walletId, userId],
    );
    const wallet = res.rows[0];
    if (!wallet) throw new NotFoundError('Wallet not found', 'WALLET_NOT_FOUND');
    return wallet;
  }

  function createBinanceService() {
    return new BinanceSyncService({
      pool,
      priceService,
      log: fastify.log,
      binanceClient: createBinanceApiClient({
        apiKey: process.env.BINANCE_API_KEY ?? '',
        secretKey: process.env.BINANCE_SECRET_KEY ?? '',
        log: fastify.log,
      }),
    });
  }

  function createOnChainService() {
    const etherscanClient = createEtherscanClient({
      apiKey: process.env.ETHERSCAN_API_KEY ?? '',
      log: fastify.log,
    });
    const bsctraceClient = createBSCTraceClient({
      apiKey: process.env.BSCTRACE_API_KEY ?? '',
      log: fastify.log,
    });
    return new OnChainSyncService({ pool, priceService, etherscanClient, bsctraceClient });
  }

  // ── SSE stream endpoint (US-015) ───────────────────────────────────────────
  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/:walletId/stream',
    { schema: { params: SyncParamsSchema } },
    async (req, reply) => {
      const userId: string = (req.user as { sub?: string }).sub ?? '';
      const { walletId } = req.params;
      const wallet = await validateWalletOwnership(walletId, userId);

      const orchestrator = req.server.syncOrchestrator;
      const ac = orchestrator.tryAcquireLock(walletId);
      if (!ac) {
        return reply.status(409).send({ error: 'SYNC_IN_PROGRESS', walletId });
      }

      // Take over the raw socket — Fastify will NOT call reply.send()
      reply.hijack();
      const raw = reply.raw;

      raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      // Heartbeat / retry hint for the client
      raw.write('retry: 5000\n\n');

      let clientDisconnected = false;
      req.raw.on('close', () => {
        clientDisconnected = true;
        ac.abort();
        orchestrator.releaseLock(walletId);
      });

      const emit = (event: Record<string, unknown>) => {
        if (!clientDisconnected) writeSse(raw, event);
      };

      try {
        if (wallet.wallet_type === 'CEX') {
          const binanceService = createBinanceService();
          const result = await binanceService.sync(walletId, userId, { emit, signal: ac.signal });
          emit({ step: 'complete', status: 'done', summary: result });
        } else {
          const onChainService = createOnChainService();
          const result = await onChainService.sync(walletId, userId, { emit, signal: ac.signal });
          emit({ step: 'complete', status: 'done', summary: result });
        }
      } catch (err) {
        if (!clientDisconnected) {
          const message = err instanceof Error ? err.message : String(err);
          if (message !== 'ABORTED') {
            emit({ step: 'error', failedStep: 'unknown', code: 'SYNC_ERROR', message });
          }
        }
      } finally {
        orchestrator.releaseLock(walletId);
        if (!raw.destroyed) raw.end();
      }
    },
  );

  // ── POST sync (legacy + lock-aware) ────────────────────────────────────────
  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/:walletId',
    {
      schema: {
        params: SyncParamsSchema,
        response: { 200: z.unknown(), 409: z.object({ error: z.string(), walletId: z.string() }) },
      },
    },
    async (req, reply) => {
      const userId: string = (req.user as { sub?: string }).sub ?? '';
      const { walletId } = req.params;
      const wallet = await validateWalletOwnership(walletId, userId);

      const orchestrator = req.server.syncOrchestrator;
      const ac = orchestrator.tryAcquireLock(walletId);
      if (!ac) {
        return reply.status(409).send({ error: 'SYNC_IN_PROGRESS', walletId });
      }

      try {
        if (wallet.wallet_type === 'ON_CHAIN') {
          const onChainService = createOnChainService();
          const result = await onChainService.sync(walletId, userId, { signal: ac.signal });
          return reply.send(result);
        }

        const binanceService = createBinanceService();
        const result = await binanceService.sync(walletId, userId, { signal: ac.signal });
        return reply.send(result);
      } finally {
        orchestrator.releaseLock(walletId);
      }
    },
  );
};
