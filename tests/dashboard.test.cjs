const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
function load(name) {
  const context = vm.createContext({ document: { addEventListener() {} }, console, TextEncoder, Set, Map });
  vm.runInContext(fs.readFileSync(path.join(root, 'static', name), 'utf8'), context);
  return context;
}
const n = (i, l, grade = '6th Grade Math', unit = 'Fractions') => ({ i, l, m: { grade, unit } });
const map = (id, owner_id, nodes, edges = []) => ({ id, owner_id, title: 'My map', data: { n: nodes, e: edges } });
test('student summary names actual concepts rather than inferring unrelated grade connections', () => {
  const c = load('student.js');
  const summary = c.computeStudentSummary([map('a', 's', [n(1, 'Fractions'), n(2, 'Equal parts')], [{ s: 1, t: 2, no: 'Equal parts name the denominator.' }])]);
  assert.match(summary, /Fractions/); assert.match(summary, /Equal parts/);
  assert.doesNotMatch(summary, /Ratios|7th|connect to.*6th/);
  assert.match(summary, /connections have notes/);
});
test('student summary keeps unrelated identically titled maps and deduplicates timeline snapshots by identity', () => {
  const c = load('student.js');
  const maps = [map('a', 's', [n(1, 'Fractions')]), map('b', 's', [n(2, 'Decimals')])];
  assert.match(c.computeStudentSummary(maps), /2 distinct concepts/);
  maps[0].timeline_id = maps[1].timeline_id = 't';
  maps[0].updated_at = '2026-01-01'; maps[1].updated_at = '2026-02-01';
  assert.match(c.computeStudentSummary(maps), /1 distinct concept/);
  assert.doesNotMatch(c.computeStudentSummary(maps), /Fractions/);
});
test('teacher summary uses the coverage metric rather than swapping activity and connectivity', () => {
  const c = load('dashboard.js');
  const maps = [1,2,3,4].map(i => map(String(i),String(i),[n(1,'Fraction','6th Grade Math','Fractions')]));
  maps.push(map('five','5',[n(1,'Ratios','7th Grade Math','Ratios'),n(2,'Rates','7th Grade Math','Ratios')],[{s:1,t:2}]));
  assert.match(c.computeClassSummary(maps), /Most students are working in Fractions \(6th Grade Math\): 4 students/);
});
test('missing prerequisites use reviewed directed edges, aliases and grade qualification', () => {
  const c = load('dashboard.js');
  vm.runInContext(`prerequisiteData = { aliases: {'old mixed':'Mixed numbers'}, edges:[{source:{label:'Fractions',grade:'6th Grade Math',unit:'Fractions'},target:{label:'Mixed numbers',grade:'6th Grade Math',unit:'Fractions'},reason:'Units'}] };`,c);
  const nodes = [n(1,'Fractions'),n(2,'old mixed')];
  assert.equal(c.computeMissingPrereqs([map('a','s',nodes)],{},new Set()).length,1);
  assert.equal(c.computeMissingPrereqs([map('a','s',nodes,[{s:1,t:2,rt:'prerequisite'}])],{}).length,0);
  assert.equal(c.computeMissingPrereqs([map('a','s',nodes,[{s:2,t:1,rt:'prerequisite'}])],{}).length,1);
  assert.equal(c.computeMissingPrereqs([map('a','s',[n(1,'Ratio word problems'),n(2,'Unit rate definition')])],{}).length,0);
  assert.equal(c.computeMissingPrereqs([map('a','s',[n(2,'Mixed numbers','7th Grade Math')])],{}).length,0);
});
