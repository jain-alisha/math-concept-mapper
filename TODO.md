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
this section instead of deleting it. All five original items are done as of
2026-08-15 - this list is currently empty; add new Beta ideas here as they
come up.

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
  populated. Later expanded into its own page - see "Teacher Dashboard is
  now its own page" below - and the sample data itself was substantially
  enriched (6-node fully-connected chain with notes, 5 students instead of
  4, curriculum coverage spanning two grades). Was originally broken -
  every sample node had hardcoded `x:0, y:0`, so opening one collapsed all
  its nodes onto a single point; fixed by giving each sample map real,
  distinct positions.
- AI teacher analysis should include classwide gaps, so if a teacher
  signaled to the AI thing (set this up too, like on their dashboard what
  they've taught). Built: `classes.taught_topics` jsonb column + `"teachers
  update own classes"` UPDATE policy (`supabase-schema.sql` - teacher-owned
  classes had no UPDATE policy at all before this), `updateClassTaughtTopics()`
  in `static/auth.js`, a "What have you taught?" checklist (scoped to
  whichever curriculum units actually appear in the class's student maps,
  not the whole curriculum tree), and `computeMissingPrereqs()` takes an
  optional `taughtSet` so each flagged gap is labeled "you taught this"
  (real signal) vs. "(not yet taught)" (expected, not a real gap yet),
  sorting taught-and-missing first. **Migration run and verified live against
  production Supabase on 2026-08-15** (clean 200s from `classes.taught_topics`,
  `maps.timeline_id`, and `map_timelines` - not the 400 "column does not
  exist" that would show if it hadn't run).
- A way for students to kinda save maps to their dashboard & a feature where
  they can line for example, October 4th map + October 18th map (and allow
  them to label their own maps) and play kind of like a movie with a slider.
  Built as map timelines: students already save/label maps via My Maps
  (unchanged), and can now group any of them into a named timeline via a
  per-row "Timeline…" select (`static/app.js`) - a "Timeline" topbar button
  opens a viewer with a slider + play/pause that scrubs between the grouped
  maps in chronological order, rendered via a self-contained
  `renderTimelineFrame()` that deliberately doesn't touch the live canvas's
  shared node-color/state, so scrubbing someone's history can never bleed
  into their in-progress editing session. New `map_timelines` table +
  `maps.timeline_id` column in `supabase-schema.sql`; `createTimeline`/
  `listMyTimelines`/`setMapTimeline`/`listTimelineMaps`/`deleteTimeline` in
  `static/auth.js`. Migration confirmed live 2026-08-15 (see above).

## Teacher-Side AI Analysis

- **Done, as of 2026-08-15 — Teacher Dashboard is now its own page.** Moved
  off `settings.html` (which was getting cramped) onto dedicated
  `dashboard.html`/`dashboard.js`. Settings kept lean: create/join a class,
  list your classes (each linking out to its Dashboard), and - for
  signed-out visitors - a "preview as Student/Teacher" toggle with a note
  ("this is a demo of what you'd see as this role") that swaps the
  description + CTA (Teacher → `dashboard.html?sample=1`, Student →
  `playground.html?sample=1`, since a student's real surface area is
  "build a map" + "join a class," and the join form is right there already).
  `playground.html`'s topbar gains a role-aware "Dashboard" link, visible
  only when signed in as a teacher.
- **Done — "Class at a Glance" card grid.** A small live SVG thumbnail per
  student's most recent map (`renderMapThumbnail()`/`renderStudentMapCards()`
  in `dashboard.js`) so a teacher can visually scan the whole class instead
  of reading a text list. Deliberately self-contained (no shared
  text-measurer or color-assignment state) so it can never interfere with
  the playground's own canvas rendering.
- **Done — way more insights.** Six insight cards instead of three: the
  original Most-explored concepts / Added but never connected / Missing
  prerequisite connections (now classwide-gaps-aware), plus three new ones -
  **Hub concepts** (total connectedness per concept summed across the whole
  class, not just how many students used it - a structurally different
  signal from frequency), **Student progress** (distinct concepts + total
  connections per student, lowest first, flagging students well below the
  class average), and **Curriculum coverage** (which grade/unit pairs the
  class's maps actually touch, and how many students are in each). Plus a
  class-wide **AI summary banner** at the top (`computeClassSummary()`) -
  the same "strong on X, thin on Y" heuristic as the playground's per-map
  AI Summary, rolled up across every student's maps. All six + the banner
  are keyed by grade+unit, not unit alone, after catching that curriculum
  unit names repeat across grades (both 6th and 7th grade have a "Ratios &
  Proportional Relationships" unit) - a unit-only key would have silently
  conflated two different grades' data.
- Likely builds further on the existing `ai_recommender.py` graph/semantic-
  similarity logic for future rounds (e.g. real misconception detection from
  incorrect/missing links, not just structural gaps).
