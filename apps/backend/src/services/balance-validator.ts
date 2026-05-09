// balance-validator.ts — US-012 A7
// BalanceValidatorService: compara balances del motor vs snapshot Binance.
// Cache en memoria 60s por userId.

import { Decimal } from 'decimal.js';
import type { Pool } from 'pg';
import type { BinanceApiClient } from '../sync/clients/binance-api.js';
import { NotFoundError } from './errors.js';
import type { BalanceDifference } from '../schemas/balance-validation.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ValidationResult {
  differences: BalanceDifference[];
  totalEngineUsd: string;
  totalSnapshotUsd: string;
  takenAt: string;
  dustNote: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DUST_THRESHOLD = new Decimal('0.00000001');
const CACHE_TTL_MS = 60_000;
const DUST_NOTE = 'Small differences are expected due to Binance dust conversion (non-goal in V1).';

// ─── In-memory cache ──────────────────────────────────────────────────────────

type CacheEntry = {
  snapshot: Array<{ asset: string; free: string; locked: string }>;
  expiresAt: number;
};

const snapshotCache = new Map<string, CacheEntry>();

// ─── BalanceValidatorService ──────────────────────────────────────────────────

export class BalanceValidatorService {
  constructor(
    private readonly pool: Pool,
    private readonly binanceClient: BinanceApiClient,
  ) {}

  async validate(userId: string): Promise<ValidationResult> {
    // 1. Verify CEX_BINANCE wallet exists for the user
    const walletResult = await this.pool.query<{ id: string }>(
      `SELECT id FROM wallets WHERE user_id = $1 AND wallet_type = 'CEX' AND network = 'CEX_BINANCE' LIMIT 1`,
      [userId],
    );

    if (!walletResult.rows[0]) {
      throw new NotFoundError('No Binance wallet configured', 'NO_CEX_WALLET');
    }

    // 2. Get Binance snapshot — check cache first
    const cached = snapshotCache.get(userId);
    let snapshotAssets: Array<{ asset: string; free: string; locked: string }>;

    if (cached && cached.expiresAt > Date.now()) {
      snapshotAssets = cached.snapshot;
    } else {
      snapshotAssets = await this.binanceClient.getAccountAssets();
      snapshotCache.set(userId, {
        snapshot: snapshotAssets,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
    }

    // 3. Load engine balances for CEX positions
    const engineResult = await this.pool.query<{ asset: string; balance: string }>(
      `SELECT tk.symbol AS asset, SUM(p.balance) AS balance
         FROM positions p
         JOIN tokens tk ON tk.id = p.token_id
         JOIN wallets w ON w.id = p.wallet_id
        WHERE w.wallet_type = 'CEX'
          AND w.user_id = $1
          AND p.status = 'OPEN'
        GROUP BY tk.symbol`,
      [userId],
    );

    const engineByAsset = new Map<string, Decimal>();
    for (const row of engineResult.rows) {
      engineByAsset.set(row.asset.toUpperCase(), new Decimal(row.balance));
    }

    // 4. Build snapshot map
    const snapshotByAsset = new Map<string, Decimal>();
    for (const item of snapshotAssets) {
      const total = new Decimal(item.free).plus(new Decimal(item.locked));
      if (total.gt(0)) {
        snapshotByAsset.set(item.asset.toUpperCase(), total);
      }
    }

    // 5. Outer-join and compute differences
    const allAssets = new Set([...engineByAsset.keys(), ...snapshotByAsset.keys()]);
    const differences: BalanceDifference[] = [];

    for (const asset of allAssets) {
      const engineBalance = engineByAsset.get(asset) ?? new Decimal(0);
      const snapshotBalance = snapshotByAsset.get(asset) ?? new Decimal(0);
      const diff = engineBalance.minus(snapshotBalance);

      // Filter noise below threshold
      if (diff.abs().lt(DUST_THRESHOLD)) {
        continue;
      }

      differences.push({
        asset,
        engineBalance: engineBalance.toFixed(8),
        snapshotBalance: snapshotBalance.toFixed(8),
        diff: diff.toFixed(8),
      });
    }

    return {
      differences,
      totalEngineUsd: '0', // Price lookup out of scope for V1 — placeholder
      totalSnapshotUsd: '0',
      takenAt: new Date().toISOString(),
      dustNote: DUST_NOTE,
    };
  }

  /** Clear cache for a user (for testing). */
  clearCache(userId: string): void {
    snapshotCache.delete(userId);
  }
}
