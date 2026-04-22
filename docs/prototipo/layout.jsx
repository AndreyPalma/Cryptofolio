// Navigation Sidebar + Layout
const { useState, useEffect, useRef } = React;

function Sidebar({ currentRoute, onNavigate }) {
  const [collapsed, setCollapsed] = useState(false);
  const navItems = [
    { id: '/', icon: '◈', label: 'Dashboard' },
    { id: '/transactions/new', icon: '＋', label: 'Nueva Transacción' },
    { id: '/settings', icon: '⚙', label: 'Configuración' },
  ];

  return React.createElement('nav', { style: {
    width: collapsed ? 64 : 220, minWidth: collapsed ? 64 : 220, height: '100vh', position: 'sticky', top: 0,
    background: 'rgba(255,255,255,0.02)', borderRight: '1px solid var(--border)',
    display: 'flex', flexDirection: 'column', padding: collapsed ? '20px 8px' : '20px 12px',
    transition: 'all 0.3s cubic-bezier(0.4,0,0.2,1)', zIndex: 50, backdropFilter: 'blur(20px)',
  }},
    // Logo
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12, padding: collapsed ? '12px 4px' : '12px 12px', marginBottom: 32, cursor: 'pointer' }, onClick: () => onNavigate('/') },
      React.createElement('div', { style: { width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, var(--accent), #8B5CF6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, color: '#fff', flexShrink: 0 } }, 'CL'),
      !collapsed && React.createElement('div', null,
        React.createElement('div', { style: { fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' } }, 'CryptoLedger'),
        React.createElement('div', { style: { fontSize: 10, fontWeight: 500, color: 'var(--text-tertiary)', letterSpacing: '0.05em' } }, 'PORTFOLIO TRACKER')
      )
    ),

    // Nav items
    React.createElement('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: 4 } },
      navItems.map(item => {
        const active = currentRoute === item.id || (item.id !== '/' && currentRoute.startsWith(item.id));
        return React.createElement(NavItem, { key: item.id, ...item, active, collapsed, onClick: () => onNavigate(item.id) });
      })
    ),

    // Collapse toggle
    React.createElement('button', { onClick: () => setCollapsed(!collapsed), style: {
      background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
      color: 'var(--text-tertiary)', padding: '8px', cursor: 'pointer', fontSize: 12, marginTop: 8, transition: 'all 0.2s',
    }}, collapsed ? '→' : '←')
  );
}

function NavItem({ icon, label, active, collapsed, onClick }) {
  const [hover, setHover] = useState(false);
  return React.createElement('button', {
    onClick, onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false),
    style: {
      display: 'flex', alignItems: 'center', gap: 12, padding: collapsed ? '10px 0' : '10px 14px',
      borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', transition: 'all 0.2s',
      justifyContent: collapsed ? 'center' : 'flex-start', width: '100%',
      background: active ? 'rgba(99,102,241,0.12)' : hover ? 'rgba(255,255,255,0.04)' : 'transparent',
      color: active ? 'var(--accent)' : hover ? 'var(--text-primary)' : 'var(--text-secondary)',
      fontFamily: 'var(--font)', fontWeight: active ? 600 : 500, fontSize: 13, letterSpacing: '0.01em',
      position: 'relative',
    }},
    active && React.createElement('div', { style: { position: 'absolute', left: collapsed ? '50%' : 0, bottom: collapsed ? 0 : '50%', width: collapsed ? 20 : 3, height: collapsed ? 3 : 20, borderRadius: 2, background: 'var(--accent)', transform: collapsed ? 'translateX(-50%)' : 'translateY(50%)' } }),
    React.createElement('span', { style: { fontSize: 16, width: 20, textAlign: 'center', flexShrink: 0 } }, icon),
    !collapsed && label
  );
}

/* ── Main Layout ── */
function AppLayout({ children, currentRoute, onNavigate }) {
  return React.createElement('div', { style: { display: 'flex', minHeight: '100vh', background: 'var(--bg-primary)' } },
    React.createElement(Sidebar, { currentRoute, onNavigate }),
    React.createElement('main', { style: { flex: 1, minWidth: 0, overflow: 'auto', position: 'relative' } },
      // Ambient glow
      React.createElement('div', { style: { position: 'fixed', top: -200, right: -200, width: 600, height: 600, borderRadius: '50%', background: 'radial-gradient(circle, rgba(99,102,241,0.04) 0%, transparent 70%)', pointerEvents: 'none', zIndex: 0 } }),
      React.createElement('div', { style: { position: 'relative', zIndex: 1, padding: '32px 40px', maxWidth: 1400 } }, children)
    )
  );
}

/* ── Page Header ── */
function PageHeader({ title, subtitle, breadcrumbs, actions, backTo, onNavigate }) {
  return React.createElement('div', { className: 'fade-in', style: { marginBottom: 32 } },
    breadcrumbs && React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 12, color: 'var(--text-tertiary)' } },
      breadcrumbs.map((b, i) => React.createElement(React.Fragment, { key: i },
        i > 0 && React.createElement('span', null, '/'),
        React.createElement('span', { onClick: b.onClick, style: { cursor: b.onClick ? 'pointer' : 'default', color: b.onClick ? 'var(--text-secondary)' : 'var(--text-tertiary)', fontWeight: 500 } }, b.label)
      ))
    ),
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 16 } },
        backTo && React.createElement('button', { onClick: () => onNavigate(backTo), style: { background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 16 } }, '←'),
        React.createElement('div', null,
          React.createElement('h1', { style: { fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' } }, title),
          subtitle && React.createElement('p', { style: { fontSize: 13, color: 'var(--text-secondary)', marginTop: 4, fontWeight: 400 } }, subtitle)
        )
      ),
      actions && React.createElement('div', { style: { display: 'flex', gap: 10, alignItems: 'center' } }, actions)
    )
  );
}

Object.assign(window, { Sidebar, NavItem, AppLayout, PageHeader });
