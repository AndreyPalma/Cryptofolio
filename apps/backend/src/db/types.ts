// Backend-local type aliases for the DB ENUMs.
//
// The values here MUST match db/enums.ts exactly. A drift guard test lives at
// `apps/backend/src/db/types.test.ts` (see also db/enums.test.ts which validates
// db/enums.ts ↔ migration SQL drift).
//
// We duplicate the arrays (instead of importing from db/) because tsc rootDir
// for the backend build is restricted to `apps/backend/src/`. Drift is cheap to
// detect via tests; sharing across rootDirs is not.

export const WALLET_TYPES = ["ON_CHAIN", "CEX"] as const;

export const NETWORKS = ["ETH", "BSC", "CEX_BINANCE"] as const;

export const TRANSACTION_TYPES = [
  "BUY",
  "SELL",
  "SWAP_IN",
  "SWAP_OUT",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "FIAT_IN",   // REQ-002
  "FIAT_OUT",  // REQ-002
] as const;

export const TRANSACTION_SOURCES = ["ETHERSCAN", "BSCTRACE", "BINANCE", "MANUAL"] as const;

export const POSITION_STATUSES = ["OPEN", "CLOSED"] as const;

export const COST_SOURCES = ["MARKET", "INHERITED", "MANUAL"] as const;

export const SERVICE_NAMES = [
  "ETHERSCAN",
  "BSCTRACE",
  "BINANCE_API_KEY",
  "BINANCE_SECRET_KEY",
  "TELEGRAM",
] as const;

export type WalletType = (typeof WALLET_TYPES)[number];
export type Network = (typeof NETWORKS)[number];
export type TransactionType = (typeof TRANSACTION_TYPES)[number];
export type TransactionSource = (typeof TRANSACTION_SOURCES)[number];
export type PositionStatus = (typeof POSITION_STATUSES)[number];
export type CostSource = (typeof COST_SOURCES)[number];
export type ServiceName = (typeof SERVICE_NAMES)[number];
