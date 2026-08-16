// Settings page: appearance (theme presets) + lean class management
// (create/join, list your classes). The full Teacher Dashboard (roster,
// Class Insights, "what have you taught") lives on its own page,
// dashboard.html/dashboard.js - Settings just links out to it.

document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupAppearance();
  setupAuthAndClasses();
});

function setupTabs() {
  const tabs = document.querySelectorAll('.settings-tab[data-tab]');
  tabs.forEach(tab => {
    tab.onclick = () => {
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    };
  });
}

function setupAppearance() {
  const wrap = document.getElementById('themeSwatches');
  if (!window.SpanTheme) {
    wrap.innerHTML = '<p class="settings-empty">Theme system unavailable.</p>';
    return;
  }
  function render() {
    const activeKey = window.SpanTheme.getActiveKey();
    wrap.innerHTML = '';
    window.SpanTheme.presets.forEach(preset => {
      const card = document.createElement('button');
      card.className = 'theme-card' + (preset.key === activeKey ? ' active' : '');
      card.type = 'button';
      const row = document.createElement('div');
      row.className = 'swatch-row';
      const dot = document.createElement('div');
      dot.className = 'swatch-dot';
      dot.style.background = preset.brand;
      row.appendChild(dot);
      const label = document.createElement('div');
      label.className = 'theme-label';
      label.textContent = preset.label;
      card.appendChild(row);
      card.appendChild(label);
      card.onclick = () => {
        window.SpanTheme.setActive(preset.key);
        render();
      };
      wrap.appendChild(card);
    });
  }
  render();
}

// Beta: "preview as a role" toggle for signed-out visitors - lets someone
// see what each role's experience looks like without creating an account.
// Teacher points at the real (much more detailed) Teacher Dashboard's
// sample mode; Student reuses the playground's existing sample map, since
// a student's actual surface area is really just "build a map" + "join a
// class" (the join-a-class form right above this is already a live demo of
// that half).
function setupRolePreviewToggle() {
  const wrap = document.getElementById('rolePreviewToggle');
  if (!wrap) return;
  const teacherBtn = document.getElementById('previewTeacherBtn');
  const studentBtn = document.getElementById('previewStudentBtn');
  const note = document.getElementById('rolePreviewNote');
  const cta = document.getElementById('rolePreviewCta');

  function show(role) {
    teacherBtn.classList.toggle('active', role === 'teacher');
    studentBtn.classList.toggle('active', role === 'student');
    if (role === 'teacher') {
      note.textContent = "This is a demo of what you'd see as a teacher: a class roster, at-a-glance student maps, and AI-driven insights across the whole class.";
      cta.href = 'dashboard.html?sample=1';
      cta.textContent = 'Open Teacher Dashboard demo →';
    } else {
      note.textContent = "This is a demo of what you'd see as a student: building your own concept map and getting AI-suggested connections as you go.";
      cta.href = 'playground.html?sample=1';
      cta.textContent = 'Open Playground demo →';
    }
  }

  teacherBtn.onclick = () => show('teacher');
  studentBtn.onclick = () => show('student');
  show('teacher');
}

function setupAuthAndClasses() {
  const signInBtn = document.getElementById('signInBtn');
  const userMenu = document.getElementById('userMenu');
  const userLabel = document.getElementById('userLabel');
  const signOutBtn = document.getElementById('signOutBtn');
  const classesSignInBtn = document.getElementById('classesSignInBtn');
  const classesSignedOut = document.getElementById('classesSignedOut');
  const classesTeacherView = document.getElementById('classesTeacherView');
  const classesStudentView = document.getElementById('classesStudentView');

  const authModal = document.getElementById('authModal');
  const authModalClose = document.getElementById('authModalClose');
  const tabSignIn = document.getElementById('tabSignIn');
  const tabSignUp = document.getElementById('tabSignUp');
  const signInForm = document.getElementById('signInForm');
  const signUpForm = document.getElementById('signUpForm');

  setupRolePreviewToggle();

  if (!window.SpanAuth || !window.SpanAuth.isConfigured) {
    classesSignedOut.querySelector('p').textContent = 'Accounts are not configured for this deployment yet.';
    classesSignInBtn.style.display = 'none';
    return;
  }

  function openModal() { authModal.style.display = 'flex'; }
  function closeModal() { authModal.style.display = 'none'; }
  function showSignIn() {
    tabSignIn.classList.add('active'); tabSignUp.classList.remove('active');
    signInForm.style.display = ''; signUpForm.style.display = 'none';
  }
  function showSignUp() {
    tabSignUp.classList.add('active'); tabSignIn.classList.remove('active');
    signUpForm.style.display = ''; signInForm.style.display = 'none';
  }

  signInBtn.onclick = openModal;
  classesSignInBtn.onclick = openModal;
  authModalClose.onclick = closeModal;
  authModal.onclick = (e) => { if (e.target === authModal) closeModal(); };
  tabSignIn.onclick = showSignIn;
  tabSignUp.onclick = showSignUp;

  signInForm.onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById('signInEmail').value.trim();
    const password = document.getElementById('signInPassword').value;
    const errEl = document.getElementById('signInError');
    errEl.textContent = '';
    try {
      await window.SpanAuth.signIn(email, password);
      closeModal();
    } catch (err) {
      errEl.textContent = err.message || 'Sign in failed.';
    }
  };

  signUpForm.onsubmit = async (e) => {
    e.preventDefault();
    const name = document.getElementById('signUpName').value.trim();
    const email = document.getElementById('signUpEmail').value.trim();
    const password = document.getElementById('signUpPassword').value;
    const errEl = document.getElementById('signUpError');
    errEl.style.color = '';
    errEl.textContent = '';
    try {
      await window.SpanAuth.signUp(email, password, name);
      errEl.style.color = '#1f8a4c';
      errEl.textContent = 'Check your email to confirm your account, then sign in.';
    } catch (err) {
      errEl.textContent = err.message || 'Sign up failed.';
    }
  };

  signOutBtn.onclick = async () => {
    await window.SpanAuth.signOut();
  };

  // --- Classes: teacher view - a lean list, each linking out to the real
  // Teacher Dashboard for the deep roster/insights view. ---
  async function renderTeacherClasses() {
    const listEl = document.getElementById('teacherClassList');
    listEl.innerHTML = '<p class="settings-empty">Loading…</p>';
    let classes;
    try {
      classes = await window.SpanAuth.listMyClasses();
    } catch (e) {
      listEl.innerHTML = '<p class="settings-empty">Could not load classes.</p>';
      return;
    }
    if (!classes.length) {
      listEl.innerHTML = '<p class="settings-empty">No classes yet — create one above.</p>';
      return;
    }
    listEl.innerHTML = '';
    classes.forEach(cls => {
      const card = document.createElement('a');
      card.className = 'class-card';
      card.href = `dashboard.html?class=${cls.id}`;
      card.innerHTML = `
        <div class="class-card-head">
          <div>
            <div class="class-name"></div>
            <div class="class-meta">Created ${new Date(cls.created_at).toLocaleDateString()} — open Dashboard →</div>
          </div>
          <span class="class-code"></span>
        </div>
      `;
      card.querySelector('.class-name').textContent = cls.name;
      card.querySelector('.class-code').textContent = cls.invite_code;
      listEl.appendChild(card);
    });
  }

  document.getElementById('createClassBtn').onclick = async () => {
    const input = document.getElementById('newClassName');
    const name = input.value.trim();
    if (!name) return;
    try {
      await window.SpanAuth.createClass(name);
      input.value = '';
      renderTeacherClasses();
    } catch (e) {
      alert('Could not create class: ' + (e.message || e));
    }
  };

  // --- Classes: student view ---
  async function renderStudentClasses() {
    const listEl = document.getElementById('studentClassList');
    listEl.innerHTML = '<p class="settings-empty">Loading…</p>';
    let classes;
    try {
      classes = await window.SpanAuth.listMyClasses();
    } catch (e) {
      listEl.innerHTML = '<p class="settings-empty">Could not load classes.</p>';
      return;
    }
    if (!classes.length) {
      listEl.innerHTML = '<p class="settings-empty">You haven\'t joined a class yet.</p>';
      return;
    }
    listEl.innerHTML = '';
    classes.forEach(cls => {
      const card = document.createElement('div');
      card.className = 'class-card';
      card.innerHTML = `<div class="class-name"></div>`;
      card.querySelector('.class-name').textContent = cls.name;
      listEl.appendChild(card);
    });
  }

  document.getElementById('joinClassBtn').onclick = async () => {
    const input = document.getElementById('joinCodeInput');
    const errEl = document.getElementById('joinClassError');
    errEl.textContent = '';
    const code = input.value.trim();
    if (!code) return;
    try {
      await window.SpanAuth.joinClassByCode(code);
      input.value = '';
      renderStudentClasses();
    } catch (e) {
      errEl.textContent = e.message || 'Could not join class.';
    }
  };

  // DEMO-ONLY, TEMPORARY: see the loud comment on claim_teacher_role() in
  // supabase-schema.sql - self-serve, no gate, acceptable only because this
  // deployment has no real student data at stake.
  document.getElementById('becomeTeacherBtn').onclick = async () => {
    const btn = document.getElementById('becomeTeacherBtn');
    const errEl = document.getElementById('becomeTeacherError');
    errEl.textContent = '';
    btn.disabled = true;
    try {
      const newSession = await window.SpanAuth.claimTeacherRole();
      updateAuthUI(newSession);
    } catch (e) {
      errEl.textContent = e.message || 'Could not update role.';
    } finally {
      btn.disabled = false;
    }
  };

  // --- Session-driven view switching ---
  function updateAuthUI(session) {
    if (session) {
      signInBtn.style.display = 'none';
      userMenu.style.display = 'flex';
      const name = (session.user.user_metadata && session.user.user_metadata.display_name) || session.user.email;
      const role = window.SpanAuth.role(session);
      userLabel.textContent = `${name} (${role})`;

      classesSignedOut.style.display = 'none';
      if (role === 'teacher') {
        classesTeacherView.style.display = '';
        classesStudentView.style.display = 'none';
        renderTeacherClasses();
      } else {
        classesStudentView.style.display = '';
        classesTeacherView.style.display = 'none';
        renderStudentClasses();
      }
    } else {
      signInBtn.style.display = '';
      userMenu.style.display = 'none';
      classesSignedOut.style.display = '';
      classesTeacherView.style.display = 'none';
      classesStudentView.style.display = 'none';
    }
  }

  window.SpanAuth.getSession().then(updateAuthUI);
  window.SpanAuth.onAuthStateChange(updateAuthUI);
}
