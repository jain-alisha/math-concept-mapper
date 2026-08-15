# Future Work

## Deployment

Current setup is Render (API) + Vercel (static frontend) + Supabase
(auth/db) — this is the supported, working path. Keep new deployment work
scoped to making this combination solid rather than adding a second target.

<!--
BACKBURNER (not active — revisit only if Render's free-tier cold start
becomes a real problem):

- **Move AI backend off Render to Oracle Cloud Always Free tier.** Render's
  free web service sleeps after 15 min idle (cold start on next request) and
  its 512MB RAM is borderline for `sentence-transformers`/`torch`. Oracle's
  Always Free tier gives a real always-on VM (4 OCPU / 24GB RAM, free
  forever) with no sleep policy — but it's actual ops work (SSH in, set up
  systemd or Docker, reverse proxy + TLS) instead of Render's git-push
  deploy. An SSH keypair for this (`~/.ssh/oracle_span_vm`) was generated
  ahead of time but no VM/infra was ever provisioned — nothing to tear down.
-->

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

## Beta Features (planned, labeled "Beta" on the homepage)

Once an item below is actually shipped, move it down into the "Done" list for
this section instead of deleting it.

- AI teacher analysis should include classwide gaps, so if a teacher signaled
  to the AI thing (set this up too, like on their dashboard what they've
  taught).
- A way for students to kinda save maps to their dashboard & a feature where
  they can line for example, October 4th map + October 18th map (and allow
  them to label their own maps) and play kind of like a movie with a slider.

### Done

- Highlight isolated nodes w/ no/few connections w/ like graph stuff compared
  to the other nodes. Shipped in `static/app.js`/`playground.html`: nodes
  with zero links get a dashed border + a small corner badge, computed live
  off the current `links` array on every `renderCanvas()`, plus a
  bottom-left "Beta" legend that only shows when at least one isolated node
  is on the canvas.
- Short AI summary, e.g. "your map is strong on ratios, thin on slope
  concepts." Shipped as an "AI Summary" topbar button in
  `static/playground.html`/`app.js`: a heuristic (not a model call) that
  groups the current map's nodes by curriculum unit and compares each
  unit's connected-vs-isolated ratio to produce a one-line "Strong on X,
  thin/lighter on Y" read, regenerated fresh every time the panel opens.
- Add a sample teacher dashboard with mock data + mock student maps already
  populated. Was already mostly built (`settings.html?sample=1`,
  `buildSampleClassData()` in `static/settings.js`) but the sample student
  maps were actually broken - every node had hardcoded `x:0, y:0`, so
  opening one collapsed all its nodes onto a single point. Fixed by giving
  each of the 4 sample students' maps real, distinct node positions;
  verified via Playwright that all 4 now open with unique, non-overlapping
  coordinates.

## Teacher-Side AI Analysis

- Surface insights to teachers based on student map activity — e.g. which
  concepts students commonly leave unconnected, common misconceptions inferred
  from incorrect/missing links, or aggregate class-wide gaps vs. the
  curriculum structure.
- Likely builds on the existing `ai_recommender.py` graph/semantic-similarity
  logic, applied across many students' maps instead of one at a time.
- Depends on the student/teacher portal + persistence work above existing
  first (nothing to analyze until maps are saved per-student).
