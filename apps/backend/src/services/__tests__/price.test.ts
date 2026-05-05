// PriceService unit tests — US-007
// Strict TDD: test first, no real network.
// vi.stubGlobal('fetch') per test; __resetCacheForTests() in beforeEach.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type { PriceResult } from '../../types/portfolio.js';

// ─── Stub logger ──────────────────────────────────────────────────────────────

const warnMock = vi.fn();
const stubLog = { warn: warnMock } as unknown as FastifyBaseLogger;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeOkJson(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function makeErrorResponse(status: number): Response {
  return new Response('error', { status });
}

// Deferred import so the module-level cache is clean at test start
const { createPriceService } = await import('../price.js');

// ─────────────────────────────────────────────────────────────────────────────
// PriceService
// ─────────────────────────────────────────────────────────────────────────────

describe('PriceService', () => {
  let svc: ReturnType<typeof createPriceService>;

  beforeEach(() => {
    svc = createPriceService(stubLog);
    svc.__resetCacheForTests?.();
    warnMock.mockClear();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // ─── SC-PRICE-01: DefiLlama bulk happy path ───────────────────────────────

  it('SC-PRICE-01: bulk ON_CHAIN — 1 fetch para 2 tokens, retorna precios', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeOkJson({
        coins: {
          'ethereum:0xaaa': { price: 3000.00 },
          'bsc:0xbbb': { price: 500.00 },
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await svc.getOnChainPricesBulk([
      { network: 'ETH', address: '0xaaa' },
      { network: 'BSC', address: '0xbbb' },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callUrl = (fetchMock.mock.calls[0] as [string])[0];
    expect(callUrl).toContain('ethereum:0xaaa');
    expect(callUrl).toContain('bsc:0xbbb');

    const r1 = result.get('onchain:eth:0xaaa');
    const r2 = result.get('onchain:bsc:0xbbb');
    expect(r1).toMatchObject({ priceUsd: '3000' });
    expect(r2).toMatchObject({ priceUsd: '500' });
  });

  // ─── SC-PRICE-02: DefiLlama partial response ─────────────────────────────

  it('SC-PRICE-02: bulk partial — token no encontrado → priceUnavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        makeOkJson({ coins: { 'ethereum:0xaaa': { price: 3000 } } }),
      ),
    );

    const result = await svc.getOnChainPricesBulk([
      { network: 'ETH', address: '0xaaa' },
      { network: 'ETH', address: '0xccc' },
    ]);

    expect(result.get('onchain:eth:0xaaa')).toMatchObject({ priceUsd: '3000' });
    expect(result.get('onchain:eth:0xccc')).toMatchObject({ priceUnavailable: true });
  });

  // ─── SC-PRICE-03: DefiLlama 5xx ──────────────────────────────────────────

  it('SC-PRICE-03: DefiLlama 5xx → todos priceUnavailable + warn', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeErrorResponse(500)));

    const result = await svc.getOnChainPricesBulk([
      { network: 'ETH', address: '0xaaa' },
    ]);

    expect(result.get('onchain:eth:0xaaa')).toMatchObject({ priceUnavailable: true });
    expect(warnMock).toHaveBeenCalledOnce();
  });

  // ─── SC-PRICE-04: DefiLlama timeout ──────────────────────────────────────

  it('SC-PRICE-04: timeout AbortController → priceUnavailable + warn', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValueOnce(new DOMException('The operation was aborted.', 'AbortError')),
    );

    const result = await svc.getOnChainPricesBulk([
      { network: 'ETH', address: '0xaaa' },
    ]);

    expect(result.get('onchain:eth:0xaaa')).toMatchObject({ priceUnavailable: true });
    expect(warnMock).toHaveBeenCalledOnce();
  });

  // ─── SC-PRICE-05: Schema mismatch ────────────────────────────────────────

  it('SC-PRICE-05: DefiLlama schema mismatch → priceUnavailable + warn', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(makeOkJson({ unexpected: true })),
    );

    const result = await svc.getOnChainPricesBulk([
      { network: 'ETH', address: '0xaaa' },
    ]);

    expect(result.get('onchain:eth:0xaaa')).toMatchObject({ priceUnavailable: true });
    expect(warnMock).toHaveBeenCalledOnce();
  });

  // ─── SC-PRICE-06: Cache hit ───────────────────────────────────────────────

  it('SC-PRICE-06: cache hit dentro de TTL → solo 1 fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeOkJson({ coins: { 'ethereum:0xaaa': { price: 3000 } } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await svc.getOnChainPricesBulk([{ network: 'ETH', address: '0xaaa' }]);
    await svc.getOnChainPricesBulk([{ network: 'ETH', address: '0xaaa' }]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // ─── SC-PRICE-07: Cache expiry ────────────────────────────────────────────

  it('SC-PRICE-07: cache expirado → nueva request', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(
      makeOkJson({ coins: { 'ethereum:0xaaa': { price: 3000 } } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await svc.getOnChainPricesBulk([{ network: 'ETH', address: '0xaaa' }]);
    vi.advanceTimersByTime(61_000); // past 60s TTL
    await svc.getOnChainPricesBulk([{ network: 'ETH', address: '0xaaa' }]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // ─── SC-PRICE-08: Negative cache ─────────────────────────────────────────

  it('SC-PRICE-08: fallo cacheado — no re-fetch dentro de TTL', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network error'));
    vi.stubGlobal('fetch', fetchMock);

    await svc.getOnChainPricesBulk([{ network: 'ETH', address: '0xaaa' }]);
    const result = await svc.getOnChainPricesBulk([{ network: 'ETH', address: '0xaaa' }]);

    expect(fetchMock).toHaveBeenCalledTimes(1); // no second fetch
    expect(result.get('onchain:eth:0xaaa')).toMatchObject({ priceUnavailable: true });
  });

  // ─── SC-PRICE-09: Binance happy path ─────────────────────────────────────

  it('SC-PRICE-09: Binance ticker happy → priceUsd string', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        makeOkJson({ symbol: 'ETHUSDT', price: '3000.50' }),
      ),
    );

    const result: PriceResult = await svc.getCexPrice('ETH');

    expect(result).toMatchObject({ priceUsd: '3000.50' });
    const callUrl = ((vi.mocked(globalThis.fetch)).mock.calls[0] as [string])[0];
    expect(callUrl).toContain('ETHUSDT');
  });

  // ─── Binance 4xx ─────────────────────────────────────────────────────────

  it('Binance 4xx → priceUnavailable + warn', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeErrorResponse(400)));

    const result: PriceResult = await svc.getCexPrice('ETH');

    expect(result).toMatchObject({ priceUnavailable: true });
    expect(warnMock).toHaveBeenCalledOnce();
  });

  // ─── Binance schema mismatch ──────────────────────────────────────────────

  it('Binance schema mismatch → priceUnavailable + warn', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeOkJson({ nope: 1 })));

    const result: PriceResult = await svc.getCexPrice('ETH');

    expect(result).toMatchObject({ priceUnavailable: true });
    expect(warnMock).toHaveBeenCalledOnce();
  });

  // ─── SC-PRICE-10: Cache key normalization ────────────────────────────────

  it('SC-PRICE-10: cache key case-insensitive — segunda llamada con casing diferente → 1 fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeOkJson({ coins: { 'ethereum:0xaaa': { price: 3000 } } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await svc.getOnChainPricesBulk([{ network: 'ETH', address: '0xAAA' }]);
    const result = await svc.getOnChainPricesBulk([{ network: 'ETH', address: '0xaaa' }]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.get('onchain:eth:0xaaa')).toMatchObject({ priceUsd: '3000' });
  });

  // ─── CEX sin binance_symbol → sin fetch ──────────────────────────────────

  it('CEX getOnChainPrice single — happy path', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        makeOkJson({ coins: { 'ethereum:0xaaa': { price: 1.5 } } }),
      ),
    );

    const result: PriceResult = await svc.getOnChainPrice('ETH', '0xaaa');

    expect(result).toMatchObject({ priceUsd: '1.5' });
  });

  // ─── Cero requests para bulk vacío ───────────────────────────────────────

  it('getOnChainPricesBulk vacío → retorna Map vacío sin fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await svc.getOnChainPricesBulk([]);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
  });
});
