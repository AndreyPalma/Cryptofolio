// Shared UI Components for CryptoLedger
const { useState, useRef, useEffect } = React;

/* ── Token Logo (generates colored icon from symbol) ── */
function TokenLogo({ symbol, color, size = 36 }) {
  const s = { width: size, height: size, borderRadius: '50%', background: `linear-gradient(135deg, ${color}33, ${color}66)`, border: `1.5px solid ${color}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.36, fontWeight: 700, color: color, letterSpacing: '-0.02em', flexShrink: 0 };
  return React.createElement('div', { style: s }, symbol.slice(0, 2));
}

/* ── Network Badge ── */
function NetworkBadge({ network }) {
  const colors = { ETH: { bg: '#627EEA22', color: '#627EEA', border: '#627EEA44' }, BSC: { bg: '#F3BA2F22', color: '#F3BA2F', border: '#F3BA2F44' } };
  const c = colors[network] || colors.ETH;
  return React.createElement('span', { style: { fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: c.bg, color: c.color, border: `1px solid ${c.border}`, fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' } }, network);
}

/* ── Type Badge ── */
function TypeBadge({ type, style: badgeStyle = 'default' }) {
  const config = {
    BUY: { bg: 'var(--green-bg)', color: 'var(--green)', border: 'var(--green-border)', label: 'BUY' },
    SELL: { bg: 'var(--red-bg)', color: 'var(--red)', border: 'var(--red-border)', label: 'SELL' },
    SWAP_IN: { bg: 'var(--blue-bg)', color: 'var(--blue)', border: 'rgba(59,130,246,0.25)', label: 'SWAP IN' },
    SWAP_OUT: { bg: 'var(--orange-bg)', color: 'var(--orange)', border: 'rgba(249,115,22,0.25)', label: 'SWAP OUT' },
    TRANSFER_IN: { bg: 'var(--purple-bg)', color: 'var(--purple)', border: 'rgba(168,85,247,0.25)', label: 'TRANSFER IN' },
    TRANSFER_OUT: { bg: 'rgba(156,163,175,0.1)', color: '#9CA3AF', border: 'rgba(156,163,175,0.25)', label: 'TRANSFER OUT' },
  };
  const c = config[type] || config.BUY;
  const pill = badgeStyle === 'pill';
  return React.createElement('span', { style: { fontSize: pill ? 10 : 11, fontWeight: 600, padding: pill ? '3px 10px' : '2px 8px', borderRadius: pill ? 20 : 6, background: c.bg, color: c.color, border: `1px solid ${c.border}`, whiteSpace: 'nowrap', letterSpacing: '0.03em' } }, c.label);
}

/* ── Cost Source Badge ── */
function CostBadge({ costSource, fromWallet }) {
  if (!costSource || costSource === 'MARKET') return null;
  const [showTip, setShowTip] = React.useState(false);
  const c = costSource === 'INHERITED'
    ? { bg: 'var(--green-bg)', color: 'var(--green)', border: 'var(--green-border)', icon: '↗', label: 'WAC heredado' }
    : { bg: 'rgba(156,163,175,0.1)', color: '#9CA3AF', border: 'rgba(156,163,175,0.25)', icon: '✎', label: 'Costo manual' };
  const tipText = costSource === 'INHERITED'
    ? `Precio basado en el WAC de la wallet origen${fromWallet ? ` (${fromWallet})` : ''}. Mantiene continuidad contable entre tus wallets.`
    : 'Precio ingresado manualmente por el usuario.';
  return React.createElement('div', { style: { position: 'relative', display: 'inline-flex' }, onMouseEnter: () => setShowTip(true), onMouseLeave: () => setShowTip(false) },
    React.createElement('span', { style: { fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: c.bg, color: c.color, border: `1px solid ${c.border}`, cursor: 'help', display: 'inline-flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' } }, c.icon, ' ', c.label),
    showTip && React.createElement('div', { className: 'fade-in', style: { position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 6, width: 240, padding: '10px 12px', background: 'rgba(15,15,24,0.96)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 'var(--radius-md)', boxShadow: '0 12px 40px rgba(0,0,0,0.6)', fontSize: 11, lineHeight: 1.5, color: 'var(--text-secondary)', fontWeight: 400, zIndex: 50, pointerEvents: 'none' } },
      React.createElement('div', { style: { fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 } }, costSource === 'INHERITED' ? '↗ WAC Heredado' : '✎ Costo Manual'),
      tipText
    )
  );
}

/* ── Storage Badge ── */
function StorageBadge({ type }) {
  const c = { HOT: { bg: 'var(--orange-bg)', color: 'var(--orange)' }, COLD: { bg: 'var(--blue-bg)', color: 'var(--blue)' }, EXCHANGE: { bg: 'var(--purple-bg)', color: 'var(--purple)' } };
  const s = c[type] || c.HOT;
  return React.createElement('span', { style: { fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: s.bg, color: s.color } }, type);
}

/* ── P&L Display ── */
function PnlDisplay({ value, pct, size = 'md' }) {
  const isPos = value >= 0;
  const color = value === 0 ? 'var(--text-secondary)' : isPos ? 'var(--green)' : 'var(--red)';
  const fs = size === 'lg' ? 20 : size === 'sm' ? 12 : 14;
  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end' } },
    React.createElement('span', { style: { color, fontSize: fs, fontWeight: 600, fontFamily: 'var(--font-mono)' } }, (isPos && value !== 0 ? '+' : '') + formatUsd(value)),
    pct !== undefined && React.createElement('span', { style: { color, fontSize: fs - 2, fontWeight: 500, opacity: 0.8, fontFamily: 'var(--font-mono)' } }, formatPct(pct))
  );
}

/* ── Stat Card (glass) ── */
function StatCard({ label, value, subValue, icon, trend, delay = 0 }) {
  return React.createElement('div', { className: 'glass fade-in', style: { padding: '20px 24px', animationDelay: `${delay}ms`, position: 'relative', overflow: 'hidden' } },
    React.createElement('div', { style: { position: 'absolute', top: -20, right: -20, width: 80, height: 80, borderRadius: '50%', background: trend === 'up' ? 'rgba(34,197,94,0.06)' : trend === 'down' ? 'rgba(239,68,68,0.06)' : 'rgba(99,102,241,0.06)', filter: 'blur(20px)' } }),
    React.createElement('div', { style: { fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 8, letterSpacing: '0.05em', textTransform: 'uppercase' } }, label),
    React.createElement('div', { style: { fontSize: 24, fontWeight: 700, fontFamily: 'var(--font-mono)', color: trend === 'up' ? 'var(--green)' : trend === 'down' ? 'var(--red)' : 'var(--text-primary)' } }, value),
    subValue && React.createElement('div', { style: { fontSize: 12, fontWeight: 500, color: trend === 'up' ? 'var(--green)' : trend === 'down' ? 'var(--red)' : 'var(--text-secondary)', marginTop: 4, fontFamily: 'var(--font-mono)' } }, subValue)
  );
}

/* ── Glass Button ── */
function GlassButton({ children, onClick, variant = 'default', size = 'md', disabled, style: extraStyle, full }) {
  const [hover, setHover] = useState(false);
  const base = { fontFamily: 'var(--font)', fontWeight: 600, borderRadius: var_radius(size), cursor: disabled ? 'not-allowed' : 'pointer', transition: 'all 0.2s', display: 'inline-flex', alignItems: 'center', gap: 8, justifyContent: 'center', opacity: disabled ? 0.4 : 1, width: full ? '100%' : 'auto', letterSpacing: '0.02em' };
  const sizes = { sm: { padding: '6px 14px', fontSize: 12 }, md: { padding: '10px 20px', fontSize: 13 }, lg: { padding: '14px 28px', fontSize: 15 } };
  const variants = {
    default: { background: hover ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-primary)' },
    primary: { background: hover ? 'var(--accent)' : 'rgba(99,102,241,0.85)', border: '1px solid rgba(99,102,241,0.5)', color: '#fff', boxShadow: hover ? '0 4px 20px rgba(99,102,241,0.3)' : 'none' },
    success: { background: hover ? 'var(--green)' : 'rgba(34,197,94,0.85)', border: '1px solid rgba(34,197,94,0.5)', color: '#fff' },
    danger: { background: hover ? 'var(--red)' : 'rgba(239,68,68,0.15)', border: '1px solid var(--red-border)', color: 'var(--red)' },
    ghost: { background: hover ? 'rgba(255,255,255,0.04)' : 'transparent', border: '1px solid transparent', color: 'var(--text-secondary)' },
  };
  return React.createElement('button', { onClick: disabled ? undefined : onClick, onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false), style: { ...base, ...sizes[size], ...variants[variant], ...extraStyle } }, children);
}
function var_radius(size) { return size === 'sm' ? 'var(--radius-sm)' : size === 'lg' ? 'var(--radius-lg)' : 'var(--radius-md)'; }

/* ── Glass Input ── */
function GlassInput({ label, value, onChange, type = 'text', placeholder, error, icon, style: extraStyle, mono }) {
  const [focus, setFocus] = useState(false);
  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, ...extraStyle } },
    label && React.createElement('label', { style: { fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', letterSpacing: '0.04em' } }, label),
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', background: focus ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)', border: `1px solid ${error ? 'var(--red-border)' : focus ? 'rgba(99,102,241,0.4)' : 'var(--glass-border)'}`, borderRadius: 'var(--radius-md)', padding: '0 14px', transition: 'all 0.2s' } },
      icon && React.createElement('span', { style: { marginRight: 10, color: 'var(--text-tertiary)', fontSize: 16 } }, icon),
      React.createElement('input', { type, value, onChange: e => onChange(e.target.value), placeholder, onFocus: () => setFocus(true), onBlur: () => setFocus(false), style: { flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 14, fontFamily: mono ? 'var(--font-mono)' : 'var(--font)', padding: '12px 0', fontWeight: 500 } })
    ),
    error && React.createElement('span', { style: { fontSize: 11, color: 'var(--red)', fontWeight: 500 } }, error)
  );
}

/* ── Glass Select ── */
function GlassSelect({ label, value, onChange, options, style: extraStyle }) {
  const [focus, setFocus] = useState(false);
  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, ...extraStyle } },
    label && React.createElement('label', { style: { fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', letterSpacing: '0.04em' } }, label),
    React.createElement('select', { value, onChange: e => onChange(e.target.value), onFocus: () => setFocus(true), onBlur: () => setFocus(false), style: { background: focus ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)', border: `1px solid ${focus ? 'rgba(99,102,241,0.4)' : 'var(--glass-border)'}`, borderRadius: 'var(--radius-md)', padding: '12px 14px', color: 'var(--text-primary)', fontSize: 14, fontFamily: 'var(--font)', fontWeight: 500, outline: 'none', cursor: 'pointer', appearance: 'none', transition: 'all 0.2s' } },
      options.map(o => React.createElement('option', { key: o.value, value: o.value, style: { background: '#1a1a2e' } }, o.label))
    )
  );
}

/* ── Toast ── */
function Toast({ message, type = 'success', onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t); }, []);
  const configs = {
    success: { bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.25)', color: '#6ee7a0', icon: '✓' },
    error: { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.25)', color: '#fca5a5', icon: '✕' },
    info: { bg: 'rgba(99,102,241,0.12)', border: 'rgba(99,102,241,0.25)', color: '#a5b4fc', icon: 'ℹ' },
  };
  const c = configs[type] || configs.success;
  return React.createElement('div', { className: 'fade-in', style: {
    position: 'fixed', bottom: 24, right: 24, display: 'flex', alignItems: 'center', gap: 10,
    background: c.bg, backdropFilter: 'blur(20px)', border: `1px solid ${c.border}`,
    padding: '12px 20px', borderRadius: 'var(--radius-md)', zIndex: 1000,
    boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
  }},
    React.createElement('span', { style: { width: 22, height: 22, borderRadius: '50%', background: c.border, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: c.color, fontWeight: 700, flexShrink: 0 } }, c.icon),
    React.createElement('span', { style: { fontSize: 13, fontWeight: 500, color: c.color } }, message),
    React.createElement('button', { onClick: onClose, style: { background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 14, marginLeft: 8, padding: 0 } }, '✕')
  );
}

/* ── Empty State ── */
function EmptyState({ icon, title, subtitle, action }) {
  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', color: 'var(--text-secondary)' } },
    React.createElement('div', { style: { fontSize: 48, marginBottom: 16, opacity: 0.3 } }, icon || '📦'),
    React.createElement('div', { style: { fontSize: 16, fontWeight: 600, marginBottom: 6 } }, title),
    subtitle && React.createElement('div', { style: { fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 20 } }, subtitle),
    action
  );
}

/* ── Updated Indicator ── */
function UpdatedAgo({ seconds }) {
  return React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 500 } },
    React.createElement('div', { style: { width: 6, height: 6, borderRadius: '50%', background: seconds < 10 ? 'var(--green)' : seconds < 30 ? 'var(--orange)' : 'var(--red)', animation: 'pulse 2s infinite' } }),
    `Actualizado hace ${seconds}s`
  );
}

Object.assign(window, { TokenLogo, NetworkBadge, TypeBadge, CostBadge, StorageBadge, PnlDisplay, StatCard, GlassButton, GlassInput, GlassSelect, Toast, EmptyState, UpdatedAgo });
