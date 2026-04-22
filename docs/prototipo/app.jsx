// App Root with Routing + Tweaks Panel
const { useState, useEffect, useCallback } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "dashboardLayout": "top",
  "tableStyle": "default",
  "badgeStyle": "default"
}/*EDITMODE-END*/;

function TweaksPanel({ tweaks, onChange, visible }) {
  if (!visible) return null;
  const Section = ({ title, children }) => React.createElement('div', { style: { marginBottom: 18 } },
    React.createElement('div', { style: { fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 } }, title), children);
  const Opt = ({ label, active, onClick }) => React.createElement('button', { onClick, style: {
    padding: '6px 14px', borderRadius: 8, border: `1px solid ${active ? 'rgba(99,102,241,0.5)' : 'var(--border)'}`,
    background: active ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.02)', color: active ? 'var(--accent)' : 'var(--text-secondary)',
    fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)', transition: 'all 0.2s',
  }}, label);

  return React.createElement('div', { className: 'glass fade-in', style: {
    position: 'fixed', bottom: 20, right: 20, width: 280, padding: 20, zIndex: 100,
    background: 'rgba(15,15,24,0.92)', backdropFilter: 'blur(30px)', borderRadius: 'var(--radius-xl)',
    border: '1px solid rgba(99,102,241,0.2)', boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
  }},
    React.createElement('div', { style: { fontSize: 14, fontWeight: 700, marginBottom: 18, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-primary)' } },
      React.createElement('span', { style: { color: 'var(--accent)' } }, '◈'), 'Tweaks'),

    React.createElement(Section, { title: 'Layout Dashboard' },
      React.createElement('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
        React.createElement(Opt, { label: 'Cards Arriba', active: tweaks.dashboardLayout === 'top', onClick: () => onChange({ dashboardLayout: 'top' }) }),
        React.createElement(Opt, { label: 'Cards Sidebar', active: tweaks.dashboardLayout === 'sidebar', onClick: () => onChange({ dashboardLayout: 'sidebar' }) }),
      )),
    React.createElement(Section, { title: 'Estilo Tabla' },
      React.createElement('div', { style: { display: 'flex', gap: 6 } },
        React.createElement(Opt, { label: 'Default', active: tweaks.tableStyle === 'default', onClick: () => onChange({ tableStyle: 'default' }) }),
        React.createElement(Opt, { label: 'Compact', active: tweaks.tableStyle === 'compact', onClick: () => onChange({ tableStyle: 'compact' }) }),
        React.createElement(Opt, { label: 'Spacious', active: tweaks.tableStyle === 'spacious', onClick: () => onChange({ tableStyle: 'spacious' }) }),
      )),
    React.createElement(Section, { title: 'Estilo Badges' },
      React.createElement('div', { style: { display: 'flex', gap: 6 } },
        React.createElement(Opt, { label: 'Default', active: tweaks.badgeStyle === 'default', onClick: () => onChange({ badgeStyle: 'default' }) }),
        React.createElement(Opt, { label: 'Pill', active: tweaks.badgeStyle === 'pill', onClick: () => onChange({ badgeStyle: 'pill' }) }),
      )),
  );
}

function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [route, setRoute] = useState('/');
  const [tweaks, setTweaks] = useState({ ...TWEAK_DEFAULTS });
  const [tweaksVisible, setTweaksVisible] = useState(false);

  // Tweaks edit mode protocol
  useEffect(() => {
    const handler = (e) => {
      if (e.data?.type === '__activate_edit_mode') setTweaksVisible(true);
      if (e.data?.type === '__deactivate_edit_mode') setTweaksVisible(false);
    };
    window.addEventListener('message', handler);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', handler);
  }, []);

  const handleTweakChange = useCallback((partial) => {
    setTweaks(prev => {
      const next = { ...prev, ...partial };
      window.parent.postMessage({ type: '__edit_mode_set_keys', edits: partial }, '*');
      return next;
    });
  }, []);

  const navigate = useCallback((path) => setRoute(path), []);

  if (!loggedIn) return React.createElement(LoginPage, { onLogin: () => setLoggedIn(true) });

  // Parse route
  let page;
  if (route === '/') {
    page = React.createElement(DashboardPage, { onNavigate: navigate, tweaks });
  } else if (route === '/transactions/new') {
    page = React.createElement(AddTransactionPage, { onNavigate: navigate });
  } else if (route === '/settings') {
    page = React.createElement(SettingsPage, { onNavigate: navigate });
  } else if (route.startsWith('/token/') && route.endsWith('/history')) {
    // Find token by route
    const tokenId = findTokenByRoute(route.replace('/history', ''));
    page = React.createElement(PositionHistoryPage, { tokenId, onNavigate: navigate });
  } else if (route.startsWith('/token/')) {
    const tokenId = findTokenByRoute(route);
    page = React.createElement(TokenDetailPage, { tokenId, onNavigate: navigate, tweaks });
  } else {
    page = React.createElement(DashboardPage, { onNavigate: navigate, tweaks });
  }

  return React.createElement(React.Fragment, null,
    React.createElement(AppLayout, { currentRoute: route, onNavigate: navigate }, page),
    React.createElement(TweaksPanel, { tweaks, onChange: handleTweakChange, visible: tweaksVisible })
  );
}

function findTokenByRoute(route) {
  // /token/:address/:network
  const parts = route.split('/');
  const addr = parts[2];
  const net = parts[3];
  const tok = MOCK_TOKENS.find(t => t.contract_address === addr && t.network === net);
  return tok ? tok.id : MOCK_TOKENS[0].id;
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(App));
