import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
const code = fs.readFileSync('static/auto-layout.js','utf8');
const context = vm.createContext({window:{}}); vm.runInContext(code,context);
const arrange = (n,e,options={}) => Array.from(context.window.SpanAutoLayout.arrange(n,e,l=>Math.min(260,l.length*9+40),options),p=>({...p}));
const node = (id,label='Concept '+id) => ({id,label,x:-20,y:-10,meta:{custom:true}});
const edge = (source,target,relType='') => ({source,target,relType,note:'Keep this explanation.'});
function assertClear(positions,nodes) {
  for (const p of positions) { assert.ok(Number.isFinite(p.x)&&p.x>=0);assert.ok(Number.isFinite(p.y)&&p.y>=0); }
  const widths=new Map(nodes.map(n=>[n.id,Math.min(260,n.label.length*9+40)]));
  for(let i=0;i<positions.length;i++)for(let j=i+1;j<positions.length;j++) {
    const a=positions[i],b=positions[j];
    assert.ok(a.x+widths.get(a.id)<=b.x || b.x+widths.get(b.id)<=a.x || a.y+54<=b.y || b.y+54<=a.y,`Nodes ${a.id} and ${b.id} overlap`);
  }
}
test('a branching map follows arrow direction and leaves room for long labels',()=>{
  const n=[node(1),node(2,'A long custom concept label that wraps'),node(3),node(4)];
  const e=[edge(1,2),edge(1,3),edge(2,4),edge(3,4)];const before=JSON.stringify([n,e]);
  const p=arrange(n,e);const byId=new Map(p.map(p=>[p.id,p]));
  for(const l of e)assert.ok(byId.get(l.source).y<byId.get(l.target).y);
  assertClear(p,n);assert.equal(JSON.stringify([n,e]),before);
});
test('cycles, reciprocal arrows, isolated concepts and narrow canvases remain usable',()=>{
  const n=Array.from({length:14},(_,i)=>node(i));
  const e=[edge(0,1),edge(1,2),edge(2,0),edge(2,3),edge(3,4),edge(4,3),edge(8,9,'related'),edge(9,10,'example'),edge(10,11,'representation'),edge(99,0)];
  const p=arrange(n,e,{width:390});assert.equal(p.length,n.length);assertClear(p,n);
  assert.deepEqual(arrange(n,e,{width:390}),p);
  const second=arrange(n.map((n,i)=>({...n,x:p[i].x,y:p[i].y})),e,{width:390});assert.deepEqual(second,p);
});
test('related arrows retain their direction and meaning while arranging positions',()=>{
  const n=[node(1),node(2)],e=[edge(1,2,'related')],p=arrange(n,e);assert.ok(p[0].y<p[1].y);assert.equal(e[0].relType,'related');
  assert.deepEqual(arrange([],[]),[]);assert.equal(arrange([node(1)],[]).length,1);
});
test('large directed maps do not recurse indefinitely or lose nodes',()=>{
  const n=Array.from({length:1800},(_,i)=>node(i));const e=n.slice(1).map((_,i)=>edge(i,i+1));e.push(edge(1799,1700));
  const p=arrange(n,e);assert.equal(new Set(p.map(p=>p.id)).size,1800);assert.ok(p.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
});
test('Auto-layout is one undoable, saved position-only edit and cannot modify read-only maps',()=>{
  const dom=new JSDOM(fs.readFileSync('static/playground.html','utf8'),{url:'https://spanmath.org/playground?sample=1',runScripts:'outside-only'});
  const w=dom.window;w.document.addEventListener=()=>{};
  const run=s=>vm.runInContext(s,dom.getInternalVMContext());run(code);run(fs.readFileSync('static/app.js','utf8'));w.onload=null;
  run("getNodeWidth=label=>label.length*9+40;renderCanvas=()=>{};renderNotesSidebar=()=>{};fitMap=()=>{};nodes=[{id:1,label:'Unit fraction',x:500,y:400,meta:{custom:true}},{id:2,label:'Number line',x:100,y:30,meta:{}}];links=[{id:1,source:1,target:2,note:'One step is one unit fraction.',relType:''}];resetHistory();");
  const original=run('JSON.stringify(serializeMap())');w.setupAutoLayoutButton();w.document.getElementById('autoLayoutBtn').disabled=false;w.document.getElementById('autoLayoutBtn').click();
  const changed=run('JSON.stringify(serializeMap())');assert.notEqual(changed,original);
  assert.equal(run('nodes[0].y<nodes[1].y'),true);assert.equal(run('historyStack.length'),2);
  const saved=JSON.parse(w.localStorage.getItem('spanConceptMap:sample'));delete saved._cloudUpdatedAt;
  assert.equal(JSON.stringify(saved),changed);
  assert.equal(run('links[0].note'),'One step is one unit fraction.');assert.equal(run('nodes[0].meta.custom'),true);
  w.autoLayoutMap();assert.equal(run('historyStack.length'),2);
  w.undo();assert.equal(run('JSON.stringify(serializeMap())'),original);
  w.redo();assert.equal(run('JSON.stringify(serializeMap())'),changed);
  run('isReadonly=true');w.autoLayoutMap();assert.equal(run('JSON.stringify(serializeMap())'),changed);
  w.applyReadonlyUI();assert.equal(w.document.getElementById('autoLayoutBtn').hidden,true);dom.window.close();
});
