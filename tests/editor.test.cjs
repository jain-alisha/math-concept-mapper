const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
function app() {
  const elements = new Map();
  const el = () => ({style:{},replaceChildren(){},getBoundingClientRect(){return {width:100,height:54,left:0,top:0}},getBBox(){return {width:this.textContent?.length*8 || 0}},setAttribute(){},getAttribute(){return '14px'},appendChild(){},classList:{remove(){}}});
  const document = { addEventListener(){}, body:el(), getElementById(id){if(!elements.has(id)) elements.set(id,el());return elements.get(id)}, createElementNS:el};
  const c = vm.createContext({document, window:{addEventListener(){}}, console, TextEncoder, TextDecoder, Set,Map, fetch(){throw new Error('Directional recommendations must not use network')}, localStorage:{getItem(){return null},setItem(){}}, clearTimeout, setTimeout});
  vm.runInContext(fs.readFileSync(path.join(root,'static/app.js'),'utf8'),c);
  vm.runInContext('prerequisiteData = '+fs.readFileSync(path.join(root,'static/prerequisites.json'),'utf8'),c);
  return c;
}
test('search finds breaking and non-breaking hyphens, case and compatibility characters',()=>{
  const c=app();
  assert.equal(c.normalizeSearch('Evaluate multi\u2011variable expressions'), c.normalizeSearch('EVALUATE multi-variable expressions'));
});
test('client graph returns disjoint Mixed numbers directions without calling backend',async()=>{
  const c=app();
  const before=await c.requestSuggestions({label:'Mixed numbers',meta:{}},'builds_on',new Set());
  const after=await c.requestSuggestions({label:'Mixed numbers',meta:{}},'leads_to',new Set());
  assert.ok(before.length); assert.ok(after.length);
  const more=await c.requestSuggestions({label:'Mixed numbers',meta:{}},'leads_to',new Set(after.map(s=>s.label)));
  assert.ok([...after,...more].some(s=>s.label==='Multiply mixed numbers'));
  assert.ok(before.every(s=>s.target==='Mixed numbers'));
  assert.ok(after.every(s=>s.source==='Mixed numbers'));
  assert.ok(!before.some(s=>after.some(t=>t.label===s.label)));
  assert.equal((await c.requestSuggestions({label:'An unknown concept',meta:{}},'builds_on',new Set())).length,0);
});
test('more suggestions append, exclude shown items and preserve prior positions',async()=>{
  const c=app();
  vm.runInContext(`renderCanvas=()=>{}; nodes=[]; const anchor={label:'Mixed numbers',meta:{}}; ghostState={node:anchor,question:'leads_to',shownLabels:new Set(),suggestions:[],loading:false};`,c);
  await c.showMoreSuggestions();
  const first=vm.runInContext('ghostState.suggestions.map(s=>s.label)',c);
  await c.showMoreSuggestions();
  const all=vm.runInContext('ghostState.suggestions.map(s=>s.label)',c);
  assert.deepEqual(Array.from(all.slice(0,first.length)),Array.from(first));
  assert.equal(new Set(all).size,all.length);
});
test('new concept placement avoids nodes, suggestion boxes and real link curves',()=>{
  const c=app();
  vm.runInContext(`nodes=[{id:1,label:'A',x:10,y:100},{id:2,label:'B',x:510,y:100}]; links=[{source:1,target:2}];`,c);
  assert.equal(c.nodePositionIsClear('Mixed numbers',220,100),false);
  const pos=c.findOpenNodePosition('Mixed numbers',{x:220,y:100});
  assert.equal(c.nodePositionIsClear('Mixed numbers',pos.x,pos.y),true);
  vm.runInContext(`ghostState={suggestions:[{label:'Ghost',_pos:{x:220,y:300}}]}`,c);
  assert.equal(c.nodePositionIsClear('Mixed numbers',220,300),false);
});
test('explain my map names real concepts and notes even when custom nodes are all linked',()=>{
  const c=app();
  const result=c.computeMapSummary([{id:1,label:'Fractions'},{id:2,label:'Equal parts'}],[{source:1,target:2,note:'The denominator counts equal parts.'}]);
  assert.match(result.text,/Fractions.*Equal parts/);
  assert.match(result.text,/denominator counts equal parts/);
  assert.match(result.text,/1 of 1 connections have explanations/);
  assert.doesNotMatch(result.text,/fully connected/);
});
test('read-only guard prevents undo, redo, clear, mutation and cloud saves',async()=>{
  const c=app();
  vm.runInContext(`isReadonly=true; nodes=[{id:1,label:'Original',x:0,y:0}]; cloudMapId='student-map'; cloudSession={}; window.SpanAuth={isConfigured:true,saveMap(){throw new Error('must not write')}}`,c);
  c.undo();c.redo();c.addNode('Forbidden',100,100);await c.clearMap();await c.flushCloudSave();
  assert.equal(vm.runInContext('nodes.length',c),1);
  assert.equal(vm.runInContext('nodes[0].label',c),'Original');
});
