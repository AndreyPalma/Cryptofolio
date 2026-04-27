// Single source of truth for SQL ENUM members.
// The migration file `migrations/0001_initial_schema.sql` MUST reference these
// names verbatim. `enums.test.ts` enforces drift by reading the .sql file.

export const WALLET_TYPES = ["ON_CHAIN", "CEX"] as const;

export const NETWORKS = ["ETH", "BSC", "CEX_BINANCE"] as const;

export const TRANSACTION_TYPES = [
  "BUY",
  "SELL",
  "SWAP_IN",
  "SWAP_OUT",
  "TRANSFER_IN",
  "TRANSFER_OUT",
] as const;

export const TRANSACTION_SOURCES = ["ETHERSCAN", "BSCTRACE", "BINANCE", "MANUAL"] as const;

export const POSITION_STATUSES = ["OPEN", "CLOSED"] as const;

export const COST_SOURCES = ["MARKET", "INHERITED", "MANUAL"] as const;

// NOTE: BINANCE_API_SECRET is the legacy v4 bug name and SHALL NOT appear here.
export const SERVICE_NAMES = [
  "ETHERSCAN",
  "BSCTRACE",
  "BINANCE_API_KEY",
  "BINANCE_SECRET_KEY",
  "TELEGRAM",
] as const;

export const SQL_ENUM_DEFINITIONS = {
  wallet_type: WALLET_TYPES,
  network: NETWORKS,
  transaction_type: TRANSACTION_TYPES,
  transaction_source: TRANSACTION_SOURCES,
  position_status: POSITION_STATUSES,
  cost_source: COST_SOURCES,
  service_name: SERVICE_NAMES,
} as const;
