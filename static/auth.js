// Span auth + cloud map storage, backed by Supabase (see supabase-schema.sql
// and README.md for setup). Loaded after static/vendor/supabase.js.
//
// Deliberately not a role picker at signup: role lives in
// auth.users.app_metadata, which the client SDK cannot write, so a logged-in
// user can never self-promote to "teacher" by editing their own row. Every
// self-serve signup is a student; promote to teacher via the SQL in
// supabase-schema.sql. Missing/absent app_metadata.role is treated as
// 'student'.

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

  window.SpanAuth = {
    isConfigured: true,
    client,

    async signUp(email, password, displayName) {
      const { data, error } = await client.auth.signUp({
        email, password,
        options: { data: { display_name: displayName || '' } },
      });
      if (error) throw error;
      return data;
    },

    async signIn(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return data;
    },

    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) throw error;
    },

    async getSession() {
      const { data } = await client.auth.getSession();
      return data.session;
    },

    onAuthStateChange(cb) {
      client.auth.onAuthStateChange((_event, session) => cb(session));
    },

    role: roleOf,

    // listMyMaps()'s contract is "maps I own" - it needs an explicit filter
    // now that a second RLS policy (teachers viewing their students' maps)
    // means "rows RLS lets me see" is no longer synonymous with "rows I own".
    // Without this filter, a teacher's own My Maps panel would silently
    // include every one of their students' maps too.
    async listMyMaps() {
      const { data: { session } } = await client.auth.getSession();
      if (!session) return [];
      const { data, error } = await client
        .from('maps')
        .select('id,title,updated_at,created_at,timeline_id')
        .eq('owner_id', session.user.id)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data;
    },

    async loadMapById(id) {
      const { data, error } = await client.from('maps').select('*').eq('id', id).single();
      if (error) throw error;
      return data;
    },

    // Returns { row } on success, { conflict: true } if a stale write was
    // rejected (id + lastKnownUpdatedAt supplied but no longer matches -
    // the map changed elsewhere since it was loaded).
    async saveMap({ id, title, data, lastKnownUpdatedAt }) {
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
        .insert({ title, data, updated_at: nowIso })
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
      return data;
    },

    async createClass(name) {
      const { data, error } = await client.from('classes').insert({ name }).select().single();
      if (error) throw error;
      return data;
    },

    // Beta: classwide gap analysis factors this in - a "missing prereq" is
    // a much stronger signal once the teacher has actually marked that
    // prereq as taught. topics is a flat array of "unit::topic" strings
    // (see computeMissingPrereqs in settings.js for the reader side).
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
      const { data, error } = await client
        .from('maps')
        .select('id,title,updated_at,owner_id')
        .in('owner_id', studentIds)
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
        .select('id,title,data,created_at')
        .eq('timeline_id', timelineId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data;
    },

    // Same access pattern as listStudentMapsInClass, but also pulls the map
    // contents (nodes/links) for class-wide analysis - Class Insights.
    async listClassMapsWithData(classId) {
      const roster = await this.listClassRoster(classId);
      const studentIds = roster.map(r => r.student_id);
      if (!studentIds.length) return [];
      const { data, error } = await client
        .from('maps')
        .select('id,title,owner_id,data')
        .in('owner_id', studentIds);
      if (error) throw error;
      return data;
    },
  };
})();
