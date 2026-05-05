// PriceService — US-007
// Singleton de proceso: cache vive a nivel módulo (Map no instanciado por request).
// createPriceService(log) captura el logger; el cache es compartido entre llamadas.

import { z } from 'zod';
import type { FastifyBaseLogger } from 'fastify';
import type { PriceResult } from '../types/portfolio.js';

// ─── Cache primitives ─────────────────────────────────────────────────────────

type CacheEntry = {
  readonly priceUsd: string | null; // null = fallo cacheado (negative cache)
  readonly expiresAt: number;
};

const TTL_DEFILLAMA_MS = 60_000;
const TTL_BINANCE_MS = 10_000;
const FETCH_TIMEOUT_MS = 5_000;

const cache = new Map<string, CacheEntry>();

// ─── Cache key helpers ────────────────────────────────────────────────────────

function onChainKey(network: 'ETH' | 'BSC', address: string): string {
  return `onchain:${network.toLowerCase()}:${address.toLowerCase()}`;
}

function cexKey(binanceSymbol: string): string {
  return `cex:${binanceSymbol.toUpperCase()}`;
}

function defiLlamaChain(network: 'ETH' | 'BSC'): 'ethereum' | 'bsc' {
  return network === 'ETH' ? 'ethereum' : 'bsc';
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

function readCache(key: string): PriceResult | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.priceUsd === null
    ? { priceUnavailable: true }
    : { priceUsd: entry.priceUsd };
}

function markUnavailable(key: string, ttl: number): void {
  cache.set(key, { priceUsd: null, expiresAt: Date.now() + ttl });
}

function markAvailable(key: string, priceUsd: string, ttl: number): void {
  cache.set(key, { priceUsd, expiresAt: Date.now() + ttl });
}

// ─── Zod schemas for external APIs ───────────────────────────────────────────

const DefiLlamaCoinSchema = z.object({
  price: z.number(),
  symbol: z.string().optional(),
  decimals: z.number().optional(),
  timestamp: z.number().optional(),
  confidence: z.number().optional(),
});

const DefiLlamaResponseSchema = z.object({
  coins: z.record(z.string(), DefiLlamaCoinSchema),
});

const BinanceTickerSchema = z.object({
  symbol: z.string(),
  price: z.string(),
});

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchDefiLlamaBulk(
  requests: ReadonlyArray<{ network: 'ETH' | 'BSC'; address: string }>,
  log: FastifyBaseLogger,
): Promise<Map<string, PriceResult>> {
  const result = new Map<string, PriceResult>();
  if (requests.length === 0) return result;

  const coinsParam = requests
    .map((r) => `${defiLlamaChain(r.network)}:${r.address.toLowerCase()}`)
    .join(',');

  const url = `https://coins.llama.fi/prices/current/${coinsParam}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      log.warn({ url, status: res.status, source: 'DEFILLAMA' }, 'price fetch non-200');
      for (const r of requests) {
        const key = onChainKey(r.network, r.address);
        markUnavailable(key, TTL_DEFILLAMA_MS);
        result.set(key, { priceUnavailable: true });
      }
      return result;
    }

    const json: unknown = await res.json();
    const parsed = DefiLlamaResponseSchema.safeParse(json);
    if (!parsed.success) {
      log.warn({ url, source: 'DEFILLAMA', issues: parsed.error.issues }, 'price schema mismatch');
      for (const r of requests) {
        const key = onChainKey(r.network, r.address);
        markUnavailable(key, TTL_DEFILLAMA_MS);
        result.set(key, { priceUnavailable: true });
      }
      return result;
    }

    for (const r of requests) {
      const apiKey = `${defiLlamaChain(r.network)}:${r.address.toLowerCase()}`;
      const coin = parsed.data.coins[apiKey];
      const key = onChainKey(r.network, r.address);
      if (!coin) {
        markUnavailable(key, TTL_DEFILLAMA_MS);
        result.set(key, { priceUnavailable: true });
      } else {
        const priceStr = String(coin.price);
        markAvailable(key, priceStr, TTL_DEFILLAMA_MS);
        result.set(key, { priceUsd: priceStr });
      }
    }
    return result;
  } catch (err) {
    log.warn({ url, source: 'DEFILLAMA', err: String(err) }, 'price fetch threw');
    for (const r of requests) {
      const key = onChainKey(r.network, r.address);
      markUnavailable(key, TTL_DEFILLAMA_MS);
      result.set(key, { priceUnavailable: true });
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBinanceTicker(
  binanceSymbol: string,
  log: FastifyBaseLogger,
): Promise<PriceResult> {
  const key = cexKey(binanceSymbol);
  const url = `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(binanceSymbol.toUpperCase())}USDT`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      log.warn({ url, status: res.status, source: 'BINANCE' }, 'price fetch non-200');
      markUnavailable(key, TTL_BINANCE_MS);
      return { priceUnavailable: true };
    }
    const json: unknown = await res.json();
    const parsed = BinanceTickerSchema.safeParse(json);
    if (!parsed.success) {
      log.warn({ url, source: 'BINANCE', issues: parsed.error.issues }, 'price schema mismatch');
      markUnavailable(key, TTL_BINANCE_MS);
      return { priceUnavailable: true };
    }
    markAvailable(key, parsed.data.price, TTL_BINANCE_MS);
    return { priceUsd: parsed.data.price };
  } catch (err) {
    log.warn({ url, source: 'BINANCE', err: String(err) }, 'price fetch threw');
    markUnavailable(key, TTL_BINANCE_MS);
    return { priceUnavailable: true };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface PriceService {
  getOnChainPrice(network: 'ETH' | 'BSC', address: string): Promise<PriceResult>;
  getCexPrice(binanceSymbol: string): Promise<PriceResult>;
  getOnChainPricesBulk(
    requests: ReadonlyArray<{ network: 'ETH' | 'BSC'; address: string }>,
  ): Promise<Map<string, PriceResult>>;
  __resetCacheForTests?(): void;
}

export function createPriceService(log: FastifyBaseLogger): PriceService {
  return {
    async getOnChainPrice(network, address) {
      const key = onChainKey(network, address);
      const cached = readCache(key);
      if (cached) return cached;
      const resultMap = await fetchDefiLlamaBulk([{ network, address }], log);
      return resultMap.get(key) ?? { priceUnavailable: true };
    },

    async getCexPrice(binanceSymbol) {
      const key = cexKey(binanceSymbol);
      const cached = readCache(key);
      if (cached) return cached;
      return fetchBinanceTicker(binanceSymbol, log);
    },

    async getOnChainPricesBulk(requests) {
      const result = new Map<string, PriceResult>();
      if (requests.length === 0) return result;

      const uncached: Array<{ network: 'ETH' | 'BSC'; address: string }> = [];

      for (const r of requests) {
        const key = onChainKey(r.network, r.address);
        const cached = readCache(key);
        if (cached) {
          result.set(key, cached);
        } else {
          uncached.push(r);
        }
      }

      if (uncached.length > 0) {
        const fetched = await fetchDefiLlamaBulk(uncached, log);
        for (const [k, v] of fetched) {
          result.set(k, v);
        }
      }

      return result;
    },

    __resetCacheForTests() {
      cache.clear();
    },
  };
}
