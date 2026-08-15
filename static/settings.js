// Settings page: appearance (theme presets) + classes (rostering + Class
// Insights). Depends on window.SpanAuth (auth.js) and window.SpanTheme
// (theme.js). Class Insights analysis functions are pure (roster + map data
// in, DOM out) so the exact same rendering path serves real class data and
// the no-login sample preview (?sample=1).

let curriculumData = null;

document.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  setupAppearance();
  try { curriculumData = await fetch('concepts.json').then(r => r.json()); } catch (e) { curriculumData = {}; }

  if (new URLSearchParams(window.location.search).get('sample') === '1') {
    renderSamplePreview();
  } else {
    setupAuthAndClasses();
  }
});

function setupTabs() {
  const tabs = document.querySelectorAll('.settings-tab[data-tab]');
  tabs.forEach(tab => {
    tab.onclick = () => {
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    };
  });
}

function setupAppearance() {
  const wrap = document.getElementById('themeSwatches');
  if (!window.SpanTheme) {
    wrap.innerHTML = '<p class="settings-empty">Theme system unavailable.</p>';
    return;
  }
  function render() {
    const activeKey = window.SpanTheme.getActiveKey();
    wrap.innerHTML = '';
    window.SpanTheme.presets.forEach(preset => {
      const card = document.createElement('button');
      card.className = 'theme-card' + (preset.key === activeKey ? ' active' : '');
      card.type = 'button';
      const row = document.createElement('div');
      row.className = 'swatch-row';
      const dot = document.createElement('div');
      dot.className = 'swatch-dot';
      dot.style.background = preset.brand;
      row.appendChild(dot);
      const label = document.createElement('div');
      label.className = 'theme-label';
      label.textContent = preset.label;
      card.appendChild(row);
      card.appendChild(label);
      card.onclick = () => {
        window.SpanTheme.setActive(preset.key);
        render();
      };
      wrap.appendChild(card);
    });
  }
  render();
}

// ============================================================
// Class Insights: pure analysis functions over {n,e} map data.
// Shared by the real (Supabase-backed) view and the sample preview.
// ============================================================

// How many distinct students included each concept at least once.
function computeConceptFrequency(mapsData) {
  const counts = new Map();
  for (const m of mapsData) {
    const seen = new Set();
    for (const n of (m.data && m.data.n) || []) {
      if (seen.has(n.l)) continue;
      seen.add(n.l);
      counts.set(n.l, (counts.get(n.l) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

// Concepts a student added but never connected to anything (degree 0).
function computeIsolatedConcepts(mapsData) {
  const counts = new Map();
  for (const m of mapsData) {
    const degree = new Map();
    for (const n of (m.data && m.data.n) || []) degree.set(n.i, 0);
    for (const e of (m.data && m.data.e) || []) {
      degree.set(e.s, (degree.get(e.s) || 0) + 1);
      degree.set(e.t, (degree.get(e.t) || 0) + 1);
    }
    for (const n of (m.data && m.data.n) || []) {
      if ((degree.get(n.i) || 0) === 0) counts.set(n.l, (counts.get(n.l) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

// For curriculum-tagged nodes, the immediately-prior topic in that unit
// (same "prerequisite" ordering ai_recommender.py's find_prereqs_successors
// uses server-side) - flagged if it's absent from the map entirely, or
// present but not directly linked to this node.
function computeMissingPrereqs(mapsData, curriculum) {
  // Nested Map (topic -> prereq -> count), not a delimited string key that
  // gets split back apart later - topic/prereq labels can themselves
  // contain spaces ("Ratio word problems"), which would silently mangle a
  // naive `${topic} ${prereq}`.split(' ') round-trip.
  const counts = new Map();
  for (const m of mapsData) {
    const nodes = (m.data && m.data.n) || [];
    const edges = (m.data && m.data.e) || [];
    const byLabel = new Map(nodes.map(n => [n.l, n]));
    const linked = new Set();
    for (const e of edges) {
      const src = nodes.find(n => n.i === e.s), tgt = nodes.find(n => n.i === e.t);
      if (src && tgt) { linked.add(src.l + '|' + tgt.l); linked.add(tgt.l + '|' + src.l); }
    }
    for (const n of nodes) {
      const meta = n.m || {};
      if (!meta.grade || !meta.unit) continue;
      const topics = curriculum[meta.grade] && curriculum[meta.grade][meta.unit];
      if (!topics) continue;
      const idx = topics.indexOf(n.l);
      if (idx <= 0) continue;
      const prereq = topics[idx - 1];
      const hasPrereq = byLabel.has(prereq) && linked.has(n.l + '|' + prereq);
      if (!hasPrereq) {
        if (!counts.has(n.l)) counts.set(n.l, new Map());
        const byPrereq = counts.get(n.l);
        byPrereq.set(prereq, (byPrereq.get(prereq) || 0) + 1);
      }
    }
  }
  const flat = [];
  for (const [topic, byPrereq] of counts) {
    for (const [prereq, count] of byPrereq) flat.push({ topic, prereq, count });
  }
  return flat.sort((a, b) => b.count - a.count);
}

function renderClassInsights(container, roster, mapsData, curriculum) {
  container.innerHTML = '';
  if (!mapsData.length) {
    container.innerHTML = '<p class="settings-empty">No student maps yet - insights will appear once students save maps.</p>';
    return;
  }

  const freq = computeConceptFrequency(mapsData).slice(0, 8);
  const isolated = computeIsolatedConcepts(mapsData).slice(0, 6);
  const missing = computeMissingPrereqs(mapsData, curriculum || {}).slice(0, 6);
  const studentCount = new Set(roster.map(r => r.student_id)).size;

  const section = document.createElement('div');
  section.className = 'insights';

  const summary = document.createElement('p');
  summary.className = 'hint';
  summary.style.margin = '0 0 1em';
  summary.textContent = `${studentCount} student${studentCount === 1 ? '' : 's'}, ${mapsData.length} map${mapsData.length === 1 ? '' : 's'} analyzed.`;
  section.appendChild(summary);

  function addGroup(title, items, renderItem, emptyText) {
    const h = document.createElement('h3');
    h.className = 'insights-group-title';
    h.textContent = title;
    section.appendChild(h);
    if (!items.length) {
      const p = document.createElement('p');
      p.className = 'settings-empty';
      p.style.textAlign = 'left';
      p.textContent = emptyText;
      section.appendChild(p);
      return;
    }
    const ul = document.createElement('ul');
    ul.className = 'insights-list';
    items.forEach(item => {
      const li = document.createElement('li');
      li.appendChild(renderItem(item));
      ul.appendChild(li);
    });
    section.appendChild(ul);
  }

  addGroup('Most-explored concepts', freq, ([label, count]) => {
    const span = document.createElement('span');
    span.textContent = label;
    const badge = document.createElement('span');
    badge.className = 'insights-badge';
    badge.textContent = `${count} student${count === 1 ? '' : 's'}`;
    const wrap = document.createElement('span');
    wrap.className = 'insights-row';
    wrap.appendChild(span); wrap.appendChild(badge);
    return wrap;
  }, 'Nothing yet.');

  addGroup('Added but never connected', isolated, ([label, count]) => {
    const span = document.createElement('span');
    span.textContent = label;
    const badge = document.createElement('span');
    badge.className = 'insights-badge insights-badge-warn';
    badge.textContent = `${count} student${count === 1 ? '' : 's'}`;
    const wrap = document.createElement('span');
    wrap.className = 'insights-row';
    wrap.appendChild(span); wrap.appendChild(badge);
    return wrap;
  }, 'No isolated concepts spotted - nice.');

  addGroup('Missing prerequisite connections', missing, (item) => {
    const span = document.createElement('span');
    span.innerHTML = '';
    const topicSpan = document.createElement('strong');
    topicSpan.textContent = item.topic;
    span.appendChild(topicSpan);
    span.appendChild(document.createTextNode(` → missing "${item.prereq}"`));
    const badge = document.createElement('span');
    badge.className = 'insights-badge insights-badge-warn';
    badge.textContent = `${item.count} student${item.count === 1 ? '' : 's'}`;
    const wrap = document.createElement('span');
    wrap.className = 'insights-row';
    wrap.appendChild(span); wrap.appendChild(badge);
    return wrap;
  }, 'No prerequisite gaps spotted in curriculum-tagged concepts.');

  container.appendChild(section);
}

// ============================================================
// Real (Supabase-backed) auth + classes
// ============================================================

function setupAuthAndClasses() {
  const signInBtn = document.getElementById('signInBtn');
  const userMenu = document.getElementById('userMenu');
  const userLabel = document.getElementById('userLabel');
  const signOutBtn = document.getElementById('signOutBtn');
  const classesSignInBtn = document.getElementById('classesSignInBtn');
  const classesSignedOut = document.getElementById('classesSignedOut');
  const classesTeacherView = document.getElementById('classesTeacherView');
  const classesStudentView = document.getElementById('classesStudentView');

  const authModal = document.getElementById('authModal');
  const authModalClose = document.getElementById('authModalClose');
  const tabSignIn = document.getElementById('tabSignIn');
  const tabSignUp = document.getElementById('tabSignUp');
  const signInForm = document.getElementById('signInForm');
  const signUpForm = document.getElementById('signUpForm');

  if (!window.SpanAuth || !window.SpanAuth.isConfigured) {
    classesSignedOut.querySelector('p').textContent = 'Accounts are not configured for this deployment yet.';
    classesSignInBtn.style.display = 'none';
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
  classesSignInBtn.onclick = openModal;
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
  };

  // --- Classes: teacher view ---
  async function renderTeacherClasses() {
    const listEl = document.getElementById('teacherClassList');
    listEl.innerHTML = '<p class="settings-empty">Loading…</p>';
    let classes;
    try {
      classes = await window.SpanAuth.listMyClasses();
    } catch (e) {
      listEl.innerHTML = '<p class="settings-empty">Could not load classes.</p>';
      return;
    }
    if (!classes.length) {
      listEl.innerHTML = '<p class="settings-empty">No classes yet — create one above.</p>';
      return;
    }
    listEl.innerHTML = '';
    classes.forEach(cls => {
      const card = document.createElement('div');
      card.className = 'class-card';
      const head = document.createElement('div');
      head.className = 'class-card-head';
      head.innerHTML = `
        <div>
          <div class="class-name"></div>
          <div class="class-meta">Created ${new Date(cls.created_at).toLocaleDateString()}</div>
        </div>
        <span class="class-code"></span>
      `;
      head.querySelector('.class-name').textContent = cls.name;
      head.querySelector('.class-code').textContent = cls.invite_code;
      const body = document.createElement('div');
      body.className = 'class-body';
      body.innerHTML = '<p class="settings-empty">Loading roster…</p>';

      head.onclick = async () => {
        const wasExpanded = card.classList.contains('expanded');
        document.querySelectorAll('#teacherClassList .class-card').forEach(c => c.classList.remove('expanded'));
        if (wasExpanded) return;
        card.classList.add('expanded');
        await renderRoster(cls.id, body);
      };

      card.appendChild(head);
      card.appendChild(body);
      listEl.appendChild(card);
    });
  }

  async function renderRoster(classId, body) {
    body.innerHTML = '<p class="settings-empty">Loading roster…</p>';
    let roster, maps, mapsWithData;
    try {
      [roster, maps, mapsWithData] = await Promise.all([
        window.SpanAuth.listClassRoster(classId),
        window.SpanAuth.listStudentMapsInClass(classId),
        window.SpanAuth.listClassMapsWithData(classId),
      ]);
    } catch (e) {
      body.innerHTML = '<p class="settings-empty">Could not load roster.</p>';
      return;
    }
    if (!roster.length) {
      body.innerHTML = '<p class="settings-empty">No students have joined yet.</p>';
      return;
    }
    const mapsByStudent = {};
    maps.forEach(m => { (mapsByStudent[m.owner_id] = mapsByStudent[m.owner_id] || []).push(m); });

    body.innerHTML = '';

    const ul = document.createElement('ul');
    ul.className = 'roster-list';
    roster.forEach(student => {
      const li = document.createElement('li');
      const nameSpan = document.createElement('div');
      nameSpan.textContent = student.student_display_name || student.student_email || student.student_id;
      li.appendChild(nameSpan);
      const studentMaps = mapsByStudent[student.student_id] || [];
      if (studentMaps.length) {
        const mapsUl = document.createElement('ul');
        mapsUl.className = 'student-maps-list';
        studentMaps.forEach(m => {
          const mapLi = document.createElement('li');
          const a = document.createElement('a');
          a.href = `playground.html?view=${m.id}&readonly=1`;
          a.textContent = m.title;
          mapLi.appendChild(a);
          mapsUl.appendChild(mapLi);
        });
        li.appendChild(mapsUl);
      } else {
        const none = document.createElement('div');
        none.className = 'settings-empty';
        none.style.paddingLeft = '1em';
        none.textContent = 'No saved maps yet.';
        li.appendChild(none);
      }
      ul.appendChild(li);
    });
    body.appendChild(ul);

    const insightsWrap = document.createElement('div');
    insightsWrap.className = 'insights-wrap';
    body.appendChild(insightsWrap);
    renderClassInsights(insightsWrap, roster, mapsWithData, curriculumData);
  }

  document.getElementById('createClassBtn').onclick = async () => {
    const input = document.getElementById('newClassName');
    const name = input.value.trim();
    if (!name) return;
    try {
      await window.SpanAuth.createClass(name);
      input.value = '';
      renderTeacherClasses();
    } catch (e) {
      alert('Could not create class: ' + (e.message || e));
    }
  };

  // --- Classes: student view ---
  async function renderStudentClasses() {
    const listEl = document.getElementById('studentClassList');
    listEl.innerHTML = '<p class="settings-empty">Loading…</p>';
    let classes;
    try {
      classes = await window.SpanAuth.listMyClasses();
    } catch (e) {
      listEl.innerHTML = '<p class="settings-empty">Could not load classes.</p>';
      return;
    }
    if (!classes.length) {
      listEl.innerHTML = '<p class="settings-empty">You haven\'t joined a class yet.</p>';
      return;
    }
    listEl.innerHTML = '';
    classes.forEach(cls => {
      const card = document.createElement('div');
      card.className = 'class-card';
      card.innerHTML = `<div class="class-name"></div>`;
      card.querySelector('.class-name').textContent = cls.name;
      listEl.appendChild(card);
    });
  }

  document.getElementById('joinClassBtn').onclick = async () => {
    const input = document.getElementById('joinCodeInput');
    const errEl = document.getElementById('joinClassError');
    errEl.textContent = '';
    const code = input.value.trim();
    if (!code) return;
    try {
      await window.SpanAuth.joinClassByCode(code);
      input.value = '';
      renderStudentClasses();
    } catch (e) {
      errEl.textContent = e.message || 'Could not join class.';
    }
  };

  // --- Session-driven view switching ---
  function updateAuthUI(session) {
    if (session) {
      signInBtn.style.display = 'none';
      userMenu.style.display = 'flex';
      const name = (session.user.user_metadata && session.user.user_metadata.display_name) || session.user.email;
      const role = window.SpanAuth.role(session);
      userLabel.textContent = `${name} (${role})`;

      classesSignedOut.style.display = 'none';
      if (role === 'teacher') {
        classesTeacherView.style.display = '';
        classesStudentView.style.display = 'none';
        renderTeacherClasses();
      } else {
        classesStudentView.style.display = '';
        classesTeacherView.style.display = 'none';
        renderStudentClasses();
      }
    } else {
      signInBtn.style.display = '';
      userMenu.style.display = 'none';
      classesSignedOut.style.display = '';
      classesTeacherView.style.display = 'none';
      classesStudentView.style.display = 'none';
    }
  }

  window.SpanAuth.getSession().then(updateAuthUI);
  window.SpanAuth.onAuthStateChange(updateAuthUI);
}

// ============================================================
// Sample preview (settings.html?sample=1): no login, no Supabase calls.
// Same real curriculum topics as the playground's sample map, arranged to
// show off all three insight types (a well-connected student, a missing
// -entirely prerequisite gap, a present-but-unlinked prerequisite gap, and
// a couple of isolated/never-connected concepts).
// ============================================================

function buildSampleClassData() {
  const G6 = '6th Grade Math', R_P = 'Ratios & Proportional Relationships';
  const meta = { grade: G6, unit: R_P };
  let nid = 1;
  // x/y matter here - these maps get opened directly in the playground (via
  // ?share=), not just summarized, so every node needs a real position or
  // they'd all stack on top of each other at the origin.
  const node = (l, x, y) => ({ i: nid++, l, x, y, m: meta });

  // Maya: fully connected chain, no gaps.
  const mayaNodes = [
    node('Ratio notation (a:b)', 60, 140),
    node('Ratio vocabulary', 320, 80),
    node('Equivalent ratios – tables', 580, 160),
  ];
  const mayaMap = {
    id: 'sample-maya', title: 'Ratios Unit Map', owner_id: 'sample-maya-id',
    data: {
      n: mayaNodes,
      e: [
        { i: 1, s: mayaNodes[0].i, t: mayaNodes[1].i, no: '' },
        { i: 2, s: mayaNodes[1].i, t: mayaNodes[2].i, no: '' },
      ],
    },
  };

  // Jordan: has the prereq present but never links it, plus an isolated node.
  const jordanNodes = [
    node('Unit rate definition', 60, 100),
    node('Unit rate calc Ints/decimals', 340, 220),
    node('Percent of quantity', 120, 360),
  ];
  const jordanMap = {
    id: 'sample-jordan', title: 'Ratios + Percents', owner_id: 'sample-jordan-id',
    data: { n: jordanNodes, e: [] },
  };

  // Priya: prereq missing entirely, plus an isolated node.
  const priyaNodes = [
    node('Ratio word problems', 80, 150),
    node('Ratio notation (a:b)', 380, 280),
  ];
  const priyaMap = {
    id: 'sample-priya', title: 'Word Problems Practice', owner_id: 'sample-priya-id',
    data: { n: priyaNodes, e: [] },
  };

  // Sam: minimal, single isolated node (also boosts frequency further).
  const samNodes = [node('Ratio notation (a:b)', 200, 180)];
  const samMap = {
    id: 'sample-sam', title: 'Getting Started', owner_id: 'sample-sam-id',
    data: { n: samNodes, e: [] },
  };

  const roster = [
    { student_id: 'sample-maya-id', student_display_name: 'Maya P.', student_email: 'maya@example.com' },
    { student_id: 'sample-jordan-id', student_display_name: 'Jordan K.', student_email: 'jordan@example.com' },
    { student_id: 'sample-priya-id', student_display_name: 'Priya S.', student_email: 'priya@example.com' },
    { student_id: 'sample-sam-id', student_display_name: 'Sam T.', student_email: 'sam@example.com' },
  ];
  const maps = [mayaMap, jordanMap, priyaMap, samMap];
  return { roster, maps };
}

// base64url-encodes map data the same way app.js's share-link mechanism
// does, so "view this student's map" works even for fake, unsaved data.
function encodeMapForShare(data) {
  const json = JSON.stringify(data);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  bytes.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function renderSamplePreview() {
  document.querySelectorAll('.settings-tab[data-tab]').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
  document.querySelector('.settings-tab[data-tab="classes"]').classList.add('active');
  document.getElementById('tab-classes').classList.add('active');

  document.getElementById('classesSignedOut').style.display = 'none';
  document.getElementById('classesStudentView').style.display = 'none';
  const teacherView = document.getElementById('classesTeacherView');
  teacherView.style.display = '';
  teacherView.querySelector('.create-class-row').style.display = 'none';
  document.getElementById('sampleBanner').style.display = '';

  const { roster, maps } = buildSampleClassData();

  const listEl = document.getElementById('teacherClassList');
  listEl.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'class-card expanded';
  const head = document.createElement('div');
  head.className = 'class-card-head';
  head.innerHTML = `
    <div>
      <div class="class-name">Period 3 - Ratios &amp; Proportions</div>
      <div class="class-meta">Sample data</div>
    </div>
    <span class="class-code">DEMO-DATA</span>
  `;
  const body = document.createElement('div');
  body.className = 'class-body';

  const ul = document.createElement('ul');
  ul.className = 'roster-list';
  const mapsByStudent = {};
  maps.forEach(m => { (mapsByStudent[m.owner_id] = mapsByStudent[m.owner_id] || []).push(m); });
  roster.forEach(student => {
    const li = document.createElement('li');
    const nameSpan = document.createElement('div');
    nameSpan.textContent = student.student_display_name;
    li.appendChild(nameSpan);
    const studentMaps = mapsByStudent[student.student_id] || [];
    const mapsUl = document.createElement('ul');
    mapsUl.className = 'student-maps-list';
    studentMaps.forEach(m => {
      const mapLi = document.createElement('li');
      const a = document.createElement('a');
      a.href = `playground.html?share=${encodeMapForShare(m.data)}`;
      a.target = '_blank';
      a.textContent = m.title;
      mapLi.appendChild(a);
      mapsUl.appendChild(mapLi);
    });
    li.appendChild(mapsUl);
    ul.appendChild(li);
  });
  body.appendChild(ul);

  const insightsWrap = document.createElement('div');
  insightsWrap.className = 'insights-wrap';
  body.appendChild(insightsWrap);
  renderClassInsights(insightsWrap, roster, maps, curriculumData);

  card.appendChild(head);
  card.appendChild(body);
  listEl.appendChild(card);
}
