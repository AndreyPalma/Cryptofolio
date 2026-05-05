export { processTransaction, calculateWAC } from './engine.js';

export type {
  DecimalString,
  TransactionInput,
  PositionState,
  ProcessTransactionInput,
  PositionEngineResult,
  WACResult,
} from './types.js';

export {
  InsufficientBalanceError,
  InvalidTransactionError,
  InvalidPositionStateError,
} from './types.js';
