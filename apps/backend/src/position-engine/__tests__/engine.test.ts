import { describe, it, expect } from 'vitest';
import { processTransaction, calculateWAC } from '../engine.js';
import {
  InsufficientBalanceError,
  InvalidTransactionError,
  InvalidPositionStateError,
} from '../types.js';
import type { PositionState, TransactionInput } from '../types.js';

const identity = { id: 'pos-1', walletId: 'wallet-1', tokenId: 'token-1' };
const now = new Date('2024-01-01T00:00:00Z');

function makeTx(overrides: Partial<TransactionInput> = {}): TransactionInput {
  return {
    type: 'BUY',
    amount: '10',
    priceUsd: '1',
    source: 'ETHERSCAN',
    costSource: 'MARKET',
    blockTimestamp: now,
    ...overrides,
  };
}

function makeClosedPosition(): PositionState {
  return {
    id: 'pos-1',
    walletId: 'wallet-1',
    tokenId: 'token-1',
    cycleNumber: 1,
    status: 'CLOSED',
    balance: '0.000000000000000000',
    wac: '2.000000000000000000',
    costBasis: '0.000000000000000000',
    realizedPnlUsd: '10.000000000000000000',
    openedAt: now,
    closedAt: now,
  };
}

describe('position-engine', () => {
  // Test 1 — DCA: 3 BUYs
  it('Test 1: DCA — 3 BUYs promedia WAC correctamente', () => {
    const r1 = processTransaction({
      position: null,
      priorClosedCycles: 0,
      transaction: makeTx({ type: 'BUY', amount: '10', priceUsd: '1' }),
      positionIdentity: identity,
    });
    expect(r1.positionWasOpened).toBe(true);
    expect(r1.realizedPnlDelta).toBe('0.000000000000000000');

    const r2 = processTransaction({
      position: r1.position,
      priorClosedCycles: 0,
      transaction: makeTx({ type: 'BUY', amount: '10', priceUsd: '2' }),
    });
    expect(r2.positionWasOpened).toBe(false);

    const r3 = processTransaction({
      position: r2.position,
      priorClosedCycles: 0,
      transaction: makeTx({ type: 'BUY', amount: '10', priceUsd: '3' }),
    });

    expect(r3.position.wac).toBe('2.000000000000000000');
    expect(r3.position.balance).toBe('30.000000000000000000');
    expect(r3.position.costBasis).toBe('60.000000000000000000');
    expect(r3.positionWasOpened).toBe(false);
  });

  // Test 2 — SELL parcial
  it('Test 2: SELL parcial calcula P&L y no cierra posición', () => {
    const buy = processTransaction({
      position: null,
      priorClosedCycles: 0,
      transaction: makeTx({ type: 'BUY', amount: '10', priceUsd: '2' }),
      positionIdentity: identity,
    });

    const sell = processTransaction({
      position: buy.position,
      priorClosedCycles: 0,
      transaction: makeTx({ type: 'SELL', amount: '5', priceUsd: '3' }),
    });

    expect(sell.position.wac).toBe('2.000000000000000000');
    expect(sell.position.balance).toBe('5.000000000000000000');
    expect(sell.position.costBasis).toBe('10.000000000000000000');
    expect(sell.realizedPnlDelta).toBe('5.000000000000000000');
    expect(sell.positionWasClosed).toBe(false);
  });

  // Test 3 — Ciclo completo: cierra y abre nuevo
  it('Test 3: ciclo completo — SELL total cierra y BUY abre ciclo 2', () => {
    const buy = processTransaction({
      position: null,
      priorClosedCycles: 0,
      transaction: makeTx({ type: 'BUY', amount: '10', priceUsd: '2' }),
      positionIdentity: identity,
    });

    const sell = processTransaction({
      position: buy.position,
      priorClosedCycles: 0,
      transaction: makeTx({ type: 'SELL', amount: '10', priceUsd: '3' }),
    });
    expect(sell.positionWasClosed).toBe(true);
    expect(sell.position.status).toBe('CLOSED');

    const buy2 = processTransaction({
      position: null,
      priorClosedCycles: 1,
      transaction: makeTx({ type: 'BUY', amount: '5', priceUsd: '1' }),
      positionIdentity: identity,
    });
    expect(buy2.position.cycleNumber).toBe(2);
    expect(buy2.position.wac).toBe('1.000000000000000000');
    expect(buy2.position.realizedPnlUsd).toBe('0.000000000000000000');
  });

  // Test 4 — Convert Binance (SWAP_OUT + SWAP_IN independientes)
  it('Test 4: Binance Convert — SWAP_OUT cierra USDT, SWAP_IN abre ETH', () => {
    const buyUsdt = processTransaction({
      position: null,
      priorClosedCycles: 0,
      transaction: makeTx({ type: 'BUY', amount: '100', priceUsd: '1', source: 'BINANCE' }),
      positionIdentity: { id: 'pos-usdt', walletId: 'wallet-1', tokenId: 'token-usdt' },
    });

    const swapOut = processTransaction({
      position: buyUsdt.position,
      priorClosedCycles: 0,
      transaction: makeTx({ type: 'SWAP_OUT', amount: '100', priceUsd: '1', source: 'BINANCE' }),
    });
    expect(swapOut.positionWasClosed).toBe(true);

    const swapIn = processTransaction({
      position: null,
      priorClosedCycles: 0,
      transaction: makeTx({ type: 'SWAP_IN', amount: '0.033', priceUsd: '3030', source: 'BINANCE' }),
      positionIdentity: { id: 'pos-eth', walletId: 'wallet-1', tokenId: 'token-eth' },
    });
    expect(swapIn.position.wac).toBe('3030.000000000000000000');
    expect(swapIn.position.balance).toBe('0.033000000000000000');
  });

  // Test 5 — TRANSFER_IN herencia de WAC
  it('Test 5: TRANSFER_IN actualiza WAC por promedio ponderado', () => {
    const buy = processTransaction({
      position: null,
      priorClosedCycles: 0,
      transaction: makeTx({ type: 'BUY', amount: '10', priceUsd: '2000' }),
      positionIdentity: identity,
    });

    const transfer = processTransaction({
      position: buy.position,
      priorClosedCycles: 0,
      transaction: makeTx({ type: 'TRANSFER_IN', amount: '0.5', priceUsd: '3000' }),
    });

    // wac = (10×2000 + 0.5×3000) / 10.5 = 21500 / 10.5 = 2047.619047619047619047...
    // toFixed(18, ROUND_HALF_EVEN): 19th decimal digit is '6' > 5 → round up → '2047.619047619047619048'
    expect(transfer.position.balance).toBe('10.500000000000000000');
    expect(transfer.position.wac).toBe('2047.619047619047619048');
  });

  // Test 6 — NEGATIVE: SELL > balance
  it('Test 6: SELL mayor al balance lanza InsufficientBalanceError', () => {
    const buy = processTransaction({
      position: null,
      priorClosedCycles: 0,
      transaction: makeTx({ type: 'BUY', amount: '10', priceUsd: '2' }),
      positionIdentity: identity,
    });

    let caughtErr: unknown;
    try {
      processTransaction({
        position: buy.position,
        priorClosedCycles: 0,
        transaction: makeTx({ type: 'SELL', amount: '15', priceUsd: '3' }),
      });
    } catch (err) {
      caughtErr = err;
    }

    expect(caughtErr).toBeInstanceOf(InsufficientBalanceError);
    const err = caughtErr as InsufficientBalanceError;
    expect(err.currentBalance).toBe('10.000000000000000000');
    expect(err.attempted).toBe('15');
    expect(err.name).toBe('InsufficientBalanceError');
  });

  // Test 7 — Source-agnosticism
  it('Test 7: resultado idéntico independientemente del source (ETHERSCAN vs BINANCE)', () => {
    function runDCA(source: 'ETHERSCAN' | 'BINANCE') {
      const r1 = processTransaction({
        position: null,
        priorClosedCycles: 0,
        transaction: makeTx({ type: 'BUY', amount: '10', priceUsd: '1', source }),
        positionIdentity: identity,
      });
      const r2 = processTransaction({
        position: r1.position,
        priorClosedCycles: 0,
        transaction: makeTx({ type: 'BUY', amount: '10', priceUsd: '2', source }),
      });
      const r3 = processTransaction({
        position: r2.position,
        priorClosedCycles: 0,
        transaction: makeTx({ type: 'BUY', amount: '10', priceUsd: '3', source }),
      });
      return r3.position;
    }

    const etherscanPos = runDCA('ETHERSCAN');
    const binancePos = runDCA('BINANCE');

    expect(etherscanPos.wac).toBe(binancePos.wac);
    expect(etherscanPos.balance).toBe(binancePos.balance);
    expect(etherscanPos.costBasis).toBe(binancePos.costBasis);
    expect(etherscanPos.realizedPnlUsd).toBe(binancePos.realizedPnlUsd);
  });

  // Test 8 — NEGATIVE: posición CLOSED pasada como input
  it('Test 8: posición con status CLOSED lanza InvalidPositionStateError', () => {
    expect(() =>
      processTransaction({
        position: makeClosedPosition(),
        priorClosedCycles: 1,
        transaction: makeTx({ type: 'BUY', amount: '5', priceUsd: '1' }),
      })
    ).toThrow(InvalidPositionStateError);
  });

  // Test 9 — NEGATIVE: SELL sin posición
  it('Test 9: SELL con position=null lanza InvalidTransactionError', () => {
    expect(() =>
      processTransaction({
        position: null,
        priorClosedCycles: 0,
        transaction: makeTx({ type: 'SELL', amount: '5', priceUsd: '3' }),
        positionIdentity: identity,
      })
    ).toThrow(InvalidTransactionError);
  });

  // Test 10 — NEGATIVE: SELL con priceUsd=null
  it('Test 10: SELL con priceUsd=null lanza InvalidTransactionError', () => {
    const buy = processTransaction({
      position: null,
      priorClosedCycles: 0,
      transaction: makeTx({ type: 'BUY', amount: '10', priceUsd: '2' }),
      positionIdentity: identity,
    });

    expect(() =>
      processTransaction({
        position: buy.position,
        priorClosedCycles: 0,
        transaction: makeTx({ type: 'SELL', amount: '5', priceUsd: null }),
      })
    ).toThrow(InvalidTransactionError);
  });

  // Test 11 — TRANSFER_OUT con priceUsd=null (permitido)
  it('Test 11: TRANSFER_OUT con priceUsd=null no lanza y realizedPnlDelta=0', () => {
    const buy = processTransaction({
      position: null,
      priorClosedCycles: 0,
      transaction: makeTx({ type: 'BUY', amount: '10', priceUsd: '2' }),
      positionIdentity: identity,
    });

    const transfer = processTransaction({
      position: buy.position,
      priorClosedCycles: 0,
      transaction: makeTx({ type: 'TRANSFER_OUT', amount: '2', priceUsd: null }),
    });

    expect(transfer.position.balance).toBe('8.000000000000000000');
    expect(transfer.position.wac).toBe('2.000000000000000000');
    expect(transfer.realizedPnlDelta).toBe('0.000000000000000000');
  });

  // Test 12 — Flags positionWasOpened/positionWasClosed para BUY sobre OPEN
  it('Test 12: BUY sobre posición OPEN — positionWasOpened=false, positionWasClosed=false', () => {
    const r1 = processTransaction({
      position: null,
      priorClosedCycles: 0,
      transaction: makeTx({ type: 'BUY', amount: '10', priceUsd: '2' }),
      positionIdentity: identity,
    });

    const r2 = processTransaction({
      position: r1.position,
      priorClosedCycles: 0,
      transaction: makeTx({ type: 'BUY', amount: '5', priceUsd: '2' }),
    });

    expect(r2.positionWasOpened).toBe(false);
    expect(r2.positionWasClosed).toBe(false);
  });

  // Test 13 — calculateWAC sin precio actual
  it('Test 13: calculateWAC sin precio actual retorna unrealized=null', () => {
    const position: PositionState = {
      id: 'pos-1',
      walletId: 'wallet-1',
      tokenId: 'token-1',
      cycleNumber: 1,
      status: 'OPEN',
      balance: '10.000000000000000000',
      wac: '2.000000000000000000',
      costBasis: '20.000000000000000000',
      realizedPnlUsd: '0.000000000000000000',
      openedAt: now,
      closedAt: null,
    };

    const result = calculateWAC(position);
    expect(result.unrealizedPnlUsd).toBeNull();
    expect(result.unrealizedPnlPct).toBeNull();
    expect(result.wac).toBe('2.000000000000000000');
    expect(result.balance).toBe('10.000000000000000000');
    expect(result.costBasis).toBe('20.000000000000000000');
  });

  // Test 14 — calculateWAC con precio actual
  it('Test 14: calculateWAC con precio actual calcula unrealized correctamente', () => {
    const position: PositionState = {
      id: 'pos-1',
      walletId: 'wallet-1',
      tokenId: 'token-1',
      cycleNumber: 1,
      status: 'OPEN',
      balance: '10.000000000000000000',
      wac: '2.000000000000000000',
      costBasis: '20.000000000000000000',
      realizedPnlUsd: '0.000000000000000000',
      openedAt: now,
      closedAt: null,
    };

    const result = calculateWAC(position, '3');
    expect(result.unrealizedPnlUsd).toBe('10.000000000000000000');
    expect(result.unrealizedPnlPct).toBe('50.000000000000000000');
  });

  // Test 15 — Primera apertura positionWasOpened=true
  it('Test 15: primera apertura de posición tiene positionWasOpened=true', () => {
    const result = processTransaction({
      position: null,
      priorClosedCycles: 0,
      transaction: makeTx({ type: 'BUY', amount: '5', priceUsd: '100' }),
      positionIdentity: identity,
    });

    expect(result.positionWasOpened).toBe(true);
  });
});
