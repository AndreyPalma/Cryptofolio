import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import {
  createBinanceApiClient,
  FiatPermissionDeniedError,
} from '../src/sync/clients/binance-api.js';
import { ExternalApiError } from '../src/services/errors.js';
import { getQuoteAsset, isStablePair } from '../src/services/binance-sync.js';

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

function makeJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createFutureClient(): ReturnType<typeof createBinanceApiClient> {
  return createBinanceApiClient({
    apiKey: 'test-key',
    secretKey: 'test-secret',
    log: mockLog,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('BinanceApiClient fiat methods', () => {
  it('getFiatOrders returns array with correct shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeJsonResponse(200, {
        data: [
          {
            orderNo: 'fiat-order-1',
            type: 0,
            fiatCurrency: 'USD',
            sourceAmount: '100.00',
            obtainAmount: '100.00',
            totalFee: '0.00',
            price: '1.00',
            status: 'Completed',
            createTime: 1_710_000_000_000,
            cryptoCurrency: 'USDT',
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createFutureClient();
    const beginTime = 1_700_000_000_000;
    const endTime = 1_700_000_100_000;
    const orders = await client.getFiatOrders({ beginTime, endTime, transactionType: 0 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toContain('/sapi/v1/fiat/orders');
    expect(url).toContain(`beginTime=${beginTime}`);
    expect(url).toContain(`endTime=${endTime}`);
    expect(url).toContain('transactionType=0');
    expect(init).toEqual(expect.objectContaining({
      headers: expect.objectContaining({ 'X-MBX-APIKEY': 'test-key' }),
    }));
    expect(orders).toEqual([
      {
        orderNo: 'fiat-order-1',
        type: 0,
        fiatCurrency: 'USD',
        sourceAmount: '100.00',
        obtainAmount: '100.00',
        totalFee: '0.00',
        price: '1.00',
        status: 'Completed',
        createTime: 1_710_000_000_000,
        cryptoCurrency: 'USDT',
      },
    ]);
  });

  it('getFiatPayments returns array with correct shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeJsonResponse(200, {
        data: [
          {
            orderNo: 'fiat-payment-1',
            fiatCurrency: 'USD',
            sourceAmount: '25.00',
            obtainAmount: '1.00',
            totalFee: '0.00',
            price: '25.00',
            status: 'Completed',
            createTime: 1_710_000_100_000,
            cryptoCurrency: 'SOL',
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createFutureClient();
    const beginTime = 1_700_000_000_000;
    const endTime = 1_700_000_100_000;
    const payments = await client.getFiatPayments({ beginTime, endTime, transactionType: 0 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toContain('/sapi/v1/fiat/payments');
    expect(url).toContain(`beginTime=${beginTime}`);
    expect(url).toContain(`endTime=${endTime}`);
    expect(url).toContain('transactionType=0');
    expect(init).toEqual(expect.objectContaining({
      headers: expect.objectContaining({ 'X-MBX-APIKEY': 'test-key' }),
    }));
    expect(payments).toEqual([
      {
        orderNo: 'fiat-payment-1',
        fiatCurrency: 'USD',
        sourceAmount: '25.00',
        obtainAmount: '1.00',
        totalFee: '0.00',
        price: '25.00',
        status: 'Completed',
        createTime: 1_710_000_100_000,
        cryptoCurrency: 'SOL',
      },
    ]);
  });

  it('401 or 403 on fiat throws FiatPermissionDeniedError', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeJsonResponse(403, { code: -2008, msg: 'Permission denied' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createFutureClient();

    await expect(
      client.getFiatOrders({ beginTime: 1, endTime: 2, transactionType: 0 }),
    ).rejects.toBeInstanceOf(FiatPermissionDeniedError);
  });

  it('500 on fiat throws ExternalApiError and not FiatPermissionDeniedError', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => (
      makeJsonResponse(500, { code: -1000, msg: 'Server error' })
    ));
    vi.stubGlobal('fetch', fetchMock);

    const client = createFutureClient();

    try {
      await client.getFiatPayments({ beginTime: 1, endTime: 2, transactionType: 0 });
      throw new Error('Expected getFiatPayments to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ExternalApiError);
      expect(error).not.toBeInstanceOf(FiatPermissionDeniedError);
    }
  });

  it('propagates signal to fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeJsonResponse(200, { data: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createFutureClient();
    const controller = new AbortController();

    await client.getFiatOrders({ beginTime: 1, endTime: 2, transactionType: 0, signal: controller.signal });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});

describe('getQuoteAsset', () => {
  it('ETHUSDC -> USDC', () => {
    expect(getQuoteAsset('ETHUSDC')).toBe('USDC');
  });

  it('BTCFDUSD -> FDUSD', () => {
    expect(getQuoteAsset('BTCFDUSD')).toBe('FDUSD');
  });

  it('ETHUSDT -> USDT regression', () => {
    expect(getQuoteAsset('ETHUSDT')).toBe('USDT');
  });

  it('ETHBNB -> BNB regression', () => {
    expect(getQuoteAsset('ETHBNB')).toBe('BNB');
  });
});

describe('self-pair filter', () => {
  it('USDTUSDC filtered', () => {
    expect(isStablePair('USDT', 'USDC')).toBe(true);
  });

  it('USDCFDUSD filtered', () => {
    expect(isStablePair('USDC', 'FDUSD')).toBe(true);
  });

  it('ETHUSDT NOT filtered', () => {
    expect(isStablePair('ETH', 'USDT')).toBe(false);
  });
});
