// Position-only layout. No inference about mathematical correctness is made.
(function () {
  function arrange(nodes, links, widthFor, options = {}) {
    const targetWidth = Math.max(300, options.width || 1000);
    const height = options.nodeHeight || 54, gapX = 64, gapY = 112, padding = 40;
    const byId = new Map(nodes.map(n => [n.id, n]));
    const order = new Map(nodes.map((n, i) => [n.id, i]));
    const outgoing = new Map(nodes.map(n => [n.id, []]));
    const incoming = new Map(nodes.map(n => [n.id, []]));
    const neighbours = new Map(nodes.map(n => [n.id, []]));
    for (const e of links) {
      if (!byId.has(e.source) || !byId.has(e.target) || e.source === e.target) continue;
      neighbours.get(e.source).push(e.target); neighbours.get(e.target).push(e.source);
      // Sideways/example relationships keep concepts together without imposing a rank.
      if (['related', 'example', 'representation'].includes(e.relType)) continue;
      outgoing.get(e.source).push(e.target); incoming.get(e.target).push(e.source);
    }

    // Iterative strongly connected components keep intentional cycles at one level.
    const visited = new Set(), finished = [];
    for (const n of nodes) {
      if (visited.has(n.id)) continue;
      const stack = [[n.id, 0]]; visited.add(n.id);
      while (stack.length) {
        const frame = stack[stack.length - 1], next = outgoing.get(frame[0]);
        if (frame[1] < next.length) {
          const id = next[frame[1]++];
          if (!visited.has(id)) { visited.add(id); stack.push([id, 0]); }
        } else { finished.push(frame[0]); stack.pop(); }
      }
    }
    const componentOf = new Map(), components = [];
    for (const id of finished.reverse()) {
      if (componentOf.has(id)) continue;
      const index = components.length, members = [], stack = [id]; componentOf.set(id, index);
      while (stack.length) {
        const current = stack.pop(); members.push(current);
        for (const parent of incoming.get(current)) if (!componentOf.has(parent)) {
          componentOf.set(parent, index); stack.push(parent);
        }
      }
      components.push(members);
    }
    const edges = components.map(() => new Set()), indegree = components.map(() => 0), rank = components.map(() => 0);
    for (const [id, targets] of outgoing) for (const target of targets) {
      const a = componentOf.get(id), b = componentOf.get(target);
      if (a !== b && !edges[a].has(b)) { edges[a].add(b); indegree[b]++; }
    }
    const queue = indegree.flatMap((degree, i) => degree === 0 ? [i] : []);
    for (let i = 0; i < queue.length; i++) for (const next of edges[queue[i]]) {
      rank[next] = Math.max(rank[next], rank[queue[i]] + 1);
      if (--indegree[next] === 0) queue.push(next);
    }

    // Pack disconnected maps and isolated concepts as separate clusters.
    const clustered = new Set(), clusters = [];
    for (const n of nodes) {
      if (clustered.has(n.id)) continue;
      const stack = [n.id], members = []; clustered.add(n.id);
      while (stack.length) {
        const id = stack.pop(); members.push(id);
        for (const next of neighbours.get(id)) if (!clustered.has(next)) { clustered.add(next); stack.push(next); }
      }
      clusters.push(members.sort((a, b) => order.get(a) - order.get(b)));
    }
    const positions = new Map(); let shelfX = padding, shelfY = padding, shelfHeight = 0;
    for (const ids of clusters) {
      const layers = new Map();
      for (const id of ids) {
        const level = rank[componentOf.get(id)];
        if (!layers.has(level)) layers.set(level, []);
        layers.get(level).push(id);
      }
      let localY = 0, clusterWidth = 0; const local = new Map();
      for (const level of [...layers.keys()].sort((a, b) => a - b)) {
        const layer = layers.get(level);
        // Parent-centre ordering reduces crossings without changing the stored graph.
        const centre = id => {
          const parents = incoming.get(id).filter(parent => local.has(parent));
          return parents.length ? parents.reduce((sum, parent) => sum + local.get(parent).x + widthFor(byId.get(parent).label)/2, 0)/parents.length : Infinity;
        };
        layer.sort((a, b) => centre(a) - centre(b) || order.get(a) - order.get(b));
        let x = 0, y = localY;
        for (const id of layer) {
          const width = widthFor(byId.get(id).label);
          if (x && x + width > targetWidth - padding * 2) { x = 0; y += height + gapY; }
          local.set(id, {x, y}); clusterWidth = Math.max(clusterWidth, x + width); x += width + gapX;
        }
        localY = y + height + gapY;
      }
      const clusterHeight = Math.max(height, localY - gapY);
      if (shelfX > padding && shelfX + clusterWidth > targetWidth - padding) {
        shelfX = padding; shelfY += shelfHeight + gapY; shelfHeight = 0;
      }
      for (const [id, p] of local) positions.set(id, {id, x:p.x+shelfX, y:p.y+shelfY});
      shelfX += clusterWidth + gapX; shelfHeight = Math.max(shelfHeight, clusterHeight);
    }
    return nodes.map(n => positions.get(n.id));
  }
  window.SpanAutoLayout = {arrange};
})();
