// T15-T20 — Classification and decomposition tests (engine project, no DB)
// Written BEFORE implementation (TDD Red phase).

import { describe, it, expect } from 'vitest';
import type { NormalizedTx, NormalizedTokenTx } from '../clients/on-chain-api.js';
import { groupByTxHash, classifyAndDecomposeTransaction } from '../classify.js';
import { SWAP_ROUTERS } from '../constants/routers.js';

const WALLET = '0xabcdef0000000000000000000000000000000001';
const ETH_ROUTER = [...SWAP_ROUTERS.ETH][0]!; // pick first router address
const EOA = '0x1234567890abcdef1234567890abcdef12345678';
const CONTRACT = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
const TOKEN_CONTRACT = '0x6b175474e89094c44da98b954eedeac495271d0f'; // DAI

function makeTx(overrides: Partial<NormalizedTx>): NormalizedTx {
  return {
    txHash: '0xaaaa',
    blockNumber: 100,
    transactionIndex: 0,
    timeStamp: 1700000000,
    from: WALLET,
    to: EOA,
    value: '0',
    isError: '0',
    gasUsed: '21000',
    ...overrides,
  };
}

function makeTokenTx(overrides: Partial<NormalizedTokenTx>): NormalizedTokenTx {
  return {
    txHash: '0xbbbb',
    blockNumber: 101,
    transactionIndex: 0,
    logIndex: 0,
    timeStamp: 1700000001,
    from: WALLET,
    to: CONTRACT,
    contractAddress: TOKEN_CONTRACT,
    tokenSymbol: 'DAI',
    tokenName: 'Dai Stablecoin',
    tokenDecimal: 18,
    value: '1000000000000000000',
    ...overrides,
  };
}

// ─── T15: groupByTxHash ───────────────────────────────────────────────────────

describe('groupByTxHash', () => {
  it('groups normal + token txs by hash, sorts tokenTxs by logIndex ASC', () => {
    const normal1 = makeTx({ txHash: '0xhash1', blockNumber: 100 });
    const normal2 = makeTx({ txHash: '0xhash2', blockNumber: 101 });
    const normal3 = makeTx({ txHash: '0xhash3', blockNumber: 102 });

    // tokenTxs for hash1 with logIndex out of order
    const token1a = makeTokenTx({ txHash: '0xhash1', logIndex: 2 });
    const token1b = makeTokenTx({ txHash: '0xhash1', logIndex: 0 });

    const groups = groupByTxHash([normal1, normal2, normal3], [token1a, token1b]);

    expect(groups).toHaveLength(3);

    // Find the group for hash1
    const group1 = groups.find((g) => g.txHash === '0xhash1');
    expect(group1).toBeDefined();
    expect(group1!.tokenTxs).toHaveLength(2);

    // tokenTxs sorted by logIndex ASC
    expect(group1!.tokenTxs[0]!.logIndex).toBe(0);
    expect(group1!.tokenTxs[1]!.logIndex).toBe(2);
  });

  it('handles tokenTxs with no corresponding normal tx', () => {
    const tokenOnly = makeTokenTx({ txHash: '0xtoken-only' });
    const groups = groupByTxHash([], [tokenOnly]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.normalTx).toBeNull();
  });
});

// ─── T16: native ETH transfer → TRANSFER_IN ──────────────────────────────────

describe('classifyAndDecomposeTransaction — TRANSFER_IN', () => {
  it('T16: native ETH transfer to wallet (counterparty is EOA) → 1 TRANSFER_IN row', () => {
    const normalTx = makeTx({
      txHash: '0xtransfer',
      to: WALLET,
      from: EOA,
      value: '1000000000000000000',
      isError: '0',
    });
    const group = groupByTxHash([normalTx], []);
    const result = classifyAndDecomposeTransaction(group[0]!, WALLET, 'ETH');

    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('TRANSFER_IN');
    expect(result[0]!.txLogIndex).toBe(0);
    expect(result[0]!.relatedTxId).toBeNull();
  });
});

// ─── T17: token BUY (from wallet to contract) ────────────────────────────────

describe('classifyAndDecomposeTransaction — BUY/SELL', () => {
  it('T17: token transfer FROM wallet to contract → SELL', () => {
    const tokenTx = makeTokenTx({
      txHash: '0xsell',
      from: WALLET,
      to: CONTRACT,
    });
    const group = groupByTxHash([], [tokenTx]);
    const result = classifyAndDecomposeTransaction(group[0]!, WALLET, 'ETH');

    expect(result).toHaveLength(1);
    // from=wallet, to=contract → outbound
    expect(result[0]!.type).toBe('SELL');
    expect(result[0]!.txLogIndex).toBe(0);
  });

  it('token transfer from contract TO wallet → BUY', () => {
    const tokenTx = makeTokenTx({
      txHash: '0xbuy',
      from: CONTRACT,
      to: WALLET,
    });
    const group = groupByTxHash([], [tokenTx]);
    const result = classifyAndDecomposeTransaction(group[0]!, WALLET, 'ETH');

    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('BUY');
  });
});

// ─── T18: SWAP via router (native → token) → SWAP_OUT + SWAP_IN ──────────────

describe('classifyAndDecomposeTransaction — SWAP via router', () => {
  it('T18: native→token swap: normalTx.to=router + tokenTx.to=wallet → 2 rows SWAP_OUT+SWAP_IN', () => {
    const normalTx = makeTx({
      txHash: '0xswap1',
      from: WALLET,
      to: ETH_ROUTER,
      value: '1000000000000000000',
    });
    const tokenTx = makeTokenTx({
      txHash: '0xswap1',
      from: ETH_ROUTER,
      to: WALLET,
      logIndex: 1,
    });

    const groups = groupByTxHash([normalTx], [tokenTx]);
    const result = classifyAndDecomposeTransaction(groups[0]!, WALLET, 'ETH');

    expect(result).toHaveLength(2);

    const out = result.find((r) => r.type === 'SWAP_OUT');
    const inLeg = result.find((r) => r.type === 'SWAP_IN');

    expect(out).toBeDefined();
    expect(inLeg).toBeDefined();
    expect(out!.txLogIndex).toBe(0);
    expect(inLeg!.txLogIndex).toBe(1);

    // Cross-linked relatedTxId
    expect(out!.relatedTxId).toBe(inLeg!.id);
    expect(inLeg!.relatedTxId).toBe(out!.id);
  });
});

// ─── T19: token-to-token swap → 2 rows ───────────────────────────────────────

describe('classifyAndDecomposeTransaction — token-to-token SWAP', () => {
  it('T19: 2 tokenTxs same hash, one through router → SWAP_OUT + SWAP_IN', () => {
    const tokenOut = makeTokenTx({
      txHash: '0xswap2',
      from: WALLET,
      to: ETH_ROUTER,
      logIndex: 0,
      tokenSymbol: 'DAI',
    });
    const tokenIn = makeTokenTx({
      txHash: '0xswap2',
      from: ETH_ROUTER,
      to: WALLET,
      logIndex: 1,
      tokenSymbol: 'USDC',
      contractAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    });

    const groups = groupByTxHash([], [tokenOut, tokenIn]);
    const result = classifyAndDecomposeTransaction(groups[0]!, WALLET, 'ETH');

    expect(result).toHaveLength(2);

    const out = result.find((r) => r.type === 'SWAP_OUT');
    const inLeg = result.find((r) => r.type === 'SWAP_IN');

    expect(out).toBeDefined();
    expect(inLeg).toBeDefined();

    // Cross-linked
    expect(out!.relatedTxId).toBe(inLeg!.id);
    expect(inLeg!.relatedTxId).toBe(out!.id);

    // Lower logIndex is OUT
    expect(out!.txLogIndex).toBe(0);
    expect(inLeg!.txLogIndex).toBe(1);
  });
});

// ─── T20: isError=1 → returns [] ─────────────────────────────────────────────

describe('classifyAndDecomposeTransaction — isError=1', () => {
  it('T20: normalTx with isError=1 → returns empty array', () => {
    const normalTx = makeTx({
      txHash: '0xfailed',
      isError: '1',
      value: '1000000000000000000',
    });
    const group = groupByTxHash([normalTx], []);
    const result = classifyAndDecomposeTransaction(group[0]!, WALLET, 'ETH');

    expect(result).toEqual([]);
  });
});
