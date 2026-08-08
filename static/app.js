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

const NODE_HEIGHT = 54, NODE_RADIUS = 17, NODE_MIN_WIDTH = 100, NODE_HORIZ_PADDING = 22;
const nodeWidthCache = new Map();

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
  renderCanvas();
  setupCustomConcept();
};

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

function resizeCanvas() {
  const svg = document.getElementById('mapCanvas');
  const area = document.getElementById('canvasArea');
  svg.setAttribute('width', area.clientWidth);
  svg.setAttribute('height', area.clientHeight);
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
  let node = {
    id: nodeIdCounter++,
    label, x, y,
    meta: {...meta}
  };
  nodes.push(node);
  renderCanvas();
}

// --------- Main Canvas Drawing ---------
function renderCanvas() {
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
  for (let link of links) {
    let src = nodes.find(n => n.id === link.source), tgt = nodes.find(n => n.id === link.target);
    if (!src || !tgt) continue;
    let srcW = getNodeWidth(src.label), tgtW = getNodeWidth(tgt.label);
    let start = {x: src.x + srcW/2, y: src.y + NODE_HEIGHT/2};
    let end = {x: tgt.x + tgtW/2, y: tgt.y + NODE_HEIGHT/2};
    let v = {x: end.x - start.x, y: end.y - start.y};
    let mag = Math.sqrt(v.x*v.x + v.y*v.y);
    let ux = v.x / mag, uy = v.y / mag;
    start.x += ux * (srcW/2.1); start.y += uy * (NODE_HEIGHT/2.3);
    end.x -= ux * (tgtW/2.1); end.y -= uy * (NODE_HEIGHT/2.3);

    let line = document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1', start.x);
    line.setAttribute('y1', start.y);
    line.setAttribute('x2', end.x);
    line.setAttribute('y2', end.y);
    line.setAttribute('class', 'link'+(link === selectedLink ? ' selected' : ''));
    line.setAttribute('data-link-id', link.id);

    // --- Link interaction: select, note, delete (ctrl+double-click) ---
    line.onclick = e => {
      selectedLink = link; selectedNode = null;
      renderCanvas();
      e.stopPropagation();
    };
    line.ondblclick = e => {
      if (e.ctrlKey) {
        deleteLink(link.id);
      } else {
        e.stopPropagation();
        showNoteEditor(link, (note) => {
          link.note = note;
          renderNotesSidebar();
          renderCanvas();
        });
      }
    };
    svg.appendChild(line);
    if (link === selectedLink && link.note) {
      showNoteTooltip(link, start, end);
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
  for (let node of nodes) {
    let w = getNodeWidth(node.label);
    let g = document.createElementNS('http://www.w3.org/2000/svg','g');
    g.setAttribute('transform', `translate(${node.x},${node.y})`);
    g.setAttribute('data-node-id', node.id);

    let rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
    rect.setAttribute('width', w);
    rect.setAttribute('height', NODE_HEIGHT);
    rect.setAttribute('rx', NODE_RADIUS);
    rect.setAttribute('ry', NODE_RADIUS);
    let extraClass = '';
    if (node === selectedNode) extraClass += ' selected';
    if (linkHoverTarget === node) extraClass += ' link-hover';
    rect.setAttribute('class', 'node'+extraClass);

    // --- One mousedown handler for all node actions ---
    rect.onmousedown = e => {
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
    textEl.setAttribute('y', NODE_HEIGHT/2 + 7);
    textEl.setAttribute('class', 'node-label');
    textEl.setAttribute('pointer-events', 'none');
    textEl.setAttribute('text-anchor', 'middle');
    textEl.setAttribute('dominant-baseline', 'middle');
    g.appendChild(rect);
    g.appendChild(textEl);

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
  dragInfo = null;
  document.onmousemove = null;
  document.onmouseup = null;
}

// --- Cheap per-frame position update used while dragging a node ---
function updateNodePosition(node) {
  const svg = document.getElementById('mapCanvas');
  const g = svg.querySelector(`[data-node-id="${node.id}"]`);
  if (g) g.setAttribute('transform', `translate(${node.x},${node.y})`);
  for (const link of links) {
    if (link.source !== node.id && link.target !== node.id) continue;
    const line = svg.querySelector(`[data-link-id="${link.id}"]`);
    if (!line) continue;
    const src = nodes.find(n => n.id === link.source), tgt = nodes.find(n => n.id === link.target);
    if (!src || !tgt) continue;
    const srcW = getNodeWidth(src.label), tgtW = getNodeWidth(tgt.label);
    let start = {x: src.x + srcW/2, y: src.y + NODE_HEIGHT/2};
    let end = {x: tgt.x + tgtW/2, y: tgt.y + NODE_HEIGHT/2};
    let v = {x: end.x - start.x, y: end.y - start.y};
    let mag = Math.sqrt(v.x*v.x + v.y*v.y) || 1;
    let ux = v.x/mag, uy = v.y/mag;
    start.x += ux * (srcW/2.1); start.y += uy * (NODE_HEIGHT/2.3);
    end.x -= ux * (tgtW/2.1); end.y -= uy * (NODE_HEIGHT/2.3);
    line.setAttribute('x1', start.x); line.setAttribute('y1', start.y);
    line.setAttribute('x2', end.x); line.setAttribute('y2', end.y);
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
  if (srcId === tgtId || links.some(l => l.source === srcId && l.target === tgtId)) return;
  links.push({id: linkIdCounter++, source: srcId, target: tgtId, note: ''});
  renderNotesSidebar();
  renderCanvas();
}
function deleteNode(nodeId) {
  nodes = nodes.filter(n => n.id !== nodeId);
  links = links.filter(l => l.source !== nodeId && l.target !== nodeId);
  selectedNode = null;
  renderNotesSidebar();
  renderCanvas();
}
function deleteLink(linkId) {
  links = links.filter(l => l.id !== linkId);
  selectedLink = null;
  renderNotesSidebar();
  renderCanvas();
}
function showNoteEditor(link, cb) {
  let note = prompt('Edit note for this connection:', link.note || '');
  if (note !== null) cb(note);
}
function showNoteTooltip(link, src, tgt) {
  let area = document.getElementById('canvasArea');
  let x = (src.x + tgt.x)/2, y = (src.y + tgt.y)/2;
  let tooltip = document.querySelector('.note-tooltip');
  if (tooltip) tooltip.remove();
  tooltip = document.createElement('div');
  tooltip.className = 'note-tooltip';
  tooltip.style.left = `${x+30}px`;
  tooltip.style.top = `${y}px`;
  tooltip.innerHTML = `
    <strong>Note:</strong><br>${link.note}<br>
    <button style="margin-top:0.5em;" onclick="deleteLink(${link.id})">Delete Link</button>
  `;
  area.appendChild(tooltip);
  setTimeout(() => { if (tooltip) tooltip.remove(); }, 8000);
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
      el.innerHTML = `<div class="sidebar-note-topic">[${src.label}, ${tgt.label}]</div>
        <div class="sidebar-note-txt">[${link.note}]</div>`;
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
