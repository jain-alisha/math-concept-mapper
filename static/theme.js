// Span color themes: a brand accent + a matching 6-hue node palette per
// preset (not a full custom picker or light/dark mode - kept deliberately
// contained). Applied on every page. Works fully offline/logged-out via
// localStorage; syncs to the account's user_metadata when signed in.
(function () {
  const STORAGE_KEY = 'spanTheme';

  const PRESETS = {
    default: {
      label: 'Default', brand: '#1976d2',
      nodeColors: [
        { fill: '#eaf2ff', stroke: '#b9d4f8', text: '#1f4f91' },
        { fill: '#f1edff', stroke: '#cabdf7', text: '#6b4fd8' },
        { fill: '#e8f7f7', stroke: '#a8dede', text: '#1f7a7a' },
        { fill: '#eafbf1', stroke: '#a9e6c3', text: '#1f8a4c' },
        { fill: '#fff8e8', stroke: '#f0d896', text: '#a6790a' },
        { fill: '#fdeef8', stroke: '#f2b8e0', text: '#b23d8f' },
      ],
    },
    cool: {
      label: 'Cool', brand: '#2f6fb5',
      nodeColors: [
        { fill: '#eaf2ff', stroke: '#b9d4f8', text: '#1f4f91' },
        { fill: '#eef0ff', stroke: '#c2c8f7', text: '#4650b8' },
        { fill: '#e8f7f7', stroke: '#a8dede', text: '#1f7a7a' },
        { fill: '#e7fbf5', stroke: '#a7e8d0', text: '#147a5c' },
        { fill: '#eef2f6', stroke: '#c3d0dc', text: '#45607a' },
        { fill: '#f3eefd', stroke: '#d0bdf7', text: '#6b3fc4' },
      ],
    },
    warm: {
      label: 'Warm', brand: '#e07a2e',
      nodeColors: [
        { fill: '#ffefe9', stroke: '#f7bfa8', text: '#c2502a' },
        { fill: '#fff3e6', stroke: '#f5cd9e', text: '#b5720a' },
        { fill: '#fff8dc', stroke: '#f0dc94', text: '#9c7a10' },
        { fill: '#ffeef2', stroke: '#f5b8c8', text: '#b5305a' },
        { fill: '#fbe9e2', stroke: '#e3a888', text: '#9c4a24' },
        { fill: '#fff0e5', stroke: '#f2b98f', text: '#b5540a' },
      ],
    },
    vivid: {
      label: 'Vivid', brand: '#6b2fd6',
      nodeColors: [
        { fill: '#dcecff', stroke: '#7fb0f2', text: '#14417a' },
        { fill: '#ece3ff', stroke: '#b79af2', text: '#4a2199' },
        { fill: '#d8f5f0', stroke: '#6fc9bd', text: '#0f5f56' },
        { fill: '#dcf5e4', stroke: '#7fd4a0', text: '#146b38' },
        { fill: '#fff0cc', stroke: '#f0c455', text: '#8a5c00' },
        { fill: '#ffe0f0', stroke: '#f28fc4', text: '#99215f' },
      ],
    },
  };

  function readLocal() {
    try {
      const key = localStorage.getItem(STORAGE_KEY);
      return PRESETS[key] ? key : 'default';
    } catch (e) { return 'default'; }
  }

  let activeKey = readLocal();

  function applyToDocument(key) {
    const preset = PRESETS[key] || PRESETS.default;
    document.documentElement.style.setProperty('--brand', preset.brand);
  }

  applyToDocument(activeKey);

  function setActive(key) {
    if (!PRESETS[key]) return;
    activeKey = key;
    try { localStorage.setItem(STORAGE_KEY, key); } catch (e) { /* ignore */ }
    applyToDocument(key);
    if (window.SpanAuth && window.SpanAuth.isConfigured) {
      window.SpanAuth.getSession().then(session => {
        if (!session) return;
        window.SpanAuth.client.auth.updateUser({ data: { theme: key } }).catch(() => {});
      });
    }
    document.dispatchEvent(new CustomEvent('spanthemechange', { detail: { key } }));
  }

  // If signed in and the account has a saved theme that differs from the
  // local one, prefer the cloud value (e.g. first login on a new device).
  function reconcileWithCloud() {
    if (!window.SpanAuth || !window.SpanAuth.isConfigured) return;
    window.SpanAuth.getSession().then(session => {
      const cloudKey = session && session.user.user_metadata && session.user.user_metadata.theme;
      if (cloudKey && PRESETS[cloudKey] && cloudKey !== activeKey) {
        activeKey = cloudKey;
        try { localStorage.setItem(STORAGE_KEY, cloudKey); } catch (e) { /* ignore */ }
        applyToDocument(cloudKey);
        document.dispatchEvent(new CustomEvent('spanthemechange', { detail: { key: cloudKey } }));
      }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', reconcileWithCloud);
  } else {
    reconcileWithCloud();
  }

  window.SpanTheme = {
    presets: Object.keys(PRESETS).map(key => ({ key, label: PRESETS[key].label, brand: PRESETS[key].brand })),
    getActiveKey: () => activeKey,
    setActive,
    getNodeColors: () => (PRESETS[activeKey] || PRESETS.default).nodeColors,
  };
})();
