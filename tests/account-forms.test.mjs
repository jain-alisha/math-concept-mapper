import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
const turn=()=>new Promise(resolve=>setTimeout(resolve,0));
async function load(page='settings') {
  const dom=new JSDOM(fs.readFileSync('static/'+page+'.html','utf8'),{url:'https://spanmath.org/'+page,runScripts:'outside-only'});
  const w=dom.window;const calls=[];
  w.SpanAuth={isConfigured:true,signUpStudent:async(...args)=>{calls.push(args);return {username:'fox_map',recoveryKey:'aaaaa-bbbbb-ccccc-ddddd'};},signIn:async(...args)=>{calls.push(args);},signUp:async()=>({session:{}}),recoverStudent:async(...args)=>{calls.push(args);},resetPasswordForEmail:async email=>calls.push(email)};
  // Simulate page-specific registration before the shared module.
  w.document.getElementById('forgotBackBtn').onclick=()=>{w.document.getElementById('forgotPasswordForm').style.display='none';w.document.getElementById('signInForm').style.display='';};
  await turn();w.eval(fs.readFileSync('static/account-forms.js','utf8'));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  return {dom,w,d:w.document,calls};
}
test('all account entry points default to no-email signup and require under-13 authorization',async()=>{
  for(const page of ['settings','playground','student','dashboard']) {
    const {dom,w,d}=await load(page);
    assert.equal(d.getElementById('signInEmail').type,'text');
    assert.equal(d.getElementById('signUpEmail').disabled,true);
    assert.equal(d.getElementById('signUpUsername').required,true);
    const age=d.getElementById('signUpAgeBand');age.value='under13';age.dispatchEvent(new w.Event('change'));
    assert.equal(d.getElementById('signUpAuthorization').required,true);
    const kind=d.getElementById('signUpKind');kind.value='email';kind.dispatchEvent(new w.Event('change'));
    assert.equal(d.getElementById('signUpEmail').required,true);assert.equal(age.disabled,true);assert.equal(d.getElementById('signUpAuthorization').disabled,true);
    dom.window.close();
  }
});
test('signup displays recovery key before sign-in and requires explicit acknowledgment',async()=>{
  const {dom,w,d,calls}=await load();
  d.getElementById('authModal').style.display='flex';d.getElementById('signUpUsername').value='fox_map';d.getElementById('signUpPassword').value='long test password';d.getElementById('signUpAgeBand').value='13plus';
  d.getElementById('signUpForm').dispatchEvent(new w.Event('submit',{cancelable:true}));await turn();
  assert.equal(calls.length,1);assert.ok(d.querySelector('code').textContent.includes('aaaaa'));
  d.getElementById('authModal').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));assert.equal(d.getElementById('authModal').style.display,'flex');
  const button=[...d.querySelectorAll('button')].find(x=>x.textContent==='I saved it — continue');button.click();await turn();
  assert.equal(calls.length,2);assert.equal(d.querySelector('code'),null);assert.equal(d.getElementById('authModal').style.display,'none');dom.window.close();
});
test('forgot-password form switches correctly between username recovery and email reset',async()=>{
  const {dom,w,d,calls}=await load();
  d.getElementById('signInEmail').value='fox_map';d.getElementById('forgotPasswordLink').click();
  assert.equal(d.getElementById('forgotEmail').disabled,true);assert.equal(d.getElementById('recoveryUsername').value,'fox_map');
  d.getElementById('recoveryKey').value='a-key';d.getElementById('recoveryPassword').value='new long password';
  d.getElementById('forgotPasswordForm').dispatchEvent(new w.Event('submit',{cancelable:true}));await turn();
  assert.deepEqual(calls[0],['fox_map','a-key','new long password']);
  d.getElementById('recoveryKind').value='email';d.getElementById('recoveryKind').dispatchEvent(new w.Event('change'));
  assert.equal(d.getElementById('forgotEmail').required,true);assert.equal(d.getElementById('recoveryKey').disabled,true);dom.window.close();
});
test('late Playground initialization restores the shared signup flow after page handlers run',async()=>{
  const {dom,w,d,calls}=await load('playground');
  d.getElementById('signUpForm').onsubmit=()=>{throw new Error('legacy email-only handler');};
  w.SpanAccountForms.setup();
  d.getElementById('signUpUsername').value='fox_map';d.getElementById('signUpPassword').value='long test password';d.getElementById('signUpAgeBand').value='13plus';
  d.getElementById('signUpForm').dispatchEvent(new w.Event('submit',{cancelable:true}));await turn();
  assert.equal(calls.length,1);assert.ok(d.querySelector('code'));dom.window.close();
});
