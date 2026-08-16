// Teacher Dashboard: class analysis, moved out of settings.html/settings.js
// so it has room to be a real page instead of a cramped settings tab.
// Depends on window.SpanAuth (auth.js). Analysis functions are pure
// (roster + map data in, DOM out) so the exact same rendering path serves
// real class data and the no-login sample preview (?sample=1).

let curriculumData = null;

document.addEventListener('DOMContentLoaded', async () => {
  try { curriculumData = await fetch('concepts.json').then(r => r.json()); } catch (e) { curriculumData = {}; }

  if (new URLSearchParams(window.location.search).get('sample') === '1') {
    renderSampleDashboard();
  } else {
    setupDashboardAuth();
  }
});

// ============================================================
// Pure analysis functions over {n,e} map data.
// ============================================================

// How many distinct students included each concept at least once. Tracks
// *which* students (by owner_id, from mapsData's owner_id field) so the UI
// can expand "N students" into names linking to their maps.
function computeConceptFrequency(mapsData) {
  const byLabel = new Map(); // label -> Set<owner_id>
  for (const m of mapsData) {
    const seen = new Set();
    for (const n of (m.data && m.data.n) || []) {
      if (seen.has(n.l)) continue;
      seen.add(n.l);
      if (!byLabel.has(n.l)) byLabel.set(n.l, new Set());
      byLabel.get(n.l).add(m.owner_id);
    }
  }
  return [...byLabel.entries()]
    .map(([label, studentIds]) => ({ label, count: studentIds.size, studentIds }))
    .sort((a, b) => b.count - a.count);
}

// Concepts a student added but never connected to anything (degree 0).
function computeIsolatedConcepts(mapsData) {
  const byLabel = new Map();
  for (const m of mapsData) {
    const degree = new Map();
    for (const n of (m.data && m.data.n) || []) degree.set(n.i, 0);
    for (const e of (m.data && m.data.e) || []) {
      degree.set(e.s, (degree.get(e.s) || 0) + 1);
      degree.set(e.t, (degree.get(e.t) || 0) + 1);
    }
    for (const n of (m.data && m.data.n) || []) {
      if ((degree.get(n.i) || 0) === 0) {
        if (!byLabel.has(n.l)) byLabel.set(n.l, new Set());
        byLabel.get(n.l).add(m.owner_id);
      }
    }
  }
  return [...byLabel.entries()]
    .map(([label, studentIds]) => ({ label, count: studentIds.size, studentIds }))
    .sort((a, b) => b.count - a.count);
}

// Total connectedness of each concept, summed across every student's map -
// a genuinely different signal than frequency: a concept can appear in many
// maps while being poorly connected, or appear in fewer maps but sit at the
// structural center of them. Surfaces the class's real "hub" ideas.
function computeHubConcepts(mapsData) {
  const totalDegree = new Map();
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
      totalDegree.set(n.l, (totalDegree.get(n.l) || 0) + (degree.get(n.i) || 0));
    }
  }
  return [...totalDegree.entries()].filter(([, d]) => d > 0).sort((a, b) => b[1] - a[1]);
}

// Per-student concept/connection counts, sorted so the students who may
// need a nudge (well below the class average concept count) surface first.
function computeStudentProgress(mapsData, roster) {
  const byStudent = new Map();
  for (const r of roster) byStudent.set(r.student_id, { concepts: new Set(), links: 0 });
  for (const m of mapsData) {
    const rec = byStudent.get(m.owner_id);
    if (!rec) continue;
    const nodesArr = (m.data && m.data.n) || [];
    const edgesArr = (m.data && m.data.e) || [];
    nodesArr.forEach(n => rec.concepts.add(n.l));
    rec.links += edgesArr.length;
  }
  const rows = roster.map(r => {
    const rec = byStudent.get(r.student_id);
    return {
      name: r.student_display_name || r.student_email || r.student_id,
      concepts: rec.concepts.size,
      links: rec.links,
    };
  });
  const avgConcepts = rows.reduce((s, r) => s + r.concepts, 0) / (rows.length || 1);
  rows.forEach(r => { r.belowAverage = avgConcepts > 0 && r.concepts < avgConcepts * 0.5; });
  rows.sort((a, b) => a.concepts - b.concepts);
  return { rows, avgConcepts };
}

// Which {grade, unit} pairs the class's maps actually touch, and how many
// distinct students are working in each - "where is the class's attention."
function computeGradeUnitCoverage(mapsData) {
  const byUnit = new Map();
  for (const m of mapsData) {
    const nodesArr = (m.data && m.data.n) || [];
    for (const n of nodesArr) {
      const meta = n.m || {};
      if (!meta.grade || !meta.unit) continue;
      const key = meta.grade + '|' + meta.unit;
      if (!byUnit.has(key)) byUnit.set(key, { grade: meta.grade, unit: meta.unit, studentIds: new Set() });
      byUnit.get(key).studentIds.add(m.owner_id);
    }
  }
  return [...byUnit.values()]
    .map(r => ({ grade: r.grade, unit: r.unit, students: r.studentIds.size, studentIds: r.studentIds }))
    .sort((a, b) => b.students - a.students);
}

// A one-line, class-wide read on where the whole class collectively stands
// - same heuristic as the playground's per-map "Instant AI Summary", rolled
// up across every student's maps instead of one map at a time.
function computeClassSummary(mapsData) {
  if (!mapsData.length) return 'No student maps yet — a class summary will appear once students save maps.';
  // Keyed by grade+unit, not unit alone - curriculum unit names repeat
  // across grades ("Ratios & Proportional Relationships" exists in both
  // 6th and 7th grade), and a unit-only key would silently conflate two
  // different grades' connectedness into one misleading number.
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
    return `${mapsData.length} map${mapsData.length === 1 ? '' : 's'} saved so far, none tagged to a curriculum unit yet.`;
  }
  const units = [...byUnit.values()]
    .map(r => ({ ...r, label: `${r.unit} (${r.grade})`, ratio: r.connected / r.total }))
    .sort((a, b) => b.ratio - a.ratio || b.total - a.total);
  const strong = units[0], thin = units[units.length - 1];
  if (units.length === 1) {
    return `The class is focused on ${strong.label} — ${strong.connected} of ${strong.total} concept-instances connected across all students.`;
  }
  const strongPhrase = strong.ratio >= 0.6 ? 'Strong as a class on' : 'Most developed as a class:';
  const thinPhrase = thin.ratio < 0.5 ? 'thin on' : 'lighter on';
  return `${strongPhrase} ${strong.label}, ${thinPhrase} ${thin.label}.`;
}

// taughtSet (optional): a Set of "grade::unit::prereq" strings the teacher
// has marked as taught (see updateClassTaughtTopics in auth.js). Grade is
// part of the key, not just unit::topic - curriculum unit names repeat
// across grades ("Ratios & Proportional Relationships" exists in both 6th
// and 7th grade) and some topic labels repeat too ("Percent word
// problems"), so a unit-only key would let marking something taught in one
// grade silently mark the same-named topic taught in a different grade.
// When supplied, each flagged item also gets `taught: true/false` - a
// missing prereq the teacher has actually covered is a much stronger
// classwide-gap signal than one that just hasn't come up yet, so callers
// can sort/filter on it. When omitted (or empty), every item is
// `taught: null` and nothing is filtered.
function computeMissingPrereqs(mapsData, curriculum, taughtSet) {
  // Nested Map (topic -> prereq -> {studentIds, unit, grade}), not a
  // delimited string key that gets split back apart later - topic/prereq
  // labels can themselves contain spaces ("Ratio word problems"), which
  // would silently mangle a naive `${topic} ${prereq}`.split(' ') round-trip.
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
        const rec = byPrereq.get(prereq) || { studentIds: new Set(), unit: meta.unit, grade: meta.grade };
        rec.studentIds.add(m.owner_id);
        byPrereq.set(prereq, rec);
      }
    }
  }
  const flat = [];
  for (const [topic, byPrereq] of counts) {
    for (const [prereq, rec] of byPrereq) {
      const taught = taughtSet && taughtSet.size ? taughtSet.has(rec.grade + '::' + rec.unit + '::' + prereq) : null;
      flat.push({ topic, prereq, count: rec.studentIds.size, studentIds: rec.studentIds, unit: rec.unit, grade: rec.grade, taught });
    }
  }
  // Taught-and-missing first (the strongest signal), then by count.
  return flat.sort((a, b) => (b.taught === true) - (a.taught === true) || b.count - a.count);
}

// Beta: classwide gap analysis input - "what has the teacher taught?"
// Scoped to whichever {grade, unit} pairs actually show up among the
// class's student maps, rather than the entire curriculum tree, so the
// checklist stays small and relevant instead of listing hundreds of
// topics nobody in this class has touched.
function collectUnitsFromMaps(mapsWithData) {
  const units = new Map();
  for (const m of mapsWithData) {
    const nodesArr = (m.data && m.data.n) || [];
    for (const n of nodesArr) {
      const meta = n.m || {};
      if (meta.grade && meta.unit) units.set(meta.grade + '|' + meta.unit, { grade: meta.grade, unit: meta.unit });
    }
  }
  return [...units.values()];
}

// ============================================================
// Rendering
// ============================================================

// Beta: "Class at a Glance" - a small live thumbnail per student's most
// recent map, so a teacher can scan the whole class visually instead of
// reading a text list. Deliberately self-contained (no shared text-measurer
// or color-assignment state, unlike the playground's own canvas renderer).
function renderMapThumbnail(svg, mapData) {
  const NODE_H = 40, NODE_R = 12;
  svg.innerHTML = '';
  const nodesArr = (mapData && mapData.n) || [];
  const edgesArr = (mapData && mapData.e) || [];
  if (!nodesArr.length) { svg.setAttribute('viewBox', '0 0 300 100'); return; }

  // One consistent color, not the per-unit rainbow the main canvas uses -
  // at thumbnail size you can't actually read six pastel hues as distinct
  // units, so all it did was look noisy. A single solid accent reads as a
  // clean "shape at a glance" instead.
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

// hrefFor(map) builds the click-through link - real classes link to the
// read-only playground view, the sample preview links to a ?share= of the
// (unsaved, fake) map data instead.
// mapsWithData should already be ordered most-recent-first (listClassMapsWithData
// orders by updated_at desc) so the first hit per owner_id is their latest map.
function mostRecentMapByStudent(mapsWithData) {
  const byStudent = new Map();
  for (const m of mapsWithData) {
    if (!byStudent.has(m.owner_id)) byStudent.set(m.owner_id, m);
  }
  return byStudent;
}

function renderStudentMapCards(container, roster, mapsWithData, hrefFor) {
  container.innerHTML = '';
  const mostRecentByStudent = mostRecentMapByStudent(mapsWithData);
  const grid = document.createElement('div');
  grid.className = 'map-cards-grid';
  roster.forEach(student => {
    const m = mostRecentByStudent.get(student.student_id);
    const card = document.createElement(m ? 'a' : 'div');
    card.className = 'map-card' + (m ? '' : ' map-card-empty');
    if (m) { card.href = hrefFor(m); card.target = '_blank'; }
    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'map-card-thumb';
    if (m) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.style.width = '100%'; svg.style.height = '100%';
      thumbWrap.appendChild(svg);
      renderMapThumbnail(svg, m.data);
    } else {
      thumbWrap.textContent = 'No map yet';
    }
    const body = document.createElement('div');
    body.className = 'map-card-body';
    const nameEl = document.createElement('div');
    nameEl.className = 'map-card-student';
    nameEl.textContent = student.student_display_name || student.student_email || student.student_id;
    body.appendChild(nameEl);
    if (m) {
      const titleEl = document.createElement('div');
      titleEl.className = 'map-card-title';
      titleEl.textContent = m.title;
      body.appendChild(titleEl);
    }
    card.appendChild(thumbWrap);
    card.appendChild(body);
    grid.appendChild(card);
  });
  container.appendChild(grid);
}

// saveFn defaults to the real backend call; the sample dashboard (no
// account, nothing to persist) passes its own in-memory version instead.
function renderTaughtTopicsChecklist(container, cls, mapsWithData, curriculum, onSave, saveFn) {
  saveFn = saveFn || ((classId, topics) => window.SpanAuth.updateClassTaughtTopics(classId, topics));
  container.innerHTML = '';

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = "Mark topics you've already covered - missing-prerequisite gaps below can then tell \"not taught yet\" apart from a real gap.";
  container.appendChild(hint);

  const units = collectUnitsFromMaps(mapsWithData);
  if (!units.length) {
    const p = document.createElement('p');
    p.className = 'settings-empty';
    p.textContent = 'No curriculum-tagged concepts in student maps yet.';
    container.appendChild(p);
    return;
  }

  const taught = new Set(cls.taught_topics || []);
  const checkboxes = [];

  units.forEach(({ grade, unit }) => {
    const topics = (curriculum[grade] && curriculum[grade][unit]) || [];
    if (!topics.length) return;
    const unitDiv = document.createElement('div');
    unitDiv.className = 'taught-unit';
    const title = document.createElement('div');
    title.className = 'taught-unit-title';
    title.textContent = `${unit} (${grade})`;
    unitDiv.appendChild(title);
    const list = document.createElement('ul');
    list.className = 'taught-topic-list';
    topics.forEach(topic => {
      const key = grade + '::' + unit + '::' + topic;
      const li = document.createElement('li');
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = taught.has(key);
      cb.dataset.key = key;
      checkboxes.push(cb);
      label.appendChild(cb);
      label.appendChild(document.createTextNode(topic));
      li.appendChild(label);
      list.appendChild(li);
    });
    unitDiv.appendChild(list);
    container.appendChild(unitDiv);
  });

  const saveRow = document.createElement('div');
  const saveBtn = document.createElement('button');
  saveBtn.className = 'taught-save-btn';
  saveBtn.textContent = 'Save';
  const savedNote = document.createElement('span');
  savedNote.className = 'taught-saved-note';
  savedNote.style.display = 'none';
  savedNote.textContent = 'Saved!';
  saveRow.appendChild(saveBtn);
  saveRow.appendChild(savedNote);
  container.appendChild(saveRow);

  saveBtn.onclick = async () => {
    const selected = checkboxes.filter(cb => cb.checked).map(cb => cb.dataset.key);
    saveBtn.disabled = true;
    try {
      await saveFn(cls.id, selected);
      cls.taught_topics = selected;
      savedNote.style.display = '';
      setTimeout(() => { savedNote.style.display = 'none'; }, 2000);
      if (typeof onSave === 'function') onSave(new Set(selected));
    } catch (e) {
      alert('Could not save: ' + (e.message || e));
    } finally {
      saveBtn.disabled = false;
    }
  };
}

function insightCard(titleHtml) {
  const card = document.createElement('div');
  card.className = 'dash-card';
  const h = document.createElement('h2');
  h.innerHTML = titleHtml;
  card.appendChild(h);
  return card;
}

// renderItem(item, li) populates the <li> itself, rather than returning a
// node - lets a single item add both its row and (for expandable rows) a
// hidden student sublist as siblings inside the same <li>.
function insightList(items, renderItem, emptyText) {
  if (!items.length) {
    const p = document.createElement('p');
    p.className = 'settings-empty';
    p.textContent = emptyText;
    return p;
  }
  const ul = document.createElement('ul');
  ul.className = 'insights-list';
  items.forEach(item => {
    const li = document.createElement('li');
    renderItem(item, li);
    ul.appendChild(li);
  });
  return ul;
}

function badgeRow(labelNode, badgeText, badgeClass) {
  const badge = document.createElement('span');
  badge.className = 'insights-badge' + (badgeClass ? ' ' + badgeClass : '');
  badge.textContent = badgeText;
  const wrap = document.createElement('span');
  wrap.className = 'insights-row';
  wrap.appendChild(labelNode); wrap.appendChild(badge);
  return wrap;
}

// Builds the "N students" row for `li` as a click-to-expand toggle -
// clicking reveals which students (by name, linking to their most recent
// map) sit behind the count. Falls back to a plain, non-clickable row when
// there's no student data to expand into (e.g. Hub concepts, which counts
// connections rather than students).
function addExpandableRow(li, labelNode, badgeText, badgeClass, studentIds, roster, mostRecentByStudent, hrefFor) {
  const row = badgeRow(labelNode, badgeText, badgeClass);
  li.appendChild(row);
  if (!studentIds || !studentIds.size || !roster) return;

  row.classList.add('insights-row-clickable');
  const chevron = document.createElement('span');
  chevron.className = 'insights-chevron';
  chevron.textContent = '▸';
  row.insertBefore(chevron, row.firstChild);

  const sub = document.createElement('ul');
  sub.className = 'insights-substudents';
  sub.style.display = 'none';
  [...studentIds].forEach(sid => {
    const student = roster.find(r => r.student_id === sid);
    const name = student ? (student.student_display_name || student.student_email || sid) : sid;
    const subLi = document.createElement('li');
    const m = mostRecentByStudent && mostRecentByStudent.get(sid);
    if (m && hrefFor) {
      const a = document.createElement('a');
      a.href = hrefFor(m);
      a.target = '_blank';
      a.textContent = name;
      subLi.appendChild(a);
    } else {
      subLi.textContent = name + (m ? '' : ' (no saved map)');
    }
    sub.appendChild(subLi);
  });
  li.appendChild(sub);

  row.onclick = () => {
    const isOpen = sub.style.display !== 'none';
    sub.style.display = isOpen ? 'none' : 'block';
    chevron.textContent = isOpen ? '▸' : '▾';
  };
}

// Renders every insight card into `grid` (an .insights-grid element) and
// the AI summary banner into `summaryEl`. Six insight types - three
// original (most-explored, isolated, missing-prereq/classwide-gaps) plus
// three new ones (hub concepts, student progress, curriculum coverage).
function renderClassInsights(summaryEl, grid, roster, mapsData, curriculum, taughtSet, hrefFor) {
  summaryEl.innerHTML = '';
  grid.innerHTML = '';
  if (!mapsData.length) {
    grid.innerHTML = '<p class="settings-empty">No student maps yet - insights will appear once students save maps.</p>';
    return;
  }

  const banner = document.createElement('div');
  banner.className = 'ai-summary-banner';
  banner.innerHTML = `
    <div class="icon-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg></div>
    <p></p>
  `;
  banner.querySelector('p').innerHTML = `<strong>Class summary</strong><span class="beta-tag">Beta</span><br>`;
  banner.querySelector('p').append(computeClassSummary(mapsData));
  summaryEl.appendChild(banner);

  const mostRecentByStudent = mostRecentMapByStudent(mapsData);
  const expandRow = (li, labelNode, badgeText, badgeClass, studentIds) =>
    addExpandableRow(li, labelNode, badgeText, badgeClass, studentIds, roster, mostRecentByStudent, hrefFor);

  const freq = computeConceptFrequency(mapsData).slice(0, 8);
  const hubs = computeHubConcepts(mapsData).slice(0, 6);
  const isolated = computeIsolatedConcepts(mapsData).slice(0, 6);
  const missing = computeMissingPrereqs(mapsData, curriculum || {}, taughtSet).slice(0, 8);
  const { rows: progressRows } = computeStudentProgress(mapsData, roster);
  const coverage = computeGradeUnitCoverage(mapsData);

  const freqCard = insightCard('Most-explored concepts');
  freqCard.appendChild(insightList(freq, (item, li) => {
    const span = document.createElement('span'); span.textContent = item.label;
    expandRow(li, span, `${item.count} student${item.count === 1 ? '' : 's'}`, null, item.studentIds);
  }, 'Nothing yet.'));
  grid.appendChild(freqCard);

  const hubCard = insightCard('Hub concepts <span class="beta-tag">Beta</span>');
  const hubHint = document.createElement('p'); hubHint.className = 'hint';
  hubHint.textContent = 'Total connections across the whole class, not just how many students used it.';
  hubCard.appendChild(hubHint);
  hubCard.appendChild(insightList(hubs, ([label, degree], li) => {
    const span = document.createElement('span'); span.textContent = label;
    li.appendChild(badgeRow(span, `${degree} connection${degree === 1 ? '' : 's'}`));
  }, 'No connected concepts yet.'));
  grid.appendChild(hubCard);

  const isoCard = insightCard('Added but never connected');
  isoCard.appendChild(insightList(isolated, (item, li) => {
    const span = document.createElement('span'); span.textContent = item.label;
    expandRow(li, span, `${item.count} student${item.count === 1 ? '' : 's'}`, 'insights-badge-warn', item.studentIds);
  }, 'No isolated concepts spotted - nice.'));
  grid.appendChild(isoCard);

  const missingTitle = taughtSet && taughtSet.size
    ? 'Missing prerequisite connections <span class="beta-tag">Classwide gaps</span>'
    : 'Missing prerequisite connections';
  const missingCard = insightCard(missingTitle);
  missingCard.appendChild(insightList(missing, (item, li) => {
    const span = document.createElement('span');
    const topicSpan = document.createElement('strong');
    topicSpan.textContent = item.topic;
    span.appendChild(topicSpan);
    span.appendChild(document.createTextNode(` → missing "${item.prereq}"`));
    if (item.taught === true) {
      const tag = document.createElement('span');
      tag.className = 'beta-tag';
      tag.style.color = '#a6790a'; tag.style.background = '#fff8e8'; tag.style.borderColor = '#f0d896';
      tag.textContent = 'you taught this';
      span.appendChild(document.createTextNode(' '));
      span.appendChild(tag);
    } else if (item.taught === false) {
      const tag = document.createElement('span');
      tag.className = 'settings-empty';
      tag.style.fontSize = '0.82em';
      tag.textContent = ' (not yet taught)';
      span.appendChild(tag);
    }
    expandRow(li, span, `${item.count} student${item.count === 1 ? '' : 's'}`, 'insights-badge-warn', item.studentIds);
  }, 'No prerequisite gaps spotted in curriculum-tagged concepts.'));
  grid.appendChild(missingCard);

  const progressCard = insightCard('Student progress <span class="beta-tag">Beta</span>');
  const progressHint = document.createElement('p'); progressHint.className = 'hint';
  progressHint.textContent = 'Distinct concepts + total connections per student, lowest first.';
  progressCard.appendChild(progressHint);
  progressCard.appendChild(insightList(progressRows, (row, li) => {
    const span = document.createElement('span'); span.textContent = row.name;
    li.appendChild(badgeRow(span, `${row.concepts} concept${row.concepts === 1 ? '' : 's'}, ${row.links} link${row.links === 1 ? '' : 's'}`, row.belowAverage ? 'insights-badge-danger' : ''));
  }, 'No students yet.'));
  grid.appendChild(progressCard);

  const coverageCard = insightCard('Curriculum coverage <span class="beta-tag">Beta</span>');
  const coverageHint = document.createElement('p'); coverageHint.className = 'hint';
  coverageHint.textContent = 'Where the class is working, by grade and unit.';
  coverageCard.appendChild(coverageHint);
  coverageCard.appendChild(insightList(coverage, (row, li) => {
    const span = document.createElement('span'); span.textContent = `${row.unit} (${row.grade})`;
    expandRow(li, span, `${row.students} student${row.students === 1 ? '' : 's'}`, null, row.studentIds);
  }, 'No curriculum-tagged concepts yet.'));
  grid.appendChild(coverageCard);
}

// Assembles one class's full dashboard view into `wrap`. `saveFn` is passed
// straight through to renderTaughtTopicsChecklist (real backend by default,
// in-memory fake for the sample dashboard).
function renderClassDashboard(wrap, cls, roster, maps, mapsWithData, curriculum, hrefFor, saveFn) {
  wrap.innerHTML = '';

  const glanceCard = document.createElement('div');
  glanceCard.className = 'dash-card';
  glanceCard.innerHTML = '<h2>Class at a Glance <span class="beta-tag">Beta</span></h2>';
  const glanceGrid = document.createElement('div');
  glanceCard.appendChild(glanceGrid);
  wrap.appendChild(glanceCard);
  if (roster.length) {
    renderStudentMapCards(glanceGrid, roster, mapsWithData, hrefFor);
  } else {
    glanceGrid.innerHTML = '<p class="settings-empty">No students have joined yet.</p>';
  }

  const summaryEl = document.createElement('div');
  wrap.appendChild(summaryEl);
  const insightsGrid = document.createElement('div');
  insightsGrid.className = 'insights-grid';
  wrap.appendChild(insightsGrid);

  let taughtSet = new Set(cls.taught_topics || []);
  renderClassInsights(summaryEl, insightsGrid, roster, mapsWithData, curriculum, taughtSet, hrefFor);

  const taughtCard = document.createElement('div');
  taughtCard.className = 'dash-card';
  taughtCard.innerHTML = '<h2>What have you taught? <span class="beta-tag">Beta</span></h2>';
  const taughtBody = document.createElement('div');
  taughtCard.appendChild(taughtBody);
  wrap.appendChild(taughtCard);
  renderTaughtTopicsChecklist(taughtBody, cls, mapsWithData, curriculum, (newSet) => {
    taughtSet = newSet;
    renderClassInsights(summaryEl, insightsGrid, roster, mapsWithData, curriculum, taughtSet, hrefFor);
  }, saveFn);

  const rosterCard = document.createElement('div');
  rosterCard.className = 'dash-card';
  rosterCard.innerHTML = '<h2>Roster</h2>';
  wrap.appendChild(rosterCard);
  if (!roster.length) {
    rosterCard.innerHTML += '<p class="settings-empty">No students have joined yet.</p>';
  } else {
    const mapsByStudent = {};
    maps.forEach(m => { (mapsByStudent[m.owner_id] = mapsByStudent[m.owner_id] || []).push(m); });
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
          a.href = hrefFor(m);
          a.target = '_blank';
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
    rosterCard.appendChild(ul);
  }
}

// ============================================================
// Sample dashboard (dashboard.html?sample=1): no login, no Supabase calls.
// Real curriculum topics (6th + 7th grade Ratios & Proportional
// Relationships), arranged to show off every insight: a strong/ahead
// student, a mixed-progress student, a needs-support student, a just-
// starting student, and a moved-ahead student working in a different grade.
// ============================================================

function buildSampleClassData() {
  const G6 = '6th Grade Math', G7 = '7th Grade Math', R_P = 'Ratios & Proportional Relationships';
  const meta6 = { grade: G6, unit: R_P };
  const meta7 = { grade: G7, unit: R_P };
  let nid = 1;
  // x/y matter here - these maps get opened directly in the playground (via
  // ?share=), not just summarized/thumbnailed, so every node needs a real
  // position or they'd all stack on top of each other at the origin.
  // Spacing is generous (~400px between chain steps) since some of these
  // labels are long and get clamped up to 350px wide by the real
  // playground's node width logic.
  const node = (l, x, y, meta) => ({ i: nid++, l, x, y, m: meta || meta6 });

  // Maya: fully connected 6-topic chain in exact curriculum order, two
  // notes - the "strong, ahead" student. No prereq gaps at all.
  const mayaNodes = [
    node('Ratio notation (a:b)', 60, 140),
    node('Ratio vocabulary', 500, 70),
    node('Equivalent ratios – tables', 940, 180),
    node('Equivalent ratios – tape diagrams', 1380, 90),
    node('Ratio word problems', 1820, 200),
    node('Unit rate definition', 2260, 110),
  ];
  const mayaMap = {
    id: 'sample-maya', title: 'Ratios Unit Map', owner_id: 'sample-maya-id',
    data: {
      n: mayaNodes,
      e: [
        { i: 1, s: mayaNodes[0].i, t: mayaNodes[1].i, no: 'Notation is just how we WRITE a ratio (a:b) - vocabulary is the words for talking about it.' },
        { i: 2, s: mayaNodes[1].i, t: mayaNodes[2].i, no: '' },
        { i: 3, s: mayaNodes[2].i, t: mayaNodes[3].i, no: 'Tables and tape diagrams show the same ratio two different ways.' },
        { i: 4, s: mayaNodes[3].i, t: mayaNodes[4].i, no: '' },
        { i: 5, s: mayaNodes[4].i, t: mayaNodes[5].i, no: '' },
      ],
    },
  };

  // Jordan: one correctly-linked pair (with a note), one prereq present but
  // never linked, two prereqs missing entirely - the "mixed progress"
  // student.
  const jordanNodes = [
    node('Unit rate definition', 60, 100),
    node('Unit rate calc Ints/decimals', 500, 220),
    node('Percent of quantity', 100, 420),
    node('Percent word problems', 500, 460),
    node('Rate word problems', 900, 340),
  ];
  const jordanMap = {
    id: 'sample-jordan', title: 'Ratios + Percents', owner_id: 'sample-jordan-id',
    data: {
      n: jordanNodes,
      e: [
        { i: 1, s: jordanNodes[0].i, t: jordanNodes[1].i, no: 'Divide total by the number of units to get the rate for ONE.' },
      ],
    },
  };

  // Priya: prereq missing entirely, two isolated nodes - the "needs
  // support" student.
  const priyaNodes = [
    node('Ratio word problems', 80, 150),
    node('Ratio notation (a:b)', 500, 280),
  ];
  const priyaMap = {
    id: 'sample-priya', title: 'Word Problems Practice', owner_id: 'sample-priya-id',
    data: { n: priyaNodes, e: [] },
  };

  // Sam: prereq present but unlinked, both isolated - "just getting
  // started."
  const samNodes = [
    node('Ratio notation (a:b)', 100, 120),
    node('Ratio vocabulary', 500, 220),
  ];
  const samMap = {
    id: 'sample-sam', title: 'Getting Started', owner_id: 'sample-sam-id',
    data: { n: samNodes, e: [] },
  };

  // Chen: 7th-grade work (curriculum coverage variety), one linked pair
  // with a note, one prereq present but unlinked, plus his own chain-start
  // node is itself missing a (6th/7th-boundary) prereq - the "moved ahead"
  // student.
  const chenNodes = [
    node('Identify proportional relationships in tables', 80, 140, meta7),
    node('Identify proportional relationships in graphs', 500, 60, meta7),
    node('Identify proportional relationships in equations', 920, 190, meta7),
  ];
  const chenMap = {
    id: 'sample-chen', title: 'Proportional Relationships', owner_id: 'sample-chen-id',
    data: {
      n: chenNodes,
      e: [
        { i: 1, s: chenNodes[0].i, t: chenNodes[1].i, no: 'Graphs show the same relationship visually - same idea, different picture.' },
      ],
    },
  };

  const roster = [
    { student_id: 'sample-maya-id', student_display_name: 'Maya P.', student_email: 'maya@example.com' },
    { student_id: 'sample-jordan-id', student_display_name: 'Jordan K.', student_email: 'jordan@example.com' },
    { student_id: 'sample-priya-id', student_display_name: 'Priya S.', student_email: 'priya@example.com' },
    { student_id: 'sample-sam-id', student_display_name: 'Sam T.', student_email: 'sam@example.com' },
    { student_id: 'sample-chen-id', student_display_name: 'Chen L.', student_email: 'chen@example.com' },
  ];
  const maps = [mayaMap, jordanMap, priyaMap, samMap, chenMap];
  // Marks two topics taught (one per grade, grade-qualified keys - see
  // computeMissingPrereqs), so the classwide-gaps demo shows all three
  // states at once: "you taught this" (real gap), "(not yet taught)"
  // (expected gap), and correctly-linked (no flag at all).
  const taughtTopics = [
    G6 + '::' + R_P + '::Percent as a rate',
    G7 + '::' + R_P + '::Unit rates in different units',
  ];
  return { roster, maps, taughtTopics };
}

// base64url-encodes map data the same way app.js's share-link mechanism
// does, so "view this student's map" works even for fake, unsaved data.
function encodeMapForShare(data) {
  const json = JSON.stringify(data);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function renderSampleDashboard() {
  const dashWrap = document.getElementById('dashWrap');
  dashWrap.innerHTML = '';

  const banner = document.createElement('div');
  banner.className = 'sample-banner';
  banner.innerHTML = 'Sample preview — no account needed. This is what a teacher sees for a real class. <a href="settings.html">Sign in for your own →</a>';
  dashWrap.appendChild(banner);

  const header = document.createElement('div');
  header.className = 'dash-header';
  header.innerHTML = `
    <h1>Period 3 - Ratios &amp; Proportions</h1>
    <span class="class-code">DEMO-DATA</span>
  `;
  dashWrap.appendChild(header);
  const meta = document.createElement('p');
  meta.className = 'dash-meta';
  meta.textContent = 'Sample data';
  dashWrap.appendChild(meta);

  const { roster, maps, taughtTopics } = buildSampleClassData();
  const sampleClass = { id: 'sample-class', taught_topics: taughtTopics };
  const body = document.createElement('div');
  dashWrap.appendChild(body);

  renderClassDashboard(
    body, sampleClass, roster, maps, maps, curriculumData,
    (m) => `playground.html?share=${encodeMapForShare(m.data)}`,
    async () => {} // fake save: no account, nothing to persist
  );
}

// ============================================================
// Real (Supabase-backed) dashboard
// ============================================================

function setupDashboardAuth() {
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
        <p>Sign in to see your Teacher Dashboard.</p>
        <button id="dashSignInBtn" style="background:var(--brand);color:#fff;border:none;padding:0.7em 1.4em;border-radius:8px;font-family:inherit;font-size:0.95em;font-weight:600;cursor:pointer;">Sign in</button>
        <p style="margin-top:1.6em;">Curious what this looks like? <a href="dashboard.html?sample=1">Preview a sample class →</a></p>
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

  async function loadClass(cls) {
    dashWrap.innerHTML = '';
    if (classList.length > 1) {
      const picker = document.createElement('div');
      picker.className = 'class-picker';
      classList.forEach(c => {
        const btn = document.createElement('button');
        btn.textContent = c.name;
        btn.className = c.id === cls.id ? 'active' : '';
        btn.onclick = () => loadClass(c);
        picker.appendChild(btn);
      });
      dashWrap.appendChild(picker);
    }

    const header = document.createElement('div');
    header.className = 'dash-header';
    header.innerHTML = `<h1></h1><span class="class-code"></span>`;
    header.querySelector('h1').textContent = cls.name;
    header.querySelector('.class-code').textContent = cls.invite_code;
    dashWrap.appendChild(header);
    const meta = document.createElement('p');
    meta.className = 'dash-meta';
    meta.textContent = `Created ${new Date(cls.created_at).toLocaleDateString()}`;
    dashWrap.appendChild(meta);

    const loading = document.createElement('p');
    loading.className = 'settings-empty';
    loading.textContent = 'Loading class data…';
    dashWrap.appendChild(loading);

    let roster, maps, mapsWithData;
    try {
      [roster, maps, mapsWithData] = await Promise.all([
        window.SpanAuth.listClassRoster(cls.id),
        window.SpanAuth.listStudentMapsInClass(cls.id),
        window.SpanAuth.listClassMapsWithData(cls.id),
      ]);
    } catch (e) {
      loading.textContent = 'Could not load class data.';
      return;
    }
    loading.remove();

    const body = document.createElement('div');
    dashWrap.appendChild(body);
    renderClassDashboard(
      body, cls, roster, maps, mapsWithData, curriculumData,
      (m) => `playground.html?view=${m.id}&readonly=1`
    );
  }

  let classList = [];

  async function showTeacherDashboard() {
    dashWrap.innerHTML = '<div class="dash-empty-state">Loading your classes…</div>';
    try {
      classList = await window.SpanAuth.listMyClasses();
    } catch (e) {
      dashWrap.innerHTML = '<div class="dash-empty-state"><p>Could not load your classes.</p></div>';
      return;
    }
    if (!classList.length) {
      dashWrap.innerHTML = `
        <div class="dash-empty-state">
          <p>You don't have any classes yet.</p>
          <p><a href="settings.html">Create one in Settings →</a></p>
        </div>
      `;
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const requestedId = params.get('class');
    const target = classList.find(c => c.id === requestedId) || classList[0];
    loadClass(target);
  }

  function updateAuthUI(session) {
    if (session) {
      signInBtn.style.display = 'none';
      userMenu.style.display = 'flex';
      const name = (session.user.user_metadata && session.user.user_metadata.display_name) || session.user.email;
      const role = window.SpanAuth.role(session);
      userLabel.textContent = `${name} (${role})`;
      if (role === 'teacher') {
        showTeacherDashboard();
      } else {
        dashWrap.innerHTML = `
          <div class="dash-empty-state">
            <p>The Teacher Dashboard is for teacher accounts.</p>
            <p><a href="settings.html">Back to Settings →</a></p>
          </div>
        `;
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
