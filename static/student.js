// Student Dashboard: a student's own saved maps + joined classes, at a
// glance. Mirrors dashboard.js's structure (pure data-in/DOM-out render
// functions, shared by the real Supabase-backed view and the no-login
// ?sample=1 preview) but scoped to one person instead of a whole class -
// there's no roster/insights here, just "what have I built."

document.addEventListener('DOMContentLoaded', () => {
  if (new URLSearchParams(window.location.search).get('sample') === '1') {
    renderSampleStudentDashboard();
  } else {
    setupStudentDashboardAuth();
  }
});

// ============================================================
// Pure render/analysis helpers over {n,e} map data.
// ============================================================

// Same renderer as dashboard.js's Class-at-a-Glance thumbnails, duplicated
// rather than shared (no module system here) - self-contained on purpose.
function renderMapThumbnail(svg, mapData) {
  const NODE_H = 40, NODE_R = 12;
  svg.innerHTML = '';
  const nodesArr = (mapData && mapData.n) || [];
  const edgesArr = (mapData && mapData.e) || [];
  if (!nodesArr.length) { svg.setAttribute('viewBox', '0 0 300 100'); return; }

  const NODE_FILL = '#1976d2', NODE_STROKE = '#14588f';
  function widthFor(label) { return Math.max(50, Math.min(label.length * 6.5 + 16, 170)); }

  const byId = new Map(nodesArr.map(n => [n.i, n]));
  for (const e of edgesArr) {
    const src = byId.get(e.s), tgt = byId.get(e.t);
    if (!src || !tgt) continue;
    const x1 = src.x + widthFor(src.l) / 2, y1 = src.y + NODE_H / 2;
    const x2 = tgt.x + widthFor(tgt.l) / 2, y2 = tgt.y + NODE_H / 2;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M${x1},${y1} L${x2},${y2}`);
    path.setAttribute('stroke', '#aab4c2');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('fill', 'none');
    svg.appendChild(path);
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodesArr) {
    const w = widthFor(n.l);
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', `translate(${n.x},${n.y})`);
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('width', w);
    rect.setAttribute('height', NODE_H);
    rect.setAttribute('rx', NODE_R);
    rect.setAttribute('fill', NODE_FILL);
    rect.setAttribute('stroke', NODE_STROKE);
    rect.setAttribute('fill-opacity', '0.85');
    g.appendChild(rect);
    svg.appendChild(g);
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + w); maxY = Math.max(maxY, n.y + NODE_H);
  }
  const pad = 18;
  svg.setAttribute('viewBox', `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`);
}

// A one-line, first-person read across all of a student's own maps - same
// byUnit-ratio heuristic and prompt-toward-a-gap framing as the playground's
// per-map AI summary and the teacher dashboard's class summary, just rolled
// up differently (across a person's maps instead of within one map, or
// across a class). Deliberately doesn't manufacture a gap when there isn't
// a real one.
function computeStudentSummary(mapsData) {
  if (!mapsData.length) return "No saved maps yet — build one in the Playground to see a summary here.";
  // Keyed by grade+unit, not unit alone - curriculum unit names repeat
  // across grades, and a unit-only key would silently conflate two
  // different grades' connectedness into one misleading number (same fix
  // as dashboard.js's computeClassSummary).
  const byUnit = new Map();
  for (const m of mapsData) {
    const nodesArr = (m.data && m.data.n) || [];
    const edgesArr = (m.data && m.data.e) || [];
    const degree = new Map();
    for (const n of nodesArr) degree.set(n.i, 0);
    for (const e of edgesArr) {
      degree.set(e.s, (degree.get(e.s) || 0) + 1);
      degree.set(e.t, (degree.get(e.t) || 0) + 1);
    }
    for (const n of nodesArr) {
      const meta = n.m || {};
      if (!meta.grade || !meta.unit) continue;
      const key = meta.grade + '|' + meta.unit;
      if (!byUnit.has(key)) byUnit.set(key, { grade: meta.grade, unit: meta.unit, total: 0, connected: 0 });
      const rec = byUnit.get(key);
      rec.total++;
      if ((degree.get(n.i) || 0) > 0) rec.connected++;
    }
  }
  if (!byUnit.size) {
    return "Your maps aren't tagged to curriculum units yet — drag topics in from the sidebar to get a summary here.";
  }
  const units = [...byUnit.values()]
    .map(r => ({ ...r, label: `${r.unit} (${r.grade})`, ratio: r.connected / r.total }))
    .sort((a, b) => b.ratio - a.ratio || b.total - a.total);
  const strong = units[0], thin = units[units.length - 1];
  if (units.length === 1) {
    return `You're building out ${strong.label} — ${strong.connected} of ${strong.total} concept${strong.total === 1 ? '' : 's'} connected so far.`;
  }
  const gap = strong.ratio - thin.ratio;
  if (gap < 0.15 && thin.ratio >= 0.5) {
    return `Your maps are holding together well across ${strong.label} and ${thin.label} — keep going.`;
  }
  return `How does ${thin.label} connect to ${strong.label}? Worth a look next time you're in the Playground.`;
}

function renderMyMapCards(container, maps, hrefFor) {
  container.innerHTML = '';
  if (!maps.length) {
    container.innerHTML = '<p class="settings-empty">No saved maps yet. <a href="playground.html">Build one in the Playground →</a></p>';
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'map-cards-grid';
  maps.forEach(m => {
    const card = document.createElement('a');
    card.className = 'map-card';
    card.href = hrefFor(m);
    card.target = '_blank';
    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'map-card-thumb';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.width = '100%'; svg.style.height = '100%';
    thumbWrap.appendChild(svg);
    renderMapThumbnail(svg, m.data);
    const body = document.createElement('div');
    body.className = 'map-card-body';
    const titleEl = document.createElement('div');
    titleEl.className = 'map-card-title';
    titleEl.textContent = m.title;
    body.appendChild(titleEl);
    if (m.updated_at) {
      const metaEl = document.createElement('div');
      metaEl.className = 'map-card-meta';
      metaEl.textContent = `Updated ${new Date(m.updated_at).toLocaleDateString()}`;
      body.appendChild(metaEl);
    }
    card.appendChild(thumbWrap);
    card.appendChild(body);
    grid.appendChild(card);
  });
  container.appendChild(grid);
}

function renderClassList(container, classes) {
  container.innerHTML = '';
  if (!classes.length) {
    container.innerHTML = '<p class="settings-empty">You haven\'t joined a class yet. <a href="settings.html">Join one in Settings →</a></p>';
    return;
  }
  const ul = document.createElement('ul');
  ul.className = 'class-list';
  classes.forEach(cls => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'class-name';
    name.textContent = cls.name;
    li.appendChild(name);
    ul.appendChild(li);
  });
  container.appendChild(ul);
}

// Assembles the full page body: summary banner, map grid, class list.
// hrefFor(map) is the click-through link - real maps link to the read-only
// playground view (same mechanism a teacher uses to view a student's map);
// the sample preview links to a ?share= of the (unsaved, fake) map data.
function renderStudentDashboardBody(wrap, mapsWithData, classes, hrefFor) {
  wrap.innerHTML = '';

  const banner = document.createElement('div');
  banner.className = 'ai-summary-banner';
  banner.innerHTML = '<p></p>';
  banner.querySelector('p').innerHTML = '<strong>My summary</strong><span class="beta-tag">Beta</span><br>';
  banner.querySelector('p').append(computeStudentSummary(mapsWithData));
  wrap.appendChild(banner);

  const mapsCard = document.createElement('div');
  mapsCard.className = 'dash-card';
  mapsCard.innerHTML = '<h2>My maps</h2><p class="hint">Click a map to view it, or open the Playground and use My Maps to keep editing.</p>';
  const mapsBody = document.createElement('div');
  mapsCard.appendChild(mapsBody);
  wrap.appendChild(mapsCard);
  renderMyMapCards(mapsBody, mapsWithData, hrefFor);

  const classesCard = document.createElement('div');
  classesCard.className = 'dash-card';
  classesCard.innerHTML = '<h2>My classes</h2>';
  const classesBody = document.createElement('div');
  classesCard.appendChild(classesBody);
  wrap.appendChild(classesCard);
  renderClassList(classesBody, classes);
}

// ============================================================
// Sample dashboard (student.html?sample=1): no login, no Supabase calls.
// One well-connected map and one just-started map, so the summary has a
// real (not manufactured) gap to point at, plus one joined class.
// ============================================================

function buildSampleStudentData() {
  const G6 = '6th Grade Math', G7 = '7th Grade Math', R_P = 'Ratios & Proportional Relationships';
  let nid = 1;
  const node = (l, x, y, grade) => ({ i: nid++, l, x, y, m: { grade, unit: R_P } });

  const ratiosNodes = [
    node('Ratio notation (a:b)', 60, 140, G6),
    node('Ratio vocabulary', 500, 70, G6),
    node('Equivalent ratios – tables', 940, 180, G6),
    node('Ratio word problems', 1380, 90, G6),
  ];
  const ratiosMap = {
    id: 'sample-my-ratios', title: 'Ratios Unit Map',
    updated_at: new Date(Date.now() - 86400000).toISOString(),
    data: {
      n: ratiosNodes,
      e: [
        { i: 1, s: ratiosNodes[0].i, t: ratiosNodes[1].i, no: 'Notation is how we write a ratio - vocabulary is the words for talking about it.' },
        { i: 2, s: ratiosNodes[1].i, t: ratiosNodes[2].i, no: '' },
        { i: 3, s: ratiosNodes[2].i, t: ratiosNodes[3].i, no: '' },
      ],
    },
  };

  const percentsNodes = [
    node('Percent of quantity', 80, 140, G7),
    node('Percent word problems', 520, 260, G7),
  ];
  const percentsMap = {
    id: 'sample-my-percents', title: 'Percents Practice',
    updated_at: new Date().toISOString(),
    data: { n: percentsNodes, e: [] },
  };

  const classes = [{ id: 'sample-class', name: 'Period 3 - Ratios & Proportions' }];

  return { maps: [percentsMap, ratiosMap], classes };
}

// base64url-encodes map data the same way app.js's share-link mechanism
// does, so "view this map" works even for fake, unsaved sample data.
function encodeMapForShare(data) {
  const json = JSON.stringify(data);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function renderSampleStudentDashboard() {
  const dashWrap = document.getElementById('dashWrap');
  dashWrap.innerHTML = '';

  const banner = document.createElement('div');
  banner.className = 'sample-banner';
  banner.innerHTML = 'Sample preview (no account needed). This is what a student sees for their own maps. <a href="settings.html">Sign in for your own →</a>';
  dashWrap.appendChild(banner);

  const header = document.createElement('div');
  header.className = 'dash-header';
  header.innerHTML = '<h1>My Dashboard</h1>';
  dashWrap.appendChild(header);
  const meta = document.createElement('p');
  meta.className = 'dash-meta';
  meta.textContent = 'Sample data';
  dashWrap.appendChild(meta);

  const { maps, classes } = buildSampleStudentData();
  const body = document.createElement('div');
  dashWrap.appendChild(body);
  renderStudentDashboardBody(body, maps, classes, (m) => `playground.html?share=${encodeMapForShare(m.data)}`);
}

// ============================================================
// Real (Supabase-backed) dashboard
// ============================================================

function setupStudentDashboardAuth() {
  const dashWrap = document.getElementById('dashWrap');
  const signInBtn = document.getElementById('signInBtn');
  const userMenu = document.getElementById('userMenu');
  const userLabel = document.getElementById('userLabel');
  const signOutBtn = document.getElementById('signOutBtn');
  const authModal = document.getElementById('authModal');
  const authModalClose = document.getElementById('authModalClose');
  const tabSignIn = document.getElementById('tabSignIn');
  const tabSignUp = document.getElementById('tabSignUp');
  const signInForm = document.getElementById('signInForm');
  const signUpForm = document.getElementById('signUpForm');

  function showSignedOutEmptyState() {
    dashWrap.innerHTML = `
      <div class="dash-empty-state">
        <p>Sign in to see your Student Dashboard.</p>
        <button id="dashSignInBtn" style="background:var(--brand);color:#fff;border:none;padding:0.7em 1.4em;border-radius:8px;font-family:inherit;font-size:0.95em;font-weight:600;cursor:pointer;">Sign in</button>
        <p style="margin-top:1.6em;">Curious what this looks like? <a href="student.html?sample=1">Preview a sample student →</a></p>
      </div>
    `;
    document.getElementById('dashSignInBtn').onclick = openModal;
  }

  if (!window.SpanAuth || !window.SpanAuth.isConfigured) {
    dashWrap.innerHTML = '<div class="dash-empty-state"><p>Accounts are not configured for this deployment yet.</p></div>';
    signInBtn.style.display = 'none';
    return;
  }

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

  signOutBtn.onclick = async () => { await window.SpanAuth.signOut(); };

  async function showStudentDashboard() {
    dashWrap.innerHTML = '<div class="dash-empty-state">Loading your maps…</div>';
    let mapRows, classes;
    try {
      [mapRows, classes] = await Promise.all([
        window.SpanAuth.listMyMaps(),
        window.SpanAuth.listMyClasses(),
      ]);
    } catch (e) {
      dashWrap.innerHTML = '<div class="dash-empty-state"><p>Could not load your dashboard.</p></div>';
      return;
    }
    // listMyMaps() omits map contents (id/title/updated_at only) - fetch
    // full data per map for thumbnails/summary, same data loadMapById
    // returns for the read-only playground view these cards link to. Fine
    // at a student's scale (a handful of saved maps, not a whole class).
    let mapsWithData = [];
    try {
      mapsWithData = await Promise.all(mapRows.map(m => window.SpanAuth.loadMapById(m.id)));
    } catch (e) {
      mapsWithData = mapRows.map(m => ({ ...m, data: { n: [], e: [] } }));
    }

    dashWrap.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'dash-header';
    header.innerHTML = '<h1>My Dashboard</h1>';
    dashWrap.appendChild(header);

    const body = document.createElement('div');
    dashWrap.appendChild(body);
    renderStudentDashboardBody(body, mapsWithData, classes, (m) => `playground.html?view=${m.id}&readonly=1`);
  }

  function updateAuthUI(session) {
    if (session) {
      signInBtn.style.display = 'none';
      userMenu.style.display = 'flex';
      const name = (session.user.user_metadata && session.user.user_metadata.display_name) || session.user.email;
      const role = window.SpanAuth.role(session);
      userLabel.textContent = `${name} (${role})`;
      if (role === 'teacher') {
        dashWrap.innerHTML = `
          <div class="dash-empty-state">
            <p>The Student Dashboard is for student accounts.</p>
            <p><a href="dashboard.html">Go to your Teacher Dashboard →</a></p>
          </div>
        `;
      } else {
        showStudentDashboard();
      }
    } else {
      signInBtn.style.display = '';
      userMenu.style.display = 'none';
      showSignedOutEmptyState();
    }
  }

  window.SpanAuth.getSession().then(updateAuthUI);
  window.SpanAuth.onAuthStateChange(updateAuthUI);
}
