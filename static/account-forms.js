// Shared username/email forms: loaded after each page's setup, preserving its
// session-driven map/dashboard behavior while replacing duplicated submit flows.
function setupSpanAccountForms() {
  if (!window.SpanAuth?.isConfigured) return;
  const el = id => document.getElementById(id);
  const signup = el('signUpForm'), forgot = el('forgotPasswordForm');
  if (!signup || !forgot) return;
  function field(id, enabled) { const input=el(id); input.hidden=!enabled; input.disabled=!enabled; input.required=enabled; }
  const signupMode = () => {
    const student=el('signUpKind').value==='student';
    field('signUpUsername',student); field('signUpEmail',!student); field('signUpName',!student);
    el('signUpName').required=false;
    el('studentAccountHint').hidden=!student;
    el('signUpAgeBand').hidden=!student; el('signUpAgeBand').disabled=!student; el('signUpAgeBand').required=student;
    el('signUpAgeLabel').hidden=!student;
    field('signUpAuthorization', student && el('signUpAgeBand').value==='under13');
  };
  el('signUpKind').onchange=signupMode; el('signUpAgeBand').onchange=signupMode; signupMode();
  const recoveryMode = () => {
    const student=el('recoveryKind').value==='student';
    for(const id of ['recoveryUsername','recoveryKey','recoveryPassword']) field(id,student);
    field('forgotEmail',!student);
    forgot.querySelector('[type=submit]').textContent=student?'Reset password':'Send reset link';
  };
  el('recoveryKind').onchange=recoveryMode; recoveryMode();
  el('forgotPasswordLink').onclick=() => {
    el('signInForm').style.display='none'; forgot.style.display='';
    const value=el('signInEmail').value.trim();
    el('recoveryKind').value=value.includes('@')?'email':'student';
    el(value.includes('@')?'forgotEmail':'recoveryUsername').value=value;
    recoveryMode();
  };
  let busy=false;
  async function submit(form, errorId, action) {
    if(busy) return;
    busy=true; const button=form.querySelector('[type=submit]'); button.disabled=true;
    const message=el(errorId); message.style.color=''; message.textContent='';
    try { await action(message); }
    catch(error) { message.textContent=error.message || 'Please try again.'; }
    finally { busy=false; button.disabled=false; }
  }
  signup.onsubmit=event => {
    event.preventDefault();
    submit(signup,'signUpError',async message => {
      const password=el('signUpPassword').value;
      if(el('signUpKind').value==='email') {
        const data=await window.SpanAuth.signUp(el('signUpEmail').value.trim(),password,el('signUpName').value.trim());
        if(data.session) el('authModal').style.display='none';
        else message.textContent='Check your email to confirm your account, then sign in.';
        return;
      }
      const result=await window.SpanAuth.signUpStudent(el('signUpUsername').value,password,el('signUpAgeBand').value,el('signUpAuthorization').value);
      showRecoveryKey(result.username,result.recoveryKey, async () => {
        await window.SpanAuth.signIn(result.username,password);
        signup.reset(); signupMode();
      });
    });
  };
  forgot.onsubmit=event => {
    event.preventDefault();
    submit(forgot,'forgotError',async message => {
      if(el('recoveryKind').value==='email') {
        await window.SpanAuth.resetPasswordForEmail(el('forgotEmail').value.trim());
        message.textContent='Check your email for a reset link.';
      } else {
        await window.SpanAuth.recoverStudent(el('recoveryUsername').value,el('recoveryKey').value,el('recoveryPassword').value);
        el('signInEmail').value=el('recoveryUsername').value.trim();
        forgot.reset(); recoveryMode();
        message.textContent='Password reset. Return to sign in with your new password.';
      }
    });
  };
  function showRecoveryKey(username,key,signIn) {
    const modal=el('authModal'), box=signup.parentElement;
    const receipt=document.createElement('section'); receipt.setAttribute('aria-label','Save your recovery key');
    const title=document.createElement('h2'); title.textContent='Save your account details';
    const name=document.createElement('p'); name.textContent='Username: '+username;
    const code=document.createElement('code'); code.textContent=key; code.style.cssText='display:block;overflow-wrap:anywhere;padding:1em;background:var(--bg,#f5f7fa);user-select:all';
    const note=document.createElement('p'); note.textContent='Keep this recovery key somewhere private. You need it if you forget your password. Anyone with the key can reset your password.';
    const saved=document.createElement('button'); saved.type='button'; saved.textContent='I saved it — continue';
    const error=document.createElement('p'); error.setAttribute('role','alert');
    receipt.append(title,name,code,note,saved,error);
    const prior=Array.from(box.children).map(child=>[child,child.style.display]);
    prior.forEach(([child])=>child.style.display='none'); box.appendChild(receipt);
    // Avoid silently dismissing the only displayed copy of the recovery key.
    const keepOpen=event=>{if(event.key==='Escape'||event.target===modal){event.preventDefault();event.stopImmediatePropagation();}};
    modal.addEventListener('click',keepOpen,true); document.addEventListener('keydown',keepOpen,true);
    saved.onclick=async()=>{
      saved.disabled=true;
      try {
        await signIn();
        receipt.remove(); prior.forEach(([child,display])=>child.style.display=display);
        modal.removeEventListener('click',keepOpen,true); document.removeEventListener('keydown',keepOpen,true);
        modal.style.display='none';
      } catch(e) {error.textContent='Your account exists. Keep the key and try signing in again. '+(e.message||'');}
      finally {saved.disabled=false;}
    };
    saved.focus();
  }
}
window.SpanAccountForms = { setup: setupSpanAccountForms };
document.addEventListener('DOMContentLoaded', setupSpanAccountForms);
