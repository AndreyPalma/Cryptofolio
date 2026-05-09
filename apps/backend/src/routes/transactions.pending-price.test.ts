// transactions.pending-price.test.ts — US-012 A6
// TDD tests for GET /api/transactions/pending-price

import { describe, it, expect, vi } from 'vitest';

// ─── Mock pg at module level — runs before any imports below ──────────────────

const mockQuery = vi.fn();

vi.mock('pg', () => {
  return {
    default: {
      Pool: vi.fn().mockImplementation(() => ({
        query: mockQuery,
        connect: vi.fn(),
        end: vi.fn(),
      })),
    },
  };
});

// ─── Now import the server (pg mock is already in place) ─────────────────────

import { buildServer } from '../index.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makePendingItem(overrides?: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(),
    wallet_id: crypto.randomUUID(),
    token_id: crypto.randomUUID(),
    token_symbol: 'ETH',
    token_network: 'ETH',
    amount: '1.5',
    block_timestamp: new Date().toISOString(),
    tx_hash: '0xabc123',
    from_address: '0xfrom',
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/transactions/pending-price (A6)', () => {
  it('A6-01 — happy path: returns 3 pending TRANSFER_IN items with count=3', async () => {
    const items = [makePendingItem(), makePendingItem(), makePendingItem()];

    mockQuery.mockResolvedValueOnce({
      rows: [{ total_count: '3', items: JSON.stringify(items) }],
      rowCount: 1,
    });

    const server = await buildServer({ enableAuth: false });
    const response = await server.inject({
      method: 'GET',
      url: '/api/transactions/pending-price',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { transactions: unknown[]; count: number };
    expect(body.count).toBe(3);
    expect(body.transactions).toHaveLength(3);
  });

  it('A6-02 — empty result: returns transactions=[] and count=0', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ total_count: '0', items: null }],
      rowCount: 1,
    });

    const server = await buildServer({ enableAuth: false });
    const response = await server.inject({
      method: 'GET',
      url: '/api/transactions/pending-price',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { transactions: unknown[]; count: number };
    expect(body.count).toBe(0);
    expect(body.transactions).toHaveLength(0);
  });

  it('A6-03 — LIMIT 100: when 150 pending exist, returns 100 items but count=150', async () => {
    const items = Array.from({ length: 100 }, () => makePendingItem());

    mockQuery.mockResolvedValueOnce({
      rows: [{ total_count: '150', items: JSON.stringify(items) }],
      rowCount: 1,
    });

    const server = await buildServer({ enableAuth: false });
    const response = await server.inject({
      method: 'GET',
      url: '/api/transactions/pending-price',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { transactions: unknown[]; count: number };
    expect(body.count).toBe(150);
    expect(body.transactions).toHaveLength(100);
  });

  it('A6-04 — NEGATIVE: requires auth — returns 401 without JWT cookie', async () => {
    const server = await buildServer({ enableAuth: true, jwtSecret: 'test-secret-abc123' });

    const response = await server.inject({
      method: 'GET',
      url: '/api/transactions/pending-price',
    });

    expect(response.statusCode).toBe(401);
  });
});
