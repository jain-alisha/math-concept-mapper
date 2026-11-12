// Shared navigation and small, keyboard-accessible disclosure interactions.
// Page-specific map, account, and class behavior stays in its existing modules.
(() => {
  let tabGroupId = 0;
  window.SpanUI = {
    tabs(container, items, initial = 0) {
      const group = ++tabGroupId;
      const nav = document.createElement('div');
      nav.className = 'ui-tabs';
      nav.setAttribute('role', 'tablist');
      nav.setAttribute('aria-label', 'Dashboard sections');
      const panels = items.map(() => document.createElement('section'));
      const buttons = items.map((item, i) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = item;
        button.id = `ui-tab-${group}-${i}`;
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-controls', `ui-panel-${group}-${i}`);
        panels[i].id = `ui-panel-${group}-${i}`;
        panels[i].className = 'ui-tab-panel';
        panels[i].setAttribute('role', 'tabpanel');
        panels[i].setAttribute('aria-labelledby', button.id);
        button.addEventListener('click', () => select(i));
        button.addEventListener('keydown', event => {
          let next = i;
          if (event.key === 'ArrowRight') next = (i + 1) % items.length;
          else if (event.key === 'ArrowLeft') next = (i + items.length - 1) % items.length;
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = items.length - 1;
          else return;
          event.preventDefault(); select(next); buttons[next].focus();
        });
        nav.appendChild(button);
        return button;
      });
      function select(index) {
        buttons.forEach((button, i) => {
          button.setAttribute('aria-selected', String(i === index));
          button.tabIndex = i === index ? 0 : -1;
          panels[i].hidden = i !== index;
        });
      }
      container.append(nav, ...panels);
      select(initial);
      return panels;
    },
  };

  document.addEventListener('DOMContentLoaded', () => {
    const path = location.pathname.replace(/\.html$/, '').split('/').pop() || 'index';
    document.body.dataset.page = path;
    const classesPage = path === 'settings' && new URLSearchParams(location.search).get('tab') === 'classes';
    const sampleDashboard = ['dashboard', 'student'].includes(path) && new URLSearchParams(location.search).get('sample') === '1';
    if (sampleDashboard) {
      document.getElementById('signInBtn').onclick = () => { location.href = 'playground?auth=1'; };
      document.getElementById('signOutBtn').onclick = async () => {
        await window.SpanAuth.signOut();
        location.reload();
      };
    }
    document.querySelectorAll('[data-nav]').forEach(link => {
      const active = link.dataset.nav === (classesPage ? 'classes' : path === 'student' ? 'dashboard' : path);
      if (active) link.setAttribute('aria-current', 'page');
    });

    // Native <details> gives touch and keyboard users a reliable click target.
    document.addEventListener('click', event => {
      document.querySelectorAll('details.ui-menu[open]').forEach(menu => {
        if (!menu.contains(event.target)) menu.open = false;
        else if (event.target.closest('.ui-menu-items a, .ui-menu-items button')) menu.open = false;
      });
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      document.querySelectorAll('details.ui-menu[open]').forEach(menu => {
        menu.open = false; menu.querySelector('summary').focus();
      });
    });

    // One dashboard destination everywhere, matched to the signed-in role.
    if (window.SpanAuth && window.SpanAuth.isConfigured) {
      const updateNavigation = session => {
        const teacher = session && window.SpanAuth.role(session) === 'teacher';
        document.querySelectorAll('[data-nav="dashboard"]').forEach(link => {
          link.href = teacher ? 'dashboard' : 'student';
        });
        if (sampleDashboard) {
          document.getElementById('signInBtn').style.display = session ? 'none' : '';
          document.getElementById('userMenu').style.display = session ? 'flex' : 'none';
          if (session) document.getElementById('userLabel').textContent = session.user.user_metadata.display_name || session.user.email;
        }
      };
      window.SpanAuth.getSession().then(updateNavigation);
      window.SpanAuth.onAuthStateChange(updateNavigation);
    }

    // Visible labels for forms previously relying only on disappearing placeholders.
    document.querySelectorAll('input[placeholder]').forEach(input => {
      if (!input.getAttribute('aria-label') && !document.querySelector(`label[for="${input.id}"]`)) {
        input.setAttribute('aria-label', input.placeholder.replace(/\.{3}$/, ''));
      }
    });

    // Print the full report even when a different dashboard tab is selected.
    let closedPrintDetails = [];
    window.addEventListener('beforeprint', () => {
      closedPrintDetails = [...document.querySelectorAll('.ui-roster-details:not([open])')];
      closedPrintDetails.forEach(details => { details.open = true; });
    });
    window.addEventListener('afterprint', () => {
      closedPrintDetails.forEach(details => { details.open = false; });
      closedPrintDetails = [];
    });
  });
})();
