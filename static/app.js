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
let summaryHighlightIds = new Set();
let demoPlaying = false;

// --- Node-level scaffolding (click a node -> Edit/Connect/Explore) ---
let nodeToolbarState = null;   // { node }
let exploreMenuState = null;   // { node }
let ghostState = null;         // { node, question, suggestions, shownLabels, loading, error }
let connectPending = null;     // node awaiting a second click to complete a connection

const EXPLORE_QUESTIONS = [
  { key: 'builds_on', title: 'What does this build on?', hint: 'Find likely prerequisites.' },
  { key: 'leads_to', title: 'What does this lead to?', hint: 'Find concepts that build from it.' },
  { key: 'related', title: 'What else is related?', hint: 'Find sideways connections that are useful but not necessarily prerequisite-based.' },
];

// --- Map-level "Check my map" ---
let checkMapDim = false;             // true while a finding's "Show on map"/"Highlight" is active
let checkMapDismissed = new Set();   // questionable-relationship link ids the student chose to "Keep anyway"

// Read-only viewing (a teacher opening a student's map from Settings ->
// Classes). Guarded at the mutation entry points AND inside autosave()
// itself, rather than trusting RLS's silent write-rejection alone - a stray
// edit here must not overwrite the viewer's own localStorage draft, which
// RLS has no concept of and can't protect.
let isReadonly = false;

const NODE_HEIGHT = 54, NODE_RADIUS = 17, NODE_MIN_WIDTH = 100, NODE_MAX_WIDTH = 420, NODE_HORIZ_PADDING = 22;
const nodeWidthCache = new Map();
const nodeTextWidthCache = new Map();

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
// Raw text width, uncapped - separate from getNodeWidth's box width so the
// renderer can tell whether a label had to be squeezed to fit its box.
function measureNodeTextWidth(label) {
  if (nodeTextWidthCache.has(label)) return nodeTextWidthCache.get(label);
  setupSvgTextMeasure();
  let textEl = window.svgTextMeasurer;
  textEl.textContent = label;
  let _ = textEl.getBoundingClientRect();
  let width = textEl.getBBox().width;
  nodeTextWidthCache.set(label, width);
  return width;
}
function getNodeWidth(label) {
  if (nodeWidthCache.has(label)) return nodeWidthCache.get(label);
  let width = Math.ceil(measureNodeTextWidth(label)) + NODE_HORIZ_PADDING * 2;
  width = Math.max(NODE_MIN_WIDTH, Math.min(width, NODE_MAX_WIDTH));
  nodeWidthCache.set(label, width);
  return width;
}
// One-off measurement at an arbitrary font size, for the PDF export's text
// (13px flat, vs. the canvas's 1.11em) - not cached like the two above
// since it's only used for the handful of labels long enough to need
// textLength compression.
function measureTextWidthAtSize(label, fontSize) {
  setupSvgTextMeasure();
  const textEl = window.svgTextMeasurer;
  const prevSize = textEl.getAttribute('font-size');
  textEl.setAttribute('font-size', fontSize + 'px');
  textEl.textContent = label;
  textEl.getBoundingClientRect();
  const width = textEl.getBBox().width;
  textEl.setAttribute('font-size', prevSize);
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
  setupExportPdfButton();
  setupAiSummaryButton();
  setupCheckMapButton();
  setupAuthUI();
  setupPlayDemoButton();

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
  const playDemoBtn = document.getElementById('playDemoBtn');
  if (playDemoBtn) playDemoBtn.style.display = 'none';
}

// --- "Explore a sample map" (playground?sample=1) ---
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

// --- Beta: sample-mode "Play demo" walkthrough ---
// A scripted, hands-off run-through of the three core interactions (drag a
// concept onto the map, connect two concepts, open the AI summary) for
// visitors on the sample map who haven't touched the canvas yet. Every step
// goes through the same addNode/addLink/aiSummaryBtn-click path a real user
// would, so what's left on the map afterward is exactly what a user doing
// this by hand would end up with - the animation is just a guided replay
// of real actions, not a separate scripted-looking state.
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// #demoCursor/#demoGhost are position:fixed, so a canvas-space (x,y) - the
// coordinate system nodes live in - needs the canvas container's screen
// rect plus its current scroll offset to land in the right spot. #mapCanvas
// has no padding/transform inside #canvasArea, so this is a direct mapping.
function canvasToScreen(x, y) {
  const area = document.getElementById('canvasArea');
  const rect = area.getBoundingClientRect();
  return { left: rect.left - area.scrollLeft + x, top: rect.top - area.scrollTop + y };
}

function moveDemoCursor(left, top, duration) {
  const cursor = document.getElementById('demoCursor');
  cursor.style.transitionDuration = duration + 'ms';
  cursor.style.left = left + 'px';
  cursor.style.top = top + 'px';
  return sleep(duration);
}
function pressDemoCursor() {
  document.getElementById('demoCursor').classList.add('pressed');
  return sleep(180);
}
function releaseDemoCursor() {
  document.getElementById('demoCursor').classList.remove('pressed');
  return sleep(150);
}
function moveDemoGhost(label, left, top, duration) {
  const ghost = document.getElementById('demoGhost');
  ghost.textContent = label;
  ghost.style.display = 'block';
  ghost.style.transitionDuration = duration + 'ms';
  ghost.style.left = left + 'px';
  ghost.style.top = top + 'px';
  return sleep(duration);
}
function hideDemoGhost() {
  document.getElementById('demoGhost').style.display = 'none';
}
function showDemoToast(msg) {
  const toast = document.getElementById('demoToast');
  toast.textContent = msg;
  toast.classList.add('show');
}
function hideDemoToast() {
  document.getElementById('demoToast').classList.remove('show');
}
// Brief pop-in on a just-added node so it reads as "dropped" rather than
// silently appearing. Targets the <rect class="node"> child, not the <g> -
// the <g> carries the translate(x,y) as an attribute, and animating CSS
// `transform` on it would override that positioning instead of layering on
// top of it.
function flashNewNode(nodeId) {
  const rect = document.querySelector(`#mapCanvas g[data-node-id="${nodeId}"] rect.node`);
  if (!rect) return;
  rect.classList.add('demo-pop');
  setTimeout(() => rect.classList.remove('demo-pop'), 500);
}

function setupPlayDemoButton() {
  const btn = document.getElementById('playDemoBtn');
  if (!btn) return;
  btn.style.display = 'block';
  btn.onclick = () => playDemo();
}

async function playDemo() {
  if (demoPlaying || isReadonly) return;
  demoPlaying = true;
  const btn = document.getElementById('playDemoBtn');
  const cursor = document.getElementById('demoCursor');
  const area = document.getElementById('canvasArea');
  btn.disabled = true;
  btn.textContent = 'Playing demo…';

  // A patch of empty canvas below whatever's already on the map - computed
  // from the current nodes' extent rather than a fixed spot, so the demo
  // never lands on top of existing content whether it's run against the
  // sample map, a blank map, or a real in-progress one.
  const baseY = (nodes.length ? Math.max(...nodes.map(n => n.y)) : 40) + 140;
  const DROP_A = { x: 260, y: baseY };
  const DROP_B = { x: 560, y: baseY + 20 };
  const UNIT = { grade: '7th Grade Math', unit: 'Ratios & Proportional Relationships' };
  const LABEL_A = 'Percent word problems';
  const LABEL_B = 'Convert fractions, decimals & percents';
  const SIDEBAR_ORIGIN = { left: 90, top: 160 };

  try {
    area.scrollTo({ top: area.scrollHeight, left: 0, behavior: 'smooth' });
    await sleep(500);

    cursor.style.transitionDuration = '0ms';
    cursor.style.left = SIDEBAR_ORIGIN.left + 'px';
    cursor.style.top = SIDEBAR_ORIGIN.top + 'px';
    cursor.style.display = 'block';
    await sleep(250);

    // --- 1 & 2: drag two concepts from the sidebar onto the map ---
    showDemoToast('Dragging concepts onto the map…');
    for (const [label, drop, originTop] of [[LABEL_A, DROP_A, 160], [LABEL_B, DROP_B, 210]]) {
      cursor.style.transitionDuration = '0ms';
      cursor.style.left = SIDEBAR_ORIGIN.left + 'px';
      cursor.style.top = originTop + 'px';
      await sleep(200);
      await pressDemoCursor();
      const dropPoint = canvasToScreen(drop.x, drop.y);
      moveDemoGhost(label, SIDEBAR_ORIGIN.left, originTop, 0);
      await Promise.all([
        moveDemoCursor(dropPoint.left, dropPoint.top, 900),
        moveDemoGhost(label, dropPoint.left, dropPoint.top, 900),
      ]);
      await releaseDemoCursor();
      hideDemoGhost();
      addNode(label, drop.x, drop.y, UNIT);
      flashNewNode(nodes[nodes.length - 1].id);
      await sleep(450);
    }
    const nodeA = nodes.find(n => n.label === LABEL_A && n.x === DROP_A.x && n.y === DROP_A.y);
    const nodeB = nodes.find(n => n.label === LABEL_B && n.x === DROP_B.x && n.y === DROP_B.y);

    // --- 3: connect them (Shift+drag from one node to the other) ---
    if (nodeA && nodeB) {
      showDemoToast('Shift+drag between nodes to connect them…');
      const aCenter = canvasToScreen(DROP_A.x + getNodeWidth(nodeA.label) / 2, DROP_A.y + NODE_HEIGHT / 2);
      const bCenter = canvasToScreen(DROP_B.x + getNodeWidth(nodeB.label) / 2, DROP_B.y + NODE_HEIGHT / 2);
      await moveDemoCursor(aCenter.left, aCenter.top, 500);
      await pressDemoCursor();
      await moveDemoCursor(bCenter.left, bCenter.top, 700);
      addLink(nodeA.id, nodeB.id);
      await releaseDemoCursor();
      await sleep(500);
    }

    // --- 4: click a concept, Explore what it builds on, add a suggestion ---
    hideDemoToast();
    await sleep(150);
    const anchorNode = nodeA || nodeB;
    if (anchorNode) {
      showDemoToast('Click a concept, then Explore…');
      const anchorRectEl = document.querySelector(`#mapCanvas g[data-node-id="${anchorNode.id}"] rect`);
      if (anchorRectEl) {
        const anchorScreenRect = anchorRectEl.getBoundingClientRect();
        await moveDemoCursor(anchorScreenRect.left + anchorScreenRect.width / 2, anchorScreenRect.top + anchorScreenRect.height / 2, 600);
        await pressDemoCursor();
        anchorRectEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        await releaseDemoCursor();
        await sleep(500);

        const exploreBtn = document.querySelector('#nodeToolbar button[data-act="explore"]');
        if (exploreBtn) {
          const eRect = exploreBtn.getBoundingClientRect();
          await moveDemoCursor(eRect.left + eRect.width / 2, eRect.top + eRect.height / 2, 500);
          await pressDemoCursor();
          exploreBtn.click();
          await releaseDemoCursor();
          await sleep(500);

          const questionBtn = document.querySelector('#exploreMenu button[data-q="builds_on"]');
          if (questionBtn) {
            const qRect = questionBtn.getBoundingClientRect();
            await moveDemoCursor(qRect.left + qRect.width / 2, qRect.top + qRect.height / 2, 500);
            await pressDemoCursor();
            questionBtn.click();
            await releaseDemoCursor();
            await sleep(1300);

            const addBtn = document.querySelector('.ghost-actions button[data-act="add"]');
            if (addBtn) {
              const aRect = addBtn.getBoundingClientRect();
              await moveDemoCursor(aRect.left + aRect.width / 2, aRect.top + aRect.height / 2, 500);
              await pressDemoCursor();
              addBtn.click();
              await releaseDemoCursor();
              await sleep(600);
            }
          }
        }
      }
      closeAllNodeOverlays();
      renderCanvas();
      hideDemoToast();
      await sleep(150);
    }

    // --- 5: activate the AI summary ---
    showDemoToast('Opening the AI summary…');
    const aiBtn = document.getElementById('aiSummaryBtn');
    const aiRect = aiBtn.getBoundingClientRect();
    await moveDemoCursor(aiRect.left + aiRect.width / 2, aiRect.top + aiRect.height / 2, 700);
    await pressDemoCursor();
    aiBtn.click();
    await releaseDemoCursor();
    await sleep(2600);
    hideDemoToast();
  } finally {
    cursor.style.display = 'none';
    demoPlaying = false;
    btn.disabled = false;
    btn.textContent = '▶ Replay demo';
  }
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

// --- Export current map to PDF, cropped tight to the nodes ---
// Rebuilt as a standalone SVG (not a clone of #mapCanvas) because the live
// canvas is sized to fill the scrollable viewport plus padding - exporting
// it as-is would bake in a lot of empty margin instead of fitting the map.
function mapExportBoundingBox() {
  if (!nodes.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const w = getNodeWidth(n.label);
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + w);
    maxY = Math.max(maxY, n.y + NODE_HEIGHT);
  }
  return { minX, minY, maxX, maxY };
}

function buildMapExportSvg() {
  const box = mapExportBoundingBox();
  if (!box) return null;
  const PAD = 40;
  const x0 = box.minX - PAD, y0 = box.minY - PAD;
  const w = box.maxX - box.minX + PAD * 2, h = box.maxY - box.minY + PAD * 2;
  const svgNS = 'http://www.w3.org/2000/svg';

  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('xmlns', svgNS);
  svg.setAttribute('viewBox', `${x0} ${y0} ${w} ${h}`);
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);

  const bg = document.createElementNS(svgNS, 'rect');
  bg.setAttribute('x', x0); bg.setAttribute('y', y0);
  bg.setAttribute('width', w); bg.setAttribute('height', h);
  bg.setAttribute('fill', '#ffffff');
  svg.appendChild(bg);

  const defs = document.createElementNS(svgNS, 'defs');
  defs.innerHTML = '<marker id="exportArrow" markerWidth="12" markerHeight="7" refX="11" refY="3.5" orient="auto" markerUnits="strokeWidth"><polygon points="0 0, 12 3.5, 0 7" fill="#8191aa"/></marker>';
  svg.appendChild(defs);

  for (const link of links) {
    const pts = linkEndpoints(link);
    if (!pts) continue;
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', curvedPathD(pts.start, pts.end));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#8191aa');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('marker-end', 'url(#exportArrow)');
    svg.appendChild(path);
  }

  for (const node of nodes) {
    const nw = getNodeWidth(node.label);
    const color = nodeColorFor(node);
    const g = document.createElementNS(svgNS, 'g');

    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('x', node.x); rect.setAttribute('y', node.y);
    rect.setAttribute('width', nw); rect.setAttribute('height', NODE_HEIGHT);
    rect.setAttribute('rx', NODE_RADIUS); rect.setAttribute('ry', NODE_RADIUS);
    rect.setAttribute('fill', color.fill);
    rect.setAttribute('stroke', color.stroke);
    rect.setAttribute('stroke-width', '1.5');
    g.appendChild(rect);

    const text = document.createElementNS(svgNS, 'text');
    text.textContent = node.label;
    text.setAttribute('x', node.x + nw / 2);
    text.setAttribute('y', node.y + NODE_HEIGHT / 2);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('font-size', '13');
    text.setAttribute('font-weight', '600');
    text.setAttribute('fill', color.text || '#1a2233');
    text.setAttribute('font-family', "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif");
    const availableExportTextWidth = nw - NODE_HORIZ_PADDING * 2;
    if (measureTextWidthAtSize(node.label, 13) > availableExportTextWidth) {
      text.setAttribute('textLength', availableExportTextWidth);
      text.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    }
    g.appendChild(text);

    svg.appendChild(g);
  }

  return { svg, w, h };
}

function mapExportFilename() {
  const input = document.getElementById('mapTitleInput');
  const title = (input && input.value.trim()) || 'span-map';
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'span-map';
}

async function exportMapToPdf() {
  const built = buildMapExportSvg();
  if (!built) { alert('Add some concepts to your map before exporting.'); return; }
  const { svg, w, h } = built;

  const RASTER_SCALE = 2; // crisp at normal print/zoom levels without ballooning file size
  svg.setAttribute('width', w * RASTER_SCALE);
  svg.setAttribute('height', h * RASTER_SCALE);

  const svgData = new XMLSerializer().serializeToString(svg);
  const svgUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgData);

  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = svgUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = w * RASTER_SCALE;
  canvas.height = h * RASTER_SCALE;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  // JPEG, not PNG: the map is opaque (white bg painted above, no
  // transparency), and jsPDF can't pass a PNG's compressed IDAT stream
  // through untouched when it has to decode it first - it was re-embedding
  // as a raw, uncompressed bitmap (a 22-node map came out to 23MB). JPEG at
  // high quality is indistinguishable here and lands under 500KB.
  const imgData = canvas.toDataURL('image/jpeg', 0.92);

  // Points, not raw px - our coordinates are CSS px (~96/inch); treating
  // them as-is as PDF points (72/inch) would inflate the physical page
  // size by a third.
  const wPt = w * 0.75, hPt = h * 0.75;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({
    orientation: wPt >= hPt ? 'landscape' : 'portrait',
    unit: 'pt',
    format: [wPt, hPt],
  });
  doc.addImage(imgData, 'JPEG', 0, 0, wPt, hPt);
  doc.save(`${mapExportFilename()}.pdf`);
}

function setupExportPdfButton() {
  const btn = document.getElementById('exportPdfBtn');
  if (!btn) return;
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      await exportMapToPdf();
    } catch (e) {
      console.error('PDF export failed:', e);
      alert('Could not export PDF. Please try again.');
    } finally {
      btn.disabled = false;
    }
  };
}

// --- Beta: Instant AI summary ---
// Heuristic, not a model call - groups the map's own nodes by curriculum
// unit and compares how well-connected each unit's nodes are, same
// "connected vs isolated" signal isolated-concept highlighting already
// computes per node, just rolled up per unit.
//
// Framed as a nudge toward a specific node rather than a strength/weakness
// verdict: it asks a question or suggests a concept to connect, and points
// at the relevant node(s) on the canvas (see summaryHighlightIds) instead
// of just naming a unit in prose. Phrasing rotates via `pickPhrase` (seeded by
// the day, so it's stable within a session but doesn't say the same thing
// every day), and a clear non-gap just gets acknowledged rather than a
// gap being manufactured to fill the sentence.

const SUMMARY_MOMENTUM_KEY = 'spanSummaryMomentum';
const SUMMARY_MOMENTUM_MIN_HOURS = 18;

// Deterministic pick so re-opening the panel doesn't change the wording
// mid-session, but different days/units land on different phrasing.
function pickPhrase(seedStr, options) {
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) h = (h * 31 + seedStr.charCodeAt(i)) >>> 0;
  return options[h % options.length];
}

// Real day-over-day progress is more motivating than a rephrased gap, so
// it takes priority when there's a positive delta to report. Only fires
// once enough time has passed since the last check-in, and only when the
// map actually grew - no "0 new connections" message.
function computeMomentumMessage(linksArr) {
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(SUMMARY_MOMENTUM_KEY) || 'null'); } catch (e) { stored = null; }
  const now = Date.now();
  const linkCount = linksArr.length;
  const hoursSince = stored ? (now - stored.timestamp) / 36e5 : Infinity;
  let message = null;
  if (stored && hoursSince >= SUMMARY_MOMENTUM_MIN_HOURS) {
    const delta = linkCount - stored.linkCount;
    if (delta > 0) {
      message = `You've added ${delta} new connection${delta === 1 ? '' : 's'} since your last visit — nice work.`;
    }
  }
  if (!stored || hoursSince >= SUMMARY_MOMENTUM_MIN_HOURS) {
    try { localStorage.setItem(SUMMARY_MOMENTUM_KEY, JSON.stringify({ linkCount, timestamp: now })); } catch (e) {}
  }
  return message;
}

function computeMapSummary(nodesArr, linksArr) {
  if (!nodesArr.length) {
    return { text: 'Your map is empty — add a few concepts to get started.', highlightIds: [] };
  }

  const momentum = computeMomentumMessage(linksArr);
  if (momentum) return { text: momentum, highlightIds: [] };

  const today = new Date().toDateString();
  const degree = new Map();
  for (const n of nodesArr) degree.set(n.id, 0);
  for (const l of linksArr) {
    degree.set(l.source, (degree.get(l.source) || 0) + 1);
    degree.set(l.target, (degree.get(l.target) || 0) + 1);
  }
  const byUnit = new Map(); // unit -> { total, connected, ids }
  for (const n of nodesArr) {
    const unit = n.meta && n.meta.unit;
    if (!unit) continue;
    if (!byUnit.has(unit)) byUnit.set(unit, { total: 0, connected: 0, ids: [] });
    const rec = byUnit.get(unit);
    rec.total++;
    rec.ids.push(n.id);
    if ((degree.get(n.id) || 0) > 0) rec.connected++;
  }
  if (!byUnit.size) {
    return {
      text: `${nodesArr.length} concept${nodesArr.length === 1 ? '' : 's'} on the map so far, none tagged to a curriculum unit yet. Drag topics in from the sidebar to get unit-by-unit insight.`,
      highlightIds: [],
    };
  }

  const units = [...byUnit.entries()]
    .map(([unit, r]) => ({ unit, ...r, ratio: r.connected / r.total }))
    .sort((a, b) => b.ratio - a.ratio || b.total - a.total);
  const strong = units[0];
  const thin = units[units.length - 1];

  if (units.length === 1) {
    const isolatedIds = strong.ids.filter(id => (degree.get(id) || 0) === 0);
    if (!isolatedIds.length) {
      return {
        text: pickPhrase(strong.unit + today, [
          `Your map is fully connected so far — nice work.`,
          `Everything on your map connects to something else — solid start.`,
        ]),
        highlightIds: [],
      };
    }
    return {
      text: pickPhrase(strong.unit + strong.total + today, [
        `What does ${strong.unit} build on? Try connecting one of the unlinked concepts to something it depends on.`,
        `A few ${strong.unit} concepts aren't linked to anything yet — what would you connect them to?`,
      ]),
      highlightIds: isolatedIds,
    };
  }

  const gap = strong.ratio - thin.ratio;
  if (gap < 0.15 && thin.ratio >= 0.5) {
    // No real gap between units - acknowledge it instead of manufacturing one.
    return {
      text: pickPhrase(strong.unit + thin.unit + today, [
        `Your map is holding together well across ${strong.unit} and ${thin.unit} — keep going.`,
        `Solid connections across both ${strong.unit} and ${thin.unit} so far.`,
      ]),
      highlightIds: [],
    };
  }

  const thinIsolatedIds = thin.ids.filter(id => (degree.get(id) || 0) === 0);
  const text = pickPhrase(thin.unit + strong.unit + today, [
    `How does ${thin.unit} connect to ${strong.unit}?`,
    `What in ${thin.unit} builds on what you've already mapped in ${strong.unit}?`,
    `Try linking a concept in ${thin.unit} to something it depends on.`,
  ]);
  return { text, highlightIds: thinIsolatedIds.length ? thinIsolatedIds : thin.ids };
}
function setupAiSummaryButton() {
  const btn = document.getElementById('aiSummaryBtn');
  const panel = document.getElementById('aiSummaryPanel');
  const text = document.getElementById('aiSummaryText');
  if (!btn || !panel || !text) return;
  const closePanel = () => {
    panel.style.display = 'none';
    if (summaryHighlightIds.size) {
      summaryHighlightIds = new Set();
      renderCanvas();
    }
  };
  btn.onclick = (e) => {
    e.stopPropagation();
    const isOpen = getComputedStyle(panel).display !== 'none';
    if (isOpen) { closePanel(); return; }
    const summary = computeMapSummary(nodes, links);
    text.textContent = summary.text;
    summaryHighlightIds = new Set(summary.highlightIds);
    checkMapDim = false; // Check My Map's dimming is a separate highlight source - don't leave it stuck on
    panel.style.display = 'block';
    renderCanvas();
  };
  // Capture phase: node/link clicks on the canvas call stopPropagation()
  // during bubbling, which would otherwise stop this from ever seeing them.
  document.addEventListener('click', (e) => {
    if (panel.contains(e.target) || btn.contains(e.target)) return;
    closePanel();
  }, true);
}

// ============================================================
// Beta: map-level "Check my map" - a different kind of check than
// Explore's per-node scaffolding. Four heuristic categories, all computed
// client-side from the curriculum JSON already loaded for the sidebar (no
// backend call needed): missing bridge, isolated concept, missing
// relationship, questionable relationship. Never auto-corrects anything -
// every action here is a suggestion the student explicitly accepts
// (Show on map / + Add / + Connect) or a deliberate choice on an existing
// edge (Explain / Keep anyway / Remove connection), never a silent edit.
// ============================================================

function curriculumPos(label) {
  for (const grade in conceptsData) {
    for (const unit in conceptsData[grade]) {
      const idx = conceptsData[grade][unit].indexOf(label);
      if (idx !== -1) return { grade, unit, idx, topics: conceptsData[grade][unit] };
    }
  }
  return null;
}

function checkMyMap() {
  const degree = new Map(nodes.map(n => [n.id, 0]));
  links.forEach(l => {
    degree.set(l.source, (degree.get(l.source) || 0) + 1);
    degree.set(l.target, (degree.get(l.target) || 0) + 1);
  });

  const isolated = nodes.filter(n => (degree.get(n.id) || 0) === 0);

  const missingBridge = [];
  const questionable = [];
  const onMapLabels = new Set(nodes.map(n => n.label));
  links.forEach(l => {
    if (checkMapDismissed.has(l.id)) return;
    const src = nodes.find(n => n.id === l.source), tgt = nodes.find(n => n.id === l.target);
    if (!src || !tgt) return;
    const posA = curriculumPos(src.label), posB = curriculumPos(tgt.label);
    if (!posA || !posB) return;
    // Deliberately same-unit only: cross-unit and cross-grade edges are
    // often the most valuable connections on a map (that's the whole
    // point of a map over a flat topic list), so distance alone can't
    // tell a genuine long-range prerequisite apart from a careless jump
    // once units differ - only flag within a single unit, where the
    // curriculum's own step-by-step order is a much stronger signal.
    if (posA.grade !== posB.grade || posA.unit !== posB.unit) return;
    const dist = Math.abs(posA.idx - posB.idx);
    if (dist <= 1) return; // adjacent in the curriculum sequence - a direct edge is expected here
    if (dist <= 3) {
      const lo = Math.min(posA.idx, posB.idx), hi = Math.max(posA.idx, posB.idx);
      const between = posA.topics.slice(lo + 1, hi).filter(t => !onMapLabels.has(t));
      if (between.length) {
        missingBridge.push({ source: src, target: tgt, candidate: between[0], link: l, grade: posA.grade, unit: posA.unit });
      }
    } else {
      questionable.push({
        source: src, target: tgt, link: l,
        reason: `${src.label} and ${tgt.label} are ${dist} topics apart in ${posA.unit} - worth double-checking this is a direct prerequisite, not a multi-step jump.`,
      });
    }
  });

  const missingRelationship = [];
  const tagged = nodes.filter(n => curriculumPos(n.label));
  for (let i = 0; i < tagged.length; i++) {
    for (let j = i + 1; j < tagged.length; j++) {
      const a = tagged[i], b = tagged[j];
      const posA = curriculumPos(a.label), posB = curriculumPos(b.label);
      if (posA.grade === posB.grade && posA.unit === posB.unit && Math.abs(posA.idx - posB.idx) === 1) {
        const already = links.some(l => (l.source === a.id && l.target === b.id) || (l.source === b.id && l.target === a.id));
        if (!already) missingRelationship.push({ a, b, unit: posA.unit });
      }
    }
  }

  return { isolated, missingBridge, missingRelationship, questionable };
}

function highlightCheckMapNodes(ids) {
  summaryHighlightIds = new Set(ids);
  checkMapDim = true;
  renderCanvas();
}

function checkMapSection(body, title, count, items, renderItem) {
  if (!items.length) return;
  const sec = document.createElement('div');
  sec.className = 'checkmap-section';
  const h = document.createElement('div');
  h.className = 'checkmap-section-title';
  h.textContent = `${count} ${title}`;
  sec.appendChild(h);
  items.forEach(item => sec.appendChild(renderItem(item)));
  body.appendChild(sec);
}

function renderCheckMapPanel() {
  const body = document.getElementById('checkMapBody');
  if (!body) return;
  const findings = checkMyMap();
  const total = findings.isolated.length + findings.missingBridge.length + findings.missingRelationship.length + findings.questionable.length;
  body.innerHTML = '';
  if (!total) {
    body.innerHTML = '<p class="checkmap-empty">No gaps spotted — nice work.</p>';
    return;
  }

  checkMapSection(body, findings.missingBridge.length === 1 ? 'possible gap' : 'possible gaps', findings.missingBridge.length, findings.missingBridge, f => {
    const row = document.createElement('div');
    row.className = 'checkmap-row';
    const p = document.createElement('p');
    p.innerHTML = `${f.source.label} and ${f.target.label} are connected, but <strong>${f.candidate}</strong> may be an important concept in between.`;
    row.appendChild(p);
    const actions = document.createElement('div');
    actions.className = 'checkmap-actions';
    const showBtn = document.createElement('button');
    showBtn.textContent = 'Show on map';
    showBtn.onclick = () => highlightCheckMapNodes([f.source.id, f.target.id]);
    const addBtn = document.createElement('button');
    addBtn.textContent = `+ Add ${f.candidate}`;
    addBtn.onclick = () => {
      // Clamped like layoutGhostPosition - this canvas has no viewBox, so a
      // negative y (both endpoints near the top edge) would be genuinely
      // unreachable, not just off-screen.
      const midX = Math.max(10, (f.source.x + f.target.x) / 2);
      const midY = Math.max(10, (f.source.y + f.target.y) / 2 - 80);
      addNode(f.candidate, midX, midY, { grade: f.grade, unit: f.unit, aiAdded: true });
      const bridgeNode = nodes[nodes.length - 1];
      addLink(f.source.id, bridgeNode.id);
      addLink(bridgeNode.id, f.target.id);
      renderCheckMapPanel();
    };
    actions.appendChild(showBtn); actions.appendChild(addBtn);
    row.appendChild(actions);
    return row;
  });

  checkMapSection(body, findings.isolated.length === 1 ? 'isolated concept' : 'isolated concepts', findings.isolated.length, findings.isolated, n => {
    const row = document.createElement('div');
    row.className = 'checkmap-row';
    const p = document.createElement('p');
    p.innerHTML = `<strong>${n.label}</strong> has no incoming or outgoing connections.`;
    row.appendChild(p);
    const actions = document.createElement('div');
    actions.className = 'checkmap-actions';
    const btn = document.createElement('button');
    btn.textContent = 'Highlight';
    btn.onclick = () => highlightCheckMapNodes([n.id]);
    actions.appendChild(btn);
    row.appendChild(actions);
    return row;
  });

  checkMapSection(body, findings.missingRelationship.length === 1 ? 'connection to consider' : 'connections to consider', findings.missingRelationship.length, findings.missingRelationship, f => {
    const row = document.createElement('div');
    row.className = 'checkmap-row';
    const p = document.createElement('p');
    p.innerHTML = `<strong>${f.a.label}</strong> and <strong>${f.b.label}</strong> are next to each other in ${f.unit}, but aren't connected yet.`;
    row.appendChild(p);
    const actions = document.createElement('div');
    actions.className = 'checkmap-actions';
    const showBtn = document.createElement('button');
    showBtn.textContent = 'Show on map';
    showBtn.onclick = () => highlightCheckMapNodes([f.a.id, f.b.id]);
    const connectBtn = document.createElement('button');
    connectBtn.textContent = '+ Connect';
    connectBtn.onclick = () => { addLink(f.a.id, f.b.id); renderCheckMapPanel(); };
    actions.appendChild(showBtn); actions.appendChild(connectBtn);
    row.appendChild(actions);
    return row;
  });

  checkMapSection(body, findings.questionable.length === 1 ? 'connection to reconsider' : 'connections to reconsider', findings.questionable.length, findings.questionable, f => {
    const row = document.createElement('div');
    row.className = 'checkmap-row';
    const p = document.createElement('p');
    p.textContent = `Take another look at this connection: ${f.source.label} → ${f.target.label}.`;
    row.appendChild(p);
    const explainP = document.createElement('p');
    explainP.className = 'checkmap-explain';
    explainP.style.display = 'none';
    explainP.textContent = f.reason;
    row.appendChild(explainP);
    const actions = document.createElement('div');
    actions.className = 'checkmap-actions';
    const explainBtn = document.createElement('button');
    explainBtn.textContent = 'Explain';
    explainBtn.onclick = () => { explainP.style.display = explainP.style.display === 'none' ? 'block' : 'none'; };
    const keepBtn = document.createElement('button');
    keepBtn.textContent = 'Keep anyway';
    keepBtn.onclick = () => { checkMapDismissed.add(f.link.id); renderCheckMapPanel(); };
    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove connection';
    removeBtn.className = 'checkmap-danger';
    removeBtn.onclick = () => { deleteLink(f.link.id); renderCheckMapPanel(); };
    actions.appendChild(explainBtn); actions.appendChild(keepBtn); actions.appendChild(removeBtn);
    row.appendChild(actions);
    return row;
  });
}

function closeCheckMapPanel() {
  const panel = document.getElementById('checkMapPanel');
  if (panel) panel.style.display = 'none';
  checkMapDim = false;
  summaryHighlightIds = new Set();
  renderCanvas();
}

function setupCheckMapButton() {
  const btn = document.getElementById('checkMapBtn');
  const panel = document.getElementById('checkMapPanel');
  if (!btn || !panel) return;
  btn.onclick = e => {
    e.stopPropagation();
    const isOpen = getComputedStyle(panel).display !== 'none';
    if (isOpen) { closeCheckMapPanel(); return; }
    panel.style.display = 'block';
    renderCheckMapPanel();
  };
  document.addEventListener('click', e => {
    if (panel.contains(e.target) || btn.contains(e.target)) return;
    if (getComputedStyle(panel).display !== 'none') closeCheckMapPanel();
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
  const timelineBtn = document.getElementById('timelineBtn');
  const timelinePanel = document.getElementById('timelinePanel');
  const timelineListView = document.getElementById('timelineListView');
  const timelineViewerView = document.getElementById('timelineViewerView');
  const timelineNameInput = document.getElementById('timelineNameInput');
  const createTimelineBtn = document.getElementById('createTimelineBtn');
  const timelineList = document.getElementById('timelineList');
  const timelineBackBtn = document.getElementById('timelineBackBtn');
  const timelineFrame = document.getElementById('timelineFrame');
  const timelineEmpty = document.getElementById('timelineEmpty');
  const timelineControls = document.getElementById('timelineControls');
  const timelinePlayBtn = document.getElementById('timelinePlayBtn');
  const timelineSlider = document.getElementById('timelineSlider');
  const timelineLabel = document.getElementById('timelineLabel');

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
      const result = await window.SpanAuth.signUp(email, password, name);
      if (result.session) {
        // Email confirmation is off for this project - signUp() already
        // returned an active session, so there's no email to check. The
        // auth-state listener picks up the session; just close the modal.
        closeModal();
      } else {
        errEl.style.color = '#1f8a4c';
        errEl.textContent = 'Check your email to confirm your account, then sign in.';
      }
    } catch (err) {
      errEl.textContent = err.message || 'Sign up failed.';
    }
  };

  signOutBtn.onclick = async () => {
    await window.SpanAuth.signOut();
    cloudMapId = null; cloudMapTitle = null; cloudMapUpdatedAt = null;
    myMapsPanel.style.display = 'none';
    timelinePanel.style.display = 'none';
    stopTimelinePlayback();
  };

  function renderMyMapsList(rows, timelines) {
    timelines = timelines || [];
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
      // Beta: map timeline - assign this saved map to a named sequence.
      const tlSelect = document.createElement('select');
      tlSelect.className = 'my-map-timeline-select';
      tlSelect.title = 'Add to a timeline';
      tlSelect.onclick = (e) => e.stopPropagation();
      const noneOpt = document.createElement('option');
      noneOpt.value = ''; noneOpt.textContent = 'Timeline…';
      tlSelect.appendChild(noneOpt);
      timelines.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id; opt.textContent = t.name;
        if (row.timeline_id === t.id) opt.selected = true;
        tlSelect.appendChild(opt);
      });
      const newOpt = document.createElement('option');
      newOpt.value = '__new__'; newOpt.textContent = '+ New timeline…';
      tlSelect.appendChild(newOpt);
      tlSelect.onchange = async (e) => {
        e.stopPropagation();
        let targetId = tlSelect.value;
        if (targetId === '__new__') {
          const name = (window.prompt('Name this timeline:') || '').trim();
          if (!name) { tlSelect.value = row.timeline_id || ''; return; }
          try {
            const t = await window.SpanAuth.createTimeline(name);
            timelines.push(t);
            targetId = t.id;
            const opt = document.createElement('option');
            opt.value = t.id; opt.textContent = t.name; opt.selected = true;
            tlSelect.insertBefore(opt, newOpt);
          } catch (err) {
            alert('Could not create timeline: ' + (err.message || err));
            tlSelect.value = row.timeline_id || '';
            return;
          }
        }
        try {
          await window.SpanAuth.setMapTimeline(row.id, targetId || null);
          row.timeline_id = targetId || null;
        } catch (err) {
          alert('Could not update timeline: ' + (err.message || err));
        }
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
      li.appendChild(tlSelect);
      li.appendChild(delBtn);
      myMapsList.appendChild(li);
    }
  }

  // --- Beta: map timeline ---
  let timelineMaps = [];
  let timelinePlayTimer = null;

  function stopTimelinePlayback() {
    if (timelinePlayTimer) { clearInterval(timelinePlayTimer); timelinePlayTimer = null; }
    timelinePlayBtn.innerHTML = '&#9654;';
  }

  function showTimelineList() {
    stopTimelinePlayback();
    timelineViewerView.style.display = 'none';
    timelineListView.style.display = '';
  }

  async function renderTimelineListPanel() {
    timelineList.innerHTML = '<li class="empty">Loading…</li>';
    let timelines;
    try {
      timelines = await window.SpanAuth.listMyTimelines();
    } catch (e) {
      timelineList.innerHTML = '<li class="empty">Could not load timelines.</li>';
      return;
    }
    if (!timelines.length) {
      timelineList.innerHTML = '<li class="empty">No timelines yet — create one above.</li>';
      return;
    }
    timelineList.innerHTML = '';
    timelines.forEach(t => {
      const li = document.createElement('li');
      const nameSpan = document.createElement('span');
      nameSpan.textContent = t.name;
      nameSpan.style.flex = '1';
      nameSpan.onclick = () => openTimelineViewer(t);
      const delBtn = document.createElement('button');
      delBtn.textContent = '×';
      delBtn.className = 'timeline-delete';
      delBtn.title = 'Delete this timeline (maps themselves are kept)';
      delBtn.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete timeline "${t.name}"? The maps in it won't be deleted.`)) return;
        await window.SpanAuth.deleteTimeline(t.id);
        li.remove();
      };
      li.onclick = () => openTimelineViewer(t);
      li.appendChild(nameSpan);
      li.appendChild(delBtn);
      timelineList.appendChild(li);
    });
  }

  // Lightweight, self-contained renderer for timeline frames - deliberately
  // does NOT touch the shared nodeColorAssignments map or global nodes/links
  // arrays like renderCanvas() does, so scrubbing through someone's map
  // history can never bleed into (or get clobbered by) the live editing
  // session's own canvas state.
  function renderTimelineFrame(svg, mapData) {
    svg.innerHTML = `
      <defs>
        <marker id="timelineArrow" markerWidth="10" markerHeight="6" refX="9" refY="3" orient="auto">
          <polygon points="0 0, 10 3, 0 6" fill="#9aa5b5"/>
        </marker>
      </defs>
    `;
    const nodesArr = (mapData && mapData.n) || [];
    const edgesArr = (mapData && mapData.e) || [];
    if (!nodesArr.length) { svg.setAttribute('viewBox', '0 0 300 150'); return; }

    const localColors = new Map();
    const palette = ['#eaf2ff', '#f1edff', '#eafbf1', '#fff8e8', '#fdeef8', '#e8f7f7'];
    const strokes = ['#b9d4f8', '#cabdf7', '#a9e6c3', '#f0d896', '#f2b8e0', '#a8dede'];
    function colorFor(n) {
      const key = (n.m && (n.m.unit || n.m.grade)) || n.l;
      if (!localColors.has(key)) localColors.set(key, localColors.size % palette.length);
      const i = localColors.get(key);
      return { fill: palette[i], stroke: strokes[i] };
    }
    const byId = new Map(nodesArr.map(n => [n.i, n]));

    for (const e of edgesArr) {
      const src = byId.get(e.s), tgt = byId.get(e.t);
      if (!src || !tgt) continue;
      const sw = getNodeWidth(src.l), tw = getNodeWidth(tgt.l);
      const x1 = src.x + sw / 2, y1 = src.y + NODE_HEIGHT / 2;
      const x2 = tgt.x + tw / 2, y2 = tgt.y + NODE_HEIGHT / 2;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M${x1},${y1} L${x2},${y2}`);
      path.setAttribute('stroke', '#9aa5b5');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('fill', 'none');
      path.setAttribute('marker-end', 'url(#timelineArrow)');
      svg.appendChild(path);
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodesArr) {
      const w = getNodeWidth(n.l);
      const color = colorFor(n);
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('transform', `translate(${n.x},${n.y})`);
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('width', w);
      rect.setAttribute('height', NODE_HEIGHT);
      rect.setAttribute('rx', NODE_RADIUS);
      rect.setAttribute('fill', color.fill);
      rect.setAttribute('stroke', color.stroke);
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.textContent = n.l;
      text.setAttribute('x', w / 2);
      text.setAttribute('y', NODE_HEIGHT / 2);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('font-size', '0.95em');
      text.setAttribute('font-weight', '600');
      text.setAttribute('font-family', "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif");
      g.appendChild(rect);
      g.appendChild(text);
      svg.appendChild(g);
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + w); maxY = Math.max(maxY, n.y + NODE_HEIGHT);
    }
    const pad = 24;
    svg.setAttribute('viewBox', `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`);
  }

  function showTimelineFrame(index) {
    const m = timelineMaps[index];
    if (!m) return;
    renderTimelineFrame(timelineFrame, m.data);
    timelineLabel.textContent = `${m.title} — ${new Date(m.created_at).toLocaleDateString()}`;
  }

  async function openTimelineViewer(t) {
    timelineListView.style.display = 'none';
    timelineViewerView.style.display = '';
    timelineFrame.innerHTML = '';
    timelineLabel.textContent = '';
    timelineEmpty.style.display = 'none';
    timelineControls.style.display = 'none';
    try {
      timelineMaps = await window.SpanAuth.listTimelineMaps(t.id);
    } catch (e) {
      timelineMaps = [];
    }
    if (!timelineMaps.length) {
      timelineEmpty.style.display = 'block';
      return;
    }
    timelineControls.style.display = 'flex';
    timelineSlider.max = String(timelineMaps.length - 1);
    timelineSlider.value = '0';
    showTimelineFrame(0);
  }

  timelineSlider.oninput = () => {
    stopTimelinePlayback();
    showTimelineFrame(Number(timelineSlider.value));
  };
  timelineBackBtn.onclick = showTimelineList;
  timelinePlayBtn.onclick = () => {
    if (timelinePlayTimer) { stopTimelinePlayback(); return; }
    if (timelineMaps.length < 2) return;
    timelinePlayBtn.innerHTML = '&#10074;&#10074;';
    timelinePlayTimer = setInterval(() => {
      let next = Number(timelineSlider.value) + 1;
      if (next > timelineMaps.length - 1) next = 0;
      timelineSlider.value = String(next);
      showTimelineFrame(next);
    }, 1400);
  };
  createTimelineBtn.onclick = async () => {
    const name = timelineNameInput.value.trim();
    if (!name) return;
    createTimelineBtn.disabled = true;
    try {
      await window.SpanAuth.createTimeline(name);
      timelineNameInput.value = '';
      await renderTimelineListPanel();
    } catch (e) {
      alert('Could not create timeline: ' + (e.message || e));
    } finally {
      createTimelineBtn.disabled = false;
    }
  };
  timelineBtn.onclick = async () => {
    const isOpen = getComputedStyle(timelinePanel).display !== 'none';
    if (isOpen) { timelinePanel.style.display = 'none'; stopTimelinePlayback(); return; }
    myMapsPanel.style.display = 'none';
    timelinePanel.style.display = 'block';
    showTimelineList();
    await renderTimelineListPanel();
  };

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
    timelinePanel.style.display = 'none';
    stopTimelinePlayback();
    myMapsPanel.style.display = 'block';
    myMapsList.innerHTML = '<li class="empty">Loading…</li>';
    try {
      const [maps, timelines] = await Promise.all([
        window.SpanAuth.listMyMaps(),
        window.SpanAuth.listMyTimelines().catch(() => []), // don't block My Maps if this 400s pre-migration
      ]);
      renderMyMapsList(maps, timelines);
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
    const dashboardLink = document.getElementById('dashboardLink');
    if (session) {
      signInBtn.style.display = 'none';
      userMenu.style.display = 'flex';
      const name = (session.user.user_metadata && session.user.user_metadata.display_name) || session.user.email;
      const role = window.SpanAuth.role(session);
      userLabel.textContent = `${name} (${role})`;
      if (dashboardLink) {
        dashboardLink.style.display = '';
        dashboardLink.href = role === 'teacher' ? 'dashboard' : 'student';
      }
    } else {
      signInBtn.style.display = '';
      userMenu.style.display = 'none';
      myMapsPanel.style.display = 'none';
      if (dashboardLink) dashboardLink.style.display = 'none';
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
    if (summaryHighlightIds.has(node.id)) extraClass += ' summary-highlight';
    if (checkMapDim && !summaryHighlightIds.has(node.id)) extraClass += ' dimmed';
    rect.setAttribute('class', 'node'+extraClass);
    const color = nodeColorFor(node);
    rect.setAttribute('fill', color.fill);
    rect.setAttribute('stroke', color.stroke);

    // --- One mousedown handler for all node actions ---
    rect.onmousedown = e => {
      if (isReadonly) return;
      if (e.shiftKey) {
        // Shift+drag: Start link-creation
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
      }
    };
    // --- Ctrl+double-click to delete node
    rect.ondblclick = e => {
      if (e.ctrlKey) {
        deleteNode(node.id);
      }
      // Else: nothing (no note)
    };
    // --- Click: select + toggle the Edit/Connect/Explore toolbar. While a
    // Connect is pending (from another node's toolbar), clicking a
    // *different* node completes the link instead of opening a toolbar.
    rect.onclick = e => {
      e.stopPropagation();
      if (isReadonly) { selectedNode = node; selectedLink = null; renderCanvas(); return; }
      if (connectPending && connectPending !== node) {
        addLink(connectPending.id, node.id);
        connectPending = null;
        closeAllNodeOverlays();
        renderCanvas();
        return;
      }
      connectPending = null;
      if (nodeToolbarState && nodeToolbarState.node === node) {
        closeAllNodeOverlays();
      } else {
        selectedNode = node; selectedLink = null;
        closeAllNodeOverlays();
        nodeToolbarState = { node };
      }
      renderCanvas();
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
    // Box width is capped (NODE_MAX_WIDTH) so a handful of very long
    // curriculum labels don't blow up the whole layout - condense those
    // labels to fit instead of letting them overflow the node.
    const availableTextWidth = w - NODE_HORIZ_PADDING * 2;
    if (measureNodeTextWidth(labelText) > availableTextWidth) {
      textEl.setAttribute('textLength', availableTextWidth);
      textEl.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    }
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

    // Quiet provenance mark, not a penalty - a small sparkle for concepts
    // added from an Explore suggestion rather than typed/dragged in by the
    // student. Bottom-right (not top-right) so it doesn't collide with the
    // isolated badge above. Clears the first time the node is renamed.
    if (node.meta && node.meta.aiAdded) {
      const badge = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      badge.setAttribute('class', 'ai-added-badge');
      badge.setAttribute('transform', `translate(${w},${NODE_HEIGHT})`);
      const bCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      bCircle.setAttribute('r', '8');
      const bText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      bText.textContent = '✦';
      bText.setAttribute('font-size', '9');
      bText.setAttribute('text-anchor', 'middle');
      bText.setAttribute('dominant-baseline', 'middle');
      bText.setAttribute('y', '0.5');
      badge.appendChild(bCircle);
      badge.appendChild(bText);
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = 'Added from an Explore suggestion';
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
    closeAllNodeOverlays();
    renderCanvas();
  };

  renderGhostSuggestions(svg);
  updateNodeOverlays();
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

// ============================================================
// Node-level scaffolding: click a node for Edit/Connect/Explore, then pick
// one of three questions to get suggestions rendered as ghost nodes right
// on the canvas (not a side panel/chat box). Each suggestion is a full
// relationship - source concept + relationship type + target concept +
// reason - never a bare "add this concept," since the product is about
// edges, not just nodes. Never auto-adds anything: every ghost needs an
// explicit "+ Add" click, and dismissing one is just as easy.
// ============================================================

function closeAllNodeOverlays() {
  nodeToolbarState = null;
  exploreMenuState = null;
  ghostState = null;
  connectPending = null;
}

// Suggestions lay out in the direction their relationship actually points -
// prerequisites above the anchor, successors below, sideways/related ones
// off to the side - so position alone previews what kind of edge "+ Add"
// will draw, before the student reads a word of the reason.
function layoutGhostPosition(anchor, index, total, question) {
  const anchorW = getNodeWidth(anchor.label);
  const spread = 250;
  const startX = anchor.x + anchorW / 2 - ((total - 1) * spread) / 2 - 100;
  let pos;
  if (question === 'builds_on') pos = { x: startX + index * spread, y: anchor.y - 150 };
  else if (question === 'leads_to') pos = { x: startX + index * spread, y: anchor.y + NODE_HEIGHT + 110 };
  else pos = { x: anchor.x + anchorW + 130, y: anchor.y - 70 + index * 95 };
  // The canvas's own coordinate space starts at (0,0) with no negative
  // headroom (no viewBox) - an anchor near the top/left edge of the map
  // would otherwise push "builds on" ghosts to a negative y that's not
  // just off-screen but genuinely unreachable by scrolling.
  return { x: Math.max(10, pos.x), y: Math.max(10, pos.y) };
}

async function requestSuggestions(node, question, exclude) {
  const backendUrl = window.AI_BACKEND_URL || 'http://localhost:5000';
  const res = await fetch(`${backendUrl}/recommend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nodes: nodes.map(n => ({ id: n.id, label: n.label, meta: n.meta })),
      selected_node: { id: node.id, label: node.label, meta: node.meta },
      question,
      exclude: [...exclude],
    }),
  });
  if (!res.ok) throw new Error('bad response');
  const data = await res.json();
  return data.suggestions || [];
}

async function openExploreQuestion(node, question) {
  ghostState = { node, question, suggestions: [], shownLabels: new Set(), loading: true, error: false };
  renderCanvas();
  let suggestions = [];
  try {
    suggestions = await requestSuggestions(node, question, ghostState.shownLabels);
  } catch (e) {
    if (ghostState && ghostState.node === node && ghostState.question === question) {
      ghostState.loading = false; ghostState.error = true;
      renderCanvas();
    }
    return;
  }
  if (!ghostState || ghostState.node !== node || ghostState.question !== question) return; // stale response
  suggestions.forEach(s => ghostState.shownLabels.add(s.label));
  ghostState.suggestions = suggestions;
  ghostState.loading = false;
  renderCanvas();
}

async function showMoreSuggestions() {
  if (!ghostState) return;
  const { node, question, shownLabels } = ghostState;
  ghostState.loading = true;
  renderCanvas();
  let suggestions = [];
  try {
    suggestions = await requestSuggestions(node, question, shownLabels);
  } catch (e) {
    if (ghostState) { ghostState.loading = false; renderCanvas(); }
    return;
  }
  if (!ghostState || ghostState.node !== node || ghostState.question !== question) return;
  suggestions.forEach(s => shownLabels.add(s.label));
  ghostState.suggestions = suggestions;
  ghostState.loading = false;
  renderCanvas();
}

// Direction follows the suggestion's own source/target labels (one of
// which is always the anchor, the other the new concept) rather than
// assuming "anchor -> new" - a builds_on ghost draws new -> anchor.
function addGhostSuggestion(suggestion, pos) {
  if (!ghostState) return;
  const anchor = ghostState.node;
  // aiAdded: quietly retained provenance, not a visual penalty - just a
  // small badge (see renderCanvas) that clears the first time the student
  // renames the node, since that's a clear "I've made this mine" signal.
  addNode(suggestion.label, pos.x, pos.y, { ...suggestion.meta, aiAdded: true });
  const newNode = nodes[nodes.length - 1];
  const sourceId = suggestion.source === anchor.label ? anchor.id : newNode.id;
  const targetId = suggestion.target === anchor.label ? anchor.id : newNode.id;
  addLink(sourceId, targetId);
  if (ghostState) ghostState.suggestions = ghostState.suggestions.filter(s => s.label !== suggestion.label);
  renderNotesSidebar();
  renderCanvas();
}

function dismissGhostSuggestion(label) {
  if (!ghostState) return;
  ghostState.suggestions = ghostState.suggestions.filter(s => s.label !== label);
  renderCanvas();
}

function showGhostReason(s, anchorRect) {
  const pop = document.getElementById('ghostReasonPopover');
  if (!pop) return;
  pop.style.display = 'block';
  pop.style.left = Math.max(8, anchorRect.left - 60) + 'px';
  pop.style.top = (anchorRect.bottom + 8) + 'px';
  pop.innerHTML = `
    <div class="reason-rel">${s.source} <span class="reason-arrow">&rarr;</span> ${s.target} <span class="reason-tag">${s.relationship}</span></div>
    <p></p>
    <button id="closeReasonBtn" title="Close">&times;</button>
  `;
  pop.querySelector('p').textContent = s.reason;
  pop.querySelector('#closeReasonBtn').onclick = e => { e.stopPropagation(); pop.style.display = 'none'; };
}

// Ghost suggestion nodes are real SVG elements appended after the real map
// (so they pan/scroll/scale with everything else) - dashed border, lower
// opacity, a small sparkle + "Suggested" tag distinguish them from real
// nodes at a glance. Their +Add/Why?/x actions live in an HTML overlay
// (updateNodeOverlays) positioned off each ghost's rendered bounding box,
// same technique as the node toolbar/explore menu below.
function renderGhostSuggestions(svg) {
  if (!ghostState || !nodes.includes(ghostState.node) || !ghostState.suggestions.length) return;
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = `<marker id="ghostArrow" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto"><polygon points="0 0, 9 3.5, 0 7" fill="#c98a12"/></marker>`;
  svg.appendChild(defs);

  const anchor = ghostState.node;
  const anchorW = getNodeWidth(anchor.label);
  const ax = anchor.x + anchorW / 2, ay = anchor.y + NODE_HEIGHT / 2;
  const total = ghostState.suggestions.length;

  ghostState.suggestions.forEach((s, i) => {
    // Computed once per suggestion and cached, not recomputed every render -
    // recomputing from the *current* index/total meant adding or dismissing
    // one ghost changed the total, which reshuffled every remaining ghost
    // to new positions (the "collapse in" toward the center effect).
    if (!s._pos) s._pos = layoutGhostPosition(anchor, i, total, ghostState.question);
    const pos = s._pos;
    const w = getNodeWidth(s.label);

    const fromGhost = s.source === s.label; // ghost is the edge's source -> arrow points at anchor
    const gx = pos.x + w / 2, gy = pos.y + NODE_HEIGHT / 2;
    const [x1, y1, x2, y2] = fromGhost ? [gx, gy, ax, ay] : [ax, ay, gx, gy];
    const edge = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    edge.setAttribute('d', `M${x1},${y1} L${x2},${y2}`);
    edge.setAttribute('stroke', '#c98a12');
    edge.setAttribute('stroke-width', '2');
    edge.setAttribute('stroke-dasharray', '5 4');
    edge.setAttribute('fill', 'none');
    if (ghostState.question !== 'related') edge.setAttribute('marker-end', 'url(#ghostArrow)');
    svg.appendChild(edge);

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', `translate(${pos.x},${pos.y})`);
    g.setAttribute('class', 'ghost-node');
    g.setAttribute('data-ghost-label', s.label);

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('width', w);
    rect.setAttribute('height', NODE_HEIGHT);
    rect.setAttribute('rx', NODE_RADIUS);
    rect.setAttribute('class', 'ghost-node-rect');
    g.appendChild(rect);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.textContent = '✦ ' + s.label;
    text.setAttribute('x', w / 2);
    text.setAttribute('y', NODE_HEIGHT / 2 - 7);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('class', 'ghost-node-text');
    g.appendChild(text);

    const tag = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    tag.textContent = 'Suggested · ' + s.relationship;
    tag.setAttribute('x', w / 2);
    tag.setAttribute('y', NODE_HEIGHT / 2 + 12);
    tag.setAttribute('text-anchor', 'middle');
    tag.setAttribute('dominant-baseline', 'middle');
    tag.setAttribute('class', 'ghost-node-tag');
    g.appendChild(tag);

    svg.appendChild(g);
  });

  // updateCanvasSize() sized the SVG to fit real nodes only, before ghosts
  // existed - grow it if any ghost (plus room for its action bar below)
  // would otherwise land past the current edge and get clipped, since this
  // SVG has no viewBox to pan within.
  const PAD = 240;
  let neededW = Number(svg.getAttribute('width')) || 0;
  let neededH = Number(svg.getAttribute('height')) || 0;
  ghostState.suggestions.forEach(s => {
    neededW = Math.max(neededW, s._pos.x + getNodeWidth(s.label) + PAD);
    neededH = Math.max(neededH, s._pos.y + NODE_HEIGHT + PAD);
  });
  svg.setAttribute('width', neededW);
  svg.setAttribute('height', neededH);
}

// One place that positions every floating HTML overlay (toolbar, explore
// menu, ghost action bars, "show more" bar) off the *rendered* SVG
// elements' bounding boxes, called at the end of every renderCanvas() so
// they track nodes through drags/drops and survive re-renders.
function updateNodeOverlays() {
  const toolbar = document.getElementById('nodeToolbar');
  const exploreMenu = document.getElementById('exploreMenu');
  const ghostLayer = document.getElementById('ghostActionsLayer');
  const moreBar = document.getElementById('ghostMoreBar');
  const reasonPopover = document.getElementById('ghostReasonPopover');
  if (!toolbar || !exploreMenu || !ghostLayer || !moreBar) return; // not on this page

  reasonPopover.style.display = 'none';

  if (nodeToolbarState && nodes.includes(nodeToolbarState.node) && !isReadonly) {
    const node = nodeToolbarState.node;
    const g = document.querySelector(`#mapCanvas g[data-node-id="${node.id}"]`);
    if (g) {
      const rect = g.getBoundingClientRect();
      toolbar.style.display = 'flex';
      toolbar.style.left = (rect.left + rect.width / 2) + 'px';
      toolbar.style.top = rect.top + 'px';
      if (connectPending === node) {
        toolbar.innerHTML = `<span class="toolbar-hint">Click another node to connect…</span><button data-act="cancel-connect">Cancel</button>`;
      } else {
        toolbar.innerHTML = `<button data-act="edit">Edit</button><span class="sep">&middot;</span><button data-act="connect">Connect</button><span class="sep">&middot;</span><button data-act="explore">&#10022; Explore</button>`;
      }
      toolbar.onclick = e => {
        e.stopPropagation();
        const act = e.target.getAttribute('data-act');
        if (act === 'edit') {
          const val = window.prompt('Rename concept:', node.label);
          if (val && val.trim() && val.trim() !== node.label) {
            node.label = val.trim();
            if (node.meta && node.meta.aiAdded) delete node.meta.aiAdded;
            renderNotesSidebar();
            renderCanvas();
          }
        } else if (act === 'connect') {
          connectPending = node;
          renderCanvas();
        } else if (act === 'cancel-connect') {
          connectPending = null;
          renderCanvas();
        } else if (act === 'explore') {
          exploreMenuState = { node };
          ghostState = null;
          renderCanvas();
        }
      };
    } else {
      toolbar.style.display = 'none';
    }
  } else {
    toolbar.style.display = 'none';
  }

  if (exploreMenuState && nodes.includes(exploreMenuState.node)) {
    const node = exploreMenuState.node;
    const g = document.querySelector(`#mapCanvas g[data-node-id="${node.id}"]`);
    if (g) {
      const rect = g.getBoundingClientRect();
      exploreMenu.style.display = 'block';
      exploreMenu.style.left = (rect.left + rect.width / 2) + 'px';
      exploreMenu.style.top = (rect.bottom + 10) + 'px';
      exploreMenu.innerHTML = `
        <div class="explore-menu-title">Explore this concept</div>
        ${EXPLORE_QUESTIONS.map(q => `<button data-q="${q.key}"><div class="eq-title">${q.title}</div><div class="eq-hint">${q.hint}</div></button>`).join('')}
      `;
      exploreMenu.onclick = e => {
        e.stopPropagation();
        const btn = e.target.closest('button');
        if (!btn) return;
        const q = btn.getAttribute('data-q');
        exploreMenuState = null;
        openExploreQuestion(node, q);
      };
    } else {
      exploreMenu.style.display = 'none';
    }
  } else {
    exploreMenu.style.display = 'none';
  }

  ghostLayer.innerHTML = '';
  if (ghostState && nodes.includes(ghostState.node)) {
    const anchorG = document.querySelector(`#mapCanvas g[data-node-id="${ghostState.node.id}"]`);
    ghostState.suggestions.forEach(s => {
      const g = document.querySelector(`#mapCanvas g[data-ghost-label="${CSS.escape(s.label)}"]`);
      if (!g) return;
      const rect = g.getBoundingClientRect();
      const bar = document.createElement('div');
      bar.className = 'ghost-actions';
      bar.style.left = (rect.left + rect.width / 2) + 'px';
      bar.style.top = (rect.bottom + 4) + 'px';
      bar.innerHTML = `<button data-act="add">+ Add</button><button data-act="why">Why?</button><button data-act="dismiss" title="Dismiss">&times;</button>`;
      bar.onclick = e => {
        e.stopPropagation();
        const act = e.target.getAttribute('data-act');
        if (act === 'add') addGhostSuggestion(s, s._pos);
        else if (act === 'dismiss') dismissGhostSuggestion(s.label);
        else if (act === 'why') showGhostReason(s, rect);
      };
      ghostLayer.appendChild(bar);
    });

    if (anchorG) {
      const arect = anchorG.getBoundingClientRect();
      // To the left of the anchor, vertically centered - stays clear of
      // ghost action bars regardless of whether this question's ghosts
      // land above, below, or to the right (related's own side).
      moreBar.style.left = (arect.left - 12) + 'px';
      moreBar.style.top = (arect.top + arect.height / 2) + 'px';
      if (ghostState.loading) {
        moreBar.style.display = 'block';
        moreBar.innerHTML = `<span class="loading-label">Thinking…</span>`;
      } else if (ghostState.error) {
        moreBar.style.display = 'block';
        moreBar.innerHTML = `<span class="loading-label">AI backend unavailable.</span><button id="closeExploreBtn" title="Close">&times;</button>`;
        document.getElementById('closeExploreBtn').onclick = e => { e.stopPropagation(); ghostState = null; renderCanvas(); };
      } else {
        moreBar.style.display = 'block';
        moreBar.innerHTML = ghostState.suggestions.length
          ? `<button id="showMoreBtn">Show 3 more</button><button id="closeExploreBtn" title="Close">&times;</button>`
          : `<span class="loading-label">Nothing else to suggest here.</span><button id="closeExploreBtn" title="Close">&times;</button>`;
        const moreBtn = document.getElementById('showMoreBtn');
        if (moreBtn) moreBtn.onclick = e => { e.stopPropagation(); showMoreSuggestions(); };
        document.getElementById('closeExploreBtn').onclick = e => { e.stopPropagation(); ghostState = null; renderCanvas(); };
      }
    } else {
      moreBar.style.display = 'none';
    }
  } else {
    moreBar.style.display = 'none';
  }
}

document.addEventListener('click', e => {
  if (e.target.closest('#nodeToolbar, #exploreMenu, #ghostActionsLayer, #ghostMoreBar, #ghostReasonPopover, .node, .ghost-node')) return;
  if (nodeToolbarState || exploreMenuState || ghostState || connectPending) {
    closeAllNodeOverlays();
    renderCanvas();
  }
});

// ========== END ==========
