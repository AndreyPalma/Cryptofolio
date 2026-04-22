// Mock data for CryptoLedger
const MOCK_WALLETS = [
  { id: 'w1', address: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18', alias: 'MetaMask Principal', network: 'ETH', storage_type: 'HOT', last_synced_block: 19842100, is_active: true },
  { id: 'w2', address: '0x8894E0a0c962CB723c1ef8b4534F75e4B5a5F8c1', alias: 'Ledger Cold', network: 'ETH', storage_type: 'COLD', last_synced_block: 19841800, is_active: true },
  { id: 'w3', address: '0xAb5801a7D398351b8bE11C439e05C5b3259aec9B', alias: 'BSC DeFi', network: 'BSC', storage_type: 'HOT', last_synced_block: 38120400, is_active: true },
];

const MOCK_TOKENS = [
  { id: 't1', symbol: 'ETH', name: 'Ethereum', network: 'ETH', contract_address: '0x0000000000000000000000000000000000000000', decimals: 18, coingecko_id: 'ethereum', color: '#627EEA' },
  { id: 't2', symbol: 'USDC', name: 'USD Coin', network: 'ETH', contract_address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, coingecko_id: 'usd-coin', color: '#2775CA' },
  { id: 't3', symbol: 'LINK', name: 'Chainlink', network: 'ETH', contract_address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', decimals: 18, coingecko_id: 'chainlink', color: '#2A5ADA' },
  { id: 't4', symbol: 'UNI', name: 'Uniswap', network: 'ETH', contract_address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', decimals: 18, coingecko_id: 'uniswap', color: '#FF007A' },
  { id: 't5', symbol: 'BNB', name: 'BNB', network: 'BSC', contract_address: '0x0000000000000000000000000000000000000000', decimals: 18, coingecko_id: 'binancecoin', color: '#F3BA2F' },
  { id: 't6', symbol: 'CAKE', name: 'PancakeSwap', network: 'BSC', contract_address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', decimals: 18, coingecko_id: 'pancakeswap', color: '#D1884F' },
];

const MOCK_PORTFOLIO = [
  { token: MOCK_TOKENS[0], totalBalance: 4.8523, currentPrice: 3245.67, wacAggregated: 2180.42, walletCount: 2,
    walletBreakdown: [
      { wallet: MOCK_WALLETS[0], balance: 3.2000, wac: 2050.00, costBasis: 6560.00, currentValue: 10386.14, pnlUsd: 3826.14, pnlPct: 58.32 },
      { wallet: MOCK_WALLETS[1], balance: 1.6523, wac: 2433.18, costBasis: 4020.22, currentValue: 5363.04, pnlUsd: 1342.82, pnlPct: 33.40 },
    ]},
  { token: MOCK_TOKENS[1], totalBalance: 12500.00, currentPrice: 1.00, wacAggregated: 1.00, walletCount: 1,
    walletBreakdown: [
      { wallet: MOCK_WALLETS[0], balance: 12500.00, wac: 1.00, costBasis: 12500.00, currentValue: 12500.00, pnlUsd: 0, pnlPct: 0 },
    ]},
  { token: MOCK_TOKENS[2], totalBalance: 285.50, currentPrice: 18.42, wacAggregated: 12.35, walletCount: 2,
    walletBreakdown: [
      { wallet: MOCK_WALLETS[0], balance: 200.00, wac: 11.50, costBasis: 2300.00, currentValue: 3684.00, pnlUsd: 1384.00, pnlPct: 60.17 },
      { wallet: MOCK_WALLETS[1], balance: 85.50, wac: 14.34, costBasis: 1226.07, currentValue: 1574.91, pnlUsd: 348.84, pnlPct: 28.45 },
    ]},
  { token: MOCK_TOKENS[3], totalBalance: 450.00, currentPrice: 12.87, wacAggregated: 15.20, walletCount: 1,
    walletBreakdown: [
      { wallet: MOCK_WALLETS[0], balance: 450.00, wac: 15.20, costBasis: 6840.00, currentValue: 5791.50, pnlUsd: -1048.50, pnlPct: -15.33 },
    ]},
  { token: MOCK_TOKENS[4], totalBalance: 12.75, currentPrice: 612.30, wacAggregated: 420.00, walletCount: 1,
    walletBreakdown: [
      { wallet: MOCK_WALLETS[2], balance: 12.75, wac: 420.00, costBasis: 5355.00, currentValue: 7806.83, pnlUsd: 2451.83, pnlPct: 45.79 },
    ]},
  { token: MOCK_TOKENS[5], totalBalance: 1200.00, currentPrice: 3.24, wacAggregated: 4.80, walletCount: 1,
    walletBreakdown: [
      { wallet: MOCK_WALLETS[2], balance: 1200.00, wac: 4.80, costBasis: 5760.00, currentValue: 3888.00, pnlUsd: -1872.00, pnlPct: -32.50 },
    ]},
];

const MOCK_TRANSACTIONS = [
  { id: 'tx1', token: MOCK_TOKENS[0], wallet: MOCK_WALLETS[0], type: 'BUY', amount: 2.0, priceAtTime: 1800.00, blockTimestamp: '2024-01-15T10:30:00Z', txHash: '0xabc123...def456', source: 'ETHERSCAN', costSource: null, positionCycle: 1 },
  { id: 'tx2', token: MOCK_TOKENS[0], wallet: MOCK_WALLETS[0], type: 'BUY', amount: 0.5, priceAtTime: 2200.00, blockTimestamp: '2024-02-20T14:15:00Z', txHash: '0xbcd234...efg567', source: 'ETHERSCAN', costSource: null, positionCycle: 1 },
  { id: 'tx3', token: MOCK_TOKENS[0], wallet: MOCK_WALLETS[0], type: 'SWAP_IN', amount: 0.7, priceAtTime: 2450.00, blockTimestamp: '2024-03-10T08:45:00Z', txHash: '0xcde345...fgh678', source: 'ETHERSCAN', costSource: null, positionCycle: 1, relatedSwap: 'Uniswap V3: 1,715 USDC → 0.7 ETH' },
  { id: 'tx4', token: MOCK_TOKENS[0], wallet: MOCK_WALLETS[1], type: 'TRANSFER_IN', amount: 1.0, priceAtTime: 2050.00, blockTimestamp: '2024-03-25T16:00:00Z', txHash: '0xdef456...ghi789', source: 'ETHERSCAN', costSource: 'INHERITED', positionCycle: 1, fromWallet: 'MetaMask Principal' },
  { id: 'tx5', token: MOCK_TOKENS[0], wallet: MOCK_WALLETS[0], type: 'SELL', amount: 0.5, priceAtTime: 3100.00, blockTimestamp: '2024-04-05T11:20:00Z', txHash: '0xefg567...hij890', source: 'ETHERSCAN', costSource: null, positionCycle: 1 },
  { id: 'tx6', token: MOCK_TOKENS[0], wallet: MOCK_WALLETS[1], type: 'BUY', amount: 0.6523, priceAtTime: 2950.00, blockTimestamp: '2024-04-12T09:00:00Z', txHash: '0xfgh678...ijk901', source: 'MANUAL', costSource: null, positionCycle: 1 },
  { id: 'tx7', token: MOCK_TOKENS[1], wallet: MOCK_WALLETS[0], type: 'SWAP_OUT', amount: 1715.00, priceAtTime: 1.00, blockTimestamp: '2024-03-10T08:45:00Z', txHash: '0xcde345...fgh678', source: 'ETHERSCAN', costSource: null, positionCycle: 1, relatedSwap: 'Uniswap V3: 1,715 USDC → 0.7 ETH' },
  { id: 'tx8', token: MOCK_TOKENS[2], wallet: MOCK_WALLETS[0], type: 'BUY', amount: 100.00, priceAtTime: 10.50, blockTimestamp: '2024-01-20T13:00:00Z', txHash: '0xghi789...jkl012', source: 'ETHERSCAN', costSource: null, positionCycle: 1 },
  { id: 'tx9', token: MOCK_TOKENS[2], wallet: MOCK_WALLETS[0], type: 'BUY', amount: 100.00, priceAtTime: 12.50, blockTimestamp: '2024-02-28T17:30:00Z', txHash: '0xhij890...klm123', source: 'ETHERSCAN', costSource: null, positionCycle: 1 },
];

const MOCK_CLOSED_CYCLES = [
  { cycleNumber: 1, token: MOCK_TOKENS[3], openedAt: '2023-06-15T10:00:00Z', closedAt: '2023-11-20T14:30:00Z', realizedPnlUsd: 320.50, totalBought: 200, avgBuyPrice: 5.20, totalSold: 200, avgSellPrice: 6.80 },
  { cycleNumber: 1, token: MOCK_TOKENS[2], openedAt: '2023-03-01T08:00:00Z', closedAt: '2023-08-15T11:00:00Z', realizedPnlUsd: -180.25, totalBought: 150, avgBuyPrice: 7.80, totalSold: 150, avgSellPrice: 6.60 },
];

// Helper fns
function formatUsd(n) { return new Intl.NumberFormat('en-US', { style:'currency', currency:'USD', minimumFractionDigits:2, maximumFractionDigits:2 }).format(n); }
function formatPct(n) { return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'; }
function formatNum(n, d=4) { return new Intl.NumberFormat('en-US', { minimumFractionDigits:2, maximumFractionDigits:d }).format(n); }
function shortAddr(a) { return a.slice(0,6) + '...' + a.slice(-4); }
function formatDate(d) { return new Date(d).toLocaleDateString('es-ES', { day:'2-digit', month:'short', year:'numeric' }); }
function formatDateTime(d) { const dt = new Date(d); return dt.toLocaleDateString('es-ES', { day:'2-digit', month:'short', year:'numeric' }) + ' ' + dt.toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit' }); }

window.MOCK_WALLETS = MOCK_WALLETS;
window.MOCK_TOKENS = MOCK_TOKENS;
window.MOCK_PORTFOLIO = MOCK_PORTFOLIO;
window.MOCK_TRANSACTIONS = MOCK_TRANSACTIONS;
window.MOCK_CLOSED_CYCLES = MOCK_CLOSED_CYCLES;
window.formatUsd = formatUsd;
window.formatPct = formatPct;
window.formatNum = formatNum;
window.shortAddr = shortAddr;
window.formatDate = formatDate;
window.formatDateTime = formatDateTime;
