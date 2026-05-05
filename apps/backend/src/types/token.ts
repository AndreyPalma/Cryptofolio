// Tipos de dominio para tokens — US-005

export interface Token {
  id: string;
  symbol: string;
  name: string | null;
  network: string;
  contract_address: string | null;
  decimals: number;
  binance_symbol: string | null;
  is_hidden: boolean;
  target_exit_price: string | null;
  created_at: string;
}

export interface CreateTokenInput {
  symbol: string;
  name?: string | null;
  network: string;
  /** Requerido para ON_CHAIN; auto-generado para CEX */
  contract_address?: string | null;
  /** Requerido para CEX_BINANCE */
  binance_symbol?: string | null;
  decimals?: number;
}

export interface UpdateTokenInput {
  is_hidden?: boolean;
  target_exit_price?: string | null;
  binance_symbol?: string | null;
}

export interface FindAllTokensFilter {
  network?: string;
  includeHidden?: boolean;
}
