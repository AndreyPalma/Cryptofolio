# Alchemy Test Fixtures

This directory contains sanitized JSON fixtures mocking Alchemy `alchemy_getAssetTransfers` API responses for the US-007 test suite.

## Fixtures

| File                            | Description                            | Scenarios |
| ------------------------------- | -------------------------------------- | --------- |
| `eth-normal-transfer.json`      | Single ETH external transfer           | A-5, C-2  |
| `eth-token-transfer.json`       | Single ERC20 transfer (USDC)           | A-6, C-2  |
| `eth-internal-transfer.json`    | Internal transaction (contract refund) | B-3, C-8  |
| `eth-swap-uniswap-v2.json`      | Uniswap V2 swap (native → token)       | B-1, C-6  |
| `eth-swap-native-to-token.json` | Native ETH swap out                    | C-6       |
| `eth-swap-token-to-native.json` | Token swap in                          | C-6       |
| `bsc-normal-transfer.json`      | BNB external transfer                  | A-2       |
| `bsc-swap-pancake.json`         | PancakeSwap swap                       | B-2, C-7  |
| `pagination-page1.json`         | First page of paginated response       | A-8       |
| `pagination-page2.json`         | Second page of paginated response      | A-8       |
| `error-rpc.json`                | JSON-RPC error response                | A-15, E-3 |

## Sanitization

All addresses, transaction hashes, and unique IDs have been replaced with deterministic test values. No real user data is present.

## Usage

```ts
import ethNormalTransfer from "./fixtures/alchemy/eth-normal-transfer.json";
```

Or use the helper functions in `../helpers/mock-alchemy.ts`.
