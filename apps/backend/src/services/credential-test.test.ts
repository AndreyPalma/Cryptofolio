// credential-test.test.ts — US-012 A3/A4/A5
// Unit tests for CredentialTestService.
// All network calls are mocked — no real HTTP.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { ValidationError, ExternalApiError, ApiKeyMissingError } from './errors.js';
import { CredentialTestService } from './credential-test.js';

// ─── Mock createBinanceApiClient ──────────────────────────────────────────────

vi.mock('../sync/clients/binance-api.js', () => ({
  createBinanceApiClient: vi.fn(),
}));

import { createBinanceApiClient } from '../sync/clients/binance-api.js';
const mockCreateBinanceApiClient = vi.mocked(createBinanceApiClient);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockFetch(response: Partial<Response> & { jsonData?: unknown }): void {
  const { jsonData, ...rest } = response;
  globalThis.fetch = vi.fn().mockResolvedValue({
    status: 200,
    ok: true,
    json: vi.fn().mockResolvedValue(jsonData ?? {}),
    ...rest,
  } as unknown as Response);
}

function mockFetchError(err: Error): void {
  globalThis.fetch = vi.fn().mockRejectedValue(err);
}

function setEnv(vars: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
}

// ─── testEtherscan ────────────────────────────────────────────────────────────

describe('CredentialTestService.testEtherscan()', () => {
  const svc = new CredentialTestService();

  beforeEach(() => {
    setEnv({ ETHERSCAN_API_KEY: 'test-key-eth' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setEnv({ ETHERSCAN_API_KEY: undefined });
  });

  it('returns connected on status:"1" response', async () => {
    mockFetch({ status: 200, ok: true, jsonData: { status: '1', result: '12345' } });

    const result = await svc.testEtherscan();

    expect(result.status).toBe('connected');
    if (result.status === 'connected') {
      expect(result.meta?.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns failed with reason on status:"0" invalid key', async () => {
    mockFetch({
      status: 200,
      ok: true,
      jsonData: { status: '0', message: 'Invalid API Key', result: 'Invalid API Key' },
    });

    const result = await svc.testEtherscan();

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toContain('Invalid API key');
    }
  });

  it('returns failed when ETHERSCAN_API_KEY is not configured', async () => {
    setEnv({ ETHERSCAN_API_KEY: undefined });

    const result = await svc.testEtherscan();

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('API key not configured');
    }
  });

  it('returns failed on AbortError (timeout)', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    mockFetchError(abortErr);

    const result = await svc.testEtherscan();

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toContain('timed out');
    }
  });

  it('returns failed on HTTP 401', async () => {
    mockFetch({ status: 401, ok: false, jsonData: {} });

    const result = await svc.testEtherscan();

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('Invalid API key');
    }
  });

  it('returns failed on HTTP 500', async () => {
    mockFetch({ status: 500, ok: false, jsonData: {} });

    const result = await svc.testEtherscan();

    expect(result.status).toBe('failed');
  });
});

// ─── testBsctrace ─────────────────────────────────────────────────────────────

describe('CredentialTestService.testBsctrace()', () => {
  const svc = new CredentialTestService();

  beforeEach(() => {
    setEnv({ BSCTRACE_API_KEY: 'test-key-bsc' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setEnv({ BSCTRACE_API_KEY: undefined });
  });

  it('returns connected on status:"1" response', async () => {
    mockFetch({ status: 200, ok: true, jsonData: { status: '1', result: '999' } });

    const result = await svc.testBsctrace();

    expect(result.status).toBe('connected');
    if (result.status === 'connected') {
      expect(result.meta?.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns failed with reason on invalid key', async () => {
    mockFetch({
      status: 200,
      ok: true,
      jsonData: { status: '0', message: 'Invalid API Key', result: 'Invalid API Key' },
    });

    const result = await svc.testBsctrace();

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toContain('Invalid API key');
    }
  });

  it('returns failed when BSCTRACE_API_KEY is not configured', async () => {
    setEnv({ BSCTRACE_API_KEY: undefined });

    const result = await svc.testBsctrace();

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('API key not configured');
    }
  });

  it('returns failed on AbortError (timeout)', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    mockFetchError(abortErr);

    const result = await svc.testBsctrace();

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toContain('timed out');
    }
  });
});

// ─── testBinance ──────────────────────────────────────────────────────────────

describe('CredentialTestService.testBinance()', () => {
  const svc = new CredentialTestService();

  beforeEach(() => {
    setEnv({ BINANCE_API_KEY: 'test-api-key', BINANCE_SECRET_KEY: 'test-secret-key' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setEnv({ BINANCE_API_KEY: undefined, BINANCE_SECRET_KEY: undefined });
    mockCreateBinanceApiClient.mockReset();
  });

  it('returns connected with assetCount on happy path', async () => {
    const mockAssets = [
      { asset: 'BTC', free: '0.5', locked: '0' },
      { asset: 'ETH', free: '2.0', locked: '0' },
      { asset: 'USDT', free: '100', locked: '0' },
    ];
    mockCreateBinanceApiClient.mockReturnValue({
      assertConfigured: vi.fn(),
      getAccountAssets: vi.fn().mockResolvedValue(mockAssets),
      getMyTrades: vi.fn(),
      getConvertHistory: vi.fn(),
      getWithdrawHistory: vi.fn(),
      getDepositHistory: vi.fn(),
    } as unknown as ReturnType<typeof createBinanceApiClient>);

    const result = await svc.testBinance();

    expect(result.status).toBe('connected');
    if (result.status === 'connected') {
      expect(result.meta?.assetCount).toBe(3);
    }
  });

  it('returns failed with "Invalid API key" on ValidationError -2014/-2015', async () => {
    const credError = new ValidationError(
      'Invalid Binance API credentials or insufficient permissions',
      'BINANCE_INVALID_CREDENTIALS',
    );
    mockCreateBinanceApiClient.mockReturnValue({
      assertConfigured: vi.fn(),
      getAccountAssets: vi.fn().mockRejectedValue(credError),
      getMyTrades: vi.fn(),
      getConvertHistory: vi.fn(),
      getWithdrawHistory: vi.fn(),
      getDepositHistory: vi.fn(),
    } as unknown as ReturnType<typeof createBinanceApiClient>);

    const result = await svc.testBinance();

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('Invalid API key');
    }
  });

  it('returns failed with "API key requires read permissions" on 403', async () => {
    const apiErr = new ExternalApiError('binance', { status: 403 });
    mockCreateBinanceApiClient.mockReturnValue({
      assertConfigured: vi.fn(),
      getAccountAssets: vi.fn().mockRejectedValue(apiErr),
      getMyTrades: vi.fn(),
      getConvertHistory: vi.fn(),
      getWithdrawHistory: vi.fn(),
      getDepositHistory: vi.fn(),
    } as unknown as ReturnType<typeof createBinanceApiClient>);

    const result = await svc.testBinance();

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('API key requires read permissions');
    }
  });

  it('returns failed when BINANCE_API_KEY is not configured', async () => {
    setEnv({ BINANCE_API_KEY: undefined });

    const result = await svc.testBinance();

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('API key not configured');
    }
  });

  it('returns failed when BINANCE_SECRET_KEY is not configured', async () => {
    setEnv({ BINANCE_SECRET_KEY: undefined });

    const result = await svc.testBinance();

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('API key not configured');
    }
  });

  it('returns failed on AbortError (timeout)', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    mockCreateBinanceApiClient.mockReturnValue({
      assertConfigured: vi.fn(),
      getAccountAssets: vi.fn().mockRejectedValue(abortErr),
      getMyTrades: vi.fn(),
      getConvertHistory: vi.fn(),
      getWithdrawHistory: vi.fn(),
      getDepositHistory: vi.fn(),
    } as unknown as ReturnType<typeof createBinanceApiClient>);

    const result = await svc.testBinance();

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toContain('timed out');
    }
  });

  it('returns failed with rate limit reason on 429', async () => {
    const apiErr = new ExternalApiError('binance', { status: 429 });
    mockCreateBinanceApiClient.mockReturnValue({
      assertConfigured: vi.fn(),
      getAccountAssets: vi.fn().mockRejectedValue(apiErr),
      getMyTrades: vi.fn(),
      getConvertHistory: vi.fn(),
      getWithdrawHistory: vi.fn(),
      getDepositHistory: vi.fn(),
    } as unknown as ReturnType<typeof createBinanceApiClient>);

    const result = await svc.testBinance();

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toContain('rate limit');
    }
  });

  it('returns failed with ApiKeyMissingError', async () => {
    const missingErr = new ApiKeyMissingError('BINANCE_API_KEY');
    mockCreateBinanceApiClient.mockReturnValue({
      assertConfigured: vi.fn(),
      getAccountAssets: vi.fn().mockRejectedValue(missingErr),
      getMyTrades: vi.fn(),
      getConvertHistory: vi.fn(),
      getWithdrawHistory: vi.fn(),
      getDepositHistory: vi.fn(),
    } as unknown as ReturnType<typeof createBinanceApiClient>);

    const result = await svc.testBinance();

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('API key not configured');
    }
  });
});
