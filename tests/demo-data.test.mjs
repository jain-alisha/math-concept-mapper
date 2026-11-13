import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const c=vm.createContext({window:{},structuredClone});vm.runInContext(fs.readFileSync('static/demo-data.js','utf8'),c);const demo=c.window.SpanDemo;
const catalog=JSON.parse(fs.readFileSync('static/concepts.json','utf8'));
test('presentation classes have substantial coherent fictional work and canonical concepts',()=>{
  assert.equal(demo.classes.length,2);assert.equal(demo.roster.length,12);assert.equal(demo.maps.length,70);
  const ids=new Set(demo.maps.map(m=>m.id));assert.equal(ids.size,demo.maps.length);
  for(const cls of demo.classes){const data=demo.getClass(cls.id);assert.equal(data.maps.length,35);assert.equal(data.roster.length,12);}
  for(const map of [...demo.maps,...demo.timelines.flatMap(t=>t.frames)]){
    const nodes=new Map(map.data.n.map(n=>[n.i,n]));
    for(const n of nodes.values())assert.ok(catalog[n.m.grade][n.m.unit].includes(n.l),n.l);
    for(const e of map.data.e){assert.ok(nodes.has(e.s)&&nodes.has(e.t));assert.notEqual(e.s,e.t);}
  }
  for(const a of demo.activities)for(const key of a.concepts){const [grade,unit,label]=key.split('::');assert.ok(catalog[grade][unit].includes(label));}
});
test('student portfolio has multiple classes and stable, progressively richer protected baselines',()=>{
  assert.equal(demo.studentMaps.length,6);assert.equal(demo.timelines.length,3);
  for(const t of demo.timelines){assert.equal(t.frames.length,4);assert.equal(t.frames[0].is_checkpoint,true);let count=0;let date='';for(const f of t.frames){assert.ok(f.data.e.length>=count);assert.ok(f.created_at>date);count=f.data.e.length;date=f.created_at;}}
  assert.ok(demo.editor.data.e.every(e=>e.no.length>40));
});
import {JSDOM} from 'jsdom';
test('student presentation switches growth timelines and opens demo activities without fake cloud ids',async()=>{
  const dom=new JSDOM('<main id="dashWrap"></main>',{url:'https://spanmath.org/student?sample=1',runScripts:'outside-only'});const w=dom.window;w.document.addEventListener=()=>{};w.structuredClone=structuredClone;w.TextEncoder=TextEncoder;w.SpanAuth={isConfigured:false};
  for(const file of ['demo-data.js','student.js'])vm.runInContext(fs.readFileSync('static/'+file,'utf8'),dom.getInternalVMContext());
  w.renderSampleStudentDashboard();
  const select=w.document.querySelector('[aria-label="Growth timeline"]');assert.equal(select.options.length,3);select.value='demo-timeline-fractions';select.dispatchEvent(new w.Event('change'));assert.match(w.document.querySelector('#timelineLabel').textContent,/Fractions Tell a Story/);
  const toggle=w.document.querySelector('.class-activities-toggle');toggle.click();await new Promise(r=>setTimeout(r,0));const href=w.document.querySelector('.class-activities-list a').href;assert.match(href,/demoActivity=demo-activity-ratios/);assert.doesNotMatch(href,/\?activity=/);dom.window.close();
});
test('editor map panels stay anchored with their toolbar buttons after navigation cleanup',()=>{
  const dom=new JSDOM(fs.readFileSync('static/playground.html','utf8'),{url:'https://spanmath.org/playground',runScripts:'outside-only'});const w=dom.window;w.document.addEventListener=()=>{};w.SpanAuth={isConfigured:false};Object.defineProperty(w.document,'readyState',{value:'complete',configurable:true});vm.runInContext(fs.readFileSync('static/site-shell.js','utf8'),dom.getInternalVMContext());
  for(const id of ['myMapsPanel','timelinePanel'])assert.equal(w.document.getElementById(id).parentElement.id,'editorToolbar');
  dom.window.close();
});
