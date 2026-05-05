// Transaction types — US-006
import type { TransactionType, TransactionSource, CostSource } from '../db/types.js';

export interface Transaction {
  id: string;
  wallet_id: string;
  token_id: string;
  position_id: string | null;
  type: TransactionType;
  source: TransactionSource;
  tx_hash: string | null;
  tx_log_index: number | null;
  cex_trade_id: number | null;
  related_tx_id: string | null;
  block_timestamp: Date;
  amount: string;           // NUMERIC returned as string by pg
  price_usd: string | null;
  cost_source: CostSource | null;
  commission_asset: string | null;
  commission_amount: string | null;
  from_address: string | null;
  to_address: string | null;
  created_at: Date;
}

export interface CreateTransactionInput {
  wallet_id: string;
  token_id: string;
  type: TransactionType;
  amount: string;
  price_usd_at_time: string | null;
  block_timestamp: string;   // ISO-8601 string from caller
  cost_source?: CostSource;
}

export interface CreateTransactionResult {
  transaction_id: string;
  position_id: string;
  cycle_number: number;
  status: 'OPEN' | 'CLOSED';
  wac: string;
  balance: string;
}

export interface TransactionListQuery {
  wallet_id: string;
  token_id?: string;
  position_id?: string;
  limit: number;
  offset: number;
}

export interface TransactionListResult {
  data: Transaction[];
  total: number;
  limit: number;
  offset: number;
}
