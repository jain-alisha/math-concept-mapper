import { createClient } from 'npm:@supabase/supabase-js@2.49.8';
import { createHandler } from './handler.mjs';
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const origins = (Deno.env.get('STUDENT_ACCOUNT_ORIGINS') || 'https://spanmath.org,https://www.spanmath.org').split(',').map(s => s.trim()).filter(Boolean);
// Only the production origins are allowed by default; never a wildcard.
Deno.serve(origins.length ? createHandler(admin, origins) : () => Response.json({error:'Student accounts are not enabled yet.'},{status:503}));
