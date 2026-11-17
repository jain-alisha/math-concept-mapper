// Span auth + cloud map storage, backed by Supabase (see supabase-schema.sql
// and README.md for setup). Loaded after static/vendor/supabase.js.
//
// Signup starts in student view. Roles live in auth.users.app_metadata;
// Teacher roles are assigned by an administrator, never by the browser.
// Missing/absent app_metadata.role is treated as 'student'.

(function () {
  // Fill these in after creating your Supabase project (Settings -> API).
  const SUPABASE_URL = 'https://rlngqnlwcyvxaqthzyft.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_gqP7lelD0nZFUAehRpcYtg__kWelsbG';

  const isConfigured = !SUPABASE_URL.startsWith('YOUR_') && !SUPABASE_ANON_KEY.startsWith('YOUR_');

  if (!isConfigured) {
    console.warn('[Span] Supabase is not configured yet (static/auth.js) - accounts/cloud save are disabled. Anonymous use (localStorage, sample map, share links) is unaffected.');
    window.SpanAuth = {
      isConfigured: false,
      async getSession() { return null; },
      onAuthStateChange() {},
    };
    return;
  }

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  function roleOf(session) {
    const meta = session && session.user && session.user.app_metadata;
    return (meta && meta.role) || 'student';
  }

  function usernameEmail(value) {
    const username = value.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{3,23}$/.test(username)) throw new Error('Enter your username or email.');
    return username + '@students.span.invalid';
  }
  async function studentAccountRequest(body) {
    const response = await fetch(SUPABASE_URL + '/functions/v1/student-accounts', {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify(body),
    });
    let result;
    try { result = await response.json(); } catch (_) { throw new Error('Student accounts are not available yet. Please try again later.'); }
    if (!response.ok) throw new Error(result.error || 'Student accounts are not available yet. Please try again later.');
    return result;
  }

  async function currentSession() {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    let session = data.session;
    if (session?.expires_at && session.expires_at * 1000 < Date.now() + 60000) {
      const refreshed = await client.auth.refreshSession();
      if (refreshed.error) throw refreshed.error;
      session = refreshed.data.session;
    }
    return session;
  }

  window.SpanAuth = {
    isConfigured: true,
    async signUpStudent(username, password) {
      return studentAccountRequest({ action: 'signup', username, password });
    },
    async deleteAccount() {
      const { data: { session } } = await client.auth.getSession();
      if (!session) throw new Error('Sign in first.');
      const response = await fetch(SUPABASE_URL + '/functions/v1/student-accounts', {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + session.access_token },
        body: JSON.stringify({ action: 'deleteAccount' }),
      });
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || 'Could not delete account.'); }
      await client.auth.signOut({ scope: 'local' }).catch(() => {});
    },
    async saveStartingCheckpoint(sourceId) {
      const { data, error } = await client.rpc('save_starting_checkpoint', { source_id: sourceId });
      if (error) throw error;
      return data;
    },
    client,

    async leaveClass(classId) {
      const session = await currentSession();
      if (!session) throw new Error('Sign in first.');
      const {error} = await client.from('class_members').delete().eq('class_id',classId).eq('student_id',session.user.id);
      if (error) throw error;
    },

    async signUp(email, password, displayName) {
      const { data, error } = await client.auth.signUp({
        email, password,
        options: { data: { display_name: displayName || '' } },
      });
      if (error) throw error;
      return data;
    },

    async signIn(identifier, password) {
      const email = identifier.includes('@') ? identifier.trim() : usernameEmail(identifier);
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return data;
    },

    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) throw error;
    },

    // Supabase emails a link back to this same origin with a recovery token
    // in the URL; onAuthStateChange fires a PASSWORD_RECOVERY event when
    // that link is opened, at which point updatePassword() below can be
    // called to actually set the new password.
    async resetPasswordForEmail(email) {
      if (email.toLowerCase().endsWith('@students.span.invalid')) throw new Error('Password recovery for username-only accounts is not available yet.');
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/settings',
      });
      if (error) throw error;
    },

    async updatePassword(newPassword) {
      const { error } = await client.auth.updateUser({ password: newPassword });
      if (error) throw error;
    },

    async getSession() {
      return currentSession();
    },

    onAuthStateChange(cb) {
      client.auth.onAuthStateChange((event, session) => cb(session, event));
    },

    role: roleOf,

    // listMyMaps()'s contract is "maps I own" - it needs an explicit filter
    // now that a second RLS policy (teachers viewing their students' maps)
    // means "rows RLS lets me see" is no longer synonymous with "rows I own".
    // Without this filter, a teacher's own My Maps panel would silently
    // include every one of their students' maps too.
    async listMyMaps() {
      for (let attempt = 0; attempt < 2; attempt++) {
        const session = await currentSession();
        if (!session) throw new Error('Your session ended. Sign in again to load your maps.');
        const { data, error, status } = await client.from('maps')
          .select('id,title,updated_at,created_at,timeline_id,activity_id,is_checkpoint')
          .eq('owner_id', session.user.id).order('updated_at', { ascending: false });
        if (!error) return data;
        if (attempt === 0 && (status === 401 || error.code === 'PGRST301' || error.code === 'PGRST303')) {
          const refreshed = await client.auth.refreshSession();
          if (refreshed.error || !refreshed.data.session) throw new Error('Your session ended. Sign in again to load your maps.');
          continue;
        }
        throw error;
      }
    },

    async loadMapById(id) {
      const { data, error } = await client.from('maps').select('*').eq('id', id).single();
      if (error) throw error;
      return window.SpanConceptBank?.row(data) || data;
    },

    // Returns { row } on success, { conflict: true } if a stale write was
    // rejected (id + lastKnownUpdatedAt supplied but no longer matches -
    // the map changed elsewhere since it was loaded). activityId is only
    // ever set on insert (a map's activity assignment doesn't change after
    // creation - see app.js's currentActivityId for why).
    async saveMap({ id, title, data, lastKnownUpdatedAt, activityId }) {
      const nowIso = new Date().toISOString();
      if (id) {
        let query = client.from('maps').update({ title, data, updated_at: nowIso }).eq('id', id);
        if (lastKnownUpdatedAt) query = query.eq('updated_at', lastKnownUpdatedAt);
        const { data: rows, error } = await query.select();
        if (error) throw error;
        if (!rows || !rows.length) return { conflict: true };
        return { row: rows[0] };
      }
      const { data: rows, error } = await client
        .from('maps')
        .insert({ title, data, updated_at: nowIso, activity_id: activityId || null })
        .select();
      if (error) throw error;
      return { row: rows[0] };
    },

    async deleteMap(id) {
      const { error } = await client.from('maps').delete().eq('id', id);
      if (error) throw error;
    },

    // --- Rostering ---

    // RLS scopes this correctly for both roles already ("classes visible to
    // me" = classes I teach OR classes I've joined), unlike listMyMaps().
    async listMyClasses() {
      const { data, error } = await client
        .from('classes')
        .select('id,name,invite_code,created_at,taught_topics')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return window.SpanConceptBank ? data.map(window.SpanConceptBank.classRow) : data;
    },

    async createClass(name) {
      const { data, error } = await client.from('classes').insert({ name }).select().single();
      if (error) throw error;
      return data;
    },

    // Beta: classwide gap analysis factors this in - a "missing prereq" is
    // a much stronger signal once the teacher has actually marked that
    // prereq as taught. topics is a flat array of "grade::unit::topic"
    // strings
    // (see computeMissingPrereqs in dashboard.js for the reader side).
    async updateClassTaughtTopics(classId, topics) {
      const { data, error } = await client
        .from('classes')
        .update({ taught_topics: topics })
        .eq('id', classId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },

    // Resolves the code and joins server-side (see join_class_by_code in
    // supabase-schema.sql) - the classes table itself is never exposed to
    // browsing/guessing by invite code.
    async joinClassByCode(code) {
      const { data, error } = await client.rpc('join_class_by_code', { code });
      if (error) throw error;
      return data && data[0];
    },

    async listClassRoster(classId) {
      const { data, error } = await client
        .from('class_members')
        .select('student_id,student_email,student_display_name,joined_at')
        .eq('class_id', classId)
        .order('joined_at');
      if (error) throw error;
      return data;
    },

    // Teacher-only in practice (RLS only grants visibility into students'
    // maps for the teacher of their class); scoped to one class via the
    // roster's student ids, with RLS remaining the actual security boundary.
    async listStudentMapsInClass(classId) {
      const roster = await this.listClassRoster(classId);
      const studentIds = roster.map(r => r.student_id);
      if (!studentIds.length) return [];
      const activities = await this.listClassActivities(classId);
      if (!activities.length) return [];
      const { data, error } = await client
        .from('maps')
        .select('id,title,updated_at,owner_id')
        .in('owner_id', studentIds)
        .in('activity_id', activities.map(a => a.id))
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data;
    },

    // --- Beta: map timeline ---

    async listMyTimelines() {
      const { data, error } = await client
        .from('map_timelines')
        .select('id,name,created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },

    async createTimeline(name) {
      const { data, error } = await client.from('map_timelines').insert({ name }).select().single();
      if (error) throw error;
      return data;
    },

    async deleteTimeline(id) {
      const { error } = await client.from('map_timelines').delete().eq('id', id);
      if (error) throw error;
    },

    // Maps' own owner-scoped UPDATE policy already covers this - no
    // timeline-specific RLS needed beyond the map_timelines table itself.
    async setMapTimeline(mapId, timelineId) {
      const { error } = await client.from('maps').update({ timeline_id: timelineId }).eq('id', mapId);
      if (error) throw error;
    },

    async listTimelineMaps(timelineId) {
      const { data, error } = await client
        .from('maps')
        .select('id,title,data,created_at,is_checkpoint')
        .eq('timeline_id', timelineId)
        .order('created_at', { ascending: true })
        .order('is_checkpoint', { ascending: false });
      if (error) throw error;
      return window.SpanConceptBank ? data.map(window.SpanConceptBank.row) : data;
    },

    // Same access pattern as listStudentMapsInClass, but also pulls the map
    // contents (nodes/links) for class-wide analysis - Class Insights.
    async listClassMapsWithData(classId) {
      const roster = await this.listClassRoster(classId);
      const studentIds = roster.map(r => r.student_id);
      if (!studentIds.length) return [];
      const activities = await this.listClassActivities(classId);
      if (!activities.length) return [];
      const { data, error } = await client
        .from('maps')
        .select('id,title,owner_id,data,updated_at,activity_id')
        .in('owner_id', studentIds)
        .in('activity_id', activities.map(a => a.id))
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return window.SpanConceptBank ? data.map(window.SpanConceptBank.row) : data;
    },

    // --- Activities: a teacher-defined assignment with its own concept
    // set, scoping Class Insights to "this specific assignment" instead of
    // a student's whole map history (see supabase-schema.sql). ---

    async getActivity(id) {
      const { data, error } = await client.from('activities').select('id,class_id,name,concepts,ai_disabled').eq('id', id).single();
      if (error) throw error;
      return window.SpanConceptBank?.activity(data) || data;
    },

    async listClassActivities(classId) {
      const { data, error } = await client
        .from('activities')
        .select('id,name,concepts,created_at,ai_disabled')
        .eq('class_id', classId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return window.SpanConceptBank ? data.map(window.SpanConceptBank.activity) : data;
    },

    async createActivity(classId, name, concepts, aiDisabled = false) {
      const { data, error } = await client
        .from('activities')
        .insert({ class_id: classId, name, concepts, ai_disabled: aiDisabled })
        .select()
        .single();
      if (error) throw error;
      return data;
    },

    async updateActivity(id, name, concepts, aiDisabled) {
      const {data,error} = await client.from('activities').update({name,concepts,ai_disabled:aiDisabled}).eq('id',id).select().single();
      if (error) throw error;
      return window.SpanConceptBank ? window.SpanConceptBank.activity(data) : data;
    },

    async setActivityAiDisabled(id, disabled) {
      const { error } = await client.from('activities').update({ ai_disabled: disabled }).eq('id', id);
      if (error) throw error;
    },

    async deleteActivity(id) {
      const { error } = await client.from('activities').delete().eq('id', id);
      if (error) throw error;
    },
  };
})();
