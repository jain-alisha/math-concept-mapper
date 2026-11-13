// Shared username/email signup. Username accounts belong to the student,
// independently of any class, and sign in with their normal password.
function setupSpanAccountForms() {
  if (!window.SpanAuth?.isConfigured) return;
  const el = id => document.getElementById(id);
  const signup=el('signUpForm'),forgot=el('forgotPasswordForm');
  if (!signup || !forgot) return;
  function field(id,enabled) { const input=el(id);input.hidden=!enabled;input.disabled=!enabled;input.required=enabled; }
  function signupMode() {
    const student=el('signUpKind').value==='student';
    field('signUpUsername',student);field('signUpEmail',!student);field('signUpName',!student);
    el('signUpName').required=false;el('studentAccountHint').hidden=!student;
  }
  el('signUpKind').onchange=signupMode;signupMode();
  el('forgotPasswordLink').onclick=()=>{
    el('signInForm').style.display='none';forgot.style.display='';
    const value=el('signInEmail').value.trim();el('forgotEmail').value=value.includes('@')?value:'';
  };
  let busy=false;
  async function submit(form,errorId,action) {
    if(busy)return;
    busy=true;const button=form.querySelector('[type=submit]');button.disabled=true;
    const message=el(errorId);message.style.color='';message.textContent='';
    try {await action(message);}catch(error){message.textContent=error.message || 'Please try again.';}
    finally {busy=false;button.disabled=false;}
  }
  signup.onsubmit=event=>{
    event.preventDefault();
    submit(signup,'signUpError',async message=>{
      const password=el('signUpPassword').value;
      if(el('signUpKind').value==='email'){
        const data=await window.SpanAuth.signUp(el('signUpEmail').value.trim(),password,el('signUpName').value.trim());
        if(data.session)el('authModal').style.display='none';
        else message.textContent='Check your email to confirm your account, then sign in.';
        return;
      }
      const result=await window.SpanAuth.signUpStudent(el('signUpUsername').value,password);
      try {await window.SpanAuth.signIn(result.username,password);}
      catch(error){message.textContent='Your account was created. Sign in with your username and password. '+(error.message || '');return;}
      signup.reset();signupMode();el('authModal').style.display='none';
    });
  };
  forgot.onsubmit=event=>{
    event.preventDefault();
    submit(forgot,'forgotError',async message=>{
      await window.SpanAuth.resetPasswordForEmail(el('forgotEmail').value.trim());
      message.textContent='Check your email for a reset link.';
    });
  };
}
window.SpanAccountForms={setup:setupSpanAccountForms};
document.addEventListener('DOMContentLoaded',setupSpanAccountForms);
