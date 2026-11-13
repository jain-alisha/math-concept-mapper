// Service-role client is injected by index.ts; this module is also tested in Node.
export function normalizeUsername(value) {
  const username = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[a-z][a-z0-9_]{3,23}$/.test(username)) throw new Error('Use 4–24 letters, numbers or underscores, starting with a letter.');
  return username;
}
export const loginEmail = username => `${username}@students.span.invalid`;
export async function hashKey(key) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
function makeKey() {
  return Array.from(crypto.getRandomValues(new Uint8Array(20)), b => b.toString(16).padStart(2, '0')).join('').match(/.{1,5}/g).join('-');
}
export function createHandler(admin, allowedOrigins) {
  return async request => {
    const origin = request.headers.get('origin');
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    if (origin && allowedOrigins.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
    const reply = (body, status = 200) => new Response(JSON.stringify(body), {status, headers});
    if (origin && !allowedOrigins.includes(origin)) return reply({error:'This site is not allowed.'},403);
    if (request.method === 'OPTIONS') return new Response(null,{status:204,headers});
    if (request.method !== 'POST') return reply({error:'Use POST.'},405);
    // Read with an actual byte cap, including requests without Content-Length.
    let body;
    try {
      const reader = request.body?.getReader();
      if (!reader) return reply({error:'Missing request.'},400);
      let size = 0; const chunks = [];
      while (true) { const {done,value} = await reader.read(); if(done) break; size += value.length;
        if(size > 4096) { await reader.cancel(); return reply({error:'Request too large.'},413); } chunks.push(value); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch { return reply({error:'Invalid request.'},400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({error:'Invalid request.'},400);
    if (body.action === 'deleteAccount') {
      const token = request.headers.get('authorization')?.replace(/^Bearer /i,'');
      if (!token) return reply({error:'Sign in first.'},401);
      try {
        const {data,error} = await admin.auth.getUser(token);
        if (error || !data.user) return reply({error:'Sign in again before deleting your account.'},401);
        // Identity comes exclusively from the verified JWT, never a body user id.
        const {error: deletionError} = await admin.auth.admin.deleteUser(data.user.id);
        if(deletionError) return reply({error:'Could not delete the account. Please try again.'},503);
        return reply({ok:true});
      } catch { return reply({error:'Could not delete the account. Please try again.'},503); }
    }
    let username;
    try { username = normalizeUsername(body.username); } catch(e) { return reply({error:e.message},400); }
    if (!['signup','recover'].includes(body.action)) return reply({error:'Unknown action.'},400);
    if (typeof body.password !== 'string' || body.password.length < 10 || body.password.length > 128) return reply({error:'Choose a password with 10–128 characters.'},400);
    try {
      // Global limits cannot be bypassed by rotating usernames/IP headers.
      // Per-username recovery limits protect individual accounts across instances.
      for (const [bucket, maxAttempts] of [['student-accounts:global',300], [body.action + ':' + username, body.action === 'recover' ? 5 : 10]]) {
        const {data,error} = await admin.rpc('consume_student_account_attempt', {bucket, max_attempts:maxAttempts});
        if(error) return reply({error:'Account service is temporarily unavailable.'},503);
        if(!data) return reply({error:'Too many attempts. Try again in 15 minutes.'},429);
      }
      if (body.action === 'recover') {
        const key = typeof body.recoveryKey === 'string' ? body.recoveryKey.replace(/[-\s]/g,'').toLowerCase() : '';
        if (!/^[a-f0-9]{40}$/.test(key)) return reply({error:'Username or recovery key is incorrect.'},400);
        const {data: account,error} = await admin.from('student_accounts').select('user_id').eq('username',username).eq('recovery_hash',await hashKey(key)).maybeSingle();
        if(error) return reply({error:'Account service is temporarily unavailable.'},503);
        if(!account) return reply({error:'Username or recovery key is incorrect.'},400);
        const {error: resetError} = await admin.auth.admin.updateUserById(account.user_id,{password:body.password});
        if(resetError) return reply({error:'Could not reset the password. Try again.'},400);
        return reply({ok:true});
      }
      if (!['under13','13plus'].includes(body.ageBand)) return reply({error:'Select your age group.'},400);
      let authorizationId = null;
      if (body.ageBand === 'under13') {
        const code = typeof body.authorizationCode === 'string' ? body.authorizationCode.replace(/[-\s]/g,'').toLowerCase() : '';
        if (!/^[a-f0-9]{40}$/.test(code)) return reply({error:'Ask your parent or school for an authorization code before signing up.'},400);
        const {data: approved,error: approvalError} = await admin.rpc('claim_student_authorization',{digest:await hashKey(code)});
        if(approvalError) return reply({error:'Authorization service is unavailable.'},503);
        if(!approved) return reply({error:'This authorization code is invalid, expired or full. Ask your parent or school for a new one.'},400);
        authorizationId = approved;
      }
      const release = async () => { if(authorizationId) await admin.rpc('release_student_authorization',{authorization_ref:authorizationId}); };
      // Supabase uses an internal, undeliverable identifier. No inbox or email
      // confirmation is needed; admin APIs and secrets never enter the browser.
      const {data,error} = await admin.auth.admin.createUser({email:loginEmail(username), password:body.password,
        email_confirm:true, app_metadata:{role:'student',account_kind:'username'},
        user_metadata:{username,display_name:username}});
      if(error || !data.user) { await release(); return reply({error:'Could not create this account. Try another username or a stronger password.'},400); }
      const recoveryKey = makeKey();
      const {error: storeError} = await admin.from('student_accounts').insert({user_id:data.user.id,username,
        authorization_id:authorizationId,age_band:body.ageBand,
        recovery_hash:await hashKey(recoveryKey.replaceAll('-',''))});
      if(storeError) {
        await admin.auth.admin.deleteUser(data.user.id);
        await release();
        return reply({error:'Could not finish signup. Please try again.'},503);
      }
      return reply({username,recoveryKey});
    } catch { return reply({error:'Account service is temporarily unavailable.'},503); }
  };
}
