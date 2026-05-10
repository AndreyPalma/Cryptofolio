import { describe, it, expect } from 'vitest';
import { processTransaction } from '../src/position-engine/engine.js';
import { isInbound, isOutbound } from '../src/position-engine/decimal-utils.js';
import {
  InsufficientBalanceError,
  InvalidTransactionError,
} from '../src/position-engine/types.js';
import type { PositionState, TransactionInput } from '../src/position-engine/types.js';

const identity = { id: 'pos-fiat-1', walletId: 'wallet-fiat', tokenId: 'token-fiat' };
const now = new Date('2024-06-01T00:00:00Z');

/**
 * Helper que construye un TransactionInput.
 * `type` se castea a `any` para poder usar 'FIAT_IN' / 'FIAT_OUT' en fase RED,
 * antes de que esos valores existan en TransactionType.
 */
function makeTx(
  overrides: Partial<Omit<TransactionInput, 'type'>> & { type?: any } = {},
): TransactionInput {
  return {
    // as any permite compilar con 'FIAT_IN'/'FIAT_OUT' aunque no estén en TransactionType todavía
    type: ('FIAT_IN' as any),
    amount: '100',
    priceUsd: '1',
    source: 'BINANCE',
    costSource: 'MARKET',
    blockTimestamp: now,
    ...overrides,
  } as TransactionInput;
}

function makeOpenPosition(overrides: Partial<PositionState> = {}): PositionState {
  return {
    id: 'pos-fiat-1',
    walletId: 'wallet-fiat',
    tokenId: 'token-fiat',
    cycleNumber: 1,
    status: 'OPEN',
    balance: '100.000000000000000000',
    wac: '1.000000000000000000',
    costBasis: '100.000000000000000000',
    realizedPnlUsd: '0.000000000000000000',
    openedAt: now,
    closedAt: null,
    ...overrides,
  };
}

describe('position engine — FIAT_IN / FIAT_OUT', () => {
  // ─── Clasificación de tipos ──────────────────────────────────────────────

  describe('clasificación de tipos', () => {
    it('FIAT_IN → isInbound=true (REQ-003)', () => {
      // RED: isInbound no maneja 'FIAT_IN' todavía → retorna false → falla
      expect(isInbound('FIAT_IN' as any)).toBe(true);
    });

    it('FIAT_IN → isOutbound=false (REQ-003)', () => {
      expect(isOutbound('FIAT_IN' as any)).toBe(false);
    });

    it('FIAT_OUT → isInbound=false (REQ-003)', () => {
      expect(isInbound('FIAT_OUT' as any)).toBe(false);
    });

    it('FIAT_OUT → isOutbound=true (REQ-003)', () => {
      // RED: isOutbound no maneja 'FIAT_OUT' todavía → retorna false → falla
      expect(isOutbound('FIAT_OUT' as any)).toBe(true);
    });

    it('tipos existentes no regresionan — BUY, SELL, SWAP_IN, SWAP_OUT, TRANSFER_IN, TRANSFER_OUT', () => {
      expect(isInbound('BUY')).toBe(true);
      expect(isInbound('SWAP_IN')).toBe(true);
      expect(isInbound('TRANSFER_IN')).toBe(true);
      expect(isOutbound('SELL')).toBe(true);
      expect(isOutbound('SWAP_OUT')).toBe(true);
      expect(isOutbound('TRANSFER_OUT')).toBe(true);

      expect(isOutbound('BUY')).toBe(false);
      expect(isInbound('SELL')).toBe(false);
    });
  });

  // ─── FIAT_IN sobre posición vacía ────────────────────────────────────────

  it('FIAT_IN sobre posición vacía: balance=100, wac=1, pnl=0, status=OPEN (REQ-004)', () => {
    // RED: processTransaction → assertNever para tipo no reconocido → lanza Error
    const result = processTransaction({
      position: null,
      priorClosedCycles: 0,
      transaction: makeTx({ type: 'FIAT_IN' as any, amount: '100', priceUsd: '1' }),
      positionIdentity: identity,
    });

    expect(result.positionWasOpened).toBe(true);
    expect(result.positionWasClosed).toBe(false);
    expect(result.position.status).toBe('OPEN');
    expect(result.position.balance).toBe('100.000000000000000000');
    expect(result.position.wac).toBe('1.000000000000000000');
    expect(result.position.realizedPnlUsd).toBe('0.000000000000000000');
  });

  // ─── FIAT_IN sobre posición existente — WAC ponderado ───────────────────

  it('FIAT_IN sobre posición existente: WAC ponderado correcto (REQ-004)', () => {
    // Posición previa: 100 unidades a $1 WAC
    const existing = makeOpenPosition();

    // FIAT_IN de 100 unidades a $2 → nuevo WAC = (100×1 + 100×2) / 200 = 1.5
    const result = processTransaction({
      position: existing,
      priorClosedCycles: 0,
      transaction: makeTx({ type: 'FIAT_IN' as any, amount: '100', priceUsd: '2' }),
    });

    expect(result.positionWasOpened).toBe(false);
    expect(result.positionWasClosed).toBe(false);
    expect(result.position.balance).toBe('200.000000000000000000');
    expect(result.position.wac).toBe('1.500000000000000000');
  });

  // ─── FIAT_OUT — reduce balance y genera P&L ──────────────────────────────

  it('FIAT_OUT reduce balance y genera P&L: (priceUsd - WAC) × amount (REQ-004)', () => {
    // Posición: 100 unidades a $1 WAC
    const existing = makeOpenPosition();

    // FIAT_OUT de 50 unidades a $3 → P&L = (3 - 1) × 50 = 100
    const result = processTransaction({
      position: existing,
      priorClosedCycles: 0,
      transaction: makeTx({ type: 'FIAT_OUT' as any, amount: '50', priceUsd: '3' }),
    });

    expect(result.positionWasClosed).toBe(false);
    expect(result.position.balance).toBe('50.000000000000000000');
    expect(result.position.wac).toBe('1.000000000000000000');
    expect(result.realizedPnlDelta).toBe('100.000000000000000000');
  });

  // ─── FIAT_OUT cierra posición cuando balance llega a cero ────────────────

  it('FIAT_OUT cierra posición cuando balance llega a cero (REQ-004)', () => {
    const existing = makeOpenPosition();

    // Venta total
    const result = processTransaction({
      position: existing,
      priorClosedCycles: 0,
      transaction: makeTx({ type: 'FIAT_OUT' as any, amount: '100', priceUsd: '2' }),
    });

    expect(result.positionWasClosed).toBe(true);
    expect(result.position.status).toBe('CLOSED');
    expect(result.position.balance).toBe('0.000000000000000000');
    // P&L = (2 - 1) × 100 = 100
    expect(result.realizedPnlDelta).toBe('100.000000000000000000');
  });

  // ─── NEGATIVE: FIAT_OUT con balance insuficiente ─────────────────────────

  it('NEGATIVE: FIAT_OUT con balance insuficiente → InsufficientBalanceError (NEGATIVE-003)', () => {
    const existing = makeOpenPosition(); // balance = 100

    let caughtErr: unknown;
    try {
      processTransaction({
        position: existing,
        priorClosedCycles: 0,
        transaction: makeTx({ type: 'FIAT_OUT' as any, amount: '999', priceUsd: '2' }),
      });
    } catch (err) {
      caughtErr = err;
    }

    expect(caughtErr).toBeInstanceOf(InsufficientBalanceError);
    const err = caughtErr as InsufficientBalanceError;
    expect(err.name).toBe('InsufficientBalanceError');
    expect(err.attempted).toBe('999');
  });

  // ─── NEGATIVE: FIAT_IN sin priceUsd ──────────────────────────────────────

  it('NEGATIVE: FIAT_IN sin priceUsd → InvalidTransactionError (NEGATIVE-005)', () => {
    let caughtErr: unknown;
    try {
      processTransaction({
        position: null,
        priorClosedCycles: 0,
        transaction: makeTx({ type: 'FIAT_IN' as any, amount: '100', priceUsd: null }),
        positionIdentity: identity,
      });
    } catch (err) {
      caughtErr = err;
    }

    expect(caughtErr).toBeInstanceOf(InvalidTransactionError);
    const err = caughtErr as InvalidTransactionError;
    expect(err.name).toBe('InvalidTransactionError');
    expect(err.reason).toBe('INBOUND_REQUIRES_PRICE');
  });
});
