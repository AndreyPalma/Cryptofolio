// Tests unitarios para WalletService — US-005
// Mock de pg.Pool: no toca la base de datos real.
// Ciclos TDD: RED aquí, GREEN en Phase 4.

import { describe, it, expect, vi } from 'vitest';
import type { Pool, PoolClient, QueryResult } from 'pg';
import { ConflictError, NotFoundError } from '../errors.js';

// Helper: construye un mock de Pool con el método query configurable
function makeMockPool(queryFn: ReturnType<typeof vi.fn> = vi.fn()): Pool {
  return { query: queryFn } as unknown as Pool;
}

// Helper: PoolClient mock para transacciones
function makeMockClient(queries: QueryResult[]): PoolClient {
  let callCount = 0;
  return {
    query: vi.fn().mockImplementation(() => {
      const result = queries[callCount] ?? { rows: [], rowCount: 0 };
      callCount++;
      return Promise.resolve(result);
    }),
    release: vi.fn(),
  } as unknown as PoolClient;
}

// Helper: Pool con connect() que devuelve un PoolClient mock
function makePoolWithClient(client: PoolClient): Pool {
  return {
    connect: vi.fn().mockResolvedValue(client),
    query: vi.fn(),
  } as unknown as Pool;
}

// ── Importación diferida para que los mocks de vi.fn() queden listos antes ──
const { createWallet, findAll, findById, updateWallet, deleteWallet } = await import('../wallet.js');

// ─────────────────────────────────────────────────────────────────────────────
// SC-WALLET-CREATE-01: creación ON_CHAIN exitosa con checksum EIP-55 válido
// ─────────────────────────────────────────────────────────────────────────────
describe('createWallet', () => {
  const VALID_ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'; // checksum EIP-55 correcto
  const LOWERCASE_ADDRESS = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';

  it('SC-WALLET-CREATE-01: crea wallet ON_CHAIN con address checksummed', async () => {
    const createdRow = {
      id: 'uuid-1',
      user_id: 'user-uuid',
      wallet_type: 'ON_CHAIN',
      address: VALID_ADDRESS,
      network: 'ETH',
      label: null,
      last_synced_at: null,
      created_at: new Date().toISOString(),
    };
    const pool = makeMockPool(vi.fn().mockResolvedValue({ rows: [createdRow], rowCount: 1 }));

    const result = await createWallet(pool, 'user-uuid', {
      wallet_type: 'ON_CHAIN',
      address: VALID_ADDRESS,
      network: 'ETH',
    });

    expect(result.id).toBe('uuid-1');
    expect(result.address).toBe(VALID_ADDRESS);
    expect(result.wallet_type).toBe('ON_CHAIN');
  });

  it('SC-WALLET-CREATE-02: normaliza address a checksum EIP-55 antes de insertar', async () => {
    let capturedAddress: string | undefined;
    const queryFn = vi.fn().mockImplementation((_sql: string, params: unknown[]) => {
      // params = [userId, checksumAddress, network, label]
      // índice 1 (base 0) = checksumAddress
      capturedAddress = params[1] as string;
      return Promise.resolve({
        rows: [{
          id: 'uuid-2',
          user_id: 'user-uuid',
          wallet_type: 'ON_CHAIN',
          address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
          network: 'BSC',
          label: null,
          last_synced_at: null,
          created_at: new Date().toISOString(),
        }],
        rowCount: 1,
      });
    });
    const pool = makeMockPool(queryFn);

    await createWallet(pool, 'user-uuid', {
      wallet_type: 'ON_CHAIN',
      address: LOWERCASE_ADDRESS, // minúsculas — debe normalizarse
      network: 'BSC',
    });

    // La address persistida debe ser la versión checksummed
    expect(capturedAddress).toBe('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
  });

  it('SC-WALLET-CREATE-03: crea wallet CEX (primera vez) con address=null', async () => {
    const createdRow = {
      id: 'uuid-3',
      user_id: 'user-uuid',
      wallet_type: 'CEX',
      address: null,
      network: 'CEX_BINANCE',
      label: null,
      last_synced_at: null,
      created_at: new Date().toISOString(),
    };
    // Secuencia de queries dentro de la transacción:
    // 1. BEGIN        → { rows: [], rowCount: 0 }
    // 2. SELECT ... FOR UPDATE → 0 filas (no existe CEX)
    // 3. INSERT       → fila creada
    // 4. COMMIT       → { rows: [], rowCount: 0 }
    const client = makeMockClient([
      { rows: [], rowCount: 0 } as unknown as QueryResult,             // BEGIN
      { rows: [], rowCount: 0 } as unknown as QueryResult,             // SELECT FOR UPDATE → no existe
      { rows: [createdRow], rowCount: 1 } as unknown as QueryResult,   // INSERT
      { rows: [], rowCount: 0 } as unknown as QueryResult,             // COMMIT
    ]);
    const pool = makePoolWithClient(client);

    const result = await createWallet(pool, 'user-uuid', {
      wallet_type: 'CEX',
      network: 'CEX_BINANCE',
    });

    expect(result.wallet_type).toBe('CEX');
    expect(result.address).toBeNull();
    expect(result.network).toBe('CEX_BINANCE');
  });

  it('SC-WALLET-CREATE-04: rechaza segunda wallet CEX con ConflictError', async () => {
    // Secuencia: BEGIN, SELECT FOR UPDATE → 1 fila (ya existe), ROLLBACK
    const client = makeMockClient([
      { rows: [], rowCount: 0 } as unknown as QueryResult,                        // BEGIN
      { rows: [{ wallet_type: 'CEX' }], rowCount: 1 } as unknown as QueryResult, // SELECT FOR UPDATE → existe
      { rows: [], rowCount: 0 } as unknown as QueryResult,                        // ROLLBACK
    ]);
    const pool = makePoolWithClient(client);

    await expect(
      createWallet(pool, 'user-uuid', {
        wallet_type: 'CEX',
        network: 'CEX_BINANCE',
      }),
    ).rejects.toThrow(ConflictError);
  });

  it('SC-WALLET-CREATE-04: código de error es BINANCE_ALREADY_CONFIGURED', async () => {
    const client = makeMockClient([
      { rows: [], rowCount: 0 } as unknown as QueryResult,
      { rows: [{ wallet_type: 'CEX' }], rowCount: 1 } as unknown as QueryResult,
      { rows: [], rowCount: 0 } as unknown as QueryResult,
    ]);
    const pool = makePoolWithClient(client);

    await expect(
      createWallet(pool, 'user-uuid', {
        wallet_type: 'CEX',
        network: 'CEX_BINANCE',
      }),
    ).rejects.toMatchObject({ code: 'BINANCE_ALREADY_CONFIGURED' });
  });

  // ── Escenarios NEGATIVOS ───────────────────────────────────────────────────

  it('NEGATIVE-W-01: ON_CHAIN sin address → ValidationError ADDRESS_REQUIRED', async () => {
    const pool = makeMockPool();

    await expect(
      createWallet(pool, 'user-uuid', {
        wallet_type: 'ON_CHAIN',
        network: 'ETH',
        // sin address
      }),
    ).rejects.toMatchObject({
      code: 'ADDRESS_REQUIRED',
      message: 'Address required for on-chain wallet',
    });
  });

  it('NEGATIVE-W-02: ON_CHAIN con address inválida → ValidationError INVALID_ADDRESS', async () => {
    const pool = makeMockPool();

    await expect(
      createWallet(pool, 'user-uuid', {
        wallet_type: 'ON_CHAIN',
        address: '0xINVALIDA',
        network: 'ETH',
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_ADDRESS',
      message: 'Invalid Ethereum address',
    });
  });

  it('NEGATIVE-W-03: ON_CHAIN con network inválida → ValidationError INVALID_NETWORK', async () => {
    const pool = makeMockPool();

    await expect(
      createWallet(pool, 'user-uuid', {
        wallet_type: 'ON_CHAIN',
        address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        network: 'POLYGON',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_NETWORK' });
  });

  it('NEGATIVE-W-04: CEX con address presente → ValidationError CEX_ADDRESS_NOT_ALLOWED', async () => {
    const pool = makeMockPool();

    await expect(
      createWallet(pool, 'user-uuid', {
        wallet_type: 'CEX',
        network: 'CEX_BINANCE',
        address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      }),
    ).rejects.toMatchObject({ code: 'CEX_ADDRESS_NOT_ALLOWED' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-WALLET-LIST-01
// ─────────────────────────────────────────────────────────────────────────────
describe('findAll', () => {
  it('SC-WALLET-LIST-01: retorna array con todas las wallets', async () => {
    const rows = [
      { id: 'uuid-1', wallet_type: 'ON_CHAIN', network: 'ETH', address: '0xABCD', label: null, last_synced_at: null, created_at: new Date().toISOString() },
      { id: 'uuid-2', wallet_type: 'CEX', network: 'CEX_BINANCE', address: null, label: null, last_synced_at: null, created_at: new Date().toISOString() },
    ];
    const pool = makeMockPool(vi.fn().mockResolvedValue({ rows, rowCount: 2 }));

    const result = await findAll(pool);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('uuid-1');
    expect(result[1].network).toBe('CEX_BINANCE');
  });

  it('triangulación: retorna array vacío si no hay wallets', async () => {
    const pool = makeMockPool(vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }));

    const result = await findAll(pool);

    expect(result).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-WALLET-FIND-01..02
// ─────────────────────────────────────────────────────────────────────────────
describe('findById', () => {
  it('SC-WALLET-FIND-01: retorna la wallet cuando existe', async () => {
    const row = { id: 'uuid-1', wallet_type: 'ON_CHAIN', network: 'ETH', address: '0xABCD', label: null, last_synced_at: null, created_at: new Date().toISOString() };
    const pool = makeMockPool(vi.fn().mockResolvedValue({ rows: [row], rowCount: 1 }));

    const result = await findById(pool, 'uuid-1');

    expect(result).not.toBeNull();
    expect(result?.id).toBe('uuid-1');
  });

  it('SC-WALLET-FIND-02: retorna null si la wallet no existe', async () => {
    const pool = makeMockPool(vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }));

    const result = await findById(pool, 'uuid-999');

    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-WALLET-UPDATE-01..02
// ─────────────────────────────────────────────────────────────────────────────
describe('updateWallet', () => {
  it('SC-WALLET-UPDATE-01: actualiza label y retorna wallet actualizada', async () => {
    const updated = { id: 'uuid-1', wallet_type: 'ON_CHAIN', network: 'ETH', address: '0xABCD', label: 'Wallet principal', last_synced_at: null, created_at: new Date().toISOString() };
    const pool = makeMockPool(vi.fn().mockResolvedValue({ rows: [updated], rowCount: 1 }));

    const result = await updateWallet(pool, 'uuid-1', { label: 'Wallet principal' });

    expect(result.label).toBe('Wallet principal');
  });

  it('SC-WALLET-UPDATE-02: lanza NotFoundError si wallet no existe', async () => {
    const pool = makeMockPool(vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }));

    await expect(
      updateWallet(pool, 'uuid-999', { label: 'X' }),
    ).rejects.toMatchObject({ code: 'WALLET_NOT_FOUND' });

    await expect(
      updateWallet(pool, 'uuid-999', { label: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-WALLET-DELETE-01..02
// ─────────────────────────────────────────────────────────────────────────────
describe('deleteWallet', () => {
  it('SC-WALLET-DELETE-01: elimina wallet existente sin error', async () => {
    const pool = makeMockPool(vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }));

    // No debe lanzar
    await expect(deleteWallet(pool, 'uuid-1')).resolves.toBeUndefined();
  });

  it('SC-WALLET-DELETE-02: lanza NotFoundError si wallet no existe', async () => {
    const pool = makeMockPool(vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }));

    await expect(
      deleteWallet(pool, 'uuid-999'),
    ).rejects.toMatchObject({ code: 'WALLET_NOT_FOUND' });
  });
});
