// ── Network/source enums (as const, no native enum) ───────────────────────────
export const TOKEN_NETWORKS = ["ETH", "BSC", "CEX_BINANCE"] as const;
export type TokenNetwork = (typeof TOKEN_NETWORKS)[number];

export const WALLET_TYPES = ["ON_CHAIN", "CEX"] as const;
export type WalletType = (typeof WALLET_TYPES)[number];

export const API_SERVICES = ["binance", "alchemy"] as const;
export type ApiService = (typeof API_SERVICES)[number];

// ── Wallet ────────────────────────────────────────────────────────────────────
export interface SettingsWallet {
  id: string;
  walletType: WalletType;
  address: string | null;
  network: string;
  label: string | null;
  lastSyncedAt: Date | null;
  createdAt: Date;
}

// ── Token (settings view) ─────────────────────────────────────────────────────
export interface SettingsToken {
  id: string;
  symbol: string;
  name: string | null;
  network: TokenNetwork;
  contractAddress: string | null;
  binanceSymbol: string | null;
  isHidden: boolean;
  targetExitPrice: string | null; // string decimal
}

// ── Sync results (discriminated union) ────────────────────────────────────────
export interface OnChainSyncResult {
  kind: "on-chain";
  synced: number;
  skipped: number;
  swapsDecomposed: number;
  transfersPendingCost: number;
  transfersInheritedFromCEX: number;
}

export interface CexSyncResult {
  kind: "cex";
  trades: { synced: number; skipped: number; symbolsProcessed: number };
  converts: { synced: number; skipped: number };
  withdrawals: { synced: number; skipped: number };
  deposits: { synced: number; skipped: number; inherited: number; manual: number };
  tokensCreated: number;
}

export type SyncResultUnion = OnChainSyncResult | CexSyncResult;

// ── Per-wallet sync state ─────────────────────────────────────────────────────
export type SyncState =
  | { status: "idle" }
  | { status: "syncing" }
  | { status: "success"; result: SyncResultUnion; finishedAt: Date }
  | { status: "error"; message: string };

// ── API keys ──────────────────────────────────────────────────────────────────
export interface ApiKeysPresence {
  BINANCE_API_KEY: boolean;
  BINANCE_SECRET_KEY: boolean;
  ALCHEMY_API_KEY: boolean;
}

export type ApiKeyTestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "connected"; meta?: { assetCount?: number; latencyMs?: number } }
  | { status: "failed"; reason: string };

// ── Pending TRANSFER_IN ───────────────────────────────────────────────────────
export interface PendingTransfer {
  id: string;
  walletId: string;
  tokenId: string;
  tokenSymbol: string;
  tokenNetwork: TokenNetwork;
  amount: string;
  blockTimestamp: Date;
  txHash: string | null;
  fromAddress: string | null;
  contractAddress: string | null;
}

// ── Balance validation ────────────────────────────────────────────────────────
export interface BalanceDifference {
  asset: string;
  engineBalance: string;
  snapshotBalance: string;
  diff: string;
}

export interface BalanceValidationData {
  differences: BalanceDifference[];
  totalEngineUsd: string;
  totalSnapshotUsd: string;
  takenAt: Date;
  dustNote: string;
}

// ── SSE sync stream types (US-015) ────────────────────────────────────────────
export const SYNC_STEPS_CEX = ["fiat", "deposits", "withdrawals", "converts", "trades"] as const;
export const SYNC_STEPS_ON_CHAIN = ["fetch_normal", "fetch_tokens", "classify", "persist"] as const;
export type CexSyncStepName = (typeof SYNC_STEPS_CEX)[number];
export type OnChainSyncStepName = (typeof SYNC_STEPS_ON_CHAIN)[number];
export type SyncStepName = CexSyncStepName | OnChainSyncStepName;
export type StepStatus = "pending" | "running" | "done" | "skipped" | "error";

export interface StepState {
  name: SyncStepName;
  label: string;
  status: StepStatus;
  synced?: number;
  skipped?: number;
  reason?: string;
  errorMessage?: string;
}

export type SyncStreamStatus = "idle" | "connecting" | "syncing" | "done" | "error" | "cancelled";
