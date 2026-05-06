// SWAP router addresses, lower-cased for O(1) Set membership checks.
// Intentionally narrow — only routers that emit 1 outbound + 1 inbound transfer
// per swap. Aggregators (1inch, 0x) are out of scope for V1 (R-8 trade-off).

export const SWAP_ROUTERS: Readonly<Record<'ETH' | 'BSC', ReadonlySet<string>>> = {
  ETH: new Set<string>([
    '0x7a250d5630b4cf539739df2c5dacb4c659f2488d', // Uniswap V2 Router 02
    '0xe592427a0aece92de3edee1f18e0157c05861564', // Uniswap V3 SwapRouter
    '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45', // Uniswap V3 SwapRouter02
    '0x66a9893cc07d91d95644aedd05d03f95e1dba8af', // Uniswap Universal Router (V4 era)
  ]),
  BSC: new Set<string>([
    '0x10ed43c718714eb63d5aa57b78b54704e256024e', // PancakeSwap V2 Router
    '0x13f4ea83d0bd40e75c8222255bc855a974568dd4', // PancakeSwap V3 SmartRouter
    '0x1b81d678ffb9c0263b24a97847620c99d213eb14', // PancakeSwap V3 SmartRouterHelper
  ]),
} as const;

export type SupportedNetwork = keyof typeof SWAP_ROUTERS;
