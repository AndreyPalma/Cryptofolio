// Tests unitarios para TokenService — US-005
// Mock de pg.Pool: no toca la base de datos real.

import { describe, it, expect, vi } from 'vitest';
import type { Pool, QueryResult } from 'pg';
import { ValidationError, ConflictError, NotFoundError } from '../errors.js';

function makeMockPool(queryFn: ReturnType<typeof vi.fn> = vi.fn()): Pool {
  return { query: queryFn } as unknown as Pool;
}

// Importación diferida para que mocks queden listos
const { createToken, findAll, updateToken, findByContractAddress } = await import('../token.js');

// ─────────────────────────────────────────────────────────────────────────────
// createToken
// ─────────────────────────────────────────────────────────────────────────────
describe('createToken', () => {
  it('SC-TOKEN-CREATE-01: token CEX auto-genera contract_address = symbol.toLowerCase()', async () => {
    let capturedContractAddress: string | undefined;
    const queryFn = vi.fn().mockImplementation((_sql: string, params: unknown[]) => {
      // params orden: [symbol, name, network, contract_address, decimals, binance_symbol]
      capturedContractAddress = params[3] as string;
      return Promise.resolve({
        rows: [{
          id: 'uuid-t1',
          symbol: 'ETH',
          name: 'Ethereum',
          network: 'CEX_BINANCE',
          contract_address: 'eth',
          decimals: 18,
          binance_symbol: 'ETHUSDT',
          is_hidden: false,
          target_exit_price: null,
          created_at: new Date().toISOString(),
        }],
        rowCount: 1,
      });
    });
    const pool = makeMockPool(queryFn);

    const result = await createToken(pool, {
      symbol: 'ETH',
      name: 'Ethereum',
      network: 'CEX_BINANCE',
      binance_symbol: 'ETHUSDT',
    });

    expect(result.contract_address).toBe('eth');
    expect(capturedContractAddress).toBe('eth');
  });

  it('SC-TOKEN-CREATE-02: contract_address externo es ignorado en tokens CEX', async () => {
    let capturedContractAddress: string | undefined;
    const queryFn = vi.fn().mockImplementation((_sql: string, params: unknown[]) => {
      capturedContractAddress = params[3] as string;
      return Promise.resolve({
        rows: [{
          id: 'uuid-t2',
          symbol: 'BTC',
          name: 'Bitcoin',
          network: 'CEX_BINANCE',
          contract_address: 'btc',
          decimals: 18,
          binance_symbol: 'BTCUSDT',
          is_hidden: false,
          target_exit_price: null,
          created_at: new Date().toISOString(),
        }],
        rowCount: 1,
      });
    });
    const pool = makeMockPool(queryFn);

    await createToken(pool, {
      symbol: 'BTC',
      network: 'CEX_BINANCE',
      contract_address: 'custom-value', // debe ser ignorado
      binance_symbol: 'BTCUSDT',
    });

    // Debe usar 'btc' y no 'custom-value'
    expect(capturedContractAddress).toBe('btc');
    expect(capturedContractAddress).not.toBe('custom-value');
  });

  it('SC-TOKEN-CREATE-03: crea token ON_CHAIN con contract_address explícito', async () => {
    const CONTRACT = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    const queryFn = vi.fn().mockResolvedValue({
      rows: [{
        id: 'uuid-t3',
        symbol: 'USDC',
        name: 'USD Coin',
        network: 'ETH',
        contract_address: CONTRACT,
        decimals: 6,
        binance_symbol: null,
        is_hidden: false,
        target_exit_price: null,
        created_at: new Date().toISOString(),
      }],
      rowCount: 1,
    });
    const pool = makeMockPool(queryFn);

    const result = await createToken(pool, {
      symbol: 'USDC',
      name: 'USD Coin',
      network: 'ETH',
      contract_address: CONTRACT,
    });

    expect(result.contract_address).toBe(CONTRACT);
    expect(result.network).toBe('ETH');
  });

  // ── Escenarios NEGATIVOS ───────────────────────────────────────────────────

  it('NEGATIVE-T-01: token CEX sin binance_symbol → ValidationError BINANCE_SYMBOL_REQUIRED', async () => {
    const pool = makeMockPool();

    await expect(
      createToken(pool, {
        symbol: 'ETH',
        network: 'CEX_BINANCE',
        // sin binance_symbol
      }),
    ).rejects.toMatchObject({
      code: 'BINANCE_SYMBOL_REQUIRED',
    });

    await expect(
      createToken(pool, { symbol: 'ETH', network: 'CEX_BINANCE' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('NEGATIVE-T-02: token ON_CHAIN sin contract_address → ValidationError CONTRACT_ADDRESS_REQUIRED', async () => {
    const pool = makeMockPool();

    await expect(
      createToken(pool, {
        symbol: 'USDC',
        network: 'ETH',
        // sin contract_address
      }),
    ).rejects.toMatchObject({
      code: 'CONTRACT_ADDRESS_REQUIRED',
    });
  });

  it('NEGATIVE-T-03: colisión de token → ConflictError TOKEN_ALREADY_EXISTS', async () => {
    // La DB lanza un error con código 23505 (UNIQUE violation)
    const pgUniqueError = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
    });
    const pool = makeMockPool(vi.fn().mockRejectedValue(pgUniqueError));

    await expect(
      createToken(pool, {
        symbol: 'ETH',
        network: 'CEX_BINANCE',
        binance_symbol: 'ETHUSDT',
      }),
    ).rejects.toMatchObject({
      code: 'TOKEN_ALREADY_EXISTS',
    });

    await expect(
      createToken(pool, {
        symbol: 'ETH',
        network: 'CEX_BINANCE',
        binance_symbol: 'ETHUSDT',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// findAll
// ─────────────────────────────────────────────────────────────────────────────
describe('findAll', () => {
  const ETH_TOKEN = { id: 'uuid-1', symbol: 'WETH', network: 'ETH', is_hidden: false, contract_address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18, binance_symbol: null, name: null, target_exit_price: null, created_at: new Date().toISOString() };
  const CEX_TOKEN = { id: 'uuid-2', symbol: 'ETH', network: 'CEX_BINANCE', is_hidden: false, contract_address: 'eth', decimals: 18, binance_symbol: 'ETHUSDT', name: 'Ethereum', target_exit_price: null, created_at: new Date().toISOString() };
  const HIDDEN_TOKEN = { id: 'uuid-3', symbol: 'SHIB', network: 'ETH', is_hidden: true, contract_address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', decimals: 18, binance_symbol: null, name: null, target_exit_price: null, created_at: new Date().toISOString() };

  it('SC-TOKEN-LIST-01: filtra por network=CEX_BINANCE', async () => {
    const queryFn = vi.fn().mockResolvedValue({
      rows: [CEX_TOKEN],
      rowCount: 1,
    } as unknown as QueryResult);
    const pool = makeMockPool(queryFn);

    const result = await findAll(pool, { network: 'CEX_BINANCE' });

    expect(result).toHaveLength(1);
    expect(result[0].network).toBe('CEX_BINANCE');
  });

  it('SC-TOKEN-LIST-02: excluye tokens ocultos por defecto', async () => {
    // El servicio debe construir WHERE is_hidden = false
    // Para testear que la query incluye ese filtro, inspeccionamos el SQL capturado
    let capturedSql = '';
    const queryFn = vi.fn().mockImplementation((sql: string) => {
      capturedSql = sql;
      return Promise.resolve({ rows: [ETH_TOKEN], rowCount: 1 });
    });
    const pool = makeMockPool(queryFn);

    await findAll(pool, {});

    expect(capturedSql.toLowerCase()).toContain('is_hidden');
    // y el resultado no incluye el hidden token (porque el mock devuelve solo ETH_TOKEN)
  });

  it('SC-TOKEN-LIST-03: includeHidden=true no filtra tokens ocultos', async () => {
    let capturedSql = '';
    const queryFn = vi.fn().mockImplementation((sql: string) => {
      capturedSql = sql;
      return Promise.resolve({ rows: [ETH_TOKEN, HIDDEN_TOKEN], rowCount: 2 });
    });
    const pool = makeMockPool(queryFn);

    const result = await findAll(pool, { includeHidden: true });

    // El SQL NO debe filtrar por is_hidden cuando includeHidden=true
    expect(capturedSql.toLowerCase()).not.toContain('is_hidden = false');
    expect(result).toHaveLength(2);
  });

  it('triangulación: combina network + includeHidden=false', async () => {
    let capturedSql = '';
    const queryFn = vi.fn().mockImplementation((sql: string) => {
      capturedSql = sql;
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const pool = makeMockPool(queryFn);

    await findAll(pool, { network: 'BSC', includeHidden: false });

    expect(capturedSql.toLowerCase()).toContain('is_hidden');
    expect(capturedSql.toLowerCase()).toContain('network');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateToken
// ─────────────────────────────────────────────────────────────────────────────
describe('updateToken', () => {
  const baseToken = { id: 'uuid-t1', symbol: 'ETH', name: 'Ethereum', network: 'CEX_BINANCE', contract_address: 'eth', decimals: 18, binance_symbol: 'ETHUSDT', is_hidden: false, target_exit_price: null, created_at: new Date().toISOString() };

  it('SC-TOKEN-UPDATE-01: marca token como oculto', async () => {
    const updated = { ...baseToken, is_hidden: true };
    const pool = makeMockPool(vi.fn().mockResolvedValue({ rows: [updated], rowCount: 1 }));

    const result = await updateToken(pool, 'uuid-t1', { is_hidden: true });

    expect(result.is_hidden).toBe(true);
  });

  it('SC-TOKEN-UPDATE-02: establece target_exit_price', async () => {
    const updated = { ...baseToken, target_exit_price: '5000.00' };
    const pool = makeMockPool(vi.fn().mockResolvedValue({ rows: [updated], rowCount: 1 }));

    const result = await updateToken(pool, 'uuid-t1', { target_exit_price: '5000.00' });

    expect(result.target_exit_price).toBe('5000.00');
  });

  it('SC-TOKEN-UPDATE-03: limpia target_exit_price con null', async () => {
    const updated = { ...baseToken, target_exit_price: null };
    const pool = makeMockPool(vi.fn().mockResolvedValue({ rows: [updated], rowCount: 1 }));

    const result = await updateToken(pool, 'uuid-t1', { target_exit_price: null });

    expect(result.target_exit_price).toBeNull();
  });

  it('SC-TOKEN-UPDATE-04: actualiza binance_symbol', async () => {
    const updated = { ...baseToken, binance_symbol: 'ETHBTC' };
    const pool = makeMockPool(vi.fn().mockResolvedValue({ rows: [updated], rowCount: 1 }));

    const result = await updateToken(pool, 'uuid-t1', { binance_symbol: 'ETHBTC' });

    expect(result.binance_symbol).toBe('ETHBTC');
  });

  it('SC-TOKEN-UPDATE-05: lanza NotFoundError si token no existe', async () => {
    const pool = makeMockPool(vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }));

    await expect(
      updateToken(pool, 'uuid-999', { is_hidden: true }),
    ).rejects.toMatchObject({ code: 'TOKEN_NOT_FOUND' });

    await expect(
      updateToken(pool, 'uuid-999', { is_hidden: true }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('triangulación: SET dinámico — solo actualiza campos presentes', async () => {
    let capturedSql = '';
    let capturedParams: unknown[] = [];
    const queryFn = vi.fn().mockImplementation((sql: string, params: unknown[]) => {
      capturedSql = sql;
      capturedParams = params;
      return Promise.resolve({ rows: [{ ...baseToken, binance_symbol: 'ETHBTC' }], rowCount: 1 });
    });
    const pool = makeMockPool(queryFn);

    // Solo binance_symbol — el SQL no debe incluir is_hidden ni target_exit_price
    await updateToken(pool, 'uuid-t1', { binance_symbol: 'ETHBTC' });

    expect(capturedSql.toLowerCase()).toContain('binance_symbol');
    expect(capturedSql.toLowerCase()).not.toContain('is_hidden');
    expect(capturedSql.toLowerCase()).not.toContain('target_exit_price');
    expect(capturedParams).toContain('ETHBTC');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// findByContractAddress — US-007
// ─────────────────────────────────────────────────────────────────────────────

describe('findByContractAddress', () => {
  const tokenRow = {
    id: 'uuid-t99',
    symbol: 'WETH',
    name: 'Wrapped Ether',
    network: 'ETH',
    contract_address: '0xAaAa',
    decimals: 18,
    binance_symbol: null,
    is_hidden: false,
    target_exit_price: null,
    created_at: new Date().toISOString(),
  };

  it('SC-TOKEN-LOOKUP-01: token encontrado — case-insensitive', async () => {
    const queryFn = vi.fn().mockResolvedValue({ rows: [tokenRow], rowCount: 1 } as unknown as QueryResult);
    const pool = makeMockPool(queryFn);

    const result = await findByContractAddress(pool, '0xaaaa', 'ETH');

    expect(result).not.toBeNull();
    expect(result?.id).toBe('uuid-t99');
    expect(result?.network).toBe('ETH');
    // SQL usa lower(contract_address) — verificar que se pasó el parámetro correcto
    const [, params] = queryFn.mock.calls[0] as [string, unknown[]];
    expect(params).toContain('ETH');
    expect(params).toContain('0xaaaa');
  });

  it('SC-TOKEN-LOOKUP-02: token inexistente → null', async () => {
    const pool = makeMockPool(vi.fn().mockResolvedValue({ rows: [], rowCount: 0 } as unknown as QueryResult));

    const result = await findByContractAddress(pool, '0xbbbb', 'ETH');

    expect(result).toBeNull();
  });

  it('SC-TOKEN-LOOKUP-03: token CEX — contract_address derivado case-insensitive', async () => {
    const cexRow = { ...tokenRow, network: 'CEX_BINANCE', contract_address: 'eth', binance_symbol: 'ETHUSDT' };
    const pool = makeMockPool(vi.fn().mockResolvedValue({ rows: [cexRow], rowCount: 1 } as unknown as QueryResult));

    const result = await findByContractAddress(pool, 'ETH', 'CEX_BINANCE');

    expect(result).not.toBeNull();
    expect(result?.network).toBe('CEX_BINANCE');
  });
});
