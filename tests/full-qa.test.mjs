import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';

const turn = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture(file = 'app.js', html = '<svg id="mapCanvas"></svg>') {
  const dom = new JSDOM(html, {url:'https://spanmath.org/playground',runScripts:'outside-only'});
  const w = dom.window;
  w.document.addEventListener = () => {};
  vm.runInContext(fs.readFileSync('static/'+file,'utf8'),dom.getInternalVMContext());
  w.onload = null;
  return {dom,w,d:w.document,run:code=>vm.runInContext(code,dom.getInternalVMContext())};
}

test('full editor render retains the visible node hit target with a wrapped label', () => {
  const {dom,w,d,run} = fixture('app.js',fs.readFileSync('static/playground.html','utf8'));
  w.SVGElement.prototype.getBBox = function() { return {width:this.textContent.length*9,height:18}; };
  run("nodes=[{id:1,label:'A longer custom mathematical idea with several readable words',x:40,y:40,meta:{}}];links=[];renderCanvas();");
  const node=d.querySelector('[data-node-id="1"]');
  assert.ok(node.querySelector('rect.node'));
  assert.equal(typeof node.querySelector('rect.node').onclick,'function');
  assert.equal(node.querySelectorAll('text.node-label tspan').length,2);
  assert.match(node.getAttribute('aria-label'),/A longer custom mathematical idea/);
  dom.window.close();
});

test('Why renders relationship names and explanations safely as text', () => {
  const {dom,w,d} = fixture('app.js','<svg id="mapCanvas"></svg><div id="ghostReasonPopover"></div>');
  w.showGhostReason({source:'<img src=x>',target:'Number line',relationship:'prerequisite',reason:'Equal steps measure units.'},{left:100,bottom:50});
  assert.equal(d.querySelector('img'),null);
  assert.match(d.body.textContent,/<img src=x> → Number line/);
  assert.match(d.body.textContent,/Equal steps measure units/);
  d.getElementById('closeReasonBtn').click();
  assert.equal(d.getElementById('ghostReasonPopover').style.display,'none');
  dom.window.close();
});

test('cloud save and reopen retain the edit URL and matching title', async () => {
  const {dom,w,d,run} = fixture('app.js','<svg id="mapCanvas"></svg><input id="mapTitleInput"><span id="openMapTitle"></span>');
  w.history.replaceState(null,'','/playground?share=old&sample=1');
  w.SpanAuth={saveMap:async()=>({row:{id:'working',title:'Working copy',updated_at:'v1'}})};
  run('renderCanvas=()=>{};renderNotesSidebar=()=>{};resetHistory=()=>{};');
  await w.saveCurrentMapAsNew('Working copy',null);
  assert.equal(new URL(w.location.href).search,'?edit=working');
  assert.equal(d.getElementById('mapTitleInput').value,'Working copy');
  w.SpanAuth.loadMapById=async()=>({id:'another',owner_id:'me',title:'Second map',updated_at:'v2',data:{n:[],e:[]}});
  w.SpanAuth.getSession=async()=>({user:{id:'me'}});
  run('applyAiToolsGate=()=>{}');
  await w.loadCloudMap('another');
  assert.equal(new URL(w.location.href).searchParams.get('edit'),'another');
  assert.equal(d.getElementById('mapTitleInput').value,'Second map');
  dom.window.close();
});

test('activity drafts cannot inherit the general draft or another assignment', () => {
  const {dom,w,run} = fixture();
  run('renderNotesSidebar=()=>{}');
  w.localStorage.setItem('spanConceptMap',JSON.stringify({n:[{i:1,l:'Unrelated'}],e:[]}));
  w.history.replaceState(null,'','/playground?activity=a');
  assert.equal(w.loadAutosave(),false);
  run("nodes=[{id:2,label:'Assignment A',x:10,y:10}];autosave();nodes=[];");
  w.history.replaceState(null,'','/playground?activity=b');
  assert.equal(w.loadAutosave(),false);
  w.history.replaceState(null,'','/playground?activity=a');
  assert.equal(w.loadAutosave(),true);
  assert.equal(run('nodes[0].label'),'Assignment A');
  dom.window.close();
});

test('unsent draft recovers only against the same cloud revision', async () => {
  const {dom,w,run} = fixture('app.js','<svg id="mapCanvas"></svg><span id="saveStatusBadge"></span>');
  run('renderCanvas=()=>{};renderNotesSidebar=()=>{};resetHistory=()=>{};applyAiToolsGate=()=>{};showCloudNotice=()=>{};');
  w.SpanAuth={getSession:async()=>({user:{id:'me'}}),loadMapById:async()=>({id:'mine',owner_id:'me',title:'Mine',updated_at:'v1',data:{n:[],e:[]}})};
  w.localStorage.setItem('spanConceptMap:map:mine',JSON.stringify({n:[{i:1,l:'Recovered',x:10,y:10}],e:[],_cloudUpdatedAt:'v1'}));
  await w.loadCloudMap('mine');
  assert.equal(run('nodes[0].label'),'Recovered');
  w.SpanAuth.loadMapById=async()=>({id:'mine',owner_id:'me',title:'Mine',updated_at:'newer',data:{n:[],e:[]}});
  await w.loadCloudMap('mine');
  assert.equal(run('nodes.length'),0);
  dom.window.close();
});

test('zoomed pointer movement keeps logical node coordinates', () => {
  const {dom,w,d,run} = fixture();
  d.getElementById('mapCanvas').getBoundingClientRect=()=>({left:100,top:80});
  run('canvasScale=0.5;updateNodePosition=()=>{};dragInfo={node:{x:0,y:0},offsetX:10,offsetY:20};');
  w.dragNodeMove({clientX:200,clientY:180});
  assert.equal(run('dragInfo.node.x'),190);
  assert.equal(run('dragInfo.node.y'),180);
  dom.window.close();
});

test('catalogue works by keyboard and reuses a duplicate when declined', async () => {
  const {dom,w,d,run} = fixture();
  run('window.added=0;findOpenNodePosition=()=>({x:50,y:50});revealNewNode=()=>{};addNode=()=>{window.added++};renderCanvas=()=>{};showConfirmDialog=async()=>false;');
  const li=w.makeDraggableTopicLi('Grade3','Fractions','Unit fraction');
  d.body.appendChild(li);
  li.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  await turn();assert.equal(w.added,1);
  run("nodes=[{id:1,label:'Unit fraction'}];");
  li.click();await turn();assert.equal(w.added,1);
  assert.equal(run('selectedNode.id'),1);
  dom.window.close();
});

test('taught topics can be selected before a single student submits', async () => {
  const {dom,w,d} = fixture('dashboard.js','<main></main>');
  let saved;
  w.renderTaughtTopicsChecklist(d.querySelector('main'),{id:'sample-class'},[],{Grade3:{Fractions:['Unit fraction']}},()=>{},async(id,topics)=>{saved=topics;});
  const cb=d.querySelector('input[type=checkbox]');assert.ok(cb);cb.checked=true;
  d.querySelector('.taught-save-btn').click();await turn();
  assert.deepEqual(Array.from(saved),['Grade3::Fractions::Unit fraction']);
  dom.window.close();
});

test('existing activity review edits its concept bank and help setting', async () => {
  const {dom,w,d} = fixture('dashboard.js','<main></main>');
  let updated;
  w.renderActivitiesCard(d.querySelector('main'),{id:'sample-class'},{Grade3:{Fractions:['Unit fraction','Number line']}},{
    list:async()=>[{id:'a',name:'Fractions',concepts:['Grade3::Fractions::Unit fraction'],ai_disabled:true}],
    update:async(id,name,concepts,disabled)=>{updated={id,name,concepts,ai_disabled:disabled};return updated;},
  },()=>{});
  await turn();const select=d.querySelector('[aria-label="Activity filter"]');select.value='a';select.dispatchEvent(new w.Event('change'));
  [...d.querySelectorAll('button')].find(b=>b.textContent==='Review / edit').click();
  const checks=d.querySelectorAll('.activity-concepts input');assert.equal(checks[0].checked,true);checks[1].checked=true;
  d.querySelector('[aria-label="Activity name"]').value='Revised';
  [...d.querySelectorAll('button')].find(b=>b.textContent==='Save changes').click();await turn();
  assert.equal(updated.id,'a');assert.equal(updated.name,'Revised');assert.equal(updated.concepts.length,2);assert.equal(updated.ai_disabled,true);
  assert.match(d.querySelector('main').textContent,/Assigned concepts: Unit fraction; Number line/);
  dom.window.close();
});

test('canonical cross-grade connections remain available without AI', async () => {
  const {dom,w,run} = fixture();
  run('prerequisiteData='+fs.readFileSync('static/prerequisites.json','utf8'));
  const results=await w.requestSuggestions({label:'Equivalent fractions',meta:{grade:'3rd Grade Math',unit:'Number & Operations—Fractions'}},'leads_to',new Set());
  assert.ok(results.length);assert.ok(results.every(s=>s.source==='Equivalent fractions'));
  dom.window.close();
});

test('a failed stale Explore request cannot replace a newer request for the same node', async () => {
  const {dom,w,run} = fixture();
  run('window.pending=[];renderCanvas=()=>{};requestSuggestions=()=>new Promise((resolve,reject)=>window.pending.push({resolve,reject}));window.anchor={label:"Fractions"};');
  const first=run("openExploreQuestion(window.anchor,'related')");
  const second=run("openExploreQuestion(window.anchor,'related')");
  w.pending[0].reject(new Error('Old failure'));
  await first;
  assert.equal(run('ghostState.loading'),true);
  assert.equal(run('ghostState.error'),false);
  w.pending[1].resolve([]);
  await second;
  assert.equal(run('ghostState.loading'),false);
  dom.window.close();
});
