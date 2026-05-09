// credentials.test.ts — US-012 A2, A3, A4, A5
// TDD tests for GET /api/credentials and POST /api/credentials/test/:service
// No real HTTP calls — fetch is mocked via vi.spyOn or vi.fn.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { buildServer } from '../index.js';
import type { FastifyInstance } from 'fastify';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAuthCookie(server: FastifyInstance): string {
  // We build the server with auth disabled in tests, but we still need to pass
  // a fake cookie that the auth onRequest hook would accept.
  // Since we disable auth via enableAuth=false, no cookie is actually required —
  // the tests just hit the endpoints directly.
  return '';
}

async function buildTestServer(): Promise<FastifyInstance> {
  return buildServer({ enableAuth: false });
}

afterEach(() => {
  vi.restoreAllMocks();
  // Clean env vars set during test
  delete process.env.ETHERSCAN_API_KEY;
  delete process.env.BSCTRACE_API_KEY;
  delete process.env.BINANCE_API_KEY;
  delete process.env.BINANCE_SECRET_KEY;
});

// ─── A2: GET /api/credentials ─────────────────────────────────────────────────

describe('GET /api/credentials (A2)', () => {
  it('A2-01 — returns true for configured keys, false for missing keys', async () => {
    process.env.ETHERSCAN_API_KEY = 'abc123ETH';
    process.env.BINANCE_API_KEY = 'xyz789BNB';
    // BSCTRACE_API_KEY and BINANCE_SECRET_KEY intentionally not set

    const server = await buildTestServer();
    const response = await server.inject({ method: 'GET', url: '/api/credentials' });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, boolean>;
    expect(body.ETHERSCAN_API_KEY).toBe(true);
    expect(body.BSCTRACE_API_KEY).toBe(false);
    expect(body.BINANCE_API_KEY).toBe(true);
    expect(body.BINANCE_SECRET_KEY).toBe(false);
  });

  it('A2-02 — empty string env var → false', async () => {
    process.env.ETHERSCAN_API_KEY = '';

    const server = await buildTestServer();
    const response = await server.inject({ method: 'GET', url: '/api/credentials' });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, boolean>;
    expect(body.ETHERSCAN_API_KEY).toBe(false);
  });

  it('A2-03 — whitespace-only env var → false', async () => {
    process.env.ETHERSCAN_API_KEY = '   ';

    const server = await buildTestServer();
    const response = await server.inject({ method: 'GET', url: '/api/credentials' });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, boolean>;
    expect(body.ETHERSCAN_API_KEY).toBe(false);
  });

  it('A2-04 — security: response body must not contain key-like strings (≥20 uppercase alphanum chars)', async () => {
    // Set a realistic-looking key that MUST NOT appear in the response
    process.env.ETHERSCAN_API_KEY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ12345';

    const server = await buildTestServer();
    const response = await server.inject({ method: 'GET', url: '/api/credentials' });

    expect(response.statusCode).toBe(200);
    expect(/[A-Z0-9]{20,}/.test(response.body)).toBe(false);
  });

  it('A2-05 — NEGATIVE: requires auth — with real auth server returns 401 when no cookie', async () => {
    const server = await buildServer({ enableAuth: true, jwtSecret: 'test-secret-abc123' });
    const response = await server.inject({ method: 'GET', url: '/api/credentials' });

    expect(response.statusCode).toBe(401);
  });
});

// ─── A3: POST /api/credentials/test/etherscan ─────────────────────────────────

describe('POST /api/credentials/test/etherscan (A3)', () => {
  it('A3-01 — happy path: fetch returns status=1 → { status: connected }', async () => {
    process.env.ETHERSCAN_API_KEY = 'validkey123';

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: '1', message: 'OK', result: '120000000000000000000000000' }),
    } as unknown as Response);

    const server = await buildTestServer();
    const response = await server.inject({
      method: 'POST',
      url: '/api/credentials/test/etherscan',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string; meta?: { latencyMs?: number } };
    expect(body.status).toBe('connected');
    if (body.meta?.latencyMs !== undefined) {
      expect(Number.isInteger(body.meta.latencyMs)).toBe(true);
      expect(body.meta.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('A3-02 — NEGATIVE: fetch returns status=0 with Invalid API Key → { status: failed, reason: Invalid API key }', async () => {
    process.env.ETHERSCAN_API_KEY = 'badkey';

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: '0', message: 'Invalid API Key' }),
    } as unknown as Response);

    const server = await buildTestServer();
    const response = await server.inject({
      method: 'POST',
      url: '/api/credentials/test/etherscan',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string; reason: string };
    expect(body.status).toBe('failed');
    expect(body.reason).toBe('Invalid API key');
  });

  it('A3-03 — NEGATIVE: HTTP 401 → { status: failed, reason: Invalid API key }', async () => {
    process.env.ETHERSCAN_API_KEY = 'badkey';

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    } as unknown as Response);

    const server = await buildTestServer();
    const response = await server.inject({
      method: 'POST',
      url: '/api/credentials/test/etherscan',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string; reason: string };
    expect(body.status).toBe('failed');
    expect(body.reason).toBe('Invalid API key');
  });

  it('A3-04 — NEGATIVE: key not configured → { status: failed, reason: API key not configured } without HTTP call', async () => {
    // Ensure key is not set
    delete process.env.ETHERSCAN_API_KEY;

    const fetchSpy = vi.spyOn(global, 'fetch');

    const server = await buildTestServer();
    const response = await server.inject({
      method: 'POST',
      url: '/api/credentials/test/etherscan',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string; reason: string };
    expect(body.status).toBe('failed');
    expect(body.reason).toBe('API key not configured');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('A3-05 — NEGATIVE: invalid service param → 400', async () => {
    const server = await buildTestServer();
    const response = await server.inject({
      method: 'POST',
      url: '/api/credentials/test/invalid-service',
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { message?: string; error?: string };
    // Should mention valid services
    const text = JSON.stringify(body);
    expect(text.toLowerCase()).toMatch(/etherscan|bsctrace|binance/i);
  });

  it('A3-06 — NEGATIVE: network error (fetch throws) → { status: failed, reason: ... }', async () => {
    process.env.ETHERSCAN_API_KEY = 'validkey123';

    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

    const server = await buildTestServer();
    const response = await server.inject({
      method: 'POST',
      url: '/api/credentials/test/etherscan',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string; reason: string };
    expect(body.status).toBe('failed');
    expect(body.reason).toBeTruthy();
  });
});

// ─── A4: POST /api/credentials/test/bsctrace ─────────────────────────────────

describe('POST /api/credentials/test/bsctrace (A4)', () => {
  it('A4-01 — happy path: fetch returns status=1 → { status: connected }', async () => {
    process.env.BSCTRACE_API_KEY = 'validbsckey';

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: '1', message: 'OK', result: '...' }),
    } as unknown as Response);

    const server = await buildTestServer();
    const response = await server.inject({
      method: 'POST',
      url: '/api/credentials/test/bsctrace',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string };
    expect(body.status).toBe('connected');
  });

  it('A4-02 — NEGATIVE: fetch returns status=0 → { status: failed, reason: Invalid API key }', async () => {
    process.env.BSCTRACE_API_KEY = 'badkey';

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: '0', message: 'Invalid API Key' }),
    } as unknown as Response);

    const server = await buildTestServer();
    const response = await server.inject({
      method: 'POST',
      url: '/api/credentials/test/bsctrace',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string; reason: string };
    expect(body.status).toBe('failed');
    expect(body.reason).toBe('Invalid API key');
  });

  it('A4-03 — NEGATIVE: key not configured → { status: failed, reason: API key not configured } without HTTP call', async () => {
    delete process.env.BSCTRACE_API_KEY;

    const fetchSpy = vi.spyOn(global, 'fetch');

    const server = await buildTestServer();
    const response = await server.inject({
      method: 'POST',
      url: '/api/credentials/test/bsctrace',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string; reason: string };
    expect(body.status).toBe('failed');
    expect(body.reason).toBe('API key not configured');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ─── A5: POST /api/credentials/test/binance ──────────────────────────────────

describe('POST /api/credentials/test/binance (A5)', () => {
  it('A5-01 — happy path: mock getAccountAssets → 42 assets → { status: connected, meta: { assetCount: 42 } }', async () => {
    process.env.BINANCE_API_KEY = 'binance-api-key-valid';
    process.env.BINANCE_SECRET_KEY = 'binance-secret-key-valid';

    // Mock the fetch to simulate a Binance /api/v3/account response
    const mockBalances = Array.from({ length: 42 }, (_, i) => ({
      asset: `TOKEN${i}`,
      free: '1.0',
      locked: '0.0',
    }));

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ balances: mockBalances }),
    } as unknown as Response);

    const server = await buildTestServer();
    const response = await server.inject({
      method: 'POST',
      url: '/api/credentials/test/binance',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string; meta?: { assetCount?: number } };
    expect(body.status).toBe('connected');
    expect(body.meta?.assetCount).toBe(42);
  });

  it('A5-02 — 0 assets (empty account) → { status: connected, meta: { assetCount: 0 } }', async () => {
    process.env.BINANCE_API_KEY = 'binance-api-key-valid';
    process.env.BINANCE_SECRET_KEY = 'binance-secret-key-valid';

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ balances: [] }),
    } as unknown as Response);

    const server = await buildTestServer();
    const response = await server.inject({
      method: 'POST',
      url: '/api/credentials/test/binance',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string; meta?: { assetCount?: number } };
    expect(body.status).toBe('connected');
    expect(body.meta?.assetCount).toBe(0);
  });

  it('A5-03 — NEGATIVE: Binance code -2014 → { status: failed, reason: Invalid API key }', async () => {
    process.env.BINANCE_API_KEY = 'bad-api-key';
    process.env.BINANCE_SECRET_KEY = 'bad-secret-key';

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ code: -2014, msg: 'API-key format invalid.' }),
    } as unknown as Response);

    const server = await buildTestServer();
    const response = await server.inject({
      method: 'POST',
      url: '/api/credentials/test/binance',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string; reason: string };
    expect(body.status).toBe('failed');
    expect(body.reason).toBe('Invalid API key');
  });

  it('A5-04 — NEGATIVE: Binance code -2015 (invalid signature) → { status: failed, reason: Invalid API key }', async () => {
    process.env.BINANCE_API_KEY = 'valid-key';
    process.env.BINANCE_SECRET_KEY = 'wrong-secret';

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ code: -2015, msg: 'Signature for this request is not valid.' }),
    } as unknown as Response);

    const server = await buildTestServer();
    const response = await server.inject({
      method: 'POST',
      url: '/api/credentials/test/binance',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string; reason: string };
    expect(body.status).toBe('failed');
    expect(body.reason).toBe('Invalid API key');
  });

  it('A5-05 — NEGATIVE: Binance code -1002 (no read permission) → { status: failed, reason: API key requires read permissions }', async () => {
    process.env.BINANCE_API_KEY = 'valid-key';
    process.env.BINANCE_SECRET_KEY = 'valid-secret';

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ code: -1002, msg: 'You are not authorized to execute this request.' }),
    } as unknown as Response);

    const server = await buildTestServer();
    const response = await server.inject({
      method: 'POST',
      url: '/api/credentials/test/binance',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string; reason: string };
    expect(body.status).toBe('failed');
    expect(body.reason).toBe('API key requires read permissions');
  });

  it('A5-06 — NEGATIVE: BINANCE_API_KEY not configured → { status: failed, reason: API key not configured }', async () => {
    delete process.env.BINANCE_API_KEY;
    delete process.env.BINANCE_SECRET_KEY;

    const fetchSpy = vi.spyOn(global, 'fetch');

    const server = await buildTestServer();
    const response = await server.inject({
      method: 'POST',
      url: '/api/credentials/test/binance',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string; reason: string };
    expect(body.status).toBe('failed');
    expect(body.reason).toBe('API key not configured');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('A5-07 — NEGATIVE: BINANCE_SECRET_KEY missing (only API key) → { status: failed, reason: API key not configured }', async () => {
    process.env.BINANCE_API_KEY = 'valid-key';
    delete process.env.BINANCE_SECRET_KEY;

    const fetchSpy = vi.spyOn(global, 'fetch');

    const server = await buildTestServer();
    const response = await server.inject({
      method: 'POST',
      url: '/api/credentials/test/binance',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string; reason: string };
    expect(body.status).toBe('failed');
    expect(body.reason).toBe('API key not configured');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('A5-08 — NEGATIVE: HTTP 429 rate limit → { status: failed, reason: Binance rate limit exceeded }', async () => {
    process.env.BINANCE_API_KEY = 'valid-key';
    process.env.BINANCE_SECRET_KEY = 'valid-secret';

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({}),
    } as unknown as Response);

    const server = await buildTestServer();
    const response = await server.inject({
      method: 'POST',
      url: '/api/credentials/test/binance',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string; reason: string };
    expect(body.status).toBe('failed');
    expect(body.reason).toBe('Binance rate limit exceeded');
  });

  it('A5-09 — Security: response body must NOT contain the secret key value', async () => {
    const SECRET = 'MY_SUPER_SECRET_BINANCE_KEY_12345';
    process.env.BINANCE_API_KEY = 'MY_API_KEY_VALUE_67890';
    process.env.BINANCE_SECRET_KEY = SECRET;

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ code: -2014, msg: 'API-key format invalid.' }),
    } as unknown as Response);

    const server = await buildTestServer();
    const response = await server.inject({
      method: 'POST',
      url: '/api/credentials/test/binance',
    });

    expect(response.body).not.toContain(SECRET);
    expect(response.body).not.toContain(process.env.BINANCE_API_KEY);
  });
});
