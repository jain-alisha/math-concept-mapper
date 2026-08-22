import json
from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import re
from collections import Counter
import numpy as np
import networkx as nx

app = Flask(__name__, static_folder='static', static_url_path='')
CORS(app)

# --- Load curriculum JSON ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(BASE_DIR, 'static', 'concepts.json'), encoding='utf-8') as f:
    curriculum = json.load(f)

# --- Build fast lookup: topic -> {grade, unit}
concept_lookup = {}
curriculum_topics = []
for grade, units in curriculum.items():
    for unit, topics in units.items():
        for topic in topics:
            concept_lookup[topic] = {'grade': grade, 'unit': unit}
            curriculum_topics.append(topic)

# --- Lightweight TF-IDF similarity (no ML model/download needed) ---
# Curriculum topic labels are named systematically (e.g. "Addition",
# "Add integers", "Add/subtract fractions" all share a root), so word-overlap
# similarity works well here without the memory cost of an embedding model.
TOKEN_RE = re.compile(r"[a-zA-Z]+")

def tokenize(text):
    return [w.lower() for w in TOKEN_RE.findall(text)]

_doc_tokens = [tokenize(t) for t in curriculum_topics]
_vocab = sorted(set(w for toks in _doc_tokens for w in toks))
_vocab_index = {w: i for i, w in enumerate(_vocab)}
_doc_freq = np.zeros(len(_vocab))
for toks in _doc_tokens:
    for w in set(toks):
        _doc_freq[_vocab_index[w]] += 1
_idf = np.log((1 + len(curriculum_topics)) / (1 + _doc_freq)) + 1

def _vectorize(tokens):
    vec = np.zeros(len(_vocab))
    for w, count in Counter(tokens).items():
        idx = _vocab_index.get(w)
        if idx is not None:
            vec[idx] = count * _idf[idx]
    norm = np.linalg.norm(vec)
    return vec / norm if norm > 0 else vec

topic_embeddings = np.array([_vectorize(toks) for toks in _doc_tokens])

def resolved_meta(label, meta):
    """meta as-authored, falling back to a curriculum lookup by exact label
    match. Custom-typed nodes (via "Add your own concept") never carry
    grade/unit even when the text happens to match a real curriculum topic
    - without this, every recommendation for a hand-typed-but-real topic
    skips straight to the all-curriculum fallback below instead of the
    topic's own unit, which is why recs for a real topic like "Percent of
    quantity" can look like generic word-similarity noise instead of
    curriculum-adjacent ones."""
    grade, unit = meta.get('grade'), meta.get('unit')
    if grade and unit:
        return grade, unit
    fallback = concept_lookup.get(label)
    return (fallback['grade'], fallback['unit']) if fallback else (grade, unit)


def find_prereqs_successors(grade, unit, topic):
    """Return topics before/after in the same unit (prereqs/successors)."""
    topics = curriculum[grade][unit]
    idx = topics.index(topic)
    prereq = topics[idx-1] if idx > 0 else None
    succ = topics[idx+1] if idx < len(topics)-1 else None
    out = []
    if prereq: out.append({'label': prereq, 'meta': {'grade': grade, 'unit': unit}})
    if succ: out.append({'label': succ, 'meta': {'grade': grade, 'unit': unit}})
    return out

def get_graph_features(nodes, links, selected_node):
    """Use NetworkX to analyze current concept map and extract candidates to suggest."""
    G = nx.Graph()
    node_ids = {n['id']: n for n in nodes}
    # Add all nodes
    for n in nodes:
        G.add_node(n['id'], label=n['label'])
    # Add all links
    for l in links:
        G.add_edge(l['source'], l['target'])
    # Get selected node id
    selected_id = selected_node.get('id')
    if selected_id is None or selected_id not in G: return []
    # Get neighbors and 2-hop neighbors
    neighbors = set(G.neighbors(selected_id))
    two_hop = set()
    for n in neighbors:
        two_hop.update(G.neighbors(n))
    two_hop -= neighbors
    two_hop.discard(selected_id)
    # Find curriculum topics *not* yet on map, that are adjacent in curriculum to any node on map
    candidate_labels = set()
    for n in nodes:
        meta = n.get('meta', {})
        label = n['label']
        g, u = resolved_meta(label, meta)
        if g and u and label in curriculum.get(g, {}).get(u, []):
            idx = curriculum[g][u].index(label)
            if idx > 0:
                before = curriculum[g][u][idx-1]
                if before not in [x['label'] for x in nodes]:
                    candidate_labels.add(before)
            if idx < len(curriculum[g][u])-1:
                after = curriculum[g][u][idx+1]
                if after not in [x['label'] for x in nodes]:
                    candidate_labels.add(after)
    # Add 2-hop exploration (find curriculum topics in same units as two-hop nodes)
    for n in [node_ids[tid] for tid in two_hop if tid in node_ids]:
        meta = n.get('meta', {})
        label = n['label']
        g, u = resolved_meta(label, meta)
        if g and u:
            for topic in curriculum[g][u]:
                if topic not in [x['label'] for x in nodes]:
                    candidate_labels.add(topic)
    return list(candidate_labels)

def semantic_similarity(selected_label, candidates, topk=5):
    """Return topk candidates by TF-IDF cosine similarity to the selected_label."""
    if not candidates: return []
    c_idx = [curriculum_topics.index(c) for c in candidates if c in curriculum_topics]
    if not c_idx: return []
    selected_vec = _vectorize(tokenize(selected_label))
    sim_scores = topic_embeddings[c_idx] @ selected_vec
    ranked = sorted(zip(sim_scores, c_idx), reverse=True)
    results = []
    for score, idx in ranked[:topk]:
        topic = curriculum_topics[idx]
        meta = concept_lookup[topic]
        results.append({'label': topic, 'meta': meta, 'score': float(score)})
    return results

@app.route('/')
def index():
    return app.send_static_file('index.html')

@app.route('/recommend', methods=['POST'])
def recommend():
    try:
        data = request.get_json()
        nodes = data.get('nodes', [])
        links = data.get('links', [])
        selected = data.get('selected_node', {})

        used_labels = set(n['label'] for n in nodes)
        selected_label = selected.get('label', '')
        selected_meta = selected.get('meta', {})

        grade, unit = resolved_meta(selected_label, selected_meta)

        # 1. Direct prereqs/successors in unit
        prereq_succ = []
        if grade and unit and selected_label in curriculum.get(grade, {}).get(unit, []):
            prereq_succ = [
                t for t in find_prereqs_successors(grade, unit, selected_label)
                if t['label'] not in used_labels
            ]

        # 2. Candidates from current graph structure
        graph_candidates = get_graph_features(nodes, links, selected)
        graph_candidates = [c for c in graph_candidates if c not in used_labels and c != selected_label]

        # 3. Semantic similarity using transformer
        semantic_recs = semantic_similarity(selected_label, graph_candidates, topk=7)

        # 4. Fallback: semantic to all curriculum (if not enough)
        needed = max(0, 8 - (len(prereq_succ) + len(semantic_recs)))
        if needed > 0:
            all_candidates = [t for t in curriculum_topics if t not in used_labels and t != selected_label]
            fallback_recs = semantic_similarity(selected_label, all_candidates, topk=needed)
        else:
            fallback_recs = []

        # Remove duplicates and merge all recommendations
        seen = set()
        recommendations = []
        for rec in prereq_succ + semantic_recs + fallback_recs:
            if rec['label'] not in seen:
                recommendations.append({'label': rec['label'], 'meta': rec['meta']})
                seen.add(rec['label'])

        # Limit number, prioritize prereq/succ, then graph, then semantic
        return jsonify({'recommendations': recommendations[:8]})
    except Exception as e:
        print("Error in /recommend:", e)
        return jsonify({'recommendations': []})

if __name__ == '__main__':
    app.run(debug=True)
