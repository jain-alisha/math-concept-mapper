import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
const turn=()=>new Promise(resolve=>setTimeout(resolve,0));
function fixture(file='app.js', html=fs.readFileSync('static/playground.html','utf8')) {
  const dom=new JSDOM(html,{url:'https://spanmath.org/playground',runScripts:'outside-only'});
  const w=dom.window;
  w.document.addEventListener=()=>{};
  const run=code=>vm.runInContext(code,dom.getInternalVMContext());
  run(fs.readFileSync('static/concept-bank.js','utf8'));
  run(fs.readFileSync('static/'+file,'utf8'));
  w.onload=null;
  w.SVGElement.prototype.getBBox=function(){return {width:this.textContent.length*9,height:18};};
  return {dom,w,d:w.document,run};
}
test('sample edits and reloads leave an unrelated unsaved draft intact',()=>{
  const {dom,w,run}=fixture();
  run("renderNotesSidebar=()=>{};nodes=[{id:1,label:'Original unsaved idea',x:20,y:20}];autosave();");
  const original=w.localStorage.getItem('spanConceptMap');
  w.history.replaceState(null,'','/playground?sample=1');
  run("nodes=[{id:1,label:'Sample edit',x:50,y:40}];autosave();nodes=[];");
  assert.equal(w.loadAutosave(),true);assert.equal(run('nodes[0].label'),'Sample edit');
  assert.equal(w.localStorage.getItem('spanConceptMap'),original);
  w.history.replaceState(null,'','/playground');
  run('nodes=[]');assert.equal(w.loadAutosave(),true);
  assert.equal(run('nodes[0].label'),'Original unsaved idea');
  dom.window.close();
});
test('catalogue duplicate protection resolves legacy nodes with no stored id',async()=>{
  const {dom,w,run}=fixture();
  run("nodes=[{id:1,label:'Equivalent fractions',x:30,y:30,meta:{}}];renderCanvas=()=>{};window.confirmations=0;showConfirmDialog=async()=>{window.confirmations++;return false};");
  await w.addCatalogConcept('Equivalent fractions',{grade:'3rd Grade Math',unit:'Number & Operations—Fractions'});
  assert.equal(w.confirmations,1);assert.equal(run('nodes.length'),1);
  assert.equal(run('selectedNode.id'),1);dom.window.close();
});
test('cross-grade discussion rules merge by concept identity and retain taught alignments',()=>{
  const {dom,w,run}=fixture('dashboard.js','<main></main>');
  run('prerequisiteData='+fs.readFileSync('static/prerequisites.json','utf8'));
  const data={n:[{i:1,l:'Equivalent ratios',m:{grade:'6th Grade Math',unit:'Ratios & Proportional Relationships'}},{i:2,l:'Ratio table',m:{grade:'6th Grade Math',unit:'Ratios & Proportional Relationships'}}],e:[]};
  const maps=[{owner_id:'one',data},{owner_id:'two',data}];
  const rows=w.computeMissingPrereqs(maps,{},new Set(['6th Grade Math::Ratios & Proportional Relationships::Equivalent ratios'])).filter(r=>r.prereq==='Equivalent ratios'&&r.topic==='Ratio table');
  assert.equal(rows.length,1);assert.equal(rows[0].count,2);assert.equal(rows[0].taught,true);
  dom.window.close();
});
test('a bare arrow supports keyboard explanation entry and read-only access',()=>{
  const {dom,w,d,run}=fixture();
  run("nodes=[{id:1,label:'Fraction',x:40,y:80,meta:{}},{id:2,label:'Number line',x:300,y:140,meta:{}}];links=[{id:1,source:1,target:2,note:''}];showNoteEditor=(link,cb)=>cb('Three equal steps locate 3/4.');renderCanvas();");
  const path=d.querySelector('path[data-link-id="1"]');
  assert.equal(path.getAttribute('tabindex'),'0');assert.equal(path.getAttribute('role'),'button');
  path.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  assert.equal(run('links[0].note'),'Three equal steps locate 3/4.');
  run("isReadonly=true;window.readNote='';showAlertDialog=note=>window.readNote=note;renderCanvas();");
  d.querySelector('path[data-link-id="1"]').dispatchEvent(new w.KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true}));
  assert.equal(w.readNote,'Three equal steps locate 3/4.');
  assert.equal(run('links[0].note'),'Three equal steps locate 3/4.');dom.window.close();
});
test('timeline names are buttons and expanding works again after reopening',async()=>{
  const {dom,w,d,run}=fixture();
  w.SpanAuth={isConfigured:true,getSession:async()=>({user:{id:'me',email:'qa@example.com'}}),role:()=> 'student',onAuthStateChange(){},listMyTimelines:async()=>[{id:'growth',name:'Fractions growth'}],listTimelineMaps:async()=>[{title:'Start',created_at:'2026-11-15',data:{n:[],e:[]}}]};
  run('setupAuthUI()');await turn();d.getElementById('timelineBtn').click();await turn();
  const opener=[...d.querySelectorAll('#timelineList button')].find(b=>b.textContent==='Fractions growth');assert.ok(opener);
  opener.click();await turn();d.getElementById('timelineExpandBtn').click();
  assert.equal(d.getElementById('timelinePanel').style.display,'flex');
  d.getElementById('timelineBtn').click();d.getElementById('timelineBtn').click();await turn();
  assert.equal(d.getElementById('timelinePanel').style.display,'block');
  [...d.querySelectorAll('#timelineList button')].find(b=>b.textContent==='Fractions growth').click();await turn();
  d.getElementById('timelineExpandBtn').click();
  assert.equal(d.getElementById('timelinePanel').style.display,'flex');dom.window.close();
});
test('phone legends live inside a collapsed disclosure and move back on desktop',()=>{
  const {dom,w,d}=fixture();w.innerWidth=390;w.positionMapLegends();
  assert.equal(d.getElementById('mapHints').hidden,false);assert.equal(d.getElementById('mapHints').open,false);
  for(const id of ['isolatedLegend','aiAddedLegend','arrowLegend'])assert.equal(d.getElementById(id).parentElement.id,'mapHintsBody');
  d.getElementById('mapHints').open=true;w.positionMapLegends();assert.equal(d.getElementById('mapHints').open,true);
  w.innerWidth=1470;w.positionMapLegends();assert.equal(d.getElementById('mapHints').hidden,true);assert.equal(d.getElementById('arrowLegend').parentElement.id,'canvasArea');dom.window.close();
});
test('teacher scope note explains history and changes with the activity filter',async()=>{
  const {dom,w,d}=fixture('dashboard.js','<main></main>');
  w.renderClassDashboard(d.querySelector('main'),{id:'sample-class'},[],[],[],{},m=>'/map/'+m.id,async()=>{},null,'QA',{list:async()=>[{id:'a',name:'Fractions',concepts:[]}]});
  await turn();assert.match(d.querySelector('.dash-scope-note').textContent,/Historical overview.*older submissions.*Previews show the latest/);
  const select=d.querySelector('[aria-label="Activity filter"]');select.value='a';select.dispatchEvent(new w.Event('change'));
  assert.match(d.querySelector('.dash-scope-note').textContent,/Latest submission per student.*same submissions/);dom.window.close();
});
test('reviewed fraction-related ideas include specific mathematics without a backend',async()=>{
  const {dom,w,run}=fixture();run('relatedData='+fs.readFileSync('static/related-connections.json','utf8'));
  w.fetch=()=>{throw new Error('Reviewed suggestions should be local');};
  const rows=await w.requestSuggestions({label:'Equivalent fractions',meta:{}},'related',new Set());
  assert.deepEqual(Array.from(rows,r=>r.label),['Denominator','Numerator','Whole']);
  assert.ok(rows.every(r=>r.basis==='reviewed'&&/2\/3/.test(r.reason)));
  assert.equal((await w.requestSuggestions({label:'Equivalent fractions',meta:{}},'related',new Set(['Denominator']))).some(r=>r.label==='Denominator'),false);
  dom.window.close();
});
