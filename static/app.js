// Math Concept Mapper — Advanced AI reason display, map-aware

let conceptsData = {};
let nodeIdCounter = 1;
let linkIdCounter = 1;
let nodes = [];
let links = [];

let selectedNode = null;
let selectedLink = null;

let dragInfo = null;
let linkDrag = null;
let linkHoverTarget = null;
let aiHoldTimeout = null;

// Read-only viewing (a teacher opening a student's map from Settings ->
// Classes). Guarded at the mutation entry points AND inside autosave()
// itself, rather than trusting RLS's silent write-rejection alone - a stray
// edit here must not overwrite the viewer's own localStorage draft, which
// RLS has no concept of and can't protect.
let isReadonly = false;

const NODE_HEIGHT = 54, NODE_RADIUS = 17, NODE_MIN_WIDTH = 100, NODE_HORIZ_PADDING = 22;
const nodeWidthCache = new Map();

// --- Soft contextual node colors ---
// Default palette, used if theme.js isn't loaded (keeps app.js standalone).
// When theme.js IS present, activeNodeColors is set from the active preset.
const DEFAULT_NODE_COLORS = [
  { fill: '#eaf2ff', stroke: '#b9d4f8', text: '#1f4f91' }, // blue
  { fill: '#f1edff', stroke: '#cabdf7', text: '#6b4fd8' }, // lavender
  { fill: '#e8f7f7', stroke: '#a8dede', text: '#1f7a7a' }, // teal
  { fill: '#eafbf1', stroke: '#a9e6c3', text: '#1f8a4c' }, // green
  { fill: '#fff8e8', stroke: '#f0d896', text: '#a6790a' }, // amber
  { fill: '#fdeef8', stroke: '#f2b8e0', text: '#b23d8f' }, // pink
];
let activeNodeColors = (window.SpanTheme && window.SpanTheme.getNodeColors()) || DEFAULT_NODE_COLORS;
// Colors are handed out in first-seen order per unit/grade, not by hash - a
// hash mod can easily cluster the most common unit into a single color
// (which is exactly what happened here), giving an unbalanced-looking map.
const nodeColorAssignments = new Map();
function nodeColorFor(node) {
  const key = (node.meta && (node.meta.unit || node.meta.grade)) || node.label;
  if (!nodeColorAssignments.has(key)) {
    nodeColorAssignments.set(key, nodeColorAssignments.size % activeNodeColors.length);
  }
  return activeNodeColors[nodeColorAssignments.get(key)];
}
document.addEventListener('spanthemechange', () => {
  activeNodeColors = (window.SpanTheme && window.SpanTheme.getNodeColors()) || DEFAULT_NODE_COLORS;
  nodeColorAssignments.clear();
  if (typeof renderCanvas === 'function' && document.getElementById('mapCanvas')) renderCanvas();
});

// --- SVG text measure ---
function setupSvgTextMeasure() {
  if (!document.getElementById('svgTextMeasure')) {
    let svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('id', 'svgTextMeasure');
    svg.style.position = 'absolute';
    svg.style.width = '0';
    svg.style.height = '0';
    svg.style.visibility = 'hidden';
    svg.style.pointerEvents = 'none';
    document.body.appendChild(svg);
  }
  if (!window.svgTextMeasurer) {
    let svg = document.getElementById('svgTextMeasure');
    let text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('font-size', '1.11em');
    text.setAttribute('font-weight', '600');
    text.setAttribute('font-family', "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif");
    svg.appendChild(text);
    window.svgTextMeasurer = text;
  }
}
function getNodeWidth(label) {
  if (nodeWidthCache.has(label)) return nodeWidthCache.get(label);
  setupSvgTextMeasure();
  let textEl = window.svgTextMeasurer;
  textEl.textContent = label;
  let _ = textEl.getBoundingClientRect();
  let bbox = textEl.getBBox();
  let width = Math.ceil(bbox.width) + NODE_HORIZ_PADDING * 2;
  width = Math.max(NODE_MIN_WIDTH, Math.min(width, 350));
  nodeWidthCache.set(label, width);
  return width;
}

// --------- Initialization ---------
window.onload = async function() {
  conceptsData = await fetch('concepts.json').then(r => r.json());
  renderSidebar();
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  setupSidebarEvents();
  setupSearchEvents();
  setupShareButton();
  setupAiSummaryButton();
  setupAuthUI();

  const params = new URLSearchParams(window.location.search);
  if (params.get('view') && params.get('readonly') === '1') {
    await loadReadonlyMap(params.get('view'));
    applyReadonlyUI();
  } else if (params.get('share')) {
    if (!loadSharedMap(params.get('share'))) loadAutosave();
  } else if (params.get('sample') === '1') {
    loadSampleMap();
  } else {
    loadAutosave();
  }

  renderCanvas();
  setupCustomConcept();
};

// --- Read-only map viewing (Settings -> Classes -> a student's map) ---
async function loadReadonlyMap(id) {
  isReadonly = true;
  try {
    if (!window.SpanAuth || !window.SpanAuth.isConfigured) throw new Error('Not signed in.');
    const row = await window.SpanAuth.loadMapById(id);
    applyMapData(row.data);
    // Deliberately not "my" map - leaving cloudMapId null means the normal
    // save/autosave paths have no target even if the isReadonly guard were
    // somehow bypassed (defense in depth, not the primary safeguard).
    cloudMapId = null;
    cloudMapTitle = row.title;
    cloudMapUpdatedAt = null;
  } catch (e) {
    console.error('Could not load map for read-only viewing:', e);
  }
}

function applyReadonlyUI() {
  const banner = document.getElementById('readonlyBanner');
  if (banner) {
    banner.textContent = cloudMapTitle
      ? `Viewing "${cloudMapTitle}" (read-only)`
      : 'Viewing a shared map (read-only)';
    banner.style.display = 'block';
  }
  const shareBtn = document.getElementById('shareBtn');
  if (shareBtn) shareBtn.style.display = 'none';
  const authArea = document.getElementById('authArea');
  if (authArea) authArea.style.display = 'none';
  const customConceptRow = document.querySelector('.custom-concept-row');
  if (customConceptRow) customConceptRow.style.display = 'none';
}

// --- "Explore a sample map" (playground.html?sample=1) ---
function loadSampleMap() {
  // A real prerequisite pathway pulled from concepts.json (6th-8th grade),
  // from ratios/basic equations up through linear functions and stats -
  // meant to show off drag-drop, linking, notes, node coloring, and AI
  // recommendations (which use this same grade/unit metadata) together.
  const R_P = 'Ratios & Proportional Relationships', E_Q = 'Expressions & Equations',
        NUM = 'The Number System', FUN = 'Functions', STAT = 'Statistics & Probability',
        G6 = '6th Grade Math', G7 = '7th Grade Math', G8 = '8th Grade Math';

  // Organic scatter layout (computed offline via a jitter + collision-resolution
  // pass over the dependency graph below) instead of a rigid grid - positions
  // are baked in here since they only need computing once.
  const POS = {
    A:[168,417], B:[166,568], C:[20,52],   D:[111,167], E:[22,326],
    F:[492,263], G:[593,158], H:[446,67],  I:[563,498], J:[903,20],
    K:[937,179], L:[933,507], M:[975,363], N:[1293,417],O:[1322,87],
    P:[1401,192],Q:[1275,326],R:[1672,296],S:[1796,205],T:[1714,82],
    U:[1661,554],V:[1676,463],
  };

  const sample = [
    ['A', 'Ratio notation (a:b)',                          G6, R_P],
    ['B', 'Write algebraic expressions (1 op)',            G6, E_Q],
    ['C', 'Graph (x,y) in four quadrants',                 G6, NUM],
    ['D', 'Unit rate definition',                          G6, R_P],
    ['E', 'Write one-step equations',                      G6, E_Q],
    ['F', 'Identify proportional relationships in tables', G7, R_P],
    ['G', 'Solve one-step equations',                      G6, E_Q],
    ['H', 'Constant of proportionality in tables',         G7, R_P],
    ['I', 'Solve two-step equations',                      G6, E_Q],
    ['J', 'Write proportional equations from tables',      G7, R_P],
    ['K', 'Solve px + q = r type equations',               G7, E_Q],
    ['L', 'Equation ↔ proportional relationship',          G8, E_Q],
    ['M', 'Graph y = mx + b',                              G8, E_Q],
    ['N', 'Find slope from two coords',                    G8, E_Q],
    ['O', 'Definition of function',                        G8, FUN],
    ['P', 'Write linear equation from graph',               G8, E_Q],
    ['Q', 'Interpret slope as rate of change',              G8, FUN],
    ['R', 'Solve system by graphing',                       G8, E_Q],
    ['S', 'Create scatter plots',                           G8, STAT],
    ['T', 'Relate proportional to linear function',         G8, FUN],
    ['U', 'Find line of best fit by eye',                   G8, STAT],
    ['V', 'Solve system by substitution',                   G8, E_Q],
  ].map(([key, label, grade, unit]) => [key, label, POS[key][0], POS[key][1], grade, unit]);

  const idFor = {};
  for (const [key, label, x, y, grade, unit] of sample) {
    const node = { id: nodeIdCounter++, label, x, y, meta: { grade, unit } };
    nodes.push(node);
    idFor[key] = node.id;
  }

  const edges = [
    ['A', 'D'],
    ['D', 'F', 'A unit rate is the constant of proportionality in its simplest form.'],
    ['F', 'H'],
    ['H', 'J', 'Once you can name the constant, you can write the equation: y = kx.'],
    ['J', 'L'],
    ['B', 'E'], ['E', 'G'], ['G', 'I'], ['I', 'K'],
    ['C', 'M'],
    ['L', 'M', 'Every proportional relationship is just a linear equation with b = 0.'],
    ['M', 'N'], ['M', 'O', 'Once a line has an input→output rule, you’re already thinking in functions.'],
    ['N', 'P', 'Slope plus one point is all point-slope form needs.'], ['O', 'Q'],
    ['P', 'R'], ['Q', 'S', 'Real data rarely sits on a perfect line — scatter plots show slope as a trend, not a rule.'],
    ['Q', 'T', 'Constant rate of change is what makes a function linear in the first place.'],
    ['S', 'U'],
    ['K', 'V', 'Substitution turns a 2-variable system into the 1-variable equation you already know how to solve.'],
    ['R', 'V'],
  ];

  for (const [a, b, note] of edges) {
    links.push({ id: linkIdCounter++, source: idFor[a], target: idFor[b], note: note || '' });
  }
  renderNotesSidebar();
}

// --- Serialize / restore map state (shared by autosave and share links) ---
const AUTOSAVE_KEY = 'spanConceptMap';

function serializeMap() {
  return {
    n: nodes.map(n => ({ i: n.id, l: n.label, x: Math.round(n.x), y: Math.round(n.y), m: n.meta || {} })),
    e: links.map(l => ({ i: l.id, s: l.source, t: l.target, no: l.note || '' })),
  };
}

function applyMapData(data) {
  nodes = (data.n || []).map(n => ({ id: n.i, label: n.l, x: n.x, y: n.y, meta: n.m || {} }));
  links = (data.e || []).map(l => ({ id: l.i, source: l.s, target: l.t, note: l.no || '' }));
  nodeIdCounter = nodes.reduce((max, n) => Math.max(max, n.id), 0) + 1;
  linkIdCounter = links.reduce((max, l) => Math.max(max, l.id), 0) + 1;
  renderNotesSidebar();
}

function autosave() {
  if (isReadonly) return;
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(serializeMap()));
  } catch (e) { /* storage unavailable/full - not critical, just skip */ }
  queueCloudSave();
}

function loadAutosave() {
  let raw;
  try { raw = localStorage.getItem(AUTOSAVE_KEY); } catch (e) { return false; }
  if (!raw) return false;
  try {
    const data = JSON.parse(raw);
    if (!data.n || !data.n.length) return false;
    applyMapData(data);
    return true;
  } catch (e) { return false; }
}

// --- Shareable links: map state round-trips through a URL-safe base64 param ---
function b64EncodeUnicode(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64DecodeUnicode(b64) {
  let s = b64.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const binary = atob(s);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
function encodeMapParam() {
  return b64EncodeUnicode(JSON.stringify(serializeMap()));
}
function loadSharedMap(param) {
  try {
    applyMapData(JSON.parse(b64DecodeUnicode(param)));
    return true;
  } catch (e) {
    console.error('Could not load shared map:', e);
    return false;
  }
}
function setupShareButton() {
  const btn = document.getElementById('shareBtn');
  if (!btn) return;
  const label = btn.querySelector('.share-label');
  btn.onclick = async () => {
    const url = `${location.origin}${location.pathname}?share=${encodeMapParam()}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch (e) {
      window.prompt('Copy this link:', url);
      return;
    }
    const original = label.textContent;
    label.textContent = 'Copied!';
    setTimeout(() => { label.textContent = original; }, 1600);
  };
}

// --- Beta: Instant AI summary ---
// Heuristic, not a model call - groups the map's own nodes by curriculum
// unit and compares how well-connected each unit's nodes are, same
// "connected vs isolated" signal isolated-concept highlighting already
// computes per node, just rolled up per unit.
function computeMapSummary(nodesArr, linksArr) {
  if (!nodesArr.length) return 'Your map is empty — add a few concepts to get a summary.';
  const degree = new Map();
  for (const n of nodesArr) degree.set(n.id, 0);
  for (const l of linksArr) {
    degree.set(l.source, (degree.get(l.source) || 0) + 1);
    degree.set(l.target, (degree.get(l.target) || 0) + 1);
  }
  const byUnit = new Map(); // unit -> { total, connected }
  let untagged = 0;
  for (const n of nodesArr) {
    const unit = n.meta && n.meta.unit;
    if (!unit) { untagged++; continue; }
    if (!byUnit.has(unit)) byUnit.set(unit, { total: 0, connected: 0 });
    const rec = byUnit.get(unit);
    rec.total++;
    if ((degree.get(n.id) || 0) > 0) rec.connected++;
  }
  if (!byUnit.size) {
    return `${nodesArr.length} concept${nodesArr.length === 1 ? '' : 's'} on the map so far, none tagged to a curriculum unit yet. Drag topics in from the sidebar to get unit-by-unit insight.`;
  }
  const units = [...byUnit.entries()]
    .map(([unit, r]) => ({ unit, ...r, ratio: r.connected / r.total }))
    .sort((a, b) => b.ratio - a.ratio || b.total - a.total);
  const strong = units[0];
  const thin = units[units.length - 1];
  if (units.length === 1) {
    return `You're building out ${strong.unit} — ${strong.connected} of ${strong.total} concept${strong.total === 1 ? '' : 's'} connected so far.`;
  }
  const strongPhrase = strong.ratio >= 0.6 ? 'Strong on' : 'Most developed:';
  const thinPhrase = thin.ratio < 0.5 ? 'thin on' : 'lighter on';
  return `${strongPhrase} ${strong.unit}, ${thinPhrase} ${thin.unit}.`;
}
function setupAiSummaryButton() {
  const btn = document.getElementById('aiSummaryBtn');
  const panel = document.getElementById('aiSummaryPanel');
  const text = document.getElementById('aiSummaryText');
  if (!btn || !panel || !text) return;
  btn.onclick = (e) => {
    e.stopPropagation();
    const isOpen = getComputedStyle(panel).display !== 'none';
    if (isOpen) { panel.style.display = 'none'; return; }
    text.textContent = computeMapSummary(nodes, links);
    panel.style.display = 'block';
  };
  // Capture phase: node/link clicks on the canvas call stopPropagation()
  // during bubbling, which would otherwise stop this from ever seeing them.
  document.addEventListener('click', (e) => {
    if (panel.contains(e.target) || btn.contains(e.target)) return;
    panel.style.display = 'none';
  }, true);
}

// --- Accounts + cloud map storage (Supabase, additive to localStorage) ---
let cloudSession = null;
let cloudMapId = null;
let cloudMapTitle = null;
let cloudMapUpdatedAt = null;
let cloudSaveTimer = null;

function cloudReady() {
  return !!(window.SpanAuth && window.SpanAuth.isConfigured && cloudSession);
}

function queueCloudSave() {
  if (!cloudReady() || !cloudMapId) return;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(flushCloudSave, 1200);
}

async function flushCloudSave() {
  if (!cloudReady() || !cloudMapId) return;
  clearTimeout(cloudSaveTimer);
  try {
    const result = await window.SpanAuth.saveMap({
      id: cloudMapId, title: cloudMapTitle, data: serializeMap(), lastKnownUpdatedAt: cloudMapUpdatedAt,
    });
    if (result.conflict) {
      showCloudNotice('This map changed elsewhere — open "My Maps" to see the latest version.');
    } else {
      cloudMapUpdatedAt = result.row.updated_at;
    }
  } catch (e) {
    console.error('Cloud save failed:', e);
  }
}

function showCloudNotice(msg) {
  const el = document.getElementById('cloudNotice');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => { el.style.display = 'none'; }, 6000);
}

async function saveCurrentMapAsNew(title) {
  const result = await window.SpanAuth.saveMap({ id: null, title, data: serializeMap() });
  cloudMapId = result.row.id;
  cloudMapTitle = result.row.title;
  cloudMapUpdatedAt = result.row.updated_at;
  return result.row;
}

async function loadCloudMap(id) {
  const row = await window.SpanAuth.loadMapById(id);
  applyMapData(row.data);
  cloudMapId = row.id;
  cloudMapTitle = row.title;
  cloudMapUpdatedAt = row.updated_at;
  renderCanvas();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushCloudSave();
});
window.addEventListener('beforeunload', () => { flushCloudSave(); });

function setupAuthUI() {
  const authArea = document.getElementById('authArea');
  if (!window.SpanAuth || !window.SpanAuth.isConfigured) {
    if (authArea) authArea.style.display = 'none';
    return;
  }

  const signInBtn = document.getElementById('signInBtn');
  const userMenu = document.getElementById('userMenu');
  const userLabel = document.getElementById('userLabel');
  const signOutBtn = document.getElementById('signOutBtn');
  const myMapsBtn = document.getElementById('myMapsBtn');
  const authModal = document.getElementById('authModal');
  const authModalClose = document.getElementById('authModalClose');
  const tabSignIn = document.getElementById('tabSignIn');
  const tabSignUp = document.getElementById('tabSignUp');
  const signInForm = document.getElementById('signInForm');
  const signUpForm = document.getElementById('signUpForm');
  const myMapsPanel = document.getElementById('myMapsPanel');
  const myMapsList = document.getElementById('myMapsList');
  const saveMapBtn = document.getElementById('saveMapBtn');
  const mapTitleInput = document.getElementById('mapTitleInput');

  function openModal() { authModal.style.display = 'flex'; }
  function closeModal() { authModal.style.display = 'none'; }
  function showSignIn() {
    tabSignIn.classList.add('active'); tabSignUp.classList.remove('active');
    signInForm.style.display = ''; signUpForm.style.display = 'none';
  }
  function showSignUp() {
    tabSignUp.classList.add('active'); tabSignIn.classList.remove('active');
    signUpForm.style.display = ''; signInForm.style.display = 'none';
  }

  signInBtn.onclick = openModal;
  authModalClose.onclick = closeModal;
  authModal.onclick = (e) => { if (e.target === authModal) closeModal(); };
  tabSignIn.onclick = showSignIn;
  tabSignUp.onclick = showSignUp;

  signInForm.onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById('signInEmail').value.trim();
    const password = document.getElementById('signInPassword').value;
    const errEl = document.getElementById('signInError');
    errEl.textContent = '';
    try {
      await window.SpanAuth.signIn(email, password);
      closeModal();
    } catch (err) {
      errEl.textContent = err.message || 'Sign in failed.';
    }
  };

  signUpForm.onsubmit = async (e) => {
    e.preventDefault();
    const name = document.getElementById('signUpName').value.trim();
    const email = document.getElementById('signUpEmail').value.trim();
    const password = document.getElementById('signUpPassword').value;
    const errEl = document.getElementById('signUpError');
    errEl.style.color = '';
    errEl.textContent = '';
    try {
      await window.SpanAuth.signUp(email, password, name);
      errEl.style.color = '#1f8a4c';
      errEl.textContent = 'Check your email to confirm your account, then sign in.';
    } catch (err) {
      errEl.textContent = err.message || 'Sign up failed.';
    }
  };

  signOutBtn.onclick = async () => {
    await window.SpanAuth.signOut();
    cloudMapId = null; cloudMapTitle = null; cloudMapUpdatedAt = null;
    myMapsPanel.style.display = 'none';
  };

  function renderMyMapsList(rows) {
    myMapsList.innerHTML = '';
    if (!rows.length) {
      myMapsList.innerHTML = '<li class="empty">No saved maps yet.</li>';
      return;
    }
    for (const row of rows) {
      const li = document.createElement('li');
      const titleSpan = document.createElement('span');
      titleSpan.textContent = row.title;
      titleSpan.className = 'my-map-title';
      titleSpan.onclick = async () => {
        await loadCloudMap(row.id);
        myMapsPanel.style.display = 'none';
        if (mapTitleInput) mapTitleInput.value = row.title;
      };
      const delBtn = document.createElement('button');
      delBtn.textContent = '×';
      delBtn.className = 'my-map-delete';
      delBtn.title = 'Delete this map';
      delBtn.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete "${row.title}"?`)) return;
        await window.SpanAuth.deleteMap(row.id);
        if (cloudMapId === row.id) { cloudMapId = null; cloudMapTitle = null; cloudMapUpdatedAt = null; }
        li.remove();
      };
      li.appendChild(titleSpan);
      li.appendChild(delBtn);
      myMapsList.appendChild(li);
    }
  }

  myMapsBtn.onclick = async () => {
    // Check the *computed* style, not the inline one: myMapsPanel starts
    // hidden via the stylesheet (no inline style set at all yet), so
    // el.style.display reads '' rather than 'none' until something sets it
    // explicitly - checking the inline value here made the very first click
    // non-deterministically think the panel was "already open" and no-op,
    // depending on whether some other code path had touched the inline
    // style first.
    const isOpen = getComputedStyle(myMapsPanel).display !== 'none';
    if (isOpen) { myMapsPanel.style.display = 'none'; return; }
    myMapsPanel.style.display = 'block';
    myMapsList.innerHTML = '<li class="empty">Loading…</li>';
    try {
      renderMyMapsList(await window.SpanAuth.listMyMaps());
    } catch (e) {
      myMapsList.innerHTML = '<li class="empty">Could not load maps.</li>';
    }
  };

  saveMapBtn.onclick = async () => {
    const title = (mapTitleInput.value || '').trim() || 'Untitled map';
    saveMapBtn.disabled = true;
    try {
      if (cloudMapId) {
        const result = await window.SpanAuth.saveMap({
          id: cloudMapId, title, data: serializeMap(), lastKnownUpdatedAt: cloudMapUpdatedAt,
        });
        if (result.conflict) {
          showCloudNotice('This map changed elsewhere — saved as a new map instead.');
          await saveCurrentMapAsNew(title);
        } else {
          cloudMapTitle = title;
          cloudMapUpdatedAt = result.row.updated_at;
        }
      } else {
        await saveCurrentMapAsNew(title);
      }
      const original = saveMapBtn.textContent;
      saveMapBtn.textContent = 'Saved!';
      setTimeout(() => { saveMapBtn.textContent = original; }, 1500);
    } catch (e) {
      alert('Could not save map: ' + (e.message || e));
    } finally {
      saveMapBtn.disabled = false;
    }
  };

  function updateAuthUI(session) {
    cloudSession = session;
    if (session) {
      signInBtn.style.display = 'none';
      userMenu.style.display = 'flex';
      const name = (session.user.user_metadata && session.user.user_metadata.display_name) || session.user.email;
      userLabel.textContent = `${name} (${window.SpanAuth.role(session)})`;
    } else {
      signInBtn.style.display = '';
      userMenu.style.display = 'none';
      myMapsPanel.style.display = 'none';
    }
  }

  window.SpanAuth.getSession().then(session => {
    updateAuthUI(session);
    if (!session && new URLSearchParams(window.location.search).get('auth') === '1') openModal();
  });
  window.SpanAuth.onAuthStateChange(updateAuthUI);
}

function renderSidebar() {
  const sidebarList = document.getElementById('sidebarList');
  sidebarList.innerHTML = '';
  for (const grade in conceptsData) {
    const gradeDiv = document.createElement('div');
    gradeDiv.className = 'grade';
    const h = document.createElement('h2');
    h.textContent = grade;
    h.onclick = () => {
      unitDiv.style.display = unitDiv.style.display === 'none' ? '' : 'none';
      tgl.textContent = unitDiv.style.display === 'none' ? '►' : '▼';
    };
    const tgl = document.createElement('span');
    tgl.textContent = '▼'; tgl.className = 'toggle';
    h.appendChild(tgl);
    gradeDiv.appendChild(h);

    const unitDiv = document.createElement('div');
    for (const unit in conceptsData[grade]) {
      const unitLabel = document.createElement('div');
      unitLabel.className = 'unit';
      unitLabel.style.marginLeft = '1.5em';
      const unitHeader = document.createElement('span');
      unitHeader.textContent = unit + ' ';
      unitHeader.style.fontWeight = '500';
      const utgl = document.createElement('span');
      utgl.textContent = '▼'; utgl.className = 'toggle';
      unitHeader.appendChild(utgl);
      unitLabel.appendChild(unitHeader);

      const topicUl = document.createElement('ul');
      for (const topic of conceptsData[grade][unit]) {
        const li = document.createElement('li');
        li.textContent = topic;
        li.draggable = true;
        li.ondragstart = ev => {
          ev.dataTransfer.setData('text/plain', JSON.stringify({grade, unit, topic}));
        };
        li.title = `${grade} › ${unit}`;
        topicUl.appendChild(li);
      }
      unitLabel.appendChild(topicUl);

      unitHeader.onclick = () => {
        topicUl.style.display = topicUl.style.display === 'none' ? '' : 'none';
        utgl.textContent = topicUl.style.display === 'none' ? '►' : '▼';
      };
      unitDiv.appendChild(unitLabel);
    }
    gradeDiv.appendChild(unitDiv);
    sidebarList.appendChild(gradeDiv);
  }
  renderNotesSidebar();
}

function setupSidebarEvents() {
  const sidebar = document.getElementById('sidebar');
  const collapseBtn = document.getElementById('collapseBtn');
  collapseBtn.onclick = () => {
    sidebar.classList.toggle('collapsed');
    collapseBtn.textContent = sidebar.classList.contains('collapsed') ? '→' : '≡';
  };
}

// --- Concept search: filters the sidebar list and auto-expands matches ---
function filterSidebar(query) {
  const q = query.trim().toLowerCase();
  const sidebarList = document.getElementById('sidebarList');
  const noResults = document.getElementById('noResults');
  let anyVisible = false;

  sidebarList.querySelectorAll(':scope > .grade').forEach(gradeDiv => {
    const h2 = gradeDiv.querySelector('h2');
    const gradeToggle = h2.querySelector('.toggle');
    const unitDiv = gradeDiv.children[1];
    let gradeHasMatch = false;

    unitDiv.querySelectorAll(':scope > .unit').forEach(unitLabel => {
      const unitHeader = unitLabel.querySelector('span');
      const unitToggle = unitHeader.querySelector('.toggle');
      const topicUl = unitLabel.querySelector('ul');
      let unitHasMatch = false;

      topicUl.querySelectorAll('li').forEach(li => {
        const match = !q || li.textContent.toLowerCase().includes(q);
        li.style.display = match ? '' : 'none';
        if (match) unitHasMatch = true;
      });

      unitLabel.style.display = unitHasMatch ? '' : 'none';
      if (unitHasMatch) {
        gradeHasMatch = true;
        if (q) {
          topicUl.style.display = '';
          if (unitToggle) unitToggle.textContent = '▼';
        }
      }
    });

    gradeDiv.style.display = gradeHasMatch ? '' : 'none';
    if (gradeHasMatch) {
      anyVisible = true;
      if (q) {
        unitDiv.style.display = '';
        if (gradeToggle) gradeToggle.textContent = '▼';
      }
    }
  });

  noResults.style.display = (q && !anyVisible) ? 'block' : 'none';
}

function setupSearchEvents() {
  const input = document.getElementById('conceptSearchInput');
  input.addEventListener('input', () => filterSidebar(input.value));
}

function setupCustomConcept() {
  const input = document.getElementById('customConceptInput');
  const btn = document.getElementById('customConceptBtn');
  btn.onclick = () => {
    let val = input.value.trim();
    if (!val) return;
    let x = 90 + Math.random()*140, y = 90 + Math.random()*120;
    addNode(val, x, y, {custom: true});
    input.value = '';
  };
  input.onkeydown = e => {
    if (e.key === 'Enter') btn.click();
  };
}

// The canvas grows to fit whatever's on it (with room to drop new nodes
// past the edge) and #canvasArea scrolls - so large maps don't overlap or
// get clipped just because they don't fit the current window.
function updateCanvasSize() {
  const svg = document.getElementById('mapCanvas');
  const area = document.getElementById('canvasArea');
  const PAD = 240;
  let w = area.clientWidth, h = area.clientHeight;
  for (const n of nodes) {
    w = Math.max(w, n.x + getNodeWidth(n.label) + PAD);
    h = Math.max(h, n.y + NODE_HEIGHT + PAD);
  }
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
}

function resizeCanvas() {
  updateCanvasSize();
  renderCanvas();
}

document.getElementById('mapCanvas').ondragover = ev => ev.preventDefault();
document.getElementById('mapCanvas').ondrop = ev => {
  ev.preventDefault();
  let data = ev.dataTransfer.getData('text/plain');
  if (!data) return;
  let obj = JSON.parse(data);
  let bbox = ev.target.getBoundingClientRect ? ev.target.getBoundingClientRect() : {left:0,top:0};
  let x = ev.clientX - bbox.left, y = ev.clientY - bbox.top;
  // If dropped from AI panel, may have .label and .meta
  if (obj.fromAI) {
    addNode(obj.label, x, y, obj.meta || {});
    return;
  }
  addNode(obj.topic, x, y, {grade: obj.grade, unit: obj.unit});
};

function addNode(label, x, y, meta={}) {
  if (isReadonly) return;
  let node = {
    id: nodeIdCounter++,
    label, x, y,
    meta: {...meta}
  };
  nodes.push(node);
  renderCanvas();
  autosave();
}

// --- Shared link geometry: endpoints trimmed to node edges, plus a gentle curve ---
function linkEndpoints(link) {
  const src = nodes.find(n => n.id === link.source), tgt = nodes.find(n => n.id === link.target);
  if (!src || !tgt) return null;
  const srcW = getNodeWidth(src.label), tgtW = getNodeWidth(tgt.label);
  let start = {x: src.x + srcW/2, y: src.y + NODE_HEIGHT/2};
  let end = {x: tgt.x + tgtW/2, y: tgt.y + NODE_HEIGHT/2};
  let v = {x: end.x - start.x, y: end.y - start.y};
  let mag = Math.sqrt(v.x*v.x + v.y*v.y) || 1;
  let ux = v.x/mag, uy = v.y/mag;
  start.x += ux * (srcW/2.1); start.y += uy * (NODE_HEIGHT/2.3);
  end.x -= ux * (tgtW/2.1); end.y -= uy * (NODE_HEIGHT/2.3);
  return {start, end};
}
function curveControlPoint(start, end) {
  const dx = end.x - start.x, dy = end.y - start.y;
  const len = Math.sqrt(dx*dx + dy*dy) || 1;
  const curve = Math.min(36, len * 0.18);
  const mx = (start.x + end.x) / 2, my = (start.y + end.y) / 2;
  return { x: mx - (dy/len)*curve, y: my + (dx/len)*curve, dx, dy };
}
function curvedPathD(start, end) {
  const c = curveControlPoint(start, end);
  return `M${start.x},${start.y} Q${c.x},${c.y} ${end.x},${end.y}`;
}
// Point + angle at the curve's midpoint, for a note label set perpendicular to the link.
function curveMidpoint(start, end) {
  const c = curveControlPoint(start, end);
  return {
    x: 0.25*start.x + 0.5*c.x + 0.25*end.x,
    y: 0.25*start.y + 0.5*c.y + 0.25*end.y,
    angle: Math.atan2(c.dy, c.dx) * 180 / Math.PI,
  };
}

// Nudge note chips so they don't sit on top of a node or on top of each
// other. chips: [{x,y,w,h}] (x/y = center). nodeRects: [{x,y,w,h}] (x/y =
// top-left, as stored on node objects).
function resolveChipCollisions(chips, nodeRects) {
  const NODE_PAD = 8, CHIP_GAP = 5;
  for (let iter = 0; iter < 40; iter++) {
    let moved = false;
    for (const c of chips) {
      for (const r of nodeRects) {
        const cL = c.x - c.w/2, cR = c.x + c.w/2, cT = c.y - c.h/2, cB = c.y + c.h/2;
        const rL = r.x - NODE_PAD, rR = r.x + r.w + NODE_PAD, rT = r.y - NODE_PAD, rB = r.y + r.h + NODE_PAD;
        if (cL < rR && rL < cR && cT < rB && rT < cB) {
          const overlapX = Math.min(cR, rR) - Math.max(cL, rL);
          const overlapY = Math.min(cB, rB) - Math.max(cT, rT);
          if (overlapX < overlapY) {
            c.x += (c.x < r.x + r.w/2 ? -1 : 1) * (overlapX + 1);
          } else {
            c.y += (c.y < r.y + r.h/2 ? -1 : 1) * (overlapY + 1);
          }
          moved = true;
        }
      }
    }
    for (let i = 0; i < chips.length; i++) {
      for (let j = i+1; j < chips.length; j++) {
        const a = chips[i], b = chips[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const minDX = (a.w + b.w)/2 + CHIP_GAP, minDY = (a.h + b.h)/2 + CHIP_GAP;
        if (Math.abs(dx) < minDX && Math.abs(dy) < minDY) {
          const overlapX = minDX - Math.abs(dx), overlapY = minDY - Math.abs(dy);
          if (overlapX < overlapY) {
            const push = overlapX/2 + 0.5;
            a.x += dx < 0 ? push : -push; b.x += dx < 0 ? -push : push;
          } else {
            const push = overlapY/2 + 0.5;
            a.y += dy < 0 ? push : -push; b.y += dy < 0 ? -push : push;
          }
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

// --------- Main Canvas Drawing ---------
function renderCanvas() {
  updateCanvasSize();
  const svg = document.getElementById('mapCanvas');
  svg.innerHTML = `
    <defs>
      <marker id="arrowhead" markerWidth="12" markerHeight="7" refX="11" refY="3.5" orient="auto" markerUnits="strokeWidth">
        <polygon points="0 0, 12 3.5, 0 7" fill="#8191aa"/>
      </marker>
      <marker id="arrowheadGhost" markerWidth="12" markerHeight="7" refX="11" refY="3.5" orient="auto" markerUnits="strokeWidth">
        <polygon points="0 0, 12 3.5, 0 7" fill="#2e90fa99"/>
      </marker>
    </defs>
  `;
  // --- Draw links (and link interaction) ---
  const noteChips = [];
  for (let link of links) {
    const pts = linkEndpoints(link);
    if (!pts) continue;
    const {start, end} = pts;

    let path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d', curvedPathD(start, end));
    path.setAttribute('class', 'link'+(link.note ? ' has-note' : '')+(link === selectedLink ? ' selected' : ''));
    path.setAttribute('data-link-id', link.id);

    // --- Link interaction: select, note, delete (ctrl+double-click) ---
    path.onclick = e => {
      selectedLink = link; selectedNode = null;
      renderCanvas();
      e.stopPropagation();
    };
    path.ondblclick = e => {
      if (isReadonly) return;
      if (e.ctrlKey) {
        deleteLink(link.id);
      } else {
        e.stopPropagation();
        showNoteEditor(link, (note) => {
          link.note = note;
          renderNotesSidebar();
          renderCanvas();
          autosave();
        });
      }
    };
    svg.appendChild(path);

    // --- Note label: collect a chip descriptor now, place it after nodes
    // are drawn (so chips can dodge nodes, dodge each other, and render on
    // top instead of getting hidden underneath a node) ---
    if (link.note) {
      const mid = curveMidpoint(start, end);
      const edgeLen = Math.hypot(end.x - start.x, end.y - start.y);
      const cap = Math.max(10, Math.min(26, Math.floor(edgeLen * 0.45 / 5.5)));
      const preview = link.note.length > cap ? link.note.slice(0, cap).trimEnd() + '…' : link.note;
      noteChips.push({ x: mid.x, y: mid.y, w: preview.length * 5.5 + 16, h: 19, text: preview });
    }
  }

  // --- Ghost arrow for link-creation ---
  if (linkDrag && linkDrag.sourceNode) {
    let srcW = getNodeWidth(linkDrag.sourceNode.label);
    let start = {
      x: linkDrag.sourceNode.x + srcW/2,
      y: linkDrag.sourceNode.y + NODE_HEIGHT/2
    };
    let end = {x: linkDrag.x2, y: linkDrag.y2};
    let ghost = document.createElementNS('http://www.w3.org/2000/svg','line');
    ghost.setAttribute('x1', start.x);
    ghost.setAttribute('y1', start.y);
    ghost.setAttribute('x2', end.x);
    ghost.setAttribute('y2', end.y);
    ghost.setAttribute('class', 'link-ghost');
    ghost.setAttribute('stroke', '#2e90fa');
    ghost.setAttribute('stroke-width', '3.7');
    ghost.setAttribute('stroke-dasharray', '8 8');
    ghost.setAttribute('stroke-opacity', '0.57');
    ghost.setAttribute('marker-end', 'url(#arrowheadGhost)');
    svg.appendChild(ghost);
  }

  // --- Draw nodes, drag/move/link logic ---
  // Beta: isolated-concept highlighting - nodes with no links stand out
  // (dashed border + small badge) against the rest of the map.
  const degree = new Map();
  for (let node of nodes) degree.set(node.id, 0);
  for (let link of links) {
    degree.set(link.source, (degree.get(link.source) || 0) + 1);
    degree.set(link.target, (degree.get(link.target) || 0) + 1);
  }
  let anyIsolated = false;
  for (let node of nodes) {
    let w = getNodeWidth(node.label);
    let g = document.createElementNS('http://www.w3.org/2000/svg','g');
    g.setAttribute('transform', `translate(${node.x},${node.y})`);
    g.setAttribute('data-node-id', node.id);

    const isIsolated = (degree.get(node.id) || 0) === 0;
    if (isIsolated) anyIsolated = true;

    let rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
    rect.setAttribute('width', w);
    rect.setAttribute('height', NODE_HEIGHT);
    rect.setAttribute('rx', NODE_RADIUS);
    rect.setAttribute('ry', NODE_RADIUS);
    let extraClass = '';
    if (node === selectedNode) extraClass += ' selected';
    if (linkHoverTarget === node) extraClass += ' link-hover';
    if (isIsolated) extraClass += ' isolated';
    rect.setAttribute('class', 'node'+extraClass);
    const color = nodeColorFor(node);
    rect.setAttribute('fill', color.fill);
    rect.setAttribute('stroke', color.stroke);

    // --- One mousedown handler for all node actions ---
    rect.onmousedown = e => {
      if (isReadonly) return;
      if (e.ctrlKey) {
        // Ctrl+drag: Start link-creation
        startLinkDrag(e, node, g, w);
      } else {
        // Drag: Move node
        const svg = document.getElementById('mapCanvas');
        let svgRect = svg.getBoundingClientRect();
        let mouseX = e.clientX - svgRect.left;
        let mouseY = e.clientY - svgRect.top;
        dragInfo = {
          node,
          offsetX: mouseX - node.x,
          offsetY: mouseY - node.y
        };
        document.onmousemove = dragNodeMove;
        document.onmouseup = stopNodeDrag;
        // Long-press (no Ctrl): Show AI after 550ms
        aiHoldTimeout = setTimeout(() => {
          showAIPanel(node);
        }, 550);
      }
    };
    // --- Cancel long-press/AI panel on mouseup/mouseleave
    rect.onmouseup = rect.onmouseleave = () => {
      if (aiHoldTimeout) clearTimeout(aiHoldTimeout);
    };
    // --- Ctrl+double-click to delete node
    rect.ondblclick = e => {
      if (e.ctrlKey) {
        deleteNode(node.id);
      }
      // Else: nothing (no note)
    };
    rect.onclick = e => {
      selectedNode = node; selectedLink = null;
      renderCanvas();
      e.stopPropagation();
    };

    // --- Label for node ---
    let labelText = node.label;
    let textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    textEl.setAttribute('font-size', '1.11em');
    textEl.setAttribute('font-weight', '600');
    textEl.setAttribute('font-family', "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif");
    textEl.textContent = labelText;
    textEl.setAttribute('x', w/2);
    textEl.setAttribute('y', NODE_HEIGHT/2);
    textEl.setAttribute('class', 'node-label');
    textEl.setAttribute('fill', color.text);
    textEl.setAttribute('pointer-events', 'none');
    textEl.setAttribute('text-anchor', 'middle');
    textEl.setAttribute('dominant-baseline', 'middle');
    g.appendChild(rect);
    g.appendChild(textEl);

    if (isIsolated) {
      const badge = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      badge.setAttribute('class', 'isolated-badge');
      badge.setAttribute('transform', `translate(${w},0)`);
      const bCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      bCircle.setAttribute('r', '9');
      const bText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      bText.textContent = '!';
      bText.setAttribute('font-size', '11');
      bText.setAttribute('text-anchor', 'middle');
      bText.setAttribute('dominant-baseline', 'middle');
      bText.setAttribute('y', '0.5');
      badge.appendChild(bCircle);
      badge.appendChild(bText);
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = 'Not connected to anything yet';
      badge.appendChild(title);
      g.appendChild(badge);
    }

    // --- If link drag, highlight drop target for valid (other) nodes ---
    if (linkDrag && linkDrag.sourceNode && linkDrag.sourceNode !== node) {
      let dropper = document.createElementNS('http://www.w3.org/2000/svg','rect');
      dropper.setAttribute('width', w);
      dropper.setAttribute('height', NODE_HEIGHT);
      dropper.setAttribute('rx', NODE_RADIUS);
      dropper.setAttribute('ry', NODE_RADIUS);
      dropper.setAttribute('x', 0);
      dropper.setAttribute('y', 0);
      dropper.setAttribute('fill', '#2e90fa11');
      dropper.setAttribute('stroke', linkHoverTarget===node ? '#2e90fa' : 'none');
      dropper.setAttribute('stroke-width', linkHoverTarget===node ? 2.5 : 0);
      dropper.setAttribute('pointer-events', 'visiblePainted');
      dropper.onmouseover = e => {
        linkHoverTarget = node;
        renderCanvas();
      };
      dropper.onmouseout = e => {
        linkHoverTarget = null;
        renderCanvas();
      };
      dropper.onmouseup = e => {
        if (linkDrag && linkDrag.sourceNode && linkDrag.sourceNode !== node) {
          addLink(linkDrag.sourceNode.id, node.id);
        }
        endLinkDrag();
      };
      g.appendChild(dropper);
    }
    svg.appendChild(g);
  }

  const isolatedLegend = document.getElementById('isolatedLegend');
  if (isolatedLegend) isolatedLegend.style.display = anyIsolated ? 'flex' : 'none';

  // --- Note chips: nudge clear of nodes and each other, then draw on top ---
  if (noteChips.length) {
    const nodeRects = nodes.map(n => ({ x: n.x, y: n.y, w: getNodeWidth(n.label), h: NODE_HEIGHT }));
    resolveChipCollisions(noteChips, nodeRects);
    for (const chip of noteChips) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'link-note');
      g.style.pointerEvents = 'none';

      const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bg.setAttribute('x', chip.x - chip.w / 2);
      bg.setAttribute('y', chip.y - chip.h / 2);
      bg.setAttribute('width', chip.w);
      bg.setAttribute('height', chip.h);
      bg.setAttribute('rx', chip.h / 2);
      bg.setAttribute('class', 'link-note-bg');

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.textContent = chip.text;
      label.setAttribute('x', chip.x);
      label.setAttribute('y', chip.y + 3.2);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('class', 'link-note-text');

      g.appendChild(bg);
      g.appendChild(label);
      svg.appendChild(g);
    }
  }

  svg.onclick = e => {
    selectedNode = null; selectedLink = null; linkHoverTarget = null;
    renderCanvas();
  };
}

// --- Node Drag/Move: update only the moved node + its links, no full rebuild ---
function dragNodeMove(e) {
  if (!dragInfo) return;
  const svg = document.getElementById('mapCanvas');
  let rect = svg.getBoundingClientRect();
  let x = e.clientX - rect.left, y = e.clientY - rect.top;
  dragInfo.node.x = x - dragInfo.offsetX;
  dragInfo.node.y = y - dragInfo.offsetY;
  updateNodePosition(dragInfo.node);
}
function stopNodeDrag(e) {
  if (dragInfo) autosave();
  dragInfo = null;
  document.onmousemove = null;
  document.onmouseup = null;
}

// --- Cheap per-frame position update used while dragging a node ---
function updateNodePosition(node) {
  updateCanvasSize();
  const svg = document.getElementById('mapCanvas');
  const g = svg.querySelector(`[data-node-id="${node.id}"]`);
  if (g) g.setAttribute('transform', `translate(${node.x},${node.y})`);
  for (const link of links) {
    if (link.source !== node.id && link.target !== node.id) continue;
    const pathEl = svg.querySelector(`[data-link-id="${link.id}"]`);
    if (!pathEl) continue;
    const pts = linkEndpoints(link);
    if (!pts) continue;
    pathEl.setAttribute('d', curvedPathD(pts.start, pts.end));
  }
}

// --- Link Drag Creation ---
function startLinkDrag(e, sourceNode, groupEl, nodeW) {
  const svg = document.getElementById('mapCanvas');
  let svgRect = svg.getBoundingClientRect();
  let mouseX = e.clientX - svgRect.left;
  let mouseY = e.clientY - svgRect.top;
  linkDrag = {sourceNode, x2: mouseX, y2: mouseY};
  renderCanvas();
  document.onmousemove = function(ev) {
    const svgRect = svg.getBoundingClientRect();
    linkDrag.x2 = ev.clientX - svgRect.left;
    linkDrag.y2 = ev.clientY - svgRect.top;
    const ghost = svg.querySelector('.link-ghost');
    if (ghost) { ghost.setAttribute('x2', linkDrag.x2); ghost.setAttribute('y2', linkDrag.y2); }
  };
  document.onmouseup = function(ev) {
    if (linkHoverTarget && linkDrag.sourceNode !== linkHoverTarget) {
      addLink(linkDrag.sourceNode.id, linkHoverTarget.id);
    }
    endLinkDrag();
  };
}
function endLinkDrag() {
  linkDrag = null;
  linkHoverTarget = null;
  document.onmousemove = null;
  document.onmouseup = null;
  renderCanvas();
}

function addLink(srcId, tgtId) {
  if (isReadonly) return;
  if (srcId === tgtId || links.some(l => l.source === srcId && l.target === tgtId)) return;
  links.push({id: linkIdCounter++, source: srcId, target: tgtId, note: ''});
  renderNotesSidebar();
  renderCanvas();
  autosave();
}
function deleteNode(nodeId) {
  if (isReadonly) return;
  nodes = nodes.filter(n => n.id !== nodeId);
  links = links.filter(l => l.source !== nodeId && l.target !== nodeId);
  selectedNode = null;
  renderNotesSidebar();
  renderCanvas();
  autosave();
}
function deleteLink(linkId) {
  if (isReadonly) return;
  links = links.filter(l => l.id !== linkId);
  selectedLink = null;
  renderNotesSidebar();
  renderCanvas();
  autosave();
}
function showNoteEditor(link, cb) {
  let note = prompt('Edit note for this connection:', link.note || '');
  if (note !== null) cb(note);
}
function renderNotesSidebar() {
  const notesDiv = document.getElementById('notesSidebar');
  if (!notesDiv) return;
  notesDiv.innerHTML = '';
  for (let link of links) {
    if (link.note && link.note.trim() !== '') {
      let src = nodes.find(n => n.id === link.source);
      let tgt = nodes.find(n => n.id === link.target);
      if (!src || !tgt) continue;
      let el = document.createElement('div');
      el.className = 'sidebar-note';
      let topicDiv = document.createElement('div');
      topicDiv.className = 'sidebar-note-topic';
      topicDiv.textContent = `[${src.label}, ${tgt.label}]`;
      let txtDiv = document.createElement('div');
      txtDiv.className = 'sidebar-note-txt';
      txtDiv.textContent = `[${link.note}]`;
      el.appendChild(topicDiv);
      el.appendChild(txtDiv);
      notesDiv.appendChild(el);
    }
  }
}

// --- AI PANEL: Shows 'reason' for each recommendation ---
function showAIPanel(node) {
  if (!node) return;
  selectedNode = node;
  document.getElementById('aiPanel').style.display = 'block';
  document.getElementById('aiList').innerHTML = `<li class="empty">Loading...</li>`;
  const backendUrl = window.AI_BACKEND_URL || 'http://localhost:5000';
  fetch(`${backendUrl}/recommend`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      nodes: nodes.map(n=>({
        id:n.id,label:n.label,meta:n.meta
      })),
      links: links.map(l=>({source:l.source, target:l.target})),
      selected_node: {id:node.id, label:node.label, meta:node.meta}
    })
  })
  .then(r => r.json())
  .then(res => {
    renderAIList(res.recommendations || []);
  })
  .catch(() => {
    document.getElementById('aiList').innerHTML =
      `<li class="empty">AI backend unavailable.<br>Run ai_recommender.py locally, or set window.AI_BACKEND_URL.</li>`;
  });
}
function renderAIList(recs) {
  const aiList = document.getElementById('aiList');
  aiList.innerHTML = '';
  if (!recs.length) {
    aiList.innerHTML = `<li class="empty">No suggestions (all linked?)</li>`;
    return;
  }
  for (const rec of recs) {
    const li = document.createElement('li');
    li.textContent = rec.label + (rec.meta.unit ? ` (${rec.meta.unit})` : '');
    if (rec.reason) {
      const reasonDiv = document.createElement('div');
      reasonDiv.style.fontSize = "0.92em";
      reasonDiv.style.color = "#3388bb";
      reasonDiv.style.marginLeft = "0.6em";
      reasonDiv.textContent = rec.reason;
      li.appendChild(document.createElement("br"));
      li.appendChild(reasonDiv);
    }
    li.draggable = true;
    li.style.userSelect = 'none';
    li.ondragstart = ev => {
      ev.dataTransfer.setData('text/plain', JSON.stringify({
        label: rec.label,
        meta: rec.meta,
        fromAI: true
      }));
    };
    li.onclick = () => {
      let angle = Math.random() * 2 * Math.PI, radius = 160 + Math.random()*25;
      let x = selectedNode.x + radius*Math.cos(angle), y = selectedNode.y + radius*Math.sin(angle);
      addNode(rec.label, x, y, rec.meta);
      addLink(selectedNode.id, nodeIdCounter-1);
      document.getElementById('aiPanel').style.display = 'none';
      renderNotesSidebar();
    };
    aiList.appendChild(li);
  }
}
document.addEventListener('click', e => {
  if (!e.target.closest('#aiPanel') && !e.target.closest('.node')) {
    document.getElementById('aiPanel').style.display = 'none';
  }
});

// ========== END ==========
