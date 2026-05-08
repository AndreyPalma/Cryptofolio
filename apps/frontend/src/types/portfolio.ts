/**
 * Domain types for GET /api/portfolio response.
 * All numeric fields are DecimalString — never JS number (PRD invariant).
 */

/**
 * Decimal string from the backend (e.g., "1234.567890123456789").
 * Branded only by convention — TypeScript treats it as `string`.
 */
export type DecimalString = string;

export const NETWORK = {
  ETH: "ETH",
  BSC: "BSC",
  CEX_BINANCE: "CEX_BINANCE",
} as const;
export type Network = (typeof NETWORK)[keyof typeof NETWORK];

export const SOURCE_TYPE = {
  ON_CHAIN: "ON_CHAIN",
  CEX: "CEX",
} as const;
export type SourceType = (typeof SOURCE_TYPE)[keyof typeof SOURCE_TYPE];

export interface WalletBreakdown {
  walletId: string;
  label: string | null;
  balance: DecimalString;
  wac: DecimalString;
}

export interface PortfolioItem {
  symbol: string;
  network: Network;
  sourceType: SourceType;
  contractAddress: string | null;
  binanceSymbol: string | null;
  totalBalance: DecimalString;
  wacAggregated: DecimalString;
  totalCostBasis: DecimalString;
  currentPrice: DecimalString | null;
  totalCurrentValue: DecimalString | null;
  pnlUsd: DecimalString | null;
  pnlPct: DecimalString | null;
  walletCount: number;
  walletBreakdown: WalletBreakdown[];
  priceUnavailable?: boolean;
}

export interface PortfolioSummary {
  totalValueUsd: DecimalString;
  totalCostBasis: DecimalString;
  totalPnlUsd: DecimalString;
  totalPnlPct: DecimalString | null;
}

/**
 * Full GET /api/portfolio response.
 * Flat shape: summary fields + tokens array at the top level.
 */
export interface PortfolioResponse {
  totalValueUsd: DecimalString;
  totalCostBasis: DecimalString;
  totalPnlUsd: DecimalString;
  totalPnlPct: DecimalString | null;
  tokens: PortfolioItem[];
}
