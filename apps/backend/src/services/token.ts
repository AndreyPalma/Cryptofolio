// TokenService — US-005
// Funciones puras que reciben Pool como parámetro para ser testeables sin Fastify.

import type { Pool } from 'pg';
import type { Token, CreateTokenInput, UpdateTokenInput, FindAllTokensFilter } from '../types/token.js';
import { ValidationError, ConflictError, NotFoundError } from './errors.js';

const CEX_NETWORK = 'CEX_BINANCE';

// ─────────────────────────────────────────────────────────────────────────────
// createToken
// ─────────────────────────────────────────────────────────────────────────────

export async function createToken(pool: Pool, input: CreateTokenInput): Promise<Token> {
  const { symbol, name, network, decimals } = input;

  let contractAddress: string;

  if (network === CEX_NETWORK) {
    // CEX: auto-generate contract_address = symbol.toLowerCase(); ignore any provided value
    if (!input.binance_symbol) {
      throw new ValidationError(
        'binance_symbol is required for CEX tokens',
        'BINANCE_SYMBOL_REQUIRED',
      );
    }
    contractAddress = symbol.toLowerCase();
  } else {
    // ON_CHAIN: contract_address is required
    if (!input.contract_address) {
      throw new ValidationError(
        'contract_address is required for on-chain tokens',
        'CONTRACT_ADDRESS_REQUIRED',
      );
    }
    contractAddress = input.contract_address;
  }

  try {
    const result = await pool.query<Token>(
      `INSERT INTO tokens (symbol, name, network, contract_address, decimals, binance_symbol)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, symbol, name, network, contract_address, decimals, binance_symbol,
                 is_hidden, target_exit_price, created_at`,
      [
        symbol,
        name ?? null,
        network,
        contractAddress,
        decimals ?? 18,
        input.binance_symbol ?? null,
      ],
    );
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- INSERT RETURNING always returns a row on success
    return result.rows[0]!;
  } catch (err) {
    // pg UNIQUE violation
    if (err instanceof Error && (err as { code?: string }).code === '23505') {
      throw new ConflictError('Token already exists', 'TOKEN_ALREADY_EXISTS');
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// findAll
// ─────────────────────────────────────────────────────────────────────────────

export async function findAll(pool: Pool, filter: FindAllTokensFilter): Promise<Token[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  // Por defecto excluir hidden; si includeHidden=true, no agregar filtro
  if (!filter.includeHidden) {
    params.push(false);
    conditions.push(`is_hidden = $${String(params.length)}`);
  }

  if (filter.network) {
    params.push(filter.network);
    conditions.push(`network = $${String(params.length)}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `SELECT id, symbol, name, network, contract_address, decimals, binance_symbol,
                      is_hidden, target_exit_price, created_at
               FROM tokens
               ${where}
               ORDER BY created_at ASC`;

  const result = await pool.query<Token>(sql, params);
  return result.rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// updateToken
// ─────────────────────────────────────────────────────────────────────────────

export async function updateToken(
  pool: Pool,
  id: string,
  input: UpdateTokenInput,
): Promise<Token> {
  const setClauses: string[] = [];
  const params: unknown[] = [];

  // Solo los campos presentes en input
  if ('is_hidden' in input && input.is_hidden !== undefined) {
    params.push(input.is_hidden);
    setClauses.push(`is_hidden = $${String(params.length)}`);
  }

  if ('target_exit_price' in input) {
    params.push(input.target_exit_price ?? null);
    setClauses.push(`target_exit_price = $${String(params.length)}`);
  }

  if ('binance_symbol' in input) {
    params.push(input.binance_symbol ?? null);
    setClauses.push(`binance_symbol = $${String(params.length)}`);
  }

  // id siempre al final como último parámetro
  params.push(id);

  const sql = `UPDATE tokens
               SET ${setClauses.join(', ')}
               WHERE id = $${String(params.length)}
               RETURNING *`;

  const result = await pool.query<Token>(sql, params);

  if (!result.rowCount || result.rowCount === 0) {
    throw new NotFoundError(`Token '${id}' no encontrado`, 'TOKEN_NOT_FOUND');
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- UPDATE RETURNING always returns a row when rowCount > 0
  return result.rows[0]!;
}

// ─────────────────────────────────────────────────────────────────────────────
// findByContractAddress — US-007
// ─────────────────────────────────────────────────────────────────────────────

export async function findByContractAddress(
  pool: Pool,
  contractAddress: string,
  network: string,
): Promise<Token | null> {
  const result = await pool.query<Token>(
    `SELECT id, symbol, name, network, contract_address, decimals, binance_symbol,
            is_hidden, target_exit_price, created_at
       FROM tokens
      WHERE network = $1 AND lower(contract_address) = lower($2)
      LIMIT 1`,
    [network, contractAddress],
  );
  return result.rows[0] ?? null;
}
