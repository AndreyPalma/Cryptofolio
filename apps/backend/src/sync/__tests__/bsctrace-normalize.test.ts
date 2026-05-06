// T10, T13 — Etherscan + BSCTrace normalization tests (engine project, no DB)
// Written BEFORE implementation (TDD Red phase).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Etherscan normalize tests (T10) ─────────────────────────────────────────

describe('EtherscanClient — fetchNormalTransactions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns typed NormalizedTx[] from status=1 response', async () => {
    const mockResponse = {
      status: '1',
      message: 'OK',
      result: [
        {
          hash: '0xABCDEF',
          blockNumber: '12345',
          transactionIndex: '2',
          timeStamp: '1700000000',
          from: '0xFROM',
          to: '0xTO',
          value: '1000000000000000000',
          isError: '0',
          gasUsed: '21000',
          input: '0x',
        },
        {
          hash: '0xBBBBBB',
          blockNumber: '12346',
          transactionIndex: '5',
          timeStamp: '1700000001',
          from: '0xSENDER',
          to: '0xRECEIVER',
          value: '2000000000000000000',
          isError: '1',
          gasUsed: '21000',
          input: '0xa9059cbb',
        },
      ],
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as unknown as Response);

    const { createEtherscanClient } = await import('../clients/etherscan.js');
    const client = createEtherscanClient({ apiKey: 'test-key', log: { warn: vi.fn() } as never });

    const result = await client.fetchNormalTransactions('0xwallet', 0, 99999999);

    expect(result).toHaveLength(2);

    const first = result[0]!;
    expect(first.txHash).toBe('0xabcdef');           // lowercased
    expect(first.blockNumber).toBe(12345);             // parsed as number
    expect(first.transactionIndex).toBe(2);
    expect(first.timeStamp).toBe(1700000000);
    expect(first.from).toBe('0xfrom');                 // lowercased
    expect(first.to).toBe('0xto');                     // lowercased
    expect(first.value).toBe('1000000000000000000');
    expect(first.isError).toBe('0');
    expect(first.gasUsed).toBe('21000');

    const second = result[1]!;
    expect(second.isError).toBe('1');
    expect(second.methodId).toBe('0xa9059cbb');
  });

  it('returns [] when status=0 and message="No transactions found"', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: '0', message: 'No transactions found', result: [] }),
    } as unknown as Response);

    const { createEtherscanClient } = await import('../clients/etherscan.js');
    const client = createEtherscanClient({ apiKey: 'test-key', log: { warn: vi.fn() } as never });

    const result = await client.fetchNormalTransactions('0xwallet', 0, 99999999);
    expect(result).toEqual([]);
  });

  it('throws ExternalApiError when status=0 with other message', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: '0', message: 'NOTOK', result: [] }),
    } as unknown as Response);

    const { createEtherscanClient } = await import('../clients/etherscan.js');
    const { ExternalApiError } = await import('../../services/errors.js');
    const client = createEtherscanClient({ apiKey: 'test-key', log: { warn: vi.fn() } as never });

    await expect(
      client.fetchNormalTransactions('0xwallet', 0, 99999999),
    ).rejects.toBeInstanceOf(ExternalApiError);
  });
});

// ─── BSCTrace normalize tests (T13) ──────────────────────────────────────────

describe('BSCTraceClient — nr_getAssetTransfers normalization', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const bscFixture = {
    jsonrpc: '2.0',
    id: 1,
    result: {
      transfers: [
        {
          // Native BNB transfer
          blockNum: '0x1a4',                           // 420 decimal
          hash: '0xNATIVETX',
          from: '0xFROM',
          to: '0xTO',
          value: '1000000000000000000',
          asset: 'BNB',
          category: 'external',
          rawContract: { address: null, decimal: null, value: '1000000000000000000' },
          metadata: { blockTimestamp: '2024-01-01T00:00:00Z' },
        },
        {
          // ERC20 token transfer
          blockNum: '0x1a5',                           // 421 decimal
          hash: '0xTOKENTX',
          from: '0xWALLET',
          to: '0xCONTRACT',
          value: '500000000000000000',
          asset: 'USDT',
          category: 'erc20',
          rawContract: {
            address: '0xTOKENADDR',
            decimal: '18',
            value: '500000000000000000',
          },
          metadata: { blockTimestamp: '2024-01-01T00:01:00Z' },
        },
      ],
    },
  };

  it('normalizes JSON-RPC response to NormalizedTx[] with lowercased addresses', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => bscFixture,
    } as unknown as Response);

    const { createBSCTraceClient } = await import('../clients/bsctrace.js');
    const client = createBSCTraceClient({ apiKey: 'test-key', log: { warn: vi.fn() } as never });

    const result = await client.fetchNormalTransactions('0xwallet', 0, 99999999);

    expect(result).toHaveLength(2);

    const native = result[0]!;
    expect(native.blockNumber).toBe(420);               // hex 0x1a4 → 420
    expect(native.txHash).toBe('0xnativetx');           // lowercased
    expect(native.from).toBe('0xfrom');
    expect(native.to).toBe('0xto');
    expect(native.isError).toBe('0');                   // BSCTrace has no error flag

    const erc20 = result[1]!;
    expect(erc20.blockNumber).toBe(421);
    expect(erc20.txHash).toBe('0xtokentx');
    expect(erc20.from).toBe('0xwallet');
  });

  it('throws ExternalApiError when response has error field', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32000, message: 'Server error' },
      }),
    } as unknown as Response);

    const { createBSCTraceClient } = await import('../clients/bsctrace.js');
    const { ExternalApiError } = await import('../../services/errors.js');
    const client = createBSCTraceClient({ apiKey: 'test-key', log: { warn: vi.fn() } as never });

    await expect(
      client.fetchNormalTransactions('0xwallet', 0, 99999999),
    ).rejects.toBeInstanceOf(ExternalApiError);
  });

  it('returns [] when result.transfers is empty', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: { transfers: [] } }),
    } as unknown as Response);

    const { createBSCTraceClient } = await import('../clients/bsctrace.js');
    const client = createBSCTraceClient({ apiKey: 'test-key', log: { warn: vi.fn() } as never });

    const result = await client.fetchNormalTransactions('0xwallet', 0, 99999999);
    expect(result).toEqual([]);
  });
});
