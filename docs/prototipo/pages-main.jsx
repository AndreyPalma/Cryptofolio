// Pages: Login + Dashboard
const { useState, useEffect, useMemo } = React;

/* ═══════════════ LOGIN ═══════════════ */
function LoginPage({ onLogin }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!pw) { setError('Ingresa tu contraseña'); return; }
    setLoading(true);
    setTimeout(() => {
      if (pw === 'demo' || pw.length >= 3) { onLogin(); }
      else { setError('Contraseña incorrecta'); setLoading(false); }
    }, 800);
  };

  return React.createElement('div', { style: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)', position: 'relative', overflow: 'hidden' } },
    // Ambient effects
    React.createElement('div', { style: { position: 'absolute', top: '20%', left: '30%', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle, rgba(99,102,241,0.08), transparent 70%)', filter: 'blur(60px)', pointerEvents: 'none' } }),
    React.createElement('div', { style: { position: 'absolute', bottom: '10%', right: '20%', width: 400, height: 400, borderRadius: '50%', background: 'radial-gradient(circle, rgba(139,92,246,0.06), transparent 70%)', filter: 'blur(60px)', pointerEvents: 'none' } }),
    // Grid pattern
    React.createElement('div', { style: { position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)', backgroundSize: '60px 60px', pointerEvents: 'none' } }),

    React.createElement('form', { onSubmit: handleSubmit, className: 'glass slide-up', style: { width: 400, padding: 40, textAlign: 'center' } },
      React.createElement('div', { style: { width: 64, height: 64, borderRadius: 18, background: 'linear-gradient(135deg, var(--accent), #8B5CF6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 800, color: '#fff', margin: '0 auto 20px', boxShadow: '0 8px 30px rgba(99,102,241,0.3)' } }, 'CL'),
      React.createElement('h1', { style: { fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 4 } }, 'CryptoLedger'),
      React.createElement('p', { style: { fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 32, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase' } }, 'Portfolio Tracker'),
      React.createElement(GlassInput, { type: 'password', value: pw, onChange: v => { setPw(v); setError(''); }, placeholder: 'Contraseña', error, icon: '🔒', mono: true }),
      React.createElement('div', { style: { height: 20 } }),
      React.createElement(GlassButton, { variant: 'primary', size: 'lg', full: true, onClick: handleSubmit, disabled: loading }, loading ? 'Verificando...' : 'Entrar'),
      React.createElement('p', { style: { fontSize: 11, color: 'var(--text-tertiary)', marginTop: 24 } }, 'Demo: ingresa cualquier contraseña')
    )
  );
}

/* ═══════════════ DASHBOARD ═══════════════ */
function DashboardPage({ onNavigate, tweaks }) {
  const [expandedRow, setExpandedRow] = useState(null);
  const [updatedAgo, setUpdatedAgo] = useState(3);
  const [sortBy, setSortBy] = useState('value');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => { const i = setInterval(() => setUpdatedAgo(p => p < 60 ? p + 1 : 0), 1000); return () => clearInterval(i); }, []);

  const totals = useMemo(() => {
    let tv = 0, cb = 0;
    MOCK_PORTFOLIO.forEach(p => {
      tv += p.totalBalance * p.currentPrice;
      cb += p.totalBalance * p.wacAggregated;
    });
    return { totalValue: tv, costBasis: cb, pnlUsd: tv - cb, pnlPct: ((tv - cb) / cb) * 100 };
  }, []);

  const sorted = useMemo(() => {
    return [...MOCK_PORTFOLIO].sort((a, b) => {
      const va = sortBy === 'value' ? a.totalBalance * a.currentPrice : sortBy === 'pnl' ? (a.currentPrice - a.wacAggregated) * a.totalBalance : a.token.symbol.localeCompare(b.token.symbol);
      const vb = sortBy === 'value' ? b.totalBalance * b.currentPrice : sortBy === 'pnl' ? (b.currentPrice - b.wacAggregated) * b.totalBalance : 0;
      return sortDir === 'desc' ? vb - va : va - vb;
    });
  }, [sortBy, sortDir]);

  const layout = tweaks.dashboardLayout || 'top';
  const tableStyle = tweaks.tableStyle || 'default';
  const badgeStyle = tweaks.badgeStyle || 'default';
  const compact = tableStyle === 'compact';

  const statsCards = React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 28 } },
    React.createElement(StatCard, { label: 'Valor Total', value: formatUsd(totals.totalValue), trend: 'neutral', delay: 0 }),
    React.createElement(StatCard, { label: 'Costo Base', value: formatUsd(totals.costBasis), delay: 50 }),
    React.createElement(StatCard, { label: 'P&L Total', value: formatUsd(totals.pnlUsd), subValue: formatPct(totals.pnlPct), trend: totals.pnlUsd >= 0 ? 'up' : 'down', delay: 100 }),
    React.createElement(StatCard, { label: 'Activos', value: MOCK_PORTFOLIO.length + ' tokens', subValue: MOCK_WALLETS.length + ' wallets', delay: 150 })
  );

  const tableHeader = React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr 80px', padding: compact ? '8px 16px' : '10px 20px', fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase', borderBottom: '1px solid var(--border)' } },
    React.createElement('span', null, 'Token'),
    React.createElement('span', { style: { textAlign: 'right' } }, 'Balance'),
    React.createElement('span', { style: { textAlign: 'right' } }, 'Precio'),
    React.createElement('span', { style: { textAlign: 'right' } }, 'Valor'),
    React.createElement('span', { style: { textAlign: 'right' } }, 'WAC'),
    React.createElement('span', { style: { textAlign: 'right' } }, 'P&L'),
    React.createElement('span', { style: { textAlign: 'center' } }, 'Wallets'),
  );

  const tableRows = sorted.map((p, i) => {
    const val = p.totalBalance * p.currentPrice;
    const cost = p.totalBalance * p.wacAggregated;
    const pnl = val - cost;
    const pnlPct = ((p.currentPrice - p.wacAggregated) / p.wacAggregated) * 100;
    const expanded = expandedRow === p.token.id;

    return React.createElement('div', { key: p.token.id, className: 'fade-in', style: { animationDelay: `${i * 30}ms` } },
      React.createElement('div', { onClick: () => setExpandedRow(expanded ? null : p.token.id), style: {
        display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr 80px',
        padding: compact ? '10px 16px' : '14px 20px', alignItems: 'center', cursor: 'pointer',
        borderBottom: '1px solid var(--border)', transition: 'background 0.2s',
        background: expanded ? 'rgba(99,102,241,0.04)' : 'transparent',
      }, onMouseEnter: e => { if (!expanded) e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; },
         onMouseLeave: e => { if (!expanded) e.currentTarget.style.background = 'transparent'; } },
        // Token
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
          React.createElement(TokenLogo, { symbol: p.token.symbol, color: p.token.color, size: compact ? 30 : 36 }),
          React.createElement('div', null,
            React.createElement('div', { style: { fontWeight: 600, fontSize: compact ? 13 : 14, display: 'flex', alignItems: 'center', gap: 8 } }, p.token.symbol, React.createElement(NetworkBadge, { network: p.token.network })),
            React.createElement('div', { style: { fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 400, marginTop: 1 } }, p.token.name)
          )
        ),
        React.createElement('span', { style: { textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500 } }, formatNum(p.totalBalance)),
        React.createElement('span', { style: { textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500 } }, formatUsd(p.currentPrice)),
        React.createElement('span', { style: { textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600 } }, formatUsd(val)),
        React.createElement('span', { style: { textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' } }, formatUsd(p.wacAggregated)),
        React.createElement('div', { style: { textAlign: 'right' } }, React.createElement(PnlDisplay, { value: pnl, pct: pnlPct, size: 'sm' })),
        React.createElement('div', { style: { textAlign: 'center' } },
          React.createElement('span', { style: { background: 'var(--accent-bg)', color: 'var(--accent)', padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600 } }, p.walletCount)
        ),
      ),
      // Expanded wallet breakdown — uses same 7-col grid as parent
      expanded && React.createElement('div', { className: 'fade-in', style: { background: 'rgba(99,102,241,0.02)', borderBottom: '1px solid var(--border)', padding: '8px 0' } },
        // Sub-header
        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr 80px', padding: '4px 20px 8px', fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase' } },
          React.createElement('span', null, 'Wallet'),
          React.createElement('span', { style: { textAlign: 'right' } }, 'Balance'),
          React.createElement('span', { style: { textAlign: 'right' } }, 'WAC'),
          React.createElement('span', { style: { textAlign: 'right' } }, 'Costo Base'),
          React.createElement('span', { style: { textAlign: 'right' } }, 'Valor'),
          React.createElement('span', { style: { textAlign: 'right' } }, 'P&L'),
          React.createElement('span', null, ''),
        ),
        p.walletBreakdown.map(wb => React.createElement('div', { key: wb.wallet.id, onClick: (e) => { e.stopPropagation(); onNavigate(`/token/${p.token.contract_address}/${p.token.network}`); }, style: {
          display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr 80px', padding: '6px 20px', alignItems: 'center', cursor: 'pointer',
          fontSize: 12, borderTop: '1px solid rgba(255,255,255,0.03)', transition: 'background 0.15s',
        }, onMouseEnter: e => e.currentTarget.style.background = 'rgba(99,102,241,0.04)',
           onMouseLeave: e => e.currentTarget.style.background = 'transparent' },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 48 } },
            React.createElement('span', { style: { fontWeight: 500, color: 'var(--text-secondary)' } }, wb.wallet.alias),
            React.createElement(StorageBadge, { type: wb.wallet.storage_type })
          ),
          React.createElement('span', { style: { textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' } }, formatNum(wb.balance)),
          React.createElement('span', { style: { textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' } }, formatUsd(wb.wac)),
          React.createElement('span', { style: { textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' } }, formatUsd(wb.costBasis)),
          React.createElement('span', { style: { textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' } }, formatUsd(wb.currentValue)),
          React.createElement('div', { style: { textAlign: 'right' } }, React.createElement(PnlDisplay, { value: wb.pnlUsd, pct: wb.pnlPct, size: 'sm' })),
          React.createElement('span', null, ''),
        ))
      )
    );
  });

  return React.createElement(React.Fragment, null,
    React.createElement(PageHeader, {
      title: 'Dashboard',
      subtitle: 'Vista agregada de tu portafolio',
      actions: React.createElement(React.Fragment, null,
        React.createElement(UpdatedAgo, { seconds: updatedAgo }),
        React.createElement(GlassButton, { variant: 'primary', size: 'sm', onClick: () => onNavigate('/transactions/new') }, '＋ Nueva TX')
      )
    }),
    statsCards,
    React.createElement('div', { className: 'glass', style: { overflow: 'hidden' } },
      tableHeader,
      tableRows
    )
  );
}

Object.assign(window, { LoginPage, DashboardPage });
