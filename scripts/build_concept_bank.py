"""Build the concept picker and compatibility index from authored alignments."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
source=json.loads((ROOT/'data/concept-alignment.json').read_text())
# Keep curriculum order authored in concepts.json; labels are concept nouns.
index={'concepts':source['concepts'],'legacyQualified':source['legacyQualified'],'aliases':source['aliases']}
js='''/* Generated alignment index; edit data/concept-alignment.json, then run scripts/build_concept_bank.py. */
(function () {
  const index = __INDEX__;
  const byId = new Map(index.concepts.map(c => [c.id,c]));
  const byLabel = new Map(index.concepts.map(c => [c.label.toLocaleLowerCase(),c]));
  function resolve(label, meta={}) {
    if (byId.has(meta.conceptId)) return byId.get(meta.conceptId);
    const qualified=index.legacyQualified[[meta.grade,meta.unit,label].join('::')];
    if (qualified) return byId.get(qualified);
    return byLabel.get((index.aliases[label] || label).toLocaleLowerCase());
  }
  function node(n) {
    const concept=resolve(n.l,n.m || {});
    if (!concept) return {...n,m:{...(n.m || {})}};
    return {...n,l:concept.label,m:{...(n.m || {}),conceptId:concept.id,...(n.l!==concept.label ? {alignmentSkill:n.m?.alignmentSkill || n.l} : {})}};
  }
  function map(data) { return data ? {...data,n:(data.n || []).map(node),e:(data.e || []).map(e=>({...e}))} : {n:[],e:[]}; }
  function row(r) { return {...r,...(r.data ? {data:map(r.data)} : {})}; }
  function activityKey(key) {
    const parts=key.split('::');if(parts.length!==3)return resolve(key)?.label || key;
    const c=resolve(parts[2],{grade:parts[0],unit:parts[1]});
    return c ? parts[0]+'::'+parts[1]+'::'+c.label : key;
  }
  function activity(a) { return {...a,concepts:[...new Set((a.concepts || []).map(activityKey))],...(a.preview_data ? {preview_data:map(a.preview_data)} : {})}; }
  function classRow(c) { return {...c,taught_topics:[...new Set((c.taught_topics || []).map(activityKey))]}; }
  window.SpanConceptBank={resolve,node,map,row,activityKey,activity,classRow,concepts:index.concepts};
})();
'''.replace('__INDEX__',json.dumps(index,ensure_ascii=False,separators=(',',':')))
(ROOT/'static/concept-bank.js').write_text(js)
