// Tipos de dominio para wallets — US-005

export type WalletType = 'ON_CHAIN' | 'CEX';
export type NetworkOnChain = 'ETH' | 'BSC';
export type NetworkCex = 'CEX_BINANCE';
export type Network = NetworkOnChain | NetworkCex;

export interface Wallet {
  id: string;
  user_id: string;
  wallet_type: WalletType;
  address: string | null;
  network: Network;
  label: string | null;
  last_synced_at: string | null;
  created_at: string;
}

export interface CreateWalletInput {
  wallet_type: WalletType;
  /** Nombre descriptivo de la wallet */
  label?: string | null;
  /** Requerido para ON_CHAIN; debe ser nulo/ausente para CEX */
  address?: string | null;
  network: string;
}

export interface UpdateWalletInput {
  label?: string | null;
}
