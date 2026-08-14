# Future Work

## Deployment

- **Move AI backend off Render to Oracle Cloud Always Free tier.** Render's free
  web service sleeps after 15 min idle (cold start on next request) and its
  512MB RAM is borderline for `sentence-transformers`/`torch`. Oracle's Always
  Free tier gives a real always-on VM (4 OCPU / 24GB RAM, free forever) with no
  sleep policy — but it's actual ops work (SSH in, set up systemd or Docker,
  reverse proxy + TLS) instead of Render's git-push deploy. Do this once the
  Render cold start becomes annoying enough to justify the setup time.

## Student & Teacher Portals

- **Done:** accounts (Supabase Auth) and per-user cloud map persistence
  ("My Maps" panel in the playground) — see `README.md`'s "Accounts & Cloud
  Save" section and `supabase-schema.sql`. Login is optional; anonymous use
  (localStorage autosave, share links, sample map) is unchanged.
- **Done:** rostering — `static/settings.html` → Classes. Teachers create a
  class and get a shareable invite code (`XXXX-XXXX`, unambiguous alphabet);
  students join by entering it. Teachers get read-only visibility into maps
  saved by students in their class (`static/app.js`'s `?view=<id>&readonly=1`
  mode — genuinely read-only: mutation entry points and `autosave()` itself
  are both gated, not just relying on RLS to silently reject a stray write).
  `classes`/`class_members` tables + `join_class_by_code` RPC in
  `supabase-schema.sql`; only a verified teacher (JWT `app_metadata.role`
  claim, not a hidden UI button) can create a class.
- Role (`student`/`teacher`) is still not self-serve — see `static/auth.js`
  and `README.md` for why and how to promote an account.

## Next ideas for the portal

- Teacher-initiated actions on a student's map (comments/feedback, not just
  viewing).
- Removing a student from a class / a student leaving a class (currently
  membership is permanent once joined — fine for a demo, not for a real term).
- Class-level views beyond a flat roster (e.g. grouping by assignment).

## Teacher-Side AI Analysis

- Surface insights to teachers based on student map activity — e.g. which
  concepts students commonly leave unconnected, common misconceptions inferred
  from incorrect/missing links, or aggregate class-wide gaps vs. the
  curriculum structure.
- Likely builds on the existing `ai_recommender.py` graph/semantic-similarity
  logic, applied across many students' maps instead of one at a time.
- Depends on the student/teacher portal + persistence work above existing
  first (nothing to analyze until maps are saved per-student).
