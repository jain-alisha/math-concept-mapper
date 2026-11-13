import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import vm from 'vm';
const c=vm.createContext({window:{}});
vm.runInContext(fs.readFileSync('static/concept-bank.js','utf8'),c);
const bank=c.window.SpanConceptBank;
const catalog=JSON.parse(fs.readFileSync('static/concepts.json','utf8'));
const alignment=JSON.parse(fs.readFileSync('data/concept-alignment.json','utf8'));
test('every historical skill resolves to its authored concept identity and retains alignment metadata',()=>{
  assert.equal(Object.keys(alignment.legacyQualified).length,625);
  for(const [key,id] of Object.entries(alignment.legacyQualified)){
    const [grade,unit,label]=key.split('::');const concept=bank.resolve(label,{grade,unit});
    assert.equal(concept.id,id,key);assert.ok(concept.alignments.some(a=>a.grade===grade&&a.unit===unit&&a.sourceSkill===label));
  }
});
test('picker labels are short concept nouns and never task prompts',()=>{
  for(const units of Object.values(catalog))for(const labels of Object.values(units)){
    assert.equal(labels.length,new Set(labels).size);
    for(const label of labels){
      assert.ok(label.length<=36,label);
      assert.doesNotMatch(label,/^(solve|write|recognize|calculate|understand|identify|create|compare|use|apply|convert|find|evaluate|plot|interpret|draw|measure|generate|simplify|perform|explain)\b/i);
      assert.doesNotMatch(label,/word problems|practice/i);assert.ok(bank.resolve(label),label);
    }
  }
});
test('old shared maps get concept labels and ids without changing arrows, notes, positions or source data',()=>{
  const original={n:[{i:1,l:'Understand a unit fraction (1/b)',x:20,y:30,m:{grade:'3rd Grade Math',unit:'Number & Operations—Fractions'}},{i:2,l:'My own idea',x:70,y:90}],e:[{i:3,s:1,t:2,no:'One of five equal parts is 1/5.'}]};
  const normalized=bank.map(original);assert.equal(normalized.n[0].l,'Unit fraction');assert.equal(normalized.n[0].m.conceptId,'math:unit-fraction');
  assert.equal(normalized.n[0].x,20);assert.equal(normalized.n[1].l,'My own idea');assert.equal(normalized.e[0].no,original.e[0].no);
  assert.equal(original.n[0].l,'Understand a unit fraction (1/b)');assert.equal(original.n[0].m.conceptId,undefined);
});
test('legacy activity and taught-topic keys use the same short labels as saved maps',()=>{
  const key='3rd Grade Math::Number & Operations—Fractions::Understand a unit fraction (1/b)';
  const expected='3rd Grade Math::Number & Operations—Fractions::Unit fraction';
  assert.equal(bank.activity({concepts:[key,expected]}).concepts.length,1);
  assert.equal(bank.activity({concepts:[key]}).concepts[0],expected);
  assert.equal(bank.classRow({taught_topics:[key]}).taught_topics[0],expected);
});
test('reviewed concept relationships have valid identities and no collapsed self-dependencies',()=>{
  const graph=JSON.parse(fs.readFileSync('static/prerequisites.json','utf8'));
  for(const edge of graph.edges){
    for(const side of ['source','target']){
      const p=edge[side];assert.ok(catalog[p.grade][p.unit].includes(p.label),p.label);assert.equal(bank.resolve(p.label).id,p.conceptId);
    }
    assert.notEqual(edge.source.conceptId,edge.target.conceptId);
  }
});
