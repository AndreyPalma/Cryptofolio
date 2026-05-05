// WalletService — US-005
// Funciones puras que reciben Pool como parámetro para ser testeables sin Fastify.

import { getAddress } from 'viem';
import type { Pool } from 'pg';
import type { Wallet, CreateWalletInput, UpdateWalletInput } from '../types/wallet.js';
import { ValidationError, ConflictError, NotFoundError } from './errors.js';

const ON_CHAIN_NETWORKS = new Set(['ETH', 'BSC']);

// ─────────────────────────────────────────────────────────────────────────────
// createWallet
// ─────────────────────────────────────────────────────────────────────────────

export async function createWallet(
  pool: Pool,
  userId: string,
  input: CreateWalletInput,
): Promise<Wallet> {
  const { wallet_type, network, label } = input;

  if (wallet_type === 'ON_CHAIN') {
    return createOnChainWallet(pool, userId, { ...input, wallet_type, network, label });
  }

  return createCexWallet(pool, userId, { ...input, wallet_type, network, label });
}

async function createOnChainWallet(
  pool: Pool,
  userId: string,
  input: CreateWalletInput,
): Promise<Wallet> {
  const { network, label } = input;
  const rawAddress = input.address;

  // NEGATIVE-W-01: address requerida para ON_CHAIN
  if (!rawAddress) {
    throw new ValidationError('Address required for on-chain wallet', 'ADDRESS_REQUIRED');
  }

  // NEGATIVE-W-03: red válida para ON_CHAIN
  if (!ON_CHAIN_NETWORKS.has(network)) {
    throw new ValidationError(
      `Network '${network}' no es válida para ON_CHAIN. Debe ser ETH o BSC`,
      'INVALID_NETWORK',
    );
  }

  // NEGATIVE-W-02: validar y normalizar EIP-55 con viem
  let checksumAddress: string;
  try {
    checksumAddress = getAddress(rawAddress);
  } catch {
    throw new ValidationError('Invalid Ethereum address', 'INVALID_ADDRESS');
  }

  const result = await pool.query<Wallet>(
    `INSERT INTO wallets (user_id, wallet_type, address, network, label)
     VALUES ($1, 'ON_CHAIN', $2, $3, $4)
     RETURNING id, user_id, wallet_type, address, network, label, last_synced_at, created_at`,
    [userId, checksumAddress, network, label ?? null],
  );

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- INSERT RETURNING always returns a row on success
  return result.rows[0]!;
}

async function createCexWallet(
  pool: Pool,
  userId: string,
  input: CreateWalletInput,
): Promise<Wallet> {
  const { label } = input;
  const rawAddress = input.address;

  // NEGATIVE-W-04: CEX no puede tener address
  if (rawAddress != null && rawAddress !== '') {
    throw new ValidationError(
      'CEX wallets cannot have an address',
      'CEX_ADDRESS_NOT_ALLOWED',
    );
  }

  // Unicidad CEX via SELECT … FOR UPDATE dentro de transacción
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query<{ wallet_type: string }>(
      `SELECT wallet_type FROM wallets WHERE network = 'CEX_BINANCE' FOR UPDATE`,
    );

    // SC-WALLET-CREATE-04: ya existe una Binance wallet
    if (existing.rowCount && existing.rowCount > 0) {
      await client.query('ROLLBACK');
      throw new ConflictError(
        'Binance account already configured',
        'BINANCE_ALREADY_CONFIGURED',
      );
    }

    const result = await client.query<Wallet>(
      `INSERT INTO wallets (user_id, wallet_type, address, network, label)
       VALUES ($1, 'CEX', NULL, 'CEX_BINANCE', $2)
       RETURNING id, user_id, wallet_type, address, network, label, last_synced_at, created_at`,
      [userId, label ?? null],
    );

    await client.query('COMMIT');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- INSERT RETURNING always returns a row on success
    return result.rows[0]!;
  } catch (err) {
    // Solo hacemos ROLLBACK si no es el ConflictError que ya hizo rollback
    if (!(err instanceof ConflictError)) {
      await client.query('ROLLBACK');
    }
    throw err;
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// findAll
// ─────────────────────────────────────────────────────────────────────────────

export async function findAll(pool: Pool): Promise<Wallet[]> {
  const result = await pool.query<Wallet>(
    `SELECT id, user_id, wallet_type, address, network, label, last_synced_at, created_at
     FROM wallets
     ORDER BY created_at ASC`,
  );
  return result.rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// findById
// ─────────────────────────────────────────────────────────────────────────────

export async function findById(pool: Pool, id: string): Promise<Wallet | null> {
  const result = await pool.query<Wallet>(
    `SELECT id, user_id, wallet_type, address, network, label, last_synced_at, created_at
     FROM wallets
     WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// updateWallet
// ─────────────────────────────────────────────────────────────────────────────

export async function updateWallet(
  pool: Pool,
  id: string,
  input: UpdateWalletInput,
): Promise<Wallet> {
  const result = await pool.query<Wallet>(
    `UPDATE wallets
     SET label = $2
     WHERE id = $1
     RETURNING id, user_id, wallet_type, address, network, label, last_synced_at, created_at`,
    [id, input.label ?? null],
  );

  if (!result.rowCount || result.rowCount === 0) {
    throw new NotFoundError(`Wallet '${id}' no encontrada`, 'WALLET_NOT_FOUND');
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- UPDATE RETURNING always returns a row when rowCount > 0
  return result.rows[0]!;
}

// ─────────────────────────────────────────────────────────────────────────────
// deleteWallet
// ─────────────────────────────────────────────────────────────────────────────

export async function deleteWallet(pool: Pool, id: string): Promise<void> {
  const result = await pool.query(
    `DELETE FROM wallets WHERE id = $1`,
    [id],
  );

  if (!result.rowCount || result.rowCount === 0) {
    throw new NotFoundError(`Wallet '${id}' no encontrada`, 'WALLET_NOT_FOUND');
  }
}
