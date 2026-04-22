// Pages: Token Detail + Position History
const { useState, useMemo } = React;

/* ═══════════════ TOKEN DETAIL ═══════════════ */
function TokenDetailPage({ tokenId, onNavigate, tweaks }) {
  const [walletFilter, setWalletFilter] = useState('all');
  const badgeStyle = tweaks.badgeStyle || 'default';

  const entry = MOCK_PORTFOLIO.find(p => p.token.id === tokenId) || MOCK_PORTFOLIO[0];
  const t = entry.token;
  const txs = MOCK_TRANSACTIONS.filter(tx => tx.token.id === t.id);

  const scope = walletFilter === 'all' ? entry : (() => {
    const wb = entry.walletBreakdown.find(w => w.wallet.id === walletFilter);
    return wb ? { ...entry, totalBalance: wb.balance, wacAggregated: wb.wac, currentPrice: entry.currentPrice } : entry;
  })();

  const val = scope.totalBalance * scope.currentPrice;
  const cost = scope.totalBalance * scope.wacAggregated;
  const pnl = val - cost;
  const pnlPct = scope.wacAggregated > 0 ? ((scope.currentPrice - scope.wacAggregated) / scope.wacAggregated) * 100 : 0;

  const filteredTxs = walletFilter === 'all' ? txs : txs.filter(tx => tx.wallet.id === walletFilter);
  const closedCount = MOCK_CLOSED_CYCLES.filter(c => c.token.id === t.id).length;

  return React.createElement(React.Fragment, null,
    React.createElement(PageHeader, {
      title: React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 14 } },
        React.createElement(TokenLogo, { symbol: t.symbol, color: t.color, size: 42 }),
        React.createElement('span', null, t.name),
        React.createElement(NetworkBadge, { network: t.network }),
        React.createElement('span', { style: { fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 8, background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid rgba(99,102,241,0.25)' } }, 'CICLO #1')
      ),
      backTo: '/', onNavigate,
      breadcrumbs: [{ label: 'Dashboard', onClick: () => onNavigate('/') }, { label: t.symbol }],
      actions: React.createElement(React.Fragment, null,
        React.createElement(GlassSelect, { value: walletFilter, onChange: setWalletFilter, options: [{ value: 'all', label: 'Todas las Wallets' }, ...entry.walletBreakdown.map(wb => ({ value: wb.wallet.id, label: wb.wallet.alias }))] }),
        closedCount > 0 && React.createElement(GlassButton, { variant: 'ghost', size: 'sm', onClick: () => onNavigate(`/token/${t.contract_address}/${t.network}/history`) }, `Ver ${closedCount} ciclo${closedCount > 1 ? 's' : ''} cerrado${closedCount > 1 ? 's' : ''}`)
      )
    }),

    // Stats row
    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 28 } },
      React.createElement(StatCard, { label: 'Balance', value: formatNum(scope.totalBalance) + ' ' + t.symbol, delay: 0 }),
      React.createElement(StatCard, { label: 'Precio Actual', value: formatUsd(scope.currentPrice), delay: 30 }),
      React.createElement(StatCard, { label: 'Valor Actual', value: formatUsd(val), delay: 60 }),
      React.createElement(StatCard, { label: 'WAC', value: formatUsd(scope.wacAggregated), delay: 90 }),
      React.createElement(StatCard, { label: 'Costo Base', value: formatUsd(cost), delay: 120 }),
      React.createElement(StatCard, { label: 'P&L', value: formatUsd(pnl), subValue: formatPct(pnlPct), trend: pnl >= 0 ? 'up' : 'down', delay: 150 }),
    ),

    // Transactions table
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 } },
      React.createElement('h3', { style: { fontSize: 16, fontWeight: 600 } }, 'Transacciones'),
      React.createElement(GlassButton, { variant: 'primary', size: 'sm', onClick: () => onNavigate('/transactions/new') }, '＋ Agregar')
    ),

    React.createElement('div', { className: 'glass', style: { overflow: 'hidden' } },
      // Header
      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '130px 100px 130px 100px 100px 100px 100px 100px 110px', padding: '10px 20px', fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase', borderBottom: '1px solid var(--border)', gap: 8 } },
        ...['Fecha', 'Tipo', 'Wallet', 'Cantidad', 'Precio TX', 'Valor TX', 'Precio Act.', 'Valor Act.', 'P&L Lote'].map(h =>
          React.createElement('span', { key: h, style: { textAlign: h === 'Fecha' || h === 'Tipo' || h === 'Wallet' ? 'left' : 'right' } }, h))
      ),
      // Rows
      filteredTxs.map((tx, i) => {
        const isSold = tx.type === 'SELL' || tx.type === 'SWAP_OUT' || tx.type === 'TRANSFER_OUT';
        const valAtTime = tx.amount * tx.priceAtTime;
        const curVal = isSold ? null : tx.amount * entry.currentPrice;
        const lotPnl = isSold ? null : (entry.currentPrice - tx.priceAtTime) * tx.amount;
        const showTooltip = tx.type === 'SWAP_IN' || tx.type === 'SWAP_OUT';

        return React.createElement('div', { key: tx.id, className: 'fade-in', style: {
          display: 'grid', gridTemplateColumns: '130px 100px 130px 100px 100px 100px 100px 100px 110px',
          padding: '12px 20px', fontSize: 12, alignItems: 'center', borderBottom: '1px solid var(--border)',
          gap: 8, transition: 'background 0.2s',
        }, onMouseEnter: e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)',
           onMouseLeave: e => e.currentTarget.style.background = 'transparent' },
          React.createElement('span', { style: { color: 'var(--text-secondary)', fontSize: 11 } }, formatDateTime(tx.blockTimestamp)),
          React.createElement('div', null,
            React.createElement(TypeBadge, { type: tx.type, style: badgeStyle }),
          ),
          React.createElement('div', null,
            React.createElement('div', { style: { fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 } }, tx.wallet.alias.split(' ')[0]),
            tx.costSource && React.createElement('div', { style: { marginTop: 4 } }, React.createElement(CostBadge, { costSource: tx.costSource, fromWallet: tx.fromWallet }))
          ),
          React.createElement('span', { style: { textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 500 } }, formatNum(tx.amount)),
          React.createElement('span', { style: { textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' } }, formatUsd(tx.priceAtTime)),
          React.createElement('span', { style: { textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' } }, formatUsd(valAtTime)),
          React.createElement('span', { style: { textAlign: 'right', fontFamily: 'var(--font-mono)' } }, isSold ? '—' : formatUsd(entry.currentPrice)),
          React.createElement('span', { style: { textAlign: 'right', fontFamily: 'var(--font-mono)' } }, isSold ? React.createElement('em', { style: { color: 'var(--text-tertiary)', fontStyle: 'italic' } }, 'Sold/Out') : formatUsd(curVal)),
          React.createElement('div', { style: { textAlign: 'right' } }, isSold ? React.createElement('em', { style: { color: 'var(--text-tertiary)', fontStyle: 'italic', fontSize: 11 } }, '—') : React.createElement(PnlDisplay, { value: lotPnl, size: 'sm' })),
        );
      }),
      filteredTxs.length === 0 && React.createElement(EmptyState, { title: 'Sin transacciones', subtitle: 'Agrega tu primera transacción', icon: '📋' })
    )
  );
}

/* ═══════════════ POSITION HISTORY ═══════════════ */
function PositionHistoryPage({ tokenId, onNavigate }) {
  const entry = MOCK_PORTFOLIO.find(p => p.token.id === tokenId) || MOCK_PORTFOLIO[0];
  const t = entry.token;
  const cycles = MOCK_CLOSED_CYCLES.filter(c => c.token.id === t.id);

  return React.createElement(React.Fragment, null,
    React.createElement(PageHeader, {
      title: `Historial de Ciclos — ${t.symbol}`,
      backTo: `/token/${t.contract_address}/${t.network}`, onNavigate,
      breadcrumbs: [
        { label: 'Dashboard', onClick: () => onNavigate('/') },
        { label: t.symbol, onClick: () => onNavigate(`/token/${t.contract_address}/${t.network}`) },
        { label: 'Historial' }
      ]
    }),

    cycles.length === 0
      ? React.createElement(EmptyState, { title: 'Sin ciclos cerrados', subtitle: 'Los ciclos se cierran cuando el balance llega a 0', icon: '📊' })
      : React.createElement('div', { style: { display: 'grid', gap: 16 } },
          cycles.map(c => {
            const isProfit = c.realizedPnlUsd >= 0;
            return React.createElement('div', { key: c.cycleNumber, className: 'glass fade-in', style: { padding: 24 } },
              React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 } },
                React.createElement('div', null,
                  React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 } },
                    React.createElement('span', { style: { fontSize: 14, fontWeight: 700 } }, `Ciclo #${c.cycleNumber}`),
                    React.createElement('span', { style: { fontSize: 11, padding: '2px 8px', borderRadius: 6, background: isProfit ? 'var(--green-bg)' : 'var(--red-bg)', color: isProfit ? 'var(--green)' : 'var(--red)', fontWeight: 600 } }, isProfit ? 'GANANCIA' : 'PÉRDIDA')
                  ),
                  React.createElement('div', { style: { fontSize: 12, color: 'var(--text-tertiary)' } }, `${formatDate(c.openedAt)} → ${formatDate(c.closedAt)}`)
                ),
                React.createElement('div', { style: { textAlign: 'right' } },
                  React.createElement('div', { style: { fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono)', color: isProfit ? 'var(--green)' : 'var(--red)' } }, (isProfit ? '+' : '') + formatUsd(c.realizedPnlUsd)),
                )
              ),
              React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 } },
                ...[
                  ['Comprado', formatNum(c.totalBought, 2) + ' ' + t.symbol],
                  ['Precio Prom. Compra', formatUsd(c.avgBuyPrice)],
                  ['Vendido', formatNum(c.totalSold, 2) + ' ' + t.symbol],
                  ['Precio Prom. Venta', formatUsd(c.avgSellPrice)],
                ].map(([l, v]) => React.createElement('div', { key: l },
                  React.createElement('div', { style: { fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 4 } }, l),
                  React.createElement('div', { style: { fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-mono)' } }, v)
                ))
              )
            );
          })
        )
  );
}

Object.assign(window, { TokenDetailPage, PositionHistoryPage });
