// classify.ts — groupByTxHash + classifyAndDecomposeTransaction (pure)
// US-008-A
// No DB imports — lives in the 'engine' vitest project.

import type { NormalizedTx, NormalizedTokenTx } from './clients/on-chain-api.js';
import type { TransactionType, TransactionSource } from '../db/types.js';
import { SWAP_ROUTERS } from './constants/routers.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** All raw rows that share a tx_hash, collected together. */
export interface TxGroup {
  readonly txHash: string;
  readonly blockNumber: number;
  readonly transactionIndex: number;
  readonly timeStamp: number;
  readonly normalTx: NormalizedTx | null;
  readonly tokenTxs: readonly NormalizedTokenTx[];
}

/** A row that is ready to be persisted. Pre-classified and pre-decomposed.
 *  tx_log_index 0/1 for swaps, 0 for everything else. */
export interface DecomposedTransaction {
  readonly id: string;                      // uuid pre-generated so swap legs cross-link
  readonly type: TransactionType;
  readonly txHash: string;
  readonly txLogIndex: number;
  readonly relatedTxId: string | null;
  readonly blockNumber: number;
  readonly transactionIndex: number;
  readonly blockTimestamp: Date;
  readonly fromAddress: string;
  readonly toAddress: string;
  readonly tokenContract: string | null;    // null for native ETH/BNB
  readonly tokenSymbol: string;
  readonly tokenDecimals: number;
  readonly amount: string;                  // human-readable decimal (de-scaled)
  readonly source: Extract<TransactionSource, 'ETHERSCAN' | 'BSCTRACE'>;
}

// ─── Native pseudo-addresses (used when there is no token contract) ───────────
const NATIVE_SYMBOL: Record<'ETH' | 'BSC', string> = {
  ETH: 'ETH',
  BSC: 'BNB',
};

// ─── groupByTxHash ────────────────────────────────────────────────────────────

export function groupByTxHash(
  normalTxs: readonly NormalizedTx[],
  tokenTxs: readonly NormalizedTokenTx[],
): TxGroup[] {
  const map = new Map<string, { normal: NormalizedTx | null; tokens: NormalizedTokenTx[] }>();

  for (const t of normalTxs) {
    map.set(t.txHash, { normal: t, tokens: [] });
  }

  for (const t of tokenTxs) {
    const existing = map.get(t.txHash);
    if (existing) {
      existing.tokens.push(t);
    } else {
      map.set(t.txHash, { normal: null, tokens: [t] });
    }
  }

  const out: TxGroup[] = [];
  for (const [txHash, { normal, tokens }] of map) {
    const firstToken = tokens[0];
    out.push({
      txHash,
      blockNumber: normal?.blockNumber ?? firstToken?.blockNumber ?? 0,
      transactionIndex: normal?.transactionIndex ?? firstToken?.transactionIndex ?? 0,
      timeStamp: normal?.timeStamp ?? firstToken?.timeStamp ?? 0,
      normalTx: normal,
      tokenTxs: tokens.slice().sort((a, b) => a.logIndex - b.logIndex),
    });
  }

  return out.sort(
    (a, b) => a.blockNumber - b.blockNumber || a.transactionIndex - b.transactionIndex,
  );
}

// ─── classifyAndDecomposeTransaction ─────────────────────────────────────────

export function classifyAndDecomposeTransaction(
  group: TxGroup,
  walletAddress: string,
  network: 'ETH' | 'BSC',
): DecomposedTransaction[] {
  const wallet = walletAddress.toLowerCase();
  const routers = SWAP_ROUTERS[network];
  const source: Extract<TransactionSource, 'ETHERSCAN' | 'BSCTRACE'> =
    network === 'ETH' ? 'ETHERSCAN' : 'BSCTRACE';
  const baseTs = new Date(group.timeStamp * 1000);

  // Skip failed transactions
  if (group.normalTx?.isError === '1') {
    return [];
  }

  // ── SWAP detection ──────────────────────────────────────────────────────────
  const normalInvolvesRouter =
    group.normalTx &&
    (routers.has(group.normalTx.to.toLowerCase()) ||
      routers.has(group.normalTx.from.toLowerCase()));

  const tokenInvolvesRouter = group.tokenTxs.some(
    (t) => routers.has(t.from.toLowerCase()) || routers.has(t.to.toLowerCase()),
  );

  const involvesRouter = normalInvolvesRouter ?? tokenInvolvesRouter;

  if (involvesRouter) {
    return decomposeSwap(group, wallet, network, source, baseTs);
  }

  // ── Token transfers (BUY / SELL / TRANSFER_IN / TRANSFER_OUT) ──────────────
  if (group.tokenTxs.length >= 1) {
    return group.tokenTxs.map((tt) => decodeTokenLeg(tt, wallet, source, baseTs));
  }

  // ── Native ETH/BNB transfer ──────────────────────────────────────────────────
  if (group.normalTx && group.normalTx.value !== '0' && group.normalTx.isError === '0') {
    return [decodeNativeLeg(group.normalTx, wallet, network, source, baseTs)];
  }

  return [];
}

// ─── Swap decomposition ───────────────────────────────────────────────────────

function decomposeSwap(
  group: TxGroup,
  wallet: string,
  network: 'ETH' | 'BSC',
  source: Extract<TransactionSource, 'ETHERSCAN' | 'BSCTRACE'>,
  baseTs: Date,
): DecomposedTransaction[] {
  const routers = SWAP_ROUTERS[network];

  // Generate two UUIDs upfront so legs can cross-link
  const outId = crypto.randomUUID();
  const inId = crypto.randomUUID();

  // ── Token-to-token swap: both legs are in tokenTxs ─────────────────────────
  if (group.tokenTxs.length >= 2) {
    // Sort by logIndex ASC — lower = OUT, higher = IN
    const sorted = group.tokenTxs.slice().sort((a, b) => a.logIndex - b.logIndex);
    const outLeg = sorted[0]!;
    const inLeg = sorted[sorted.length - 1]!;

    const out = makeDecomposedTokenTx(
      outLeg, 'SWAP_OUT', outId, 0, inId, source, baseTs,
    );
    const inT = makeDecomposedTokenTx(
      inLeg, 'SWAP_IN', inId, 1, outId, source, baseTs,
    );
    return [out, inT];
  }

  // ── Native → token swap: normalTx is the OUT leg ───────────────────────────
  if (group.normalTx && group.tokenTxs.length >= 1) {
    const nTx = group.normalTx;
    const tTx = group.tokenTxs[0]!;

    const isNativeOut = nTx.from.toLowerCase() === wallet;

    if (isNativeOut) {
      // SWAP_OUT = native, SWAP_IN = token received
      const amountOut = scaleDown(nTx.value, 18); // native = 18 decimals
      const out: DecomposedTransaction = {
        id: outId,
        type: 'SWAP_OUT',
        txHash: nTx.txHash,
        txLogIndex: 0,
        relatedTxId: inId,
        blockNumber: nTx.blockNumber,
        transactionIndex: nTx.transactionIndex,
        blockTimestamp: baseTs,
        fromAddress: nTx.from,
        toAddress: nTx.to,
        tokenContract: null,
        tokenSymbol: NATIVE_SYMBOL[network],
        tokenDecimals: 18,
        amount: amountOut,
        source,
      };
      const inT = makeDecomposedTokenTx(tTx, 'SWAP_IN', inId, 1, outId, source, baseTs);
      return [out, inT];
    }

    // SWAP_IN = native received, SWAP_OUT = token sent
    const amountIn = scaleDown(nTx.value, 18);
    const out = makeDecomposedTokenTx(tTx, 'SWAP_OUT', outId, 0, inId, source, baseTs);
    const inT: DecomposedTransaction = {
      id: inId,
      type: 'SWAP_IN',
      txHash: nTx.txHash,
      txLogIndex: 1,
      relatedTxId: outId,
      blockNumber: nTx.blockNumber,
      transactionIndex: nTx.transactionIndex,
      blockTimestamp: baseTs,
      fromAddress: nTx.from,
      toAddress: nTx.to,
      tokenContract: null,
      tokenSymbol: NATIVE_SYMBOL[network],
      tokenDecimals: 18,
      amount: amountIn,
      source,
    };
    return [out, inT];
  }

  // Fallback: only a router call with no token transfers — skip
  return [];
}

// ─── Per-leg helpers ──────────────────────────────────────────────────────────

function makeDecomposedTokenTx(
  tt: NormalizedTokenTx,
  type: TransactionType,
  id: string,
  txLogIndex: number,
  relatedTxId: string | null,
  source: Extract<TransactionSource, 'ETHERSCAN' | 'BSCTRACE'>,
  baseTs: Date,
): DecomposedTransaction {
  return {
    id,
    type,
    txHash: tt.txHash,
    txLogIndex,
    relatedTxId,
    blockNumber: tt.blockNumber,
    transactionIndex: tt.transactionIndex,
    blockTimestamp: baseTs,
    fromAddress: tt.from,
    toAddress: tt.to,
    tokenContract: tt.contractAddress,
    tokenSymbol: tt.tokenSymbol,
    tokenDecimals: tt.tokenDecimal,
    amount: scaleDown(tt.value, tt.tokenDecimal),
    source,
  };
}

function decodeTokenLeg(
  tt: NormalizedTokenTx,
  wallet: string,
  source: Extract<TransactionSource, 'ETHERSCAN' | 'BSCTRACE'>,
  baseTs: Date,
): DecomposedTransaction {
  const isOutbound = tt.from.toLowerCase() === wallet;
  const type: TransactionType = isOutbound ? 'SELL' : 'BUY';

  return makeDecomposedTokenTx(tt, type, crypto.randomUUID(), 0, null, source, baseTs);
}

function decodeNativeLeg(
  tx: NormalizedTx,
  wallet: string,
  network: 'ETH' | 'BSC',
  source: Extract<TransactionSource, 'ETHERSCAN' | 'BSCTRACE'>,
  baseTs: Date,
): DecomposedTransaction {
  const isOutbound = tx.from.toLowerCase() === wallet;
  const type: TransactionType = isOutbound ? 'TRANSFER_OUT' : 'TRANSFER_IN';

  return {
    id: crypto.randomUUID(),
    type,
    txHash: tx.txHash,
    txLogIndex: 0,
    relatedTxId: null,
    blockNumber: tx.blockNumber,
    transactionIndex: tx.transactionIndex,
    blockTimestamp: baseTs,
    fromAddress: tx.from,
    toAddress: tx.to,
    tokenContract: null,
    tokenSymbol: NATIVE_SYMBOL[network],
    tokenDecimals: 18,
    amount: scaleDown(tx.value, 18),
    source,
  };
}

// ─── Decimal scaling ──────────────────────────────────────────────────────────

/** Convert a raw uint256 token amount (string) to a human-readable decimal string.
 *  Uses integer arithmetic to avoid float precision issues for small decimals. */
function scaleDown(raw: string, decimals: number): string {
  if (decimals === 0) return raw;
  const n = BigInt(raw);
  const divisor = 10n ** BigInt(decimals);
  const whole = n / divisor;
  const frac = n % divisor;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole.toString()}.${fracStr}`;
}
