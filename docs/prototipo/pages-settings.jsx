// Pages: Add Transaction + Settings
const { useState, useMemo, useEffect } = React;

/* ═══════════════ ADD TRANSACTION ═══════════════ */
function AddTransactionPage({ onNavigate }) {
  const [wallet, setWallet] = useState('');
  const [token, setToken] = useState('');
  const [type, setType] = useState('BUY');
  const [amount, setAmount] = useState('');
  const [price, setPrice] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 16));
  const [errors, setErrors] = useState({});
  const [toast, setToast] = useState(null);
  const [inheritWac, setInheritWac] = useState(null);

  const selectedToken = MOCK_TOKENS.find(t => t.id === token);
  const selectedWallet = MOCK_WALLETS.find(w => w.id === wallet);
  const currentPos = selectedToken ? MOCK_PORTFOLIO.find(p => p.token.id === token) : null;
  const currentBalance = currentPos ? currentPos.totalBalance : 0;
  const currentWac = currentPos ? currentPos.wacAggregated : 0;

  // Preview calc
  const preview = useMemo(() => {
    if (!amount || !price || !type) return null;
    const amt = parseFloat(amount);
    const prc = parseFloat(price);
    if (isNaN(amt) || isNaN(prc) || amt <= 0 || prc <= 0) return null;

    if (type === 'BUY' || type === 'SWAP_IN' || type === 'TRANSFER_IN') {
      const newBal = currentBalance + amt;
      const newCost = (currentWac * currentBalance) + (prc * amt);
      const newWac = newBal > 0 ? newCost / newBal : 0;
      return { newBalance: newBal, newWac, isNew: currentBalance === 0 };
    } else {
      if (amt > currentBalance) return { error: `Excede balance de ${formatNum(currentBalance)} tokens` };
      const newBal = currentBalance - amt;
      const realizedPnl = (prc - currentWac) * amt;
      return { newBalance: newBal, newWac: currentWac, realizedPnl, closes: newBal === 0 };
    }
  }, [amount, price, type, currentBalance, currentWac]);

  // TRANSFER_IN inheritance check
  useEffect(() => {
    if (type === 'TRANSFER_IN' && selectedToken && selectedWallet) {
      const otherWallets = MOCK_WALLETS.filter(w => w.id !== wallet);
      if (otherWallets.length > 0) {
        const pos = MOCK_PORTFOLIO.find(p => p.token.id === token);
        if (pos) {
          const wb = pos.walletBreakdown.find(w => otherWallets.some(ow => ow.id === w.wallet.id));
          if (wb) setInheritWac({ wac: wb.wac, walletAlias: wb.wallet.alias });
          else setInheritWac(null);
        }
      }
    } else { setInheritWac(null); }
  }, [type, token, wallet]);

  const handleSubmit = () => {
    const errs = {};
    if (!wallet) errs.wallet = 'Selecciona una wallet';
    if (!token) errs.token = 'Selecciona un token';
    if (!amount || parseFloat(amount) <= 0) errs.amount = 'Cantidad inválida';
    if (!price || parseFloat(price) <= 0) errs.price = 'Precio debe ser mayor a 0';
    if (preview?.error) errs.amount = preview.error;
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setToast('Transacción agregada. Ciclo actualizado.');
    setTimeout(() => onNavigate('/'), 1500);
  };

  return React.createElement(React.Fragment, null,
    React.createElement(PageHeader, { title: 'Nueva Transacción', subtitle: 'Ingresa una transacción manual', backTo: '/', onNavigate,
      breadcrumbs: [{ label: 'Dashboard', onClick: () => onNavigate('/') }, { label: 'Nueva Transacción' }] }),
    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' } },
      // Form
      React.createElement('div', { className: 'glass fade-in', style: { padding: 28 } },
        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 18 } },
          React.createElement(GlassSelect, { label: 'Wallet', value: wallet, onChange: setWallet, options: [{ value: '', label: 'Seleccionar...' }, ...MOCK_WALLETS.map(w => ({ value: w.id, label: `${w.alias} (${w.network})` }))] }),
          React.createElement(GlassSelect, { label: 'Token', value: token, onChange: setToken, options: [{ value: '', label: 'Seleccionar...' }, ...MOCK_TOKENS.map(t => ({ value: t.id, label: `${t.symbol} — ${t.name}` }))] }),
        ),
        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 18, marginBottom: 18 } },
          React.createElement(GlassSelect, { label: 'Tipo', value: type, onChange: setType, options: ['BUY','SELL','SWAP_IN','SWAP_OUT','TRANSFER_IN','TRANSFER_OUT'].map(t => ({ value: t, label: t.replace('_', ' ') })) }),
          React.createElement(GlassInput, { label: 'Cantidad', value: amount, onChange: setAmount, type: 'number', placeholder: '0.00', error: errors.amount, mono: true }),
          React.createElement(GlassInput, { label: 'Precio USD', value: price, onChange: setPrice, type: 'number', placeholder: '0.00', error: errors.price, mono: true }),
        ),
        React.createElement(GlassInput, { label: 'Fecha y Hora', value: date, onChange: setDate, type: 'datetime-local', style: { marginBottom: 20, maxWidth: 300 } }),

        // Inherit WAC suggestion
        inheritWac && React.createElement('div', { className: 'fade-in', style: { background: 'var(--green-bg)', border: '1px solid var(--green-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px', marginBottom: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          React.createElement('div', null,
            React.createElement('div', { style: { fontSize: 12, fontWeight: 600, color: 'var(--green)', marginBottom: 2 } }, `Heredar WAC de ${inheritWac.walletAlias}?`),
            React.createElement('div', { style: { fontSize: 11, color: 'var(--text-secondary)' } }, `WAC disponible: ${formatUsd(inheritWac.wac)}`)
          ),
          React.createElement(GlassButton, { variant: 'success', size: 'sm', onClick: () => setPrice(String(inheritWac.wac)) }, 'Usar este precio')
        ),

        React.createElement('div', { style: { display: 'flex', gap: 12, justifyContent: 'flex-end' } },
          React.createElement(GlassButton, { variant: 'ghost', onClick: () => onNavigate('/') }, 'Cancelar'),
          React.createElement(GlassButton, { variant: 'primary', onClick: handleSubmit, disabled: preview?.error }, 'Confirmar Transacción'),
        )
      ),

      // Preview panel
      React.createElement('div', { className: 'glass fade-in', style: { padding: 24, animationDelay: '100ms' } },
        React.createElement('div', { style: { fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 16 } }, 'Vista Previa de Impacto'),
        selectedToken ? React.createElement(React.Fragment, null,
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 } },
            React.createElement(TokenLogo, { symbol: selectedToken.symbol, color: selectedToken.color, size: 32 }),
            React.createElement('div', null,
              React.createElement('div', { style: { fontWeight: 600, fontSize: 14 } }, selectedToken.symbol),
              React.createElement('div', { style: { fontSize: 11, color: 'var(--text-tertiary)' } }, `Balance actual: ${formatNum(currentBalance)}`)
            )
          ),
          preview && !preview.error && React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
              React.createElement('span', { style: { fontSize: 12, color: 'var(--text-secondary)' } }, 'Nuevo Balance'),
              React.createElement('span', { style: { fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-mono)' } }, formatNum(preview.newBalance))
            ),
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
              React.createElement('span', { style: { fontSize: 12, color: 'var(--text-secondary)' } }, 'Nuevo WAC'),
              React.createElement('span', { style: { fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--accent)' } }, formatUsd(preview.newWac))
            ),
            preview.isNew && React.createElement('div', { style: { fontSize: 11, color: 'var(--green)', fontWeight: 500, padding: '6px 10px', background: 'var(--green-bg)', borderRadius: 'var(--radius-sm)' } }, '✦ Nuevo ciclo de posición'),
            preview.closes && React.createElement('div', { style: { fontSize: 11, color: 'var(--orange)', fontWeight: 500, padding: '6px 10px', background: 'var(--orange-bg)', borderRadius: 'var(--radius-sm)' } }, '⚠ Cierra posición actual'),
            preview.realizedPnl !== undefined && React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between' } },
              React.createElement('span', { style: { fontSize: 12, color: 'var(--text-secondary)' } }, 'P&L Realizado'),
              React.createElement(PnlDisplay, { value: preview.realizedPnl, size: 'sm' })
            ),
          ),
          preview?.error && React.createElement('div', { style: { color: 'var(--red)', fontSize: 12, fontWeight: 500, padding: '8px 12px', background: 'var(--red-bg)', borderRadius: 'var(--radius-sm)' } }, preview.error)
        ) : React.createElement('div', { style: { fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center', padding: 20 } }, 'Selecciona un token para ver el impacto')
      )
    ),
    toast && React.createElement(Toast, { message: toast, onClose: () => setToast(null) })
  );
}

/* ═══════════════ SETTINGS ═══════════════ */
/* ═══════════════ ADD WALLET MODAL ═══════════════ */
function AddWalletModal({ onClose, onAdd }) {
  const [address, setAddress] = useState('');
  const [alias, setAlias] = useState('');
  const [network, setNetwork] = useState('ETH');
  const [storageType, setStorageType] = useState('HOT');
  const [errors, setErrors] = useState({});

  const handleAdd = () => {
    const errs = {};
    if (!address) errs.address = 'Dirección requerida';
    else if (!/^0x[a-fA-F0-9]{40}$/.test(address)) errs.address = 'Dirección Ethereum inválida (0x + 40 hex)';
    if (!alias) errs.alias = 'Alias requerido';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    onAdd({ address, alias, network, storage_type: storageType });
    onClose();
  };

  return React.createElement('div', { style: { position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }, onClick: onClose },
    // Backdrop
    React.createElement('div', { style: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' } }),
    // Modal
    React.createElement('div', { className: 'glass slide-up', onClick: e => e.stopPropagation(), style: {
      position: 'relative', width: 460, padding: 32, background: 'rgba(15,15,24,0.95)',
      border: '1px solid rgba(99,102,241,0.2)', borderRadius: 'var(--radius-xl)',
      boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
    }},
      // Header
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 } },
        React.createElement('h2', { style: { fontSize: 18, fontWeight: 700 } }, 'Agregar Wallet'),
        React.createElement('button', { onClick: onClose, style: { background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-secondary)', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 14 } }, '✕')
      ),
      // Form
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
        React.createElement(GlassInput, { label: 'Dirección', value: address, onChange: setAddress, placeholder: '0x742d35Cc6634C0532925a3b844Bc9e...', error: errors.address, mono: true }),
        React.createElement(GlassInput, { label: 'Alias', value: alias, onChange: setAlias, placeholder: 'Mi Wallet Principal', error: errors.alias }),
        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 } },
          React.createElement(GlassSelect, { label: 'Red', value: network, onChange: setNetwork, options: [{ value: 'ETH', label: 'Ethereum' }, { value: 'BSC', label: 'BSC' }] }),
          React.createElement(GlassSelect, { label: 'Tipo de Almacenamiento', value: storageType, onChange: setStorageType, options: [{ value: 'HOT', label: 'Hot Wallet' }, { value: 'COLD', label: 'Cold Wallet' }, { value: 'EXCHANGE', label: 'Exchange' }] }),
        ),
        // Network indicator
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: network === 'ETH' ? 'rgba(98,126,234,0.06)' : 'rgba(243,186,47,0.06)', border: `1px solid ${network === 'ETH' ? 'rgba(98,126,234,0.15)' : 'rgba(243,186,47,0.15)'}`, borderRadius: 'var(--radius-md)' } },
          React.createElement('span', { style: { fontSize: 18 } }, network === 'ETH' ? '⟠' : '◈'),
          React.createElement('div', null,
            React.createElement('div', { style: { fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' } }, network === 'ETH' ? 'Ethereum Mainnet' : 'BNB Smart Chain'),
            React.createElement('div', { style: { fontSize: 10, color: 'var(--text-tertiary)' } }, network === 'ETH' ? 'Sync via Etherscan API' : 'Sync via BscScan API'),
          )
        ),
        // Actions
        React.createElement('div', { style: { display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 } },
          React.createElement(GlassButton, { variant: 'ghost', onClick: onClose }, 'Cancelar'),
          React.createElement(GlassButton, { variant: 'primary', onClick: handleAdd }, 'Agregar Wallet'),
        )
      )
    )
  );
}

function SettingsPage({ onNavigate }) {
  const [activeTab, setActiveTab] = useState('wallets');
  const [syncingWallet, setSyncingWallet] = useState(null);
  const [syncResult, setSyncResult] = useState(null);
  const [apiKeys, setApiKeys] = useState({ ETHERSCAN: '••••••••', BSCSCAN: '••••••••', TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '' });
  const [toast, setToast] = useState(null);
  const [showAddWallet, setShowAddWallet] = useState(false);
  const [wallets, setWallets] = useState(MOCK_WALLETS);

  const handleSync = (walletId) => {
    setSyncingWallet(walletId);
    setSyncResult(null);
    setTimeout(() => {
      setSyncingWallet(null);
      setSyncResult({ walletId, synced: 3, skipped: 1, swapsDecomposed: 1, transfersPendingCost: 0 });
      setToast('Sincronización completada: 3 nuevas TX');
    }, 2000);
  };

  const tabs = [
    { id: 'wallets', label: 'Wallets', icon: '◎' },
    { id: 'tokens', label: 'Tokens', icon: '◆' },
    { id: 'api', label: 'API Keys', icon: '🔑' },
    { id: 'telegram', label: 'Telegram', icon: '📡' },
  ];

  return React.createElement(React.Fragment, null,
    React.createElement(PageHeader, { title: 'Configuración', subtitle: 'Gestiona wallets, tokens y APIs' }),
    // Tab bar
    React.createElement('div', { style: { display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid var(--border)', paddingBottom: 0 } },
      tabs.map(tab => React.createElement('button', { key: tab.id, onClick: () => setActiveTab(tab.id), style: {
        background: 'none', border: 'none', color: activeTab === tab.id ? 'var(--accent)' : 'var(--text-secondary)',
        fontSize: 13, fontWeight: 600, fontFamily: 'var(--font)', padding: '10px 18px', cursor: 'pointer',
        borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent', transition: 'all 0.2s',
        display: 'flex', alignItems: 'center', gap: 8,
      }}, React.createElement('span', null, tab.icon), tab.label))
    ),

    // Add Wallet Modal
    showAddWallet && React.createElement(AddWalletModal, { onClose: () => setShowAddWallet(false), onAdd: (w) => { setWallets(prev => [...prev, { ...w, id: 'w' + Date.now(), last_synced_block: 0, is_active: true }]); setToast('Wallet agregada exitosamente'); } }),

    // WALLETS TAB
    activeTab === 'wallets' && React.createElement('div', { style: { display: 'grid', gap: 14 } },
      wallets.map(w => {
        const isSyncing = syncingWallet === w.id;
        const result = syncResult?.walletId === w.id ? syncResult : null;
        return React.createElement('div', { key: w.id, className: 'glass fade-in', style: { padding: '18px 24px' } },
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 14 } },
              React.createElement('div', { style: { width: 40, height: 40, borderRadius: 10, background: w.network === 'ETH' ? 'rgba(98,126,234,0.1)' : 'rgba(243,186,47,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, border: `1px solid ${w.network === 'ETH' ? 'rgba(98,126,234,0.2)' : 'rgba(243,186,47,0.2)'}` } }, w.network === 'ETH' ? '⟠' : '◈'),
              React.createElement('div', null,
                React.createElement('div', { style: { fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 } }, w.alias, React.createElement(NetworkBadge, { network: w.network }), React.createElement(StorageBadge, { type: w.storage_type })),
                React.createElement('div', { style: { fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', marginTop: 2, cursor: 'pointer' }, title: w.address }, shortAddr(w.address)),
              )
            ),
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
              React.createElement('span', { style: { fontSize: 11, color: 'var(--text-tertiary)' } }, `Bloque: ${w.last_synced_block.toLocaleString()}`),
              React.createElement(GlassButton, { variant: 'primary', size: 'sm', onClick: () => handleSync(w.id), disabled: isSyncing }, isSyncing ? '⟳ Sincronizando...' : '⟳ Sync'),
            )
          ),
          result && React.createElement('div', { className: 'fade-in', style: { marginTop: 12, padding: '10px 14px', background: 'var(--green-bg)', border: '1px solid var(--green-border)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--green)', fontWeight: 500 } },
            `${result.synced} nuevas TX | ${result.swapsDecomposed} swap descompuesto | ${result.transfersPendingCost} transfers pendientes`
          )
        );
      }),
      React.createElement(GlassButton, { variant: 'default', full: true, onClick: () => setShowAddWallet(true), style: { border: '1px dashed var(--glass-border)', marginTop: 8 } }, '＋ Agregar Wallet')
    ),

    // TOKENS TAB
    activeTab === 'tokens' && React.createElement('div', { className: 'glass', style: { overflow: 'hidden' } },
      MOCK_TOKENS.map((t, i) => React.createElement('div', { key: t.id, className: 'fade-in', style: {
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 24px',
        borderBottom: i < MOCK_TOKENS.length - 1 ? '1px solid var(--border)' : 'none',
      }},
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
          React.createElement(TokenLogo, { symbol: t.symbol, color: t.color, size: 32 }),
          React.createElement('div', null,
            React.createElement('div', { style: { fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 } }, t.symbol, React.createElement(NetworkBadge, { network: t.network })),
            React.createElement('div', { style: { fontSize: 11, color: 'var(--text-tertiary)' } }, t.name),
          )
        ),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 16 } },
          React.createElement('div', { style: { textAlign: 'right' } },
            React.createElement('div', { style: { fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 2 } }, 'Target Exit'),
            React.createElement('span', { style: { fontFamily: 'var(--font-mono)', fontSize: 13, color: t.target_exit_price ? 'var(--text-primary)' : 'var(--text-tertiary)' } }, t.target_exit_price ? formatUsd(t.target_exit_price) : '—')
          ),
          React.createElement('div', { style: { width: 36, height: 20, borderRadius: 10, background: 'var(--green)', cursor: 'pointer', position: 'relative', transition: 'background 0.2s' } },
            React.createElement('div', { style: { position: 'absolute', top: 2, left: 18, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' } })
          )
        )
      ))
    ),

    // API KEYS TAB
    activeTab === 'api' && React.createElement('div', { style: { display: 'grid', gap: 16 } },
      [{ key: 'ETHERSCAN', label: 'Etherscan API Key', desc: 'Para sincronización Ethereum' }, { key: 'BSCSCAN', label: 'BscScan API Key', desc: 'Para sincronización BSC' }].map(api =>
        React.createElement('div', { key: api.key, className: 'glass fade-in', style: { padding: '20px 24px' } },
          React.createElement('div', { style: { fontSize: 14, fontWeight: 600, marginBottom: 4 } }, api.label),
          React.createElement('div', { style: { fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 12 } }, api.desc),
          React.createElement('div', { style: { display: 'flex', gap: 10, alignItems: 'flex-end' } },
            React.createElement(GlassInput, { value: apiKeys[api.key], onChange: v => setApiKeys(p => ({...p, [api.key]: v})), type: 'password', mono: true, style: { flex: 1 } }),
            React.createElement(GlassButton, { variant: 'success', size: 'sm' }, '✓ Test'),
          )
        )
      )
    ),

    // TELEGRAM TAB
    activeTab === 'telegram' && React.createElement('div', { className: 'glass fade-in', style: { padding: 28, maxWidth: 600 } },
      React.createElement('div', { style: { fontSize: 16, fontWeight: 600, marginBottom: 4 } }, 'Alertas Telegram'),
      React.createElement('div', { style: { fontSize: 12, color: 'var(--text-secondary)', marginBottom: 24 } }, 'Recibe alertas cuando un token alcance tu precio objetivo'),
      React.createElement('div', { style: { display: 'grid', gap: 16 } },
        React.createElement(GlassInput, { label: 'Bot Token', value: apiKeys.TELEGRAM_BOT_TOKEN, onChange: v => setApiKeys(p => ({...p, TELEGRAM_BOT_TOKEN: v})), placeholder: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11', mono: true }),
        React.createElement(GlassInput, { label: 'Chat ID', value: apiKeys.TELEGRAM_CHAT_ID, onChange: v => setApiKeys(p => ({...p, TELEGRAM_CHAT_ID: v})), placeholder: '-1001234567890', mono: true }),
      ),
      React.createElement('div', { style: { display: 'flex', gap: 10, marginTop: 20 } },
        React.createElement(GlassButton, { variant: 'primary' }, 'Guardar'),
        React.createElement(GlassButton, { variant: 'default' }, '📡 Enviar Test'),
      )
    ),

    toast && React.createElement(Toast, { message: toast, onClose: () => setToast(null) })
  );
}

Object.assign(window, { AddTransactionPage, SettingsPage });
