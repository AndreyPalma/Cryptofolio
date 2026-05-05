import {
  type PositionState,
  type TransactionInput,
  type ProcessTransactionInput,
  type PositionEngineResult,
  type WACResult,
  type DecimalString,
  InsufficientBalanceError,
  InvalidTransactionError,
  InvalidPositionStateError,
} from './types.js';
import { ZERO, toDecimal, roundToStorage, isInbound, isOutbound } from './decimal-utils.js';

function assertNever(x: never): never {
  throw new Error('Unhandled transaction type: ' + String(x));
}

function openNewCycle(input: ProcessTransactionInput): PositionEngineResult {
  const tx = input.transaction;

  const identity = input.positionIdentity;
  if (!identity) {
    throw new InvalidTransactionError({
      reason: 'MISSING_POSITION_IDENTITY',
      context: { type: tx.type },
    });
  }

  if (tx.priceUsd === null) {
    throw new InvalidTransactionError({
      reason: 'INBOUND_REQUIRES_PRICE',
      context: { type: tx.type },
    });
  }

  const amount = toDecimal(tx.amount);
  const price = toDecimal(tx.priceUsd);

  const newPosition: PositionState = {
    id: identity.id,
    walletId: identity.walletId,
    tokenId: identity.tokenId,
    cycleNumber: input.priorClosedCycles + 1,
    status: 'OPEN',
    balance: roundToStorage(amount),
    wac: roundToStorage(price),
    costBasis: roundToStorage(amount.times(price)),
    realizedPnlUsd: roundToStorage(ZERO),
    openedAt: tx.blockTimestamp,
    closedAt: null,
  };

  return {
    position: newPosition,
    realizedPnlDelta: roundToStorage(ZERO),
    positionWasOpened: true,
    positionWasClosed: false,
  };
}

function appendToOpenPosition(
  pos: PositionState,
  tx: TransactionInput,
): PositionEngineResult {

  if (tx.priceUsd === null) {
    throw new InvalidTransactionError({
      reason: 'INBOUND_REQUIRES_PRICE',
      context: { type: tx.type },
    });
  }

  const oldBalance = toDecimal(pos.balance);
  const oldCostBasis = toDecimal(pos.costBasis);
  const inAmount = toDecimal(tx.amount);
  const inPrice = toDecimal(tx.priceUsd);

  const newBalance = oldBalance.plus(inAmount);
  const newCostBasis = oldCostBasis.plus(inAmount.times(inPrice));
  const newWac = newCostBasis.div(newBalance);

  const updated: PositionState = {
    ...pos,
    balance: roundToStorage(newBalance),
    wac: roundToStorage(newWac),
    costBasis: roundToStorage(newCostBasis),
  };

  return {
    position: updated,
    realizedPnlDelta: roundToStorage(ZERO),
    positionWasOpened: false,
    positionWasClosed: false,
  };
}

function reduceOpenPosition(
  pos: PositionState,
  tx: TransactionInput,
): PositionEngineResult {

  const oldBalance = toDecimal(pos.balance);
  const sellAmount = toDecimal(tx.amount);

  if (sellAmount.gt(oldBalance)) {
    throw new InsufficientBalanceError({
      currentBalance: pos.balance,
      attempted: tx.amount,
    });
  }

  const wac = toDecimal(pos.wac);
  const newBalance = oldBalance.minus(sellAmount);
  const newCostBasis = wac.times(newBalance);

  let realizedDelta = ZERO;
  if (tx.type === 'TRANSFER_OUT' && tx.priceUsd === null) {
    // realizedDelta stays ZERO — transfer without price generates no P&L
  } else if (tx.priceUsd === null) {
    throw new InvalidTransactionError({
      reason: 'OUTBOUND_REQUIRES_PRICE',
      context: { type: tx.type },
    });
  } else {
    realizedDelta = toDecimal(tx.priceUsd).minus(wac).times(sellAmount);
  }

  const newRealizedPnl = toDecimal(pos.realizedPnlUsd).plus(realizedDelta);
  const closes = newBalance.isZero();

  const updated: PositionState = {
    ...pos,
    balance: roundToStorage(newBalance),
    costBasis: roundToStorage(newCostBasis),
    realizedPnlUsd: roundToStorage(newRealizedPnl),
    status: closes ? 'CLOSED' : 'OPEN',
    closedAt: closes ? tx.blockTimestamp : null,
  };

  return {
    position: updated,
    realizedPnlDelta: roundToStorage(realizedDelta),
    positionWasOpened: false,
    positionWasClosed: closes,
  };
}

export function processTransaction(input: ProcessTransactionInput): PositionEngineResult {
  if (input.position !== null && input.position.status !== 'OPEN') {
    throw new InvalidPositionStateError(
      `Caller must pass position=null when no OPEN position exists. Got status: ${input.position.status}`,
    );
  }

  const tx = input.transaction;

  if (isInbound(tx.type)) {
    if (input.position === null) {
      return openNewCycle(input);
    }
    return appendToOpenPosition(input.position, tx);
  }

  if (isOutbound(tx.type)) {
    if (input.position === null) {
      throw new InvalidTransactionError({
        reason: 'OUTBOUND_WITHOUT_POSITION',
        context: { type: tx.type },
      });
    }
    return reduceOpenPosition(input.position, tx);
  }

  return assertNever(tx.type);
}

export function calculateWAC(
  position: PositionState,
  currentPriceUsd?: DecimalString | null,
): WACResult {
  const { wac, costBasis, balance } = position;

  if (currentPriceUsd === undefined || currentPriceUsd === null) {
    return { wac, costBasis, balance, unrealizedPnlUsd: null, unrealizedPnlPct: null };
  }

  const wacD = toDecimal(wac);
  const balD = toDecimal(balance);
  const priceD = toDecimal(currentPriceUsd);

  const unrealizedUsd = priceD.minus(wacD).times(balD);
  const unrealizedPct = wacD.isZero() ? null : priceD.minus(wacD).div(wacD).times(100);

  return {
    wac,
    costBasis,
    balance,
    unrealizedPnlUsd: roundToStorage(unrealizedUsd),
    unrealizedPnlPct: unrealizedPct === null ? null : roundToStorage(unrealizedPct),
  };
}
