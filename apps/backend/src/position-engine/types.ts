import type { TransactionType, TransactionSource, CostSource, PositionStatus } from '../db/types.js';

export type DecimalString = string;

export interface TransactionInput {
  readonly externalRef?: string;
  readonly type: TransactionType;
  readonly amount: DecimalString;
  readonly priceUsd: DecimalString | null;
  readonly costSource?: CostSource;
  readonly source: TransactionSource;
  readonly blockTimestamp: Date;
  readonly relatedTxId?: string;
}

export interface PositionState {
  readonly id: string;
  readonly walletId: string;
  readonly tokenId: string;
  readonly cycleNumber: number;
  readonly status: PositionStatus;
  readonly balance: DecimalString;
  readonly wac: DecimalString;
  readonly costBasis: DecimalString;
  readonly realizedPnlUsd: DecimalString;
  readonly openedAt: Date;
  readonly closedAt: Date | null;
}

export interface ProcessTransactionInput {
  readonly position: PositionState | null;
  readonly priorClosedCycles: number;
  readonly transaction: TransactionInput;
  readonly positionIdentity?: {
    readonly id: string;
    readonly walletId: string;
    readonly tokenId: string;
  };
}

export interface PositionEngineResult {
  readonly position: PositionState;
  readonly realizedPnlDelta: DecimalString;
  readonly positionWasOpened: boolean;
  readonly positionWasClosed: boolean;
}

export interface WACResult {
  readonly wac: DecimalString;
  readonly costBasis: DecimalString;
  readonly balance: DecimalString;
  readonly unrealizedPnlUsd: DecimalString | null;
  readonly unrealizedPnlPct: DecimalString | null;
}

export class InsufficientBalanceError extends Error {
  override readonly name = 'InsufficientBalanceError' as const;
  readonly currentBalance: DecimalString;
  readonly attempted: DecimalString;
  constructor(params: { currentBalance: DecimalString; attempted: DecimalString }) {
    super(`Insufficient balance: attempted ${params.attempted}, current ${params.currentBalance}`);
    this.currentBalance = params.currentBalance;
    this.attempted = params.attempted;
  }
}

export class InvalidTransactionError extends Error {
  override readonly name = 'InvalidTransactionError' as const;
  readonly reason: string;
  readonly context: Readonly<Record<string, unknown>>;
  constructor(params: { reason: string; context?: Readonly<Record<string, unknown>> }) {
    super(`Invalid transaction: ${params.reason}`);
    this.reason = params.reason;
    this.context = params.context ?? {};
  }
}

export class InvalidPositionStateError extends Error {
  override readonly name = 'InvalidPositionStateError' as const;
  readonly reason: string;
  constructor(reason: string) {
    super(`Invalid position state: ${reason}`);
    this.reason = reason;
  }
}
