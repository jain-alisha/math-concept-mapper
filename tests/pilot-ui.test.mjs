import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
const turn=()=>new Promise(r=>setTimeout(r,0));
function load(file,html='') {
  const dom=new JSDOM(html+'<svg id="mapCanvas"></svg>',{url:'https://spanmath.org',runScripts:'outside-only'});
  const w=dom.window;
  w.document.addEventListener=()=>{};
  vm.runInContext(fs.readFileSync('static/'+file,'utf8'),dom.getInternalVMContext());
  w.onload=null;
  return {dom,w,d:w.document,run:code=>vm.runInContext(code,dom.getInternalVMContext())};
}
test('activity filter scopes thumbnails and roster, including non-submitters; anonymous mode hides account and invite',async()=>{
  const {dom,w,d,run}=load('dashboard.js','<div id="userMenu">Teacher</div><header><h1>Private class</h1><span class="class-code">SECRET</span></header><main></main>');
  w.fixture={roster:[{student_id:'s1',student_display_name:'Ada'},{student_id:'s2',student_display_name:'Lee'}],maps:[{id:'a',owner_id:'s1',title:'Target',activity_id:'target',updated_at:'2026-11-13',data:{n:[],e:[]}},{id:'b',owner_id:'s2',title:'Unrelated',activity_id:'other',data:{n:[],e:[]}}]};
  run(`renderClassDashboard(document.querySelector('main'),{id:'sample-class'},window.fixture.roster,window.fixture.maps,window.fixture.maps,{},m=>'/map/'+m.id,async()=>{},document.querySelector('header'),'Private class',{list:async()=>[{id:'target',name:'Target activity'}]});`);
  await turn();const select=d.querySelector('[aria-label="Activity filter"]');select.value='target';select.dispatchEvent(new w.Event('change'));
  assert.match(d.querySelector('main').textContent,/No submission for this activity/);
  assert.equal(d.querySelector('a[href="/map/b"]'),null);
  assert.equal(d.querySelectorAll('a[href="/map/a"]').length,2);
  d.getElementById('anonymousModeBtn').click();
  assert.equal(d.getElementById('userMenu').hidden,true);assert.equal(d.querySelector('.class-code').hidden,true);
  assert.doesNotMatch(d.querySelector('main').textContent,/Ada|Lee/);
  d.getElementById('anonymousModeBtn').click();assert.equal(d.getElementById('userMenu').hidden,false);dom.window.close();
});
test('concept picker filters grade, unit and Unicode search without losing checked concepts',async()=>{
  const {dom,w,d,run}=load('dashboard.js','<main></main>');
  run(`renderActivitiesCard(document.querySelector('main'),{id:'sample'},{Grade3:{Fractions:['Unit fractions','Equal parts']},Grade6:{Ratios:['Unit rates']}},{list:async()=>[]},()=>{});`);
  await turn();[...d.querySelectorAll('button')].find(b=>b.textContent==='+ New Activity').click();
  const checks=[...d.querySelectorAll('.activity-concepts input')];checks[0].checked=true;checks[0].dispatchEvent(new w.Event('change',{bubbles:true}));
  const grade=d.querySelector('[aria-label="Activity concept grade"]');grade.value='Grade6';grade.dispatchEvent(new w.Event('change'));
  assert.equal(d.querySelector('.taught-unit').hidden,true);assert.equal(checks[0].checked,true);
  assert.match(d.querySelector('[aria-live]').textContent,/1 concept selected: Unit fractions/);
  const search=d.querySelector('input[type="search"]');search.value='absent';search.dispatchEvent(new w.Event('input'));assert.ok([...d.querySelectorAll('.taught-unit')].every(g=>g.hidden));dom.window.close();
});
test('map checker renders custom labels as text and gives the authored directed reason',()=>{
  const {dom,d,run}=load('app.js','<div id="checkMapBody"></div>');
  run(`nodes=[{id:1,label:'<img src=x onerror=alert(1)>'},{id:2,label:'Fractions'},{id:3,label:'Other'}]; links=[{id:1,source:2,target:3}]; prerequisiteData={aliases:{},edges:[{source:{label:nodes[0].label},target:{label:'Fractions',unit:'Numbers'},reason:'Equal parts establish the fraction unit.'}]}; renderCheckMapPanel();`);
  assert.equal(d.querySelector('img'),null);assert.match(d.body.textContent,/Equal parts establish the fraction unit/);assert.doesNotMatch(d.body.textContent,/next to each other|undefined/);dom.window.close();
});
test('PDF appendix preserves long Unicode explanations across pages',()=>{
  const {dom,d,run}=load('app.js');const rendered=[];let pages=0;
  const ctx={fillRect(){},fillText(t){rendered.push(t);},measureText(t){return {width:t.length*12};}};
  const create=d.createElement.bind(d);d.createElement=tag=>tag==='canvas'?{getContext:()=>ctx,toDataURL:()=> 'data:image/jpeg;base64,test'}:create(tag);
  const note='⅔ → ⁴⁄₆ means equal value. '.repeat(450)+'FINAL EXPLANATION';
  dom.window.note=note;dom.window.pdf={addPage(){pages++;},addImage(){}};
  run(`nodes=[{id:1,label:'Fractions'},{id:2,label:'Equivalence'}];links=[{source:1,target:2,note:window.note}];appendMapNotesToPdf(window.pdf);`);
  assert.ok(pages>1);assert.match(rendered.join(''),/⅔ → ⁴⁄₆/);assert.ok(rendered.join('').endsWith('FINAL EXPLANATION'));dom.window.close();
});
test('direct editing route rejects another owner before loading their content',async()=>{
  const {dom,w,run}=load('app.js');w.SpanAuth={loadMapById:async()=>({owner_id:'other',data:{n:[],e:[]}}),getSession:async()=>({user:{id:'me'}})};
  await assert.rejects(()=>run("loadCloudMap('not-mine')"),/only edit maps you own/);dom.window.close();
});
