// binance-api-client.test.ts — US-008-B [engine]
// TDD tests for BinanceApiClient. No DB. No real HTTP calls.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createBinanceApiClient } from '../clients/binance-api.js';
import { ApiKeyMissingError, ExternalApiError, ValidationError } from '../../services/errors.js';
import type { FastifyBaseLogger } from 'fastify';

const mockLog = {
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn().mockReturnThis(),
  level: 'warn',
  silent: vi.fn(),
} as unknown as FastifyBaseLogger;

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── T04: assertConfigured ────────────────────────────────────────────────────

describe('BinanceApiClient', () => {
  describe('assertConfigured', () => {
    it('T04a — throws ApiKeyMissingError when apiKey is empty string', () => {
      const client = createBinanceApiClient({ apiKey: '', secretKey: 'secret', log: mockLog });
      expect(() => client.assertConfigured()).toThrow(ApiKeyMissingError);
    });

    it('T04b — throws ApiKeyMissingError when apiKey is whitespace only', () => {
      const client = createBinanceApiClient({ apiKey: '   ', secretKey: 'secret', log: mockLog });
      expect(() => client.assertConfigured()).toThrow(ApiKeyMissingError);
    });

    it('T04c — throws ApiKeyMissingError when secretKey is empty string', () => {
      const client = createBinanceApiClient({ apiKey: 'valid-key', secretKey: '', log: mockLog });
      expect(() => client.assertConfigured()).toThrow(ApiKeyMissingError);
    });

    it('T04d — does NOT throw when both keys are present', () => {
      const client = createBinanceApiClient({ apiKey: 'key', secretKey: 'secret', log: mockLog });
      expect(() => client.assertConfigured()).not.toThrow();
    });
  });

  // ─── T06: getMyTrades normalizes BinanceTrade response ───────────────────

  describe('getMyTrades', () => {
    it('T06 — normalizes BinanceTrade response correctly', async () => {
      const mockTrade = {
        symbol: 'ETHUSDT',
        id: 123456,
        orderId: 789,
        price: '3000.00',
        qty: '1.0',
        quoteQty: '3000.00',
        isBuyer: true,
        time: 1700000000000,
        commissionAsset: 'BNB',
        commission: '0.001',
      };

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [mockTrade],
      } as unknown as Response);

      const client = createBinanceApiClient({ apiKey: 'key', secretKey: 'secret', log: mockLog });
      const trades = await client.getMyTrades('ETHUSDT', 1699000000000, 1700000000000);

      expect(trades).toHaveLength(1);
      expect(trades[0]).toMatchObject({
        symbol: 'ETHUSDT',
        id: 123456,
        orderId: 789,
        price: '3000.00',
        qty: '1.0',
        quoteQty: '3000.00',
        isBuyer: true,          // must remain boolean
        time: 1700000000000,    // must remain number (unix ms)
        commissionAsset: 'BNB',
        commission: '0.001',
      });
      expect(typeof trades[0]!.isBuyer).toBe('boolean');
      expect(typeof trades[0]!.time).toBe('number');
    });

    it('T06b — commissionAsset and commission are null when absent', async () => {
      const mockTrade = {
        symbol: 'BTCUSDT',
        id: 99,
        orderId: 88,
        price: '50000',
        qty: '0.1',
        quoteQty: '5000',
        isBuyer: false,
        time: 1700000000000,
        // commissionAsset and commission intentionally omitted
      };

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [mockTrade],
      } as unknown as Response);

      const client = createBinanceApiClient({ apiKey: 'key', secretKey: 'secret', log: mockLog });
      const trades = await client.getMyTrades('BTCUSDT', 0, Date.now());

      expect(trades[0]!.commissionAsset).toBeNull();
      expect(trades[0]!.commission).toBeNull();
    });
  });

  // ─── T07: HMAC signature behavior ────────────────────────────────────────

  describe('HMAC signature', () => {
    it('T07 — signature is appended as last query param and secretKey never appears in URL', async () => {
      const SECRET = 'my-super-secret-key-that-must-not-leak';
      const API_KEY = 'my-api-key-value';

      let capturedUrl: string | null = null;
      let capturedHeaders: Record<string, string> | null = null;

      vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
        capturedUrl = url.toString();
        capturedHeaders = (init?.headers as Record<string, string>) ?? {};
        return {
          ok: true,
          status: 200,
          json: async () => [],
        } as unknown as Response;
      });

      const client = createBinanceApiClient({ apiKey: API_KEY, secretKey: SECRET, log: mockLog });
      await client.getMyTrades('ETHUSDT', 1000, 2000);

      expect(capturedUrl).not.toBeNull();
      const url = new URL(capturedUrl!);

      // signature must be present
      expect(url.searchParams.has('signature')).toBe(true);

      // signature must be LAST param (check raw query string)
      const rawQs = capturedUrl!.split('?')[1]!;
      const paramKeys = rawQs.split('&').map((p) => p.split('=')[0]);
      expect(paramKeys[paramKeys.length - 1]).toBe('signature');

      // secretKey must NOT appear in the URL string
      expect(capturedUrl).not.toContain(SECRET);

      // apiKey must be in X-MBX-APIKEY header, NOT in URL
      expect(capturedHeaders!['X-MBX-APIKEY']).toBe(API_KEY);
      expect(capturedUrl).not.toContain(API_KEY);

      // timestamp and recvWindow must be present
      expect(url.searchParams.has('timestamp')).toBe(true);
      expect(url.searchParams.get('recvWindow')).toBe('60000');
    });
  });

  // ─── T08: Binance error codes -2015/-2014 → ValidationError ─────────────

  describe('error mapping', () => {
    it('T08a — HTTP 401 with code -2015 → ValidationError BINANCE_INVALID_CREDENTIALS', async () => {
      const SECRET = 'do-not-leak-me';

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ code: -2015, msg: 'Invalid API-key, IP, or permissions for action.' }),
      } as unknown as Response);

      const client = createBinanceApiClient({ apiKey: 'key', secretKey: SECRET, log: mockLog });

      let caughtError: unknown = null;
      try {
        await client.getMyTrades('ETHUSDT', 0, 1);
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(ValidationError);
      const e = caughtError as ValidationError;
      expect(e.code).toBe('BINANCE_INVALID_CREDENTIALS');
      expect(e.statusCode).toBe(400);
      // secret must not leak into error message
      expect(e.message).not.toContain(SECRET);
    });

    it('T08b — HTTP 401 with code -2014 → ValidationError BINANCE_INVALID_CREDENTIALS', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ code: -2014, msg: 'API-key format invalid.' }),
      } as unknown as Response);

      const client = createBinanceApiClient({ apiKey: 'key', secretKey: 'secret', log: mockLog });
      await expect(client.getMyTrades('ETHUSDT', 0, 1)).rejects.toBeInstanceOf(ValidationError);
    });

    it('T08c — 2xx body with code -2015 → ValidationError BINANCE_INVALID_CREDENTIALS', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ code: -2015, msg: 'Invalid API-key.' }),
      } as unknown as Response);

      const client = createBinanceApiClient({ apiKey: 'key', secretKey: 'secret', log: mockLog });
      await expect(client.getMyTrades('ETHUSDT', 0, 1)).rejects.toBeInstanceOf(ValidationError);
    });

    // ─── T09: HTTP 429 → ExternalApiError 502 ──────────────────────────────

    it('T09a — HTTP 429 → ExternalApiError statusCode=502', async () => {
      const API_KEY = 'api-key-do-not-leak';
      const SECRET = 'secret-do-not-leak';

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({}),
      } as unknown as Response);

      const client = createBinanceApiClient({ apiKey: API_KEY, secretKey: SECRET, log: mockLog });

      let caughtError: unknown = null;
      try {
        await client.getMyTrades('ETHUSDT', 0, 1);
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(ExternalApiError);
      const e = caughtError as ExternalApiError;
      expect(e.statusCode).toBe(502);
      expect(e.code).toBe('EXTERNAL_API_ERROR');
      // keys must not leak
      expect(e.message).not.toContain(API_KEY);
      expect(e.message).not.toContain(SECRET);
    });

    it('T09b — generic HTTP 500 → ExternalApiError statusCode=502', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ code: -1000, msg: 'Internal error.' }),
      } as unknown as Response);

      const client = createBinanceApiClient({ apiKey: 'key', secretKey: 'secret', log: mockLog });
      await expect(client.getMyTrades('ETHUSDT', 0, 1)).rejects.toBeInstanceOf(ExternalApiError);
    });
  });
});
