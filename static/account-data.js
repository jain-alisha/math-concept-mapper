document.addEventListener('DOMContentLoaded', () => {
  const box=document.getElementById('accountDataControls');
  if(!box || !window.SpanAuth?.isConfigured) return;
  const show=session=>{box.style.display=session?'':'none';};
  window.SpanAuth.getSession().then(show); window.SpanAuth.onAuthStateChange(show);
  document.getElementById('deleteAccountBtn').onclick=async event=>{
    const error=document.getElementById('deleteAccountError'); error.textContent='';
    if(document.getElementById('deleteAccountConfirmation').value!=='DELETE') {error.textContent='Type DELETE to confirm.';return;}
    const button=event.target; button.disabled=true;
    try {
      await window.SpanAuth.deleteAccount();
      // Only Span's own local drafts/preferences on this device are removed.
      for (const key of Object.keys(localStorage)) if(key.startsWith('span')) localStorage.removeItem(key);
      window.location.href='index';
    } catch(e) {error.textContent=e.message||'Could not delete account.';button.disabled=false;}
  };
});
