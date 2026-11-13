// Shared navigation and session state. Loaded after each page's own script.
(function () {
  function setup() {
    const bar = document.getElementById('topbar');
    if (!bar) return;
    bar.classList.add('span-topbar');
    const editor = /(?:^|\/)playground(?:\.html)?$/.test(location.pathname);
    bar.classList.toggle('span-editor-header', editor);
    const nav = bar.querySelector('nav');
    let menu = nav;
    let mapActions = null;
    if (editor) {
      // Keep the same site navigation everywhere; mapping actions get
      // their own row instead of competing with account navigation.
      const tools = document.createElement('div'); tools.id = 'editorToolbar';
      for (const id of ['openMapTitle','saveStatusBadge']) { const el=document.getElementById(id); if(el) tools.appendChild(el); }
      for (const group of Array.from(nav.querySelectorAll(':scope > .tb-group'))) tools.appendChild(group);
      mapActions = document.createElement('div'); mapActions.className='tb-group'; tools.appendChild(mapActions);
      for (const id of ['myMapsBtn','timelineBtn']) { const el=document.getElementById(id); if(el) mapActions.appendChild(el); }
      // Panels follow their buttons into the editor row, so they open below
      // its full height instead of covering the buttons after navigation cleanup.
      for (const id of ['myMapsPanel','timelinePanel']) { const panel=document.getElementById(id); if(panel) tools.appendChild(panel); }
      bar.after(tools);
      document.getElementById('anonNavLinks')?.remove();
      menu = document.createElement('div'); menu.className = 'span-global-nav'; nav.prepend(menu);
    }
    if (!menu) return;
    for (const [href, label] of [['index', 'Home'], ['playground', 'Playground'], ['student', 'Dashboard'], ['settings', 'Settings']]) {
      const found = Array.from(menu.querySelectorAll('a')).find(a => {
        const path = a.getAttribute('href').split('?')[0].replace(/\.html$/, '');
        return href === 'student' ? ['student', 'dashboard'].includes(path) && !a.search : path === href;
      });
      const a = found || document.createElement('a');
      if (!found) { a.href = href; a.textContent = label; menu.appendChild(a); }
      if (!editor) menu.appendChild(a);
      a.classList.add('span-nav-link');
      if (href === 'student') a.dataset.spanDashboard = 'true';
      const current = location.pathname.replace(/\.html$/, '').replace(/^\//, '') || 'index';
      if (current === href) a.setAttribute('aria-current', 'page');
    }
    if (editor && !menu.querySelector('a[href="privacy"]')) {
      const privacy = document.createElement('a'); privacy.href = 'privacy'; privacy.className = 'span-nav-link'; privacy.textContent = 'Privacy & contact'; menu.appendChild(privacy);
    }
    let signIn = document.getElementById('signInBtn');
    if (!signIn) {
      signIn = bar.querySelector('a[href*="auth=1"]');
      if (signIn) signIn.id = 'signInBtn';
    }
    let userMenu = document.getElementById('userMenu');
    if (!userMenu) {
      userMenu = document.createElement('div');
      userMenu.id = 'userMenu';
      userMenu.innerHTML = '<span id="userLabel"></span><button id="signOutBtn" type="button">Log out</button>';
      nav.appendChild(userMenu);
    }
    if (!editor) { if (signIn) nav.appendChild(signIn); nav.appendChild(userMenu); }
    // Sample pages intentionally skip their normal account setup. Keep the
    // header functional in samples too, without changing any sample records.
    if (signIn && !signIn.onclick && signIn.tagName === 'BUTTON') {
      signIn.onclick = () => { location.href = 'settings?auth=1'; };
    }
    const signOut = document.getElementById('signOutBtn');
    if (signOut && !signOut.onclick) signOut.onclick = async () => {
      signOut.disabled = true;
      try { await window.SpanAuth.signOut(); }
      catch (_) { signOut.textContent = 'Try logging out again'; }
      finally { signOut.disabled = false; }
    };
    function render(session) {
      const role = session && window.SpanAuth.role(session);
      if (signIn) signIn.style.display = session ? 'none' : '';
      if (mapActions) mapActions.style.display = session ? 'flex' : 'none';
      userMenu.style.display = session ? 'flex' : 'none';
      const label = document.getElementById('userLabel');
      if (label && session) label.textContent = (session.user.user_metadata?.display_name || session.user.email || 'My account') + ' (' + role + ')';
      bar.querySelectorAll('[data-span-dashboard], #dashboardLink').forEach(a => {
        a.href = session ? (role === 'teacher' ? 'dashboard' : 'student') : 'settings';
        a.style.display = '';
      });
      document.querySelectorAll('.sample-banner a[href="settings"], .sample-banner a[data-span-account]').forEach(a => {
        a.dataset.spanAccount = 'true';
        a.textContent = session ? 'Open your dashboard →' : 'Sign in for your own →';
        a.href = session ? (role === 'teacher' ? 'dashboard' : 'student') : 'settings?auth=1';
      });
    }
    if (window.SpanAuth?.isConfigured) {
      window.SpanAuth.getSession().then(render).catch(() => render(null));
      window.SpanAuth.onAuthStateChange(render);
    } else render(null);
    let footer = document.querySelector('footer.site-footer');
    if (!footer) { footer = document.createElement('footer'); document.body.appendChild(footer); }
    footer.classList.add('site-footer', 'span-site-footer');
    footer.innerHTML = '<span>Span</span><a href="privacy">Privacy &amp; student data</a><a href="https://github.com/jain-alisha/math-concept-mapper/issues/new" target="_blank" rel="noopener">Contact the Span team</a>';
    if (editor) footer.classList.add('span-editor-footer');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();
})();
