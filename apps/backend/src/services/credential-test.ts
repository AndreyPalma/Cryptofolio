// credential-test.ts — US-012 A3, A4, A5
// CredentialTestService: verifica conectividad real con cada servicio externo.
// SECURITY: NUNCA loguear ni retornar valores de API keys ni secrets.

import { createBinanceApiClient } from '../sync/clients/binance-api.js';
import { ValidationError, ExternalApiError, ApiKeyMissingError } from './errors.js';
import type { CredentialTestResult } from '../schemas/credentials.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse an Etherscan/BSCScan-style API response body and map to CredentialTestResult. */
function parseEtherscanLikeBody(
  body: unknown,
  httpStatus: number,
  serviceName: 'Etherscan' | 'BSCScan',
): CredentialTestResult {
  if (httpStatus === 401 || httpStatus === 403) {
    return { status: 'failed', reason: 'Invalid API key' };
  }
  if (httpStatus >= 500) {
    return { status: 'failed', reason: `${serviceName} unreachable` };
  }

  const data = body as { status?: string; message?: string; result?: unknown };

  if (data.status === '1') {
    return { status: 'connected' };
  }

  if (data.status === '0') {
    const result = typeof data.result === 'string' ? data.result.toLowerCase() : '';
    const msg = typeof data.message === 'string' ? data.message.toLowerCase() : '';
    const combined = `${result} ${msg}`;
    if (combined.includes('invalid') || combined.includes('api key')) {
      return { status: 'failed', reason: 'Invalid API key' };
    }
    if (combined.includes('rate limit') || combined.includes('max rate')) {
      return { status: 'failed', reason: 'Rate limit exceeded' };
    }
    const reason = typeof data.result === 'string' ? data.result : typeof data.message === 'string' ? data.message : 'Unknown error';
    return { status: 'failed', reason };
  }

  return { status: 'failed', reason: `${serviceName} unreachable` };
}

// ─── CredentialTestService ────────────────────────────────────────────────────

export class CredentialTestService {
  private static readonly TIMEOUT_MS = 8_000;

  /** Test Etherscan API key connectivity. */
  async testEtherscan(): Promise<CredentialTestResult> {
    const apiKey = process.env.ETHERSCAN_API_KEY?.trim();
    if (!apiKey) {
      return { status: 'failed', reason: 'API key not configured' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, CredentialTestService.TIMEOUT_MS);

    const url = `https://api.etherscan.io/v2/api?chainid=1&module=stats&action=ethsupply&apikey=${apiKey}`;
    const start = Date.now();

    try {
      const res = await fetch(url, { signal: controller.signal });
      const latencyMs = Math.round(Date.now() - start);

      let body: unknown = {};
      try {
        body = await res.json();
      } catch {
        // ignore parse error
      }

      const result = parseEtherscanLikeBody(body, res.status, 'Etherscan');

      // Attach latencyMs if connected
      if (result.status === 'connected') {
        return { status: 'connected', meta: { latencyMs } };
      }
      return result;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { status: 'failed', reason: 'Connection timed out' };
      }
      return { status: 'failed', reason: 'Etherscan unreachable' };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Test BSCScan API key connectivity. */
  async testBsctrace(): Promise<CredentialTestResult> {
    const apiKey = process.env.BSCTRACE_API_KEY?.trim();
    if (!apiKey) {
      return { status: 'failed', reason: 'API key not configured' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, CredentialTestService.TIMEOUT_MS);

    const url = `https://api.bscscan.com/api?module=stats&action=bnbsupply&apikey=${apiKey}`;
    const start = Date.now();

    try {
      const res = await fetch(url, { signal: controller.signal });
      const latencyMs = Math.round(Date.now() - start);

      let body: unknown = {};
      try {
        body = await res.json();
      } catch {
        // ignore parse error
      }

      const result = parseEtherscanLikeBody(body, res.status, 'BSCScan');

      if (result.status === 'connected') {
        return { status: 'connected', meta: { latencyMs } };
      }
      return result;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { status: 'failed', reason: 'Connection timed out' };
      }
      return { status: 'failed', reason: 'BSCScan unreachable' };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Test Binance API key connectivity using the existing BinanceApiClient. */
  async testBinance(): Promise<CredentialTestResult> {
    const apiKey = process.env.BINANCE_API_KEY?.trim();
    const secretKey = process.env.BINANCE_SECRET_KEY?.trim();

    if (!apiKey || !secretKey) {
      return { status: 'failed', reason: 'API key not configured' };
    }

    // We need a minimal logger for BinanceApiClient — never log key values
    const silentLog = {
      warn: () => { /* noop */ },
      error: () => { /* noop */ },
      info: () => { /* noop */ },
      debug: () => { /* noop */ },
      trace: () => { /* noop */ },
      fatal: () => { /* noop */ },
      child: function () { return this; },
      level: 'silent',
      silent: () => { /* noop */ },
    } as unknown as import('fastify').FastifyBaseLogger;

    const client = createBinanceApiClient({ apiKey, secretKey, log: silentLog });

    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, CredentialTestService.TIMEOUT_MS);

    try {
      // getAccountAssets calls GET /api/v3/account — validates both key and signature
      const assets = await client.getAccountAssets();
      return { status: 'connected', meta: { assetCount: assets.length } };
    } catch (err) {
      if (err instanceof ValidationError && err.code === 'BINANCE_INVALID_CREDENTIALS') {
        // -2014 or -2015 — bad key format or invalid signature
        return { status: 'failed', reason: 'Invalid API key' };
      }
      if (err instanceof ApiKeyMissingError) {
        return { status: 'failed', reason: 'API key not configured' };
      }
      if (err instanceof ExternalApiError) {
        const cause = err.upstreamCause as { status?: number; binanceCode?: number } | null;
        if (cause?.status === 429) {
          return { status: 'failed', reason: 'Binance rate limit exceeded' };
        }
        if (cause?.status === 403) {
          return { status: 'failed', reason: 'API key requires read permissions' };
        }
        if (cause?.binanceCode) {
          return { status: 'failed', reason: `Binance error code ${String(cause.binanceCode)}` };
        }
        if (cause?.status) {
          return { status: 'failed', reason: `Binance HTTP ${String(cause.status)}` };
        }
        return { status: 'failed', reason: 'Binance unreachable' };
      }
      if (err instanceof Error && err.name === 'AbortError') {
        return { status: 'failed', reason: 'Connection timed out' };
      }
      return { status: 'failed', reason: 'Binance unreachable' };
    } finally {
      clearTimeout(timer);
    }
  }
}
