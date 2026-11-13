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
with open(os.path.join(BASE_DIR, 'static', 'prerequisites.json'), encoding='utf-8') as f:
    prerequisite_graph = json.load(f)

ALIASES = prerequisite_graph.get('aliases', {})

def canonical_label(label):
    return ALIASES.get(label, label)

def graph_edges_for(label, meta, question):
    """Only authored direct edges can establish dependency direction."""
    original_label = label
    label = canonical_label(label)
    anchor_side = 'target' if question == 'builds_on' else 'source'
    for edge in prerequisite_graph['edges']:
        anchor = edge[anchor_side]
        if canonical_label(anchor['label']) != label:
            continue
        # Historical aliases may have moved grades. Canonical catalog
        # labels still require their grade/unit when the caller supplies it.
        if original_label == label:
            if meta.get('grade') and meta['grade'] != anchor['grade']:
                continue
            if meta.get('unit') and meta['unit'] != anchor['unit']:
                continue
        yield edge

# --- Build fast lookup: topic -> {grade, unit}
concept_lookup = {}
curriculum_topics = []
for grade, units in curriculum.items():
    for unit, topics in units.items():
        for topic in topics:
            if topic not in concept_lookup:
                concept_lookup[topic] = {'grade': grade, 'unit': unit, 'conceptId': 'math:' + re.sub(r'[^a-z0-9]+', '-', topic.lower()).strip('-')}
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
# a bare "add this topic." Curriculum topic order within a unit
# is NOT prerequisite evidence. Authored graph edges determine direction; related pulls
# same-unit topics that are neither, ranked by word-overlap to the anchor.
REASON_TEMPLATES = {
    'builds_on': [
        "{a} is what {b} builds on directly - it lays the groundwork.",
        "Getting {a} solid first is usually what makes {b} click.",
        "{b} assumes {a} as a starting point.",
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
    used = {canonical_label(label) for label in used_labels}
    if question in ('builds_on', 'leads_to'):
        # Curriculum list order and word overlap are not evidence of a
        # prerequisite. Return fewer results when the authored graph ends.
        results = []
        seen = set()
        suggestion_side = 'source' if question == 'builds_on' else 'target'
        for edge in graph_edges_for(selected_label, selected_meta, question):
            endpoint = edge[suggestion_side]
            label = endpoint['label']
            if label in used or label in seen:
                continue
            seen.add(label)
            source = label if question == 'builds_on' else selected_label
            target = selected_label if question == 'builds_on' else label
            results.append({
                'label': label,
                'meta': {'grade': endpoint['grade'], 'unit': endpoint['unit'], 'conceptId': endpoint['conceptId']},
                'source': source, 'target': target,
                'relationship': RELATIONSHIP_LABEL[question],
                'reason': edge['reason'],
            })
            if len(results) >= topk:
                break
        return results

    canonical = canonical_label(selected_label)
    grade, unit = resolved_meta(canonical, selected_meta)
    candidates = curriculum.get(grade, {}).get(unit, [])
    candidates = [t for t in candidates if t not in used and t != canonical]
    ranked = semantic_similarity(canonical, candidates, topk=topk)
    return [{
        'label': r['label'], 'meta': {'grade': grade, 'unit': unit, 'conceptId': concept_lookup[r['label']]['conceptId']},
        'source': selected_label, 'target': r['label'],
        'relationship': 'related',
        'reason': build_reason(selected_label, r['label'], 'related'),
    } for r in ranked]

# --- Optional: real-LLM recommendations ---
# Off by default (falls back to the heuristic above) unless at least one
# provider below has an API key set. Written against the OpenAI-compatible
# chat-completions shape that Gemini, Groq, Qwen (DashScope), OpenAI,
# OpenRouter, Together, and most other hosted-model providers all expose,
# so adding/swapping a provider is an env var, not code.
#
# Two slots, tried in order: PRIMARY then FALLBACK, then the heuristic.
# Defaults to Gemini (genuinely free indefinitely, no card - see
# README) as primary and Groq (also free/no-card, very low latency) as
# fallback, so a rate-limit or outage on one doesn't take Explore down to
# the heuristic on its own - both env-configurable if you'd rather use
# something else for either slot.
LLM_PROVIDERS = [
    {
        'name': 'primary',
        'api_key': os.environ.get('LLM_API_KEY'),
        'base_url': os.environ.get('LLM_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta/openai'),
        'model': os.environ.get('LLM_MODEL', 'gemini-2.5-flash'),
    },
    {
        'name': 'fallback',
        'api_key': os.environ.get('LLM_FALLBACK_API_KEY'),
        'base_url': os.environ.get('LLM_FALLBACK_BASE_URL', 'https://api.groq.com/openai/v1'),
        'model': os.environ.get('LLM_FALLBACK_MODEL', 'openai/gpt-oss-120b'),
    },
]

QUESTION_PROMPTS = {
    'builds_on': 'What does this concept build on? The student wants likely PREREQUISITES - concepts that should come before this one and that this one depends on.',
    'leads_to': 'What does this concept lead to? The student wants likely SUCCESSORS - concepts that build on this one as a foundation.',
    'related': "What else is related? The student wants useful SIDEWAYS connections - concepts that share ideas with this one but aren't a strict prerequisite or successor.",
}

def _call_llm_provider(provider, selected_label, where, question, candidates, topk):
    """One provider, one attempt. Returns a raw suggestions list, or raises
    on any failure (network, auth, malformed JSON) - the caller decides
    what "failure" means (try the next provider, then the heuristic)."""
    prompt = f"""You are a math curriculum expert helping a student explore how concepts connect, inside a concept-mapping tool. The student is looking at "{selected_label}"{where}.

They asked: {QUESTION_PROMPTS.get(question, QUESTION_PROMPTS['related'])}

Choose up to {topk} suggestions ONLY from this list of real curriculum topics - do not invent a topic that isn't in this list:
{json.dumps(candidates, ensure_ascii=False)}

For each suggestion, write a specific, non-generic reason (1-2 sentences) that names the actual mathematical or cognitive mechanism connecting the two concepts - not a template phrase like "X is what Y builds on." Help the student understand WHY the connection matters, not just THAT it exists.

Respond with ONLY valid JSON, no markdown fences, no commentary, in exactly this shape:
{{"suggestions": [{{"label": "<exact topic from the list above>", "reason": "<specific reason>"}}]}}"""

    resp = requests.post(
        f"{provider['base_url']}/chat/completions",
        headers={'Authorization': f"Bearer {provider['api_key']}", 'Content-Type': 'application/json'},
        json={
            'model': provider['model'],
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
    return json.loads(content).get('suggestions', [])

def llm_relationship_suggestions(selected_label, grade, unit, used_labels, question, topk=3):
    """Returns a list of suggestions on success, [] if every configured
    provider returned nothing usable, or None if nothing is configured at
    all - the caller distinguishes None (fall back entirely) from a short
    list (top up with the heuristic) so a flaky API call degrades
    gracefully instead of breaking Explore."""
    if question != 'related':
        return None
    configured = [p for p in LLM_PROVIDERS if p['api_key']]
    if not configured:
        return None
    if grade and unit and unit in curriculum.get(grade, {}):
        candidates = [t for t in curriculum[grade][unit] if t not in used_labels and t != selected_label]
    else:
        candidates = [t for t in curriculum_topics if t not in used_labels and t != selected_label]
    if not candidates:
        return []

    where = f' ({grade}, {unit})' if grade and unit else ''
    raw_suggestions = []
    for provider in configured:
        try:
            raw_suggestions = _call_llm_provider(provider, selected_label, where, question, candidates, topk)
            break
        except Exception as e:
            print(f"LLM recommend error ({provider['name']}, {provider['model']}):", e)
            continue
    else:
        return None  # every configured provider failed

    valid_labels = set(candidates)
    results = []
    for item in raw_suggestions[:topk]:
        label = (item or {}).get('label')
        reason = (item or {}).get('reason', '').strip()
        if label not in valid_labels or not reason:
            continue  # skip hallucinated topics or empty reasons
        meta = concept_lookup.get(label)
        if meta and label in curriculum.get(grade, {}).get(unit, []):
            meta = {**meta, 'grade': grade, 'unit': unit}
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

        used_labels = {canonical_label(n['label']) for n in nodes} | {canonical_label(label) for label in exclude}
        selected_label = canonical_label(selected.get('label', ''))
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
