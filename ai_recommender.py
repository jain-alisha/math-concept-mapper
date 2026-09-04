import json
from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import re
from collections import Counter
import numpy as np
import requests

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

# --- Relationship-shaped suggestions for the three Explore questions ---
# The product's thesis is about edges, not just nodes - a suggestion is
# always (source concept, relationship type, target concept, reason), never
# a bare "add this topic." Curriculum topic order within a unit is the
# source of truth for prerequisite/successor direction; "related" pulls
# same-unit topics that are neither, ranked by word-overlap to the anchor.
REASON_TEMPLATES = {
    'builds_on': [
        "{b} is what {a} builds on directly - it lays the groundwork.",
        "Getting {b} solid first is usually what makes {a} click.",
        "{a} assumes {b} as a starting point.",
    ],
    'leads_to': [
        "{a} feeds directly into {b} - a natural next step.",
        "Once {a} is solid, {b} is where it gets used next.",
        "{b} builds on {a} without much else in between.",
    ],
    'related': [
        "{b} touches similar ideas as {a}, without being a strict prerequisite.",
        "{a} and {b} often show up side by side in the same unit.",
        "{b} is a useful sideways connection from {a}, not a dependency.",
    ],
}

def _stable_index(a, b, n):
    # Deterministic (not process-random like Python's hash()) so the same
    # pair always phrases the same way, while still varying across pairs.
    s = sum(ord(c) for c in (a + b))
    return s % n

def build_reason(a, b, question):
    options = REASON_TEMPLATES[question]
    template = options[_stable_index(a, b, len(options))]
    return template.format(a=a, b=b)

RELATIONSHIP_LABEL = {
    'builds_on': 'prerequisite',
    'leads_to': 'builds toward',
    'related': 'related',
}

def relationship_suggestions(selected_label, selected_meta, used_labels, question, topk=3):
    grade, unit = resolved_meta(selected_label, selected_meta)
    candidates = []
    if grade and unit and selected_label in curriculum.get(grade, {}).get(unit, []):
        topics = curriculum[grade][unit]
        idx = topics.index(selected_label)
        if question == 'builds_on':
            candidates = [t for t in reversed(topics[:idx]) if t not in used_labels]
        elif question == 'leads_to':
            candidates = [t for t in topics[idx + 1:] if t not in used_labels]
        elif question == 'related':
            near = set()
            if idx > 0: near.add(topics[idx - 1])
            if idx < len(topics) - 1: near.add(topics[idx + 1])
            candidates = [t for t in topics if t != selected_label and t not in near and t not in used_labels]

    ranked = semantic_similarity(selected_label, candidates, topk=topk) if candidates else []
    if len(ranked) < topk:
        pool = [t for t in curriculum_topics if t not in used_labels and t != selected_label]
        seen = set(r['label'] for r in ranked)
        pool = [t for t in pool if t not in seen]
        ranked += semantic_similarity(selected_label, pool, topk=topk - len(ranked))

    relationship = RELATIONSHIP_LABEL[question]
    results = []
    for r in ranked[:topk]:
        if question == 'builds_on':
            source, target = r['label'], selected_label
        else:
            # 'leads_to' and 'related' both read as selected -> suggestion
            source, target = selected_label, r['label']
        results.append({
            'label': r['label'],
            'meta': r['meta'],
            'source': source,
            'target': target,
            'relationship': relationship,
            'reason': build_reason(source, target, question),
        })
    return results

# --- Optional: real-LLM recommendations ---
# Off by default (falls back to the heuristic above) unless LLM_API_KEY is
# set. Written against the OpenAI-compatible chat-completions shape that
# Qwen (Alibaba DashScope), OpenAI, OpenRouter, Groq, Together, and most
# other hosted-model providers all expose, so swapping providers is just
# changing LLM_BASE_URL/LLM_MODEL env vars, not code. Defaults point at
# DashScope's Qwen endpoint since that's what was asked for, but nothing
# here is Qwen-specific.
LLM_API_KEY = os.environ.get('LLM_API_KEY')
LLM_BASE_URL = os.environ.get('LLM_BASE_URL', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1')
LLM_MODEL = os.environ.get('LLM_MODEL', 'qwen-plus')

QUESTION_PROMPTS = {
    'builds_on': 'What does this concept build on? The student wants likely PREREQUISITES - concepts that should come before this one and that this one depends on.',
    'leads_to': 'What does this concept lead to? The student wants likely SUCCESSORS - concepts that build on this one as a foundation.',
    'related': "What else is related? The student wants useful SIDEWAYS connections - concepts that share ideas with this one but aren't a strict prerequisite or successor.",
}

def llm_relationship_suggestions(selected_label, grade, unit, used_labels, question, topk=3):
    """Returns a list of suggestions on success, [] if the model returned
    nothing usable, or None if the LLM path isn't configured/failed - the
    caller distinguishes None (fall back entirely) from a short list (top
    up with the heuristic) so a flaky API call degrades gracefully instead
    of breaking Explore."""
    if not LLM_API_KEY:
        return None
    if grade and unit and unit in curriculum.get(grade, {}):
        candidates = [t for t in curriculum[grade][unit] if t not in used_labels and t != selected_label]
    else:
        candidates = [t for t in curriculum_topics if t not in used_labels and t != selected_label]
    if not candidates:
        return []

    where = f' ({grade}, {unit})' if grade and unit else ''
    prompt = f"""You are a math curriculum expert helping a student explore how concepts connect, inside a concept-mapping tool. The student is looking at "{selected_label}"{where}.

They asked: {QUESTION_PROMPTS.get(question, QUESTION_PROMPTS['related'])}

Choose up to {topk} suggestions ONLY from this list of real curriculum topics - do not invent a topic that isn't in this list:
{json.dumps(candidates, ensure_ascii=False)}

For each suggestion, write a specific, non-generic reason (1-2 sentences) that names the actual mathematical or cognitive mechanism connecting the two concepts - not a template phrase like "X is what Y builds on." Help the student understand WHY the connection matters, not just THAT it exists.

Respond with ONLY valid JSON, no markdown fences, no commentary, in exactly this shape:
{{"suggestions": [{{"label": "<exact topic from the list above>", "reason": "<specific reason>"}}]}}"""

    try:
        resp = requests.post(
            f'{LLM_BASE_URL}/chat/completions',
            headers={'Authorization': f'Bearer {LLM_API_KEY}', 'Content-Type': 'application/json'},
            json={
                'model': LLM_MODEL,
                'messages': [{'role': 'user', 'content': prompt}],
                'temperature': 0.7,
                'max_tokens': 800,
            },
            timeout=20,
        )
        resp.raise_for_status()
        content = resp.json()['choices'][0]['message']['content'].strip()
        if content.startswith('```'):
            content = content.strip('`')
            if content.lower().startswith('json'):
                content = content[4:]
        raw_suggestions = json.loads(content).get('suggestions', [])
    except Exception as e:
        print('LLM recommend error:', e)
        return None

    valid_labels = set(candidates)
    results = []
    for item in raw_suggestions[:topk]:
        label = (item or {}).get('label')
        reason = (item or {}).get('reason', '').strip()
        if label not in valid_labels or not reason:
            continue  # skip hallucinated topics or empty reasons
        meta = concept_lookup.get(label)
        if not meta:
            continue
        if question == 'builds_on':
            source, target = label, selected_label
        else:
            source, target = selected_label, label
        results.append({
            'label': label,
            'meta': meta,
            'source': source,
            'target': target,
            'relationship': RELATIONSHIP_LABEL[question],
            'reason': reason,
        })
    return results

@app.route('/')
def index():
    return app.send_static_file('index.html')

@app.route('/recommend', methods=['POST'])
def recommend():
    try:
        data = request.get_json()
        nodes = data.get('nodes', [])
        selected = data.get('selected_node', {})
        question = data.get('question', 'related')
        exclude = data.get('exclude', [])
        if question not in RELATIONSHIP_LABEL:
            question = 'related'

        used_labels = set(n['label'] for n in nodes) | set(exclude)
        selected_label = selected.get('label', '')
        selected_meta = selected.get('meta', {})
        grade, unit = resolved_meta(selected_label, selected_meta)

        suggestions = llm_relationship_suggestions(selected_label, grade, unit, used_labels, question, topk=3)
        if suggestions is None:
            # Not configured, or the call/parse failed - the heuristic is
            # the whole feature in that case, not just a backfill.
            suggestions = relationship_suggestions(selected_label, selected_meta, used_labels, question, topk=3)
        elif len(suggestions) < 3:
            # Model returned fewer than asked (or some got filtered for
            # naming a topic outside the candidate list) - top up rather
            # than short the student a suggestion.
            backfill_used = used_labels | set(s['label'] for s in suggestions)
            suggestions += relationship_suggestions(selected_label, selected_meta, backfill_used, question, topk=3 - len(suggestions))

        return jsonify({'suggestions': suggestions})
    except Exception as e:
        print("Error in /recommend:", e)
        return jsonify({'suggestions': []})

if __name__ == '__main__':
    app.run(debug=True)
