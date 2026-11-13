// Teacher Dashboard: class analysis, moved out of settings.html/settings.js
// so it has room to be a real page instead of a cramped settings tab.
// Depends on window.SpanAuth (auth.js). Analysis functions are pure
// (roster + map data in, DOM out) so the exact same rendering path serves
// real class data and the no-login sample preview (?sample=1).

let curriculumData = null;
let prerequisiteData = { aliases: {}, edges: [] };
let prerequisiteDataAvailable = false;

document.addEventListener('DOMContentLoaded', async () => {
  const loaded = await Promise.allSettled([
    fetch('concepts.json').then(r => { if (!r.ok) throw new Error(); return r.json(); }),
    fetch('prerequisites.json').then(r => { if (!r.ok) throw new Error(); return r.json(); }),
  ]);
  curriculumData = loaded[0].status === 'fulfilled' ? loaded[0].value : {};
  prerequisiteDataAvailable = loaded[1].status === 'fulfilled';
  prerequisiteData = loaded[1].status === 'fulfilled' ? loaded[1].value : { aliases: {}, edges: [] };

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

// Per-student split of concepts the student typed/dragged in themselves
// vs. concepts added from an Explore suggestion (n.m.aiAdded, set by
// addGhostSuggestion in app.js and cleared the first time a student
// renames a suggested node). Provenance is tracked quietly, not as a
// judgment - this is a visibility tool for teachers, not a scoreboard, so
// it's presented as a plain count split rather than sorted by "most AI-
// reliant" or similarly loaded framing.
function computeProvenanceStats(mapsData, roster) {
  const byStudent = new Map();
  for (const r of roster) byStudent.set(r.student_id, { own: 0, aiAdded: 0 });
  for (const m of mapsData) {
    const rec = byStudent.get(m.owner_id);
    if (!rec) continue;
    const nodesArr = (m.data && m.data.n) || [];
    nodesArr.forEach(n => { if (n.m && n.m.aiAdded) rec.aiAdded++; else rec.own++; });
  }
  return roster.map(r => {
    const rec = byStudent.get(r.student_id);
    return {
      name: r.student_display_name || r.student_email || r.student_id,
      own: rec.own,
      aiAdded: rec.aiAdded,
    };
  });
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

// Scopes classwide stats to one specific assignment: only maps tagged with
// this activity, and only each student's single latest-updated one among
// those - without this, a student's older map (or an earlier "Save a
// copy" checkpoint) would get summed in right alongside their current
// one, double-counting concepts/connections and distorting class patterns.
// No activityId -> existing behavior (every map, unfiltered), so selecting
// "All maps" in the activity picker doesn't change anything.
function filterMapsForActivity(mapsWithData, activityId) {
  if (!activityId) return mapsWithData;
  const tagged = mapsWithData.filter(m => m.activity_id === activityId);
  const latestByOwner = new Map();
  for (const m of tagged) {
    const existing = latestByOwner.get(m.owner_id);
    if (!existing || new Date(m.updated_at) > new Date(existing.updated_at)) {
      latestByOwner.set(m.owner_id, m);
    }
  }
  return [...latestByOwner.values()];
}

// Every unordered pair within an activity's assigned concept set, with how
// many distinct students drew a connection between them (in either
// direction, counted once per student even if linked twice) - including
// pairs nobody connected at all, which the frequency-sorted insight cards
// above deliberately can't show since they only list concepts/pairs that
// appear at least once.
function computePairConnectionCounts(mapsData, conceptLabels) {
  const labelSet = new Set(conceptLabels);
  const pairKey = (a, b) => [a, b].sort().join(' || ');
  const counts = new Map();
  for (const m of mapsData) {
    const nodesArr = (m.data && m.data.n) || [];
    const edgesArr = (m.data && m.data.e) || [];
    const byId = new Map(nodesArr.map(n => [n.i, n]));
    const seenThisStudent = new Set();
    for (const e of edgesArr) {
      const src = byId.get(e.s), tgt = byId.get(e.t);
      if (!src || !tgt || src.l === tgt.l) continue;
      if (!labelSet.has(src.l) || !labelSet.has(tgt.l)) continue;
      const key = pairKey(src.l, tgt.l);
      if (seenThisStudent.has(key)) continue;
      seenThisStudent.add(key);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const pairs = [];
  for (let i = 0; i < conceptLabels.length; i++) {
    for (let j = i + 1; j < conceptLabels.length; j++) {
      const a = conceptLabels[i], b = conceptLabels[j];
      pairs.push({ a, b, count: counts.get(pairKey(a, b)) || 0 });
    }
  }
  pairs.sort((x, y) => y.count - x.count || (x.a + x.b).localeCompare(y.a + y.b));
  return pairs;
}

// "grade::unit::topic" -> the bare topic label, matching how map nodes
// store a concept's name (n.l) - every existing classwide stat (hub
// concepts, frequency, etc.) already matches by label alone with the same
// grade-collision caveat, so this stays consistent rather than inventing a
// different, stricter key scheme just for this one card.
function activityConceptLabels(activity) {
  if (!activity || !activity.concepts) return [];
  return activity.concepts.map(key => {
    const parts = key.split('::');
    return parts.length === 3 ? parts[2] : key;
  });
}

// Projector-safe roster: same shape and order, names replaced with stable
// "Student N" labels (numbered by join order) so every existing render
// function that already does `student.student_display_name || ...` shows
// the anonymized name for free, with zero changes to those functions.
function anonymizeRoster(roster) {
  return roster.map((r, i) => ({ ...r, student_display_name: `Student ${i + 1}`, student_email: '' }));
}

// A one-line, class-wide read on where the whole class collectively stands
// - same heuristic as the playground's per-map "Instant AI Summary", rolled
// up across every student's maps instead of one map at a time.
function computeClassSummary(mapsData) {
  if (!mapsData.length) return 'No student maps yet — a class summary will appear once students save maps.';
  const coverage = computeGradeUnitCoverage(mapsData);
  if (!coverage.length) return `${mapsData.length} saved maps. Add curriculum concepts to see coverage by grade and unit.`;
  const leading = coverage[0];
  const students = new Set(mapsData.map(m => m.owner_id)).size;
  const connections = mapsData.reduce((sum, m) => sum + ((m.data && m.data.e) || []).length, 0);
  return `${students} student${students === 1 ? '' : 's'} have saved maps with ${connections} connection${connections === 1 ? '' : 's'}. Most students are working in ${leading.unit} (${leading.grade}): ${leading.students} student${leading.students === 1 ? '' : 's'}, as shown in Curriculum coverage.`;
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
  const aliases = prerequisiteData.aliases || {};
  const canonical = label => aliases[label] || label;
  const matches = (node, endpoint) => canonical(node.l) === endpoint.label &&
    (aliases[node.l] || ((!(node.m || {}).grade || node.m.grade === endpoint.grade) &&
    (!(node.m || {}).unit || node.m.unit === endpoint.unit)));
  const counts = new Map();
  for (const m of mapsData) {
    const nodes = (m.data && m.data.n) || [];
    const edges = (m.data && m.data.e) || [];
    for (const rule of prerequisiteData.edges || []) {
      const targets = nodes.filter(n => matches(n, rule.target));
      if (!targets.length) continue;
      const sources = nodes.filter(n => matches(n, rule.source));
      const connected = edges.some(e => sources.some(n => n.i === e.s) && targets.some(n => n.i === e.t) && (!e.rt || e.rt === 'prerequisite'));
      if (connected) continue;
      const key = JSON.stringify([rule.source, rule.target]);
      if (!counts.has(key)) counts.set(key, { topic: rule.target.label, prereq: rule.source.label,
        grade: rule.source.grade, unit: rule.source.unit, reason: rule.reason, studentIds: new Set() });
      counts.get(key).studentIds.add(m.owner_id);
    }
  }
  return [...counts.values()].map(rec => ({ ...rec, count: rec.studentIds.size,
    taught: taughtSet && taughtSet.size ? taughtSet.has(`${rec.grade}::${rec.unit}::${rec.prereq}`) : null,
  })).sort((a, b) => (b.taught === true) - (a.taught === true) || b.count - a.count);
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
  const originalNodes = (mapData && mapData.n) || [];
  // Compact arrangement keeps labels visible on wide maps. Only preview
  // coordinates change; the saved map retains its authored positions.
  const wide = originalNodes.length && Math.max(...originalNodes.map(n=>n.x)) - Math.min(...originalNodes.map(n=>n.x)) > 800;
  const nodesArr = wide ? originalNodes.map((n,i)=>({...n,x:(i%2)*200,y:Math.floor(i/2)*70})) : originalNodes;
  svg.setAttribute('aria-label', wide ? 'Connection preview arranged to fit; open map for original layout' : 'Map connection preview');
  const edgesArr = (mapData && mapData.e) || [];
  if (!nodesArr.length) { svg.setAttribute('viewBox', '0 0 300 100'); return; }

  // Keep compact labels readable against one opaque, consistent node color.
  const NODE_FILL = '#eaf2ff', NODE_STROKE = '#89acd5';
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
    rect.setAttribute('fill-opacity', '1');
    g.appendChild(rect);
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.textContent = n.l.length > 23 ? n.l.slice(0, 22) + '…' : n.l;
    label.setAttribute('x', w / 2); label.setAttribute('y', NODE_H / 2);
    label.setAttribute('text-anchor', 'middle'); label.setAttribute('dominant-baseline', 'middle');
    label.setAttribute('font-size', '13'); label.setAttribute('font-family', 'system-ui, sans-serif');
    label.setAttribute('fill', '#173e70');
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title'); title.textContent = n.l;
    g.appendChild(title); g.appendChild(label);
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
    if (m) { card.href = hrefFor(m); card.title = 'Open read-only map'; }
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
      titleEl.textContent = m.title + ' · Read-only';
      body.appendChild(titleEl);
    }
    card.appendChild(thumbWrap);
    card.appendChild(body);
    const item = document.createElement('div');
    item.appendChild(card);
    grid.appendChild(item);
  });
  container.appendChild(grid);
}

// Shared by the taught-topics checklist above and the activity concept
// picker below - same checkbox-per-topic, grouped-by-unit rendering, just
// over a different unit list (units actually touched by student maps vs.
// the whole curriculum) and a different pre-checked set.
function renderConceptChecklist(container, curriculum, units, checkedKeys) {
  container.innerHTML = '';
  const checked = checkedKeys instanceof Set ? checkedKeys : new Set(checkedKeys || []);
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
      cb.checked = checked.has(key);
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
  return checkboxes;
}

function allUnitsFromCurriculum(curriculum) {
  const units = [];
  Object.keys(curriculum || {}).forEach(grade => {
    Object.keys(curriculum[grade] || {}).forEach(unit => units.push({ grade, unit }));
  });
  return units;
}

// saveFn defaults to the real backend call; the sample dashboard (no
// account, nothing to persist) passes its own in-memory version instead.
function renderTaughtTopicsChecklist(container, cls, mapsWithData, curriculum, onSave, saveFn) {
  saveFn = saveFn || ((classId, topics) => window.SpanAuth.updateClassTaughtTopics(classId, topics));
  container.innerHTML = '';

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = "Mark topics you've already covered - missing-prerequisite connections above can then tell \"not taught yet\" apart from a real gap.";
  container.appendChild(hint);

  const units = collectUnitsFromMaps(mapsWithData);
  if (!units.length) {
    const p = document.createElement('p');
    p.className = 'settings-empty';
    p.textContent = 'No curriculum-tagged concepts in student maps yet.';
    container.appendChild(p);
    return;
  }

  const checklistWrap = document.createElement('div');
  container.appendChild(checklistWrap);
  const checkboxes = renderConceptChecklist(checklistWrap, curriculum, units, cls.taught_topics || []);

  const saveRow = document.createElement('div');
  const saveBtn = document.createElement('button');
  saveBtn.className = 'taught-save-btn';
  saveBtn.textContent = 'Save';
  const savedNote = document.createElement('span');
  savedNote.className = 'taught-saved-note';
  savedNote.style.display = 'none';
  // Sample dashboard has no backend to persist to, so "Saved!" would be a
  // false signal once the page reloads and the checkboxes reset - say so.
  savedNote.textContent = cls.id === 'sample-class' ? 'Preview updated — demo changes reset on reload.' : 'Saved!';
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

// Activities: a named assignment with its own concept set, used to scope
// Class Insights to "this specific assignment" (see filterMapsForActivity
// and computePairConnectionCounts). activityFns defaults to the real
// backend; the sample dashboard passes an in-memory version instead, same
// pattern as renderTaughtTopicsChecklist's saveFn. onChange(activityId,
// activities) fires on load and on every selection/create/delete, so the
// caller can re-run its activity-aware render pipeline.
function renderActivitiesCard(container, cls, curriculum, activityFns, onChange) {
  activityFns = activityFns || {
    list: (classId) => window.SpanAuth.listClassActivities(classId),
    create: (classId, name, concepts, aiDisabled) => window.SpanAuth.createActivity(classId, name, concepts, aiDisabled),
    del: (id) => window.SpanAuth.deleteActivity(id),
    setAiDisabled: (id, disabled) => window.SpanAuth.setActivityAiDisabled(id, disabled),
  };

  container.innerHTML = '<h2>Activities</h2>';
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = "Scope Class Insights to one assignment's concept set, including classwide connection counts within it.";
  container.appendChild(hint);

  const selectRow = document.createElement('div');
  selectRow.className = 'activity-select-row';
  const select = document.createElement('select');
  selectRow.appendChild(select);
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'activity-delete-btn';
  deleteBtn.textContent = 'Delete';
  deleteBtn.disabled = true;
  selectRow.appendChild(deleteBtn);
  container.appendChild(selectRow);

  const aiToggleRow = document.createElement('label');
  aiToggleRow.className = 'activity-ai-toggle-row';
  aiToggleRow.style.display = 'none';
  const aiToggleCheckbox = document.createElement('input');
  aiToggleCheckbox.type = 'checkbox';
  aiToggleRow.appendChild(aiToggleCheckbox);
  aiToggleRow.appendChild(document.createTextNode(' Disable AI tools (Explore, AI Summary, Check My Map) for students on this activity'));
  container.appendChild(aiToggleRow);

  const newBtn = document.createElement('button');
  newBtn.className = 'activity-new-btn';
  newBtn.textContent = '+ New Activity';
  container.appendChild(newBtn);

  const form = document.createElement('div');
  form.className = 'activity-form';
  form.style.display = 'none';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'activity-name-input';
  nameInput.placeholder = 'Activity name...';
  nameInput.maxLength = 80;
  form.appendChild(nameInput);
  const conceptsWrap = document.createElement('div');
  conceptsWrap.className = 'activity-concepts';
  form.appendChild(conceptsWrap);
  const newAiDisabledLabel = document.createElement('label');
  newAiDisabledLabel.className = 'activity-ai-toggle-row';
  const newAiDisabledCheckbox = document.createElement('input');
  newAiDisabledCheckbox.type = 'checkbox';
  newAiDisabledLabel.appendChild(newAiDisabledCheckbox);
  newAiDisabledLabel.appendChild(document.createTextNode(' Disable AI tools for students on this activity'));
  form.appendChild(newAiDisabledLabel);
  const formActions = document.createElement('div');
  formActions.className = 'activity-form-actions';
  const createBtn = document.createElement('button');
  createBtn.textContent = 'Create';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  formActions.appendChild(createBtn);
  formActions.appendChild(cancelBtn);
  form.appendChild(formActions);
  container.appendChild(form);

  let activities = [];
  let checkboxes = [];

  function renderOptions() {
    select.innerHTML = '<option value="">All maps</option>';
    activities.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.name;
      select.appendChild(opt);
    });
  }

  function syncAiToggleRow() {
    const activity = activities.find(a => a.id === select.value);
    if (!activity) { aiToggleRow.style.display = 'none'; return; }
    aiToggleCheckbox.checked = !!activity.ai_disabled;
    aiToggleRow.style.display = 'flex';
  }

  async function load() {
    select.innerHTML = '<option value="">Loading…</option>';
    try {
      activities = await activityFns.list(cls.id);
    } catch (e) {
      activities = [];
    }
    renderOptions();
    deleteBtn.disabled = !select.value;
    syncAiToggleRow();
    onChange(select.value || null, activities);
  }

  newBtn.onclick = () => {
    const opening = form.style.display === 'none';
    form.style.display = opening ? 'block' : 'none';
    if (opening) {
      nameInput.value = '';
      newAiDisabledCheckbox.checked = false;
      checkboxes = renderConceptChecklist(conceptsWrap, curriculum, allUnitsFromCurriculum(curriculum), []);
    }
  };
  cancelBtn.onclick = () => { form.style.display = 'none'; };

  createBtn.onclick = async () => {
    const name = nameInput.value.trim();
    if (!name) { alert('Give this activity a name.'); return; }
    const concepts = checkboxes.filter(cb => cb.checked).map(cb => cb.dataset.key);
    if (!concepts.length) { alert('Pick at least one concept for this activity.'); return; }
    createBtn.disabled = true;
    try {
      const created = await activityFns.create(cls.id, name, concepts, newAiDisabledCheckbox.checked);
      activities = [created, ...activities];
      renderOptions();
      select.value = created.id;
      form.style.display = 'none';
      deleteBtn.disabled = false;
      syncAiToggleRow();
      onChange(select.value, activities);
    } catch (e) {
      alert('Could not create activity: ' + (e.message || e));
    } finally {
      createBtn.disabled = false;
    }
  };

  select.onchange = () => {
    deleteBtn.disabled = !select.value;
    syncAiToggleRow();
    onChange(select.value || null, activities);
  };

  aiToggleCheckbox.onchange = async () => {
    const activity = activities.find(a => a.id === select.value);
    if (!activity) return;
    const disabled = aiToggleCheckbox.checked;
    aiToggleCheckbox.disabled = true;
    try {
      await activityFns.setAiDisabled(activity.id, disabled);
      activity.ai_disabled = disabled;
    } catch (e) {
      aiToggleCheckbox.checked = !disabled;
      alert('Could not update AI setting: ' + (e.message || e));
    } finally {
      aiToggleCheckbox.disabled = false;
    }
  };

  deleteBtn.onclick = async () => {
    const activity = activities.find(a => a.id === select.value);
    if (!activity) return;
    if (!confirm(`Delete activity "${activity.name}"? Maps already tagged to it are not deleted - they just become untagged.`)) return;
    deleteBtn.disabled = true;
    try {
      await activityFns.del(activity.id);
      activities = activities.filter(a => a.id !== activity.id);
      renderOptions();
      syncAiToggleRow();
      onChange(null, activities);
    } catch (e) {
      alert('Could not delete activity: ' + (e.message || e));
    } finally {
      deleteBtn.disabled = !select.value;
    }
  };

  load();
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
      a.title = 'Open read-only map';
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
function renderClassInsights(summaryEl, grid, roster, mapsData, curriculum, taughtSet, hrefFor, activity) {
  summaryEl.innerHTML = '';
  grid.innerHTML = '';
  if (!mapsData.length) {
    grid.innerHTML = '<p class="settings-empty">No student maps yet - insights will appear once students save maps.</p>';
    return;
  }

  const banner = document.createElement('div');
  banner.className = 'ai-summary-banner';
  banner.innerHTML = `<p></p>`;
  banner.querySelector('p').innerHTML = `<strong>Class summary</strong><br>`;
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
  const provenance = computeProvenanceStats(mapsData, roster);

  const freqCard = insightCard('Most-explored concepts');
  freqCard.appendChild(insightList(freq, (item, li) => {
    const span = document.createElement('span'); span.textContent = item.label;
    expandRow(li, span, `${item.count} student${item.count === 1 ? '' : 's'}`, null, item.studentIds);
  }, 'Nothing yet.'));
  grid.appendChild(freqCard);

  const hubCard = insightCard('Hub concepts');
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
    topicSpan.textContent = item.prereq + ' → ' + item.topic;
    topicSpan.title = item.reason || '';
    span.appendChild(topicSpan);
    span.appendChild(document.createTextNode(' — connection missing'));
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
  }, prerequisiteDataAvailable ? 'No missing connections among the reviewed prerequisite relationships.' : 'Prerequisite analysis is temporarily unavailable. Reload to try again.'));
  grid.appendChild(missingCard);

  const progressCard = insightCard('Student progress');
  const progressHint = document.createElement('p'); progressHint.className = 'hint';
  progressHint.textContent = 'Distinct concepts + total connections per student, lowest first.';
  progressCard.appendChild(progressHint);
  progressCard.appendChild(insightList(progressRows, (row, li) => {
    const span = document.createElement('span'); span.textContent = row.name;
    li.appendChild(badgeRow(span, `${row.concepts} concept${row.concepts === 1 ? '' : 's'}, ${row.links} link${row.links === 1 ? '' : 's'}`, row.belowAverage ? 'insights-badge-danger' : ''));
  }, 'No students yet.'));
  grid.appendChild(progressCard);

  const coverageCard = insightCard('Curriculum coverage');
  const coverageHint = document.createElement('p'); coverageHint.className = 'hint';
  coverageHint.textContent = 'Where the class is working, by grade and unit.';
  coverageCard.appendChild(coverageHint);
  coverageCard.appendChild(insightList(coverage, (row, li) => {
    const span = document.createElement('span'); span.textContent = `${row.unit} (${row.grade})`;
    expandRow(li, span, `${row.students} student${row.students === 1 ? '' : 's'}`, null, row.studentIds);
  }, 'No curriculum-tagged concepts yet.'));
  grid.appendChild(coverageCard);

  const provenanceCard = insightCard('Concept provenance');
  provenanceCard.classList.add('provenance-card');
  const provenanceHint = document.createElement('p'); provenanceHint.className = 'hint';
  provenanceHint.textContent = 'Concepts each student typed or dragged in themselves vs. added from an Explore suggestion.';
  provenanceCard.appendChild(provenanceHint);
  provenanceCard.appendChild(insightList(provenance, (row, li) => {
    const span = document.createElement('span'); span.textContent = row.name;
    li.appendChild(badgeRow(span, `${row.own} student-created, ${row.aiAdded} from suggestions`));
  }, 'No students yet.'));
  grid.appendChild(provenanceCard);

  if (activity) {
    const conceptLabels = activityConceptLabels(activity);
    const pairs = computePairConnectionCounts(mapsData, conceptLabels);
    const pairCard = insightCard(`Classwide connection counts`);
    const pairHint = document.createElement('p'); pairHint.className = 'hint';
    pairHint.textContent = `Every possible pair within "${activity.name}"'s ${conceptLabels.length} concepts, including pairs nobody connected.`;
    pairCard.appendChild(pairHint);
    pairCard.appendChild(insightList(pairs, (pair, li) => {
      const span = document.createElement('span'); span.textContent = `${pair.a} ↔ ${pair.b}`;
      li.appendChild(badgeRow(span, `${pair.count} student${pair.count === 1 ? '' : 's'}`, pair.count === 0 ? 'insights-badge-warn' : ''));
    }, 'This activity has fewer than two concepts assigned.'));
    grid.appendChild(pairCard);
  }
}

// A first attempt at this rendered the report through jsPDF's html()
// plugin (via html2canvas) - it kept surfacing new html2canvas rendering
// bugs one at a time (blank inline <svg> thumbnails, linear-gradients
// turning solid black, broken glyphs for ▸/▾/→, and finally mismeasured
// word spacing throughout the whole document that no option fixed).
// html2canvas re-implements text layout instead of using the browser's
// own, so it will never match pixel-for-pixel. Printing sidesteps all of
// it: real browser layout, real fonts, real gradients. The @media print
// rules in dashboard.html hide everything except the current class's
// report and keep cards from splitting awkwardly across pages.
// onToggleAnonymous(nowAnonymous) fires on click; the caller owns the
// actual re-render (this function only knows about the button itself).
function setupExportReportButton(header, className, onToggleAnonymous) {
  const actions = document.createElement('div');
  actions.className = 'dash-header-actions';
  while (header.firstChild) actions.appendChild(header.firstChild);
  header.appendChild(actions);

  if (onToggleAnonymous) {
    const anonBtn = document.createElement('button');
    anonBtn.id = 'anonymousModeBtn';
    anonBtn.textContent = 'Anonymous mode: off';
    anonBtn.setAttribute('aria-pressed', 'false');
    anonBtn.title = 'Hide student names - for projecting class patterns without putting names on screen';
    let anonymous = false;
    anonBtn.onclick = () => {
      anonymous = !anonymous;
      anonBtn.classList.toggle('active', anonymous);
      anonBtn.textContent = anonymous ? 'Anonymous mode: on' : 'Anonymous mode: off';
      anonBtn.setAttribute('aria-pressed', String(anonymous));
      onToggleAnonymous(anonymous);
    };
    actions.appendChild(anonBtn);
  }

  const btn = document.createElement('button');
  btn.id = 'exportReportBtn';
  btn.textContent = 'Export PDF';
  btn.title = "Opens the print dialog - choose \"Save as PDF\" as the destination";
  actions.appendChild(btn);

  btn.onclick = () => window.print();
}

// Assembles one class's full dashboard view into `wrap`, plus the header
// actions (Export PDF, Anonymous mode) into `header`. `saveFn`/`activityFns`
// are passed straight through to renderTaughtTopicsChecklist/
// renderActivitiesCard (real backend by default, in-memory fakes for the
// sample dashboard).
function renderClassDashboard(wrap, cls, roster, maps, mapsWithData, curriculum, hrefFor, saveFn, header, className, activityFns) {
  wrap.innerHTML = '';

  const activitiesCard = document.createElement('div');
  activitiesCard.className = 'dash-card';
  wrap.appendChild(activitiesCard);

  const glanceCard = document.createElement('div');
  glanceCard.className = 'dash-card';
  glanceCard.innerHTML = '<h2>Class at a Glance</h2>';
  const glanceGrid = document.createElement('div');
  glanceCard.appendChild(glanceGrid);
  wrap.appendChild(glanceCard);

  const summaryEl = document.createElement('div');
  wrap.appendChild(summaryEl);
  const insightsGrid = document.createElement('div');
  insightsGrid.className = 'insights-grid';
  wrap.appendChild(insightsGrid);

  const taughtCard = document.createElement('div');
  taughtCard.className = 'dash-card';
  taughtCard.innerHTML = '<h2>What have you taught?</h2>';
  const taughtBody = document.createElement('div');
  taughtCard.appendChild(taughtBody);
  wrap.appendChild(taughtCard);

  const rosterCard = document.createElement('div');
  rosterCard.className = 'dash-card';
  wrap.appendChild(rosterCard);

  let taughtSet = new Set(cls.taught_topics || []);
  let anonymous = false;
  let activities = [];
  let selectedActivityId = null;

  function currentRoster() {
    return anonymous ? anonymizeRoster(roster) : roster;
  }

  function renderRosterCard() {
    const r = currentRoster();
    rosterCard.innerHTML = '<h2>Roster</h2>';
    if (!r.length) {
      rosterCard.innerHTML += '<p class="settings-empty">No students have joined yet.</p>';
      return;
    }
    const mapsByStudent = {};
    maps.forEach(m => { (mapsByStudent[m.owner_id] = mapsByStudent[m.owner_id] || []).push(m); });
    const ul = document.createElement('ul');
    ul.className = 'roster-list';
    r.forEach(student => {
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
          a.title = 'Open read-only map';
          a.textContent = m.title + ' · Read-only';
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

  // Re-runs everything that shows student names or depends on the
  // activity filter - called on load and whenever anonymous mode, the
  // activity selection, or taughtSet changes. "What have you taught?"
  // deliberately isn't re-run here: it shows no names, and it's scoped to
  // the whole class's curriculum coverage, not one activity.
  function rerender() {
    const r = currentRoster();
    if (r.length) {
      renderStudentMapCards(glanceGrid, r, mapsWithData, hrefFor);
    } else {
      glanceGrid.innerHTML = '<p class="settings-empty">No students have joined yet.</p>';
    }
    const activity = activities.find(a => a.id === selectedActivityId) || null;
    const filteredMaps = filterMapsForActivity(mapsWithData, selectedActivityId);
    renderClassInsights(summaryEl, insightsGrid, r, filteredMaps, curriculum, taughtSet, hrefFor, activity);
    renderRosterCard();
  }

  if (header) {
    setupExportReportButton(header, className, (nowAnonymous) => {
      anonymous = nowAnonymous;
      rerender();
    });
  }

  renderActivitiesCard(activitiesCard, cls, curriculum, activityFns, (activityId, newActivities) => {
    selectedActivityId = activityId;
    activities = newActivities;
    rerender();
  });

  renderTaughtTopicsChecklist(taughtBody, cls, mapsWithData, curriculum, (newSet) => {
    taughtSet = newSet;
    rerender();
  }, saveFn);
}

// ============================================================
// Sample dashboard (dashboard?sample=1): no login, no Supabase calls.
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
    id: 'sample-maya', title: 'Ratios Unit Map', owner_id: 'sample-maya-id', activity_id: 'sample-activity-ratios',
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
    node('Calculate unit rates with integers and decimals', 500, 220),
    node('Percent of quantity', 100, 420),
    node('Percent word problems', 500, 460),
    node('Rate word problems', 900, 340),
  ];
  const jordanMap = {
    id: 'sample-jordan', title: 'Ratios + Percents', owner_id: 'sample-jordan-id', activity_id: 'sample-activity-ratios',
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
    id: 'sample-priya', title: 'Word Problems Practice', owner_id: 'sample-priya-id', activity_id: 'sample-activity-ratios',
    data: { n: priyaNodes, e: [] },
  };

  // Sam: prereq present but unlinked, both isolated - "just getting
  // started."
  const samNodes = [
    node('Ratio notation (a:b)', 100, 120),
    node('Ratio vocabulary', 500, 220),
  ];
  const samMap = {
    id: 'sample-sam', title: 'Getting Started', owner_id: 'sample-sam-id', activity_id: 'sample-activity-ratios',
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

// In-memory activityFns for the sample dashboard (no account, nothing to
// persist) - same role as buildSampleClassData's fake saveFn. Seeded with
// one activity already selected-able so "Classwide connection counts"
// has something to show without extra clicks; its concepts match exactly
// the labels buildSampleClassData's maps use (Maya/Jordan/Priya/Sam's
// activity_id above), not a real curriculum lookup.
function buildSampleActivityFns() {
  let activities = [{
    id: 'sample-activity-ratios',
    class_id: 'sample-class',
    name: 'Ratios Checkpoint',
    concepts: [
      '6th Grade Math::Ratios & Proportional Relationships::Ratio notation (a:b)',
      '6th Grade Math::Ratios & Proportional Relationships::Ratio vocabulary',
      '6th Grade Math::Ratios & Proportional Relationships::Equivalent ratios – tables',
      '6th Grade Math::Ratios & Proportional Relationships::Equivalent ratios – tape diagrams',
      '6th Grade Math::Ratios & Proportional Relationships::Ratio word problems',
      '6th Grade Math::Ratios & Proportional Relationships::Unit rate definition',
    ],
    created_at: new Date().toISOString(),
    ai_disabled: false,
  }];
  return {
    list: async () => activities,
    create: async (classId, name, concepts, aiDisabled) => {
      const created = { id: 'sample-activity-' + Date.now(), class_id: classId, name, concepts, created_at: new Date().toISOString(), ai_disabled: !!aiDisabled };
      activities = [created, ...activities];
      return created;
    },
    del: async (id) => { activities = activities.filter(a => a.id !== id); },
    setAiDisabled: async (id, disabled) => {
      const a = activities.find(a => a.id === id);
      if (a) a.ai_disabled = disabled;
    },
  };
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
  banner.innerHTML = 'Sample preview (no account needed). This is what a teacher sees for a real class. <a href="settings">Sign in for your own →</a>';
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
    (m) => `playground?share=${encodeMapForShare(m.data)}&readonly=1`,
    async () => {}, // fake save: no account, nothing to persist
    header, 'Period 3 - Ratios & Proportions', buildSampleActivityFns()
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
  const forgotPasswordLink = document.getElementById('forgotPasswordLink');
  const forgotPasswordForm = document.getElementById('forgotPasswordForm');
  const forgotBackBtn = document.getElementById('forgotBackBtn');

  function showSignedOutEmptyState() {
    dashWrap.innerHTML = `
      <div class="dash-empty-state">
        <p>Sign in to see your Teacher Dashboard.</p>
        <button id="dashSignInBtn" style="background:var(--brand);color:#fff;border:none;padding:0.7em 1.4em;border-radius:8px;font-family:inherit;font-size:0.95em;font-weight:600;cursor:pointer;">Sign in</button>
        <p style="margin-top:1.6em;">Curious what this looks like? <a href="dashboard?sample=1">Preview a sample class →</a></p>
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
    if (forgotPasswordForm) forgotPasswordForm.style.display = 'none';
  }
  function showSignUp() {
    tabSignUp.classList.add('active'); tabSignIn.classList.remove('active');
    signUpForm.style.display = ''; signInForm.style.display = 'none';
    if (forgotPasswordForm) forgotPasswordForm.style.display = 'none';
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

  if (forgotPasswordLink) forgotPasswordLink.onclick = () => {
    signInForm.style.display = 'none';
    forgotPasswordForm.style.display = '';
    document.getElementById('forgotEmail').value = document.getElementById('signInEmail').value;
  };
  if (forgotBackBtn) forgotBackBtn.onclick = () => {
    forgotPasswordForm.style.display = 'none';
    signInForm.style.display = '';
  };
  if (forgotPasswordForm) forgotPasswordForm.onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById('forgotEmail').value.trim();
    const errEl = document.getElementById('forgotError');
    errEl.style.color = '';
    errEl.textContent = '';
    try {
      await window.SpanAuth.resetPasswordForEmail(email);
      errEl.style.color = '#1f8a4c';
      errEl.textContent = 'Check your email for a reset link.';
    } catch (err) {
      errEl.textContent = err.message || 'Could not send reset link.';
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
      (m) => `playground?view=${m.id}&readonly=1`,
      undefined, header, cls.name
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
          <p><a href="settings">Create one in Settings →</a></p>
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
            <p><a href="settings">Back to Settings →</a></p>
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
