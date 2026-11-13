import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
const turn=()=>new Promise(resolve=>setTimeout(resolve,0));
async function load(page='settings') {
  const dom=new JSDOM(fs.readFileSync('static/'+page+'.html','utf8'),{url:'https://spanmath.org/'+page,runScripts:'outside-only'});
  const w=dom.window;const calls=[];
  w.SpanAuth={isConfigured:true,signUpStudent:async(...args)=>{calls.push(args);return {username:'fox_map'};},signIn:async(...args)=>{calls.push(args);},signUp:async()=>({session:{}}),resetPasswordForEmail:async email=>calls.push(email)};
  // Simulate page-specific registration before the shared module.
  w.document.getElementById('forgotBackBtn').onclick=()=>{w.document.getElementById('forgotPasswordForm').style.display='none';w.document.getElementById('signInForm').style.display='';};
  await turn();w.eval(fs.readFileSync('static/account-forms.js','utf8'));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  return {dom,w,d:w.document,calls};
}
test('all entry points offer simple username/password or email signup',async()=>{
  for(const page of ['settings','playground','student','dashboard']){
    const {dom,w,d}=await load(page);
    assert.equal(d.getElementById('signInEmail').type,'text');
    assert.equal(d.getElementById('signUpEmail').disabled,true);
    assert.equal(d.getElementById('signUpUsername').required,true);
    const enabled=[...d.querySelectorAll('#signUpForm input,#signUpForm select')].filter(x=>!x.disabled).map(x=>x.id);
    assert.deepEqual(enabled,['signUpKind','signUpUsername','signUpPassword']);
    const kind=d.getElementById('signUpKind');kind.value='email';kind.dispatchEvent(new w.Event('change'));
    assert.equal(d.getElementById('signUpEmail').required,true);assert.equal(d.getElementById('signUpUsername').disabled,true);
    dom.window.close();
  }
});
test('username signup signs in immediately with the same password',async()=>{
  const {dom,w,d,calls}=await load();
  d.getElementById('authModal').style.display='flex';d.getElementById('signUpUsername').value='fox_map';d.getElementById('signUpPassword').value='long test password';
  d.getElementById('signUpForm').dispatchEvent(new w.Event('submit',{cancelable:true}));await turn();
  assert.deepEqual(calls,[['fox_map','long test password'],['fox_map','long test password']]);
  assert.equal(d.getElementById('authModal').style.display,'none');assert.equal(d.querySelector('code'),null);dom.window.close();
});
test('forgot-password UI keeps email resets and explains username account help',async()=>{
  const {dom,w,d,calls}=await load();
  d.getElementById('signInEmail').value='fox_map';d.getElementById('forgotPasswordLink').click();
  assert.equal(d.getElementById('forgotEmail').value,'');assert.match(d.getElementById('forgotPasswordForm').textContent,/no email/);
  d.getElementById('forgotEmail').value='teacher@example.com';
  d.getElementById('forgotPasswordForm').dispatchEvent(new w.Event('submit',{cancelable:true}));await turn();
  assert.deepEqual(calls,['teacher@example.com']);dom.window.close();
});
test('late Playground initialization restores the simple signup flow',async()=>{
  const {dom,w,d,calls}=await load('playground');
  d.getElementById('signUpForm').onsubmit=()=>{throw new Error('legacy email-only handler');};w.SpanAccountForms.setup();
  d.getElementById('signUpUsername').value='fox_map';d.getElementById('signUpPassword').value='long test password';
  d.getElementById('signUpForm').dispatchEvent(new w.Event('submit',{cancelable:true}));await turn();
  assert.equal(calls.length,2);assert.equal(d.getElementById('authModal').style.display,'none');dom.window.close();
});
