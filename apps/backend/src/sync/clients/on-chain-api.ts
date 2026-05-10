// OnChainApiClient interface + Normalized*Tx types — US-008-A
// All addresses lower-cased on the way out so downstream code never has to
// remember to normalize. Numeric strings (value, blockNumber) preserved as
// strings to avoid losing precision on uint256 amounts.

/** Normalized normal (ETH/BNB value) transaction. */
export interface NormalizedTx {
  readonly txHash: string;
  readonly blockNumber: number;
  readonly transactionIndex: number;  // intra-block ordering for stable sort
  readonly timeStamp: number;          // unix seconds
  readonly from: string;               // lower-cased
  readonly to: string;                 // lower-cased; empty string for contract creation
  readonly value: string;              // wei, decimal string
  readonly isError: '0' | '1';
  readonly gasUsed: string;
  readonly methodId?: string;          // first 4 bytes of input data, lower-cased '0x...'
}

/** Normalized ERC20 token transfer log. */
export interface NormalizedTokenTx {
  readonly txHash: string;
  readonly blockNumber: number;
  readonly transactionIndex: number;
  readonly logIndex: number;           // log position within the tx
  readonly timeStamp: number;
  readonly from: string;               // lower-cased
  readonly to: string;                 // lower-cased
  readonly contractAddress: string;    // lower-cased — the ERC20 token contract
  readonly tokenSymbol: string;
  readonly tokenName: string;
  readonly tokenDecimal: number;
  readonly value: string;              // raw, scaled by 10^tokenDecimal
}

/** Common interface implemented by EtherscanClient and BSCTraceClient. */
export interface OnChainApiClient {
  readonly network: 'ETH' | 'BSC';
  /** Throws ApiKeyMissingError if API key is not configured. */
  assertConfigured(): void;
  fetchNormalTransactions(
    address: string,
    startBlock: number,
    endBlock: number,
  ): Promise<NormalizedTx[]>;
  fetchTokenTransactions(
    address: string,
    startBlock: number,
    endBlock: number,
  ): Promise<NormalizedTokenTx[]>;
}
