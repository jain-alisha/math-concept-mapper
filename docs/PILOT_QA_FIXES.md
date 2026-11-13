# Span pilot QA corrections — current status

Updated November 13, 2026. PR #3 was merged as `05b3dac`, preserving the user's toolbar cleanup at `052c6ec`. Repository state and production deployment are separate: the live frontend still served the older interface when checked after this merge.

## Implemented in main

- Explore and both checkers use 94 authored, directed prerequisite edges from `static/prerequisites.json`, with legacy aliases. Directional Explore runs locally. Unknown/exhausted neighborhoods produce no invented dependencies; related ideas still use the backend.
- Map explanations and check results appear outside the disappearing menu. Summaries name real concepts, links and notes. Unicode search, placement collision checks, appended suggestions, labels and provenance badges were corrected.
- Current map title, Find map start, consistent Timeline/Clear names, Escape dismissal, mutually exclusive panels and arrow legend are present. Find map start scrolls; it does not zoom to fit.
- Save a copy asks for a title, guards concurrent clicks, refreshes the list and switches to the editable duplicate. It does not silently create a timeline.
- Teacher links open read-only in the same tab; mutation entry points, undo/redo and saving are guarded.
- Teacher feedback drafts were removed at the user's request. No draft delivery feature exists.
- Independent username/password student accounts support cloud persistence, private recovery keys and membership in multiple classes. Existing email accounts remain supported.
- Save starting checkpoint creates an immutable snapshot and groups it with the editable working map. Ordinary copies remain editable.
- Account deletion, daily 12-month map expiry and under-13 authorization-code enforcement are implemented. Adult authority/evidence must be verified outside the app before issuing codes. See `INDEPENDENT_STUDENT_ACCOUNTS.md`.
- Navigation, catalog wording, grades 3–8 positioning, privacy notice, responsive cards and timeline bounds were corrected.

## Follow-up corrections in this change

- Checker recommendations now display the authored mathematical reason and direction, rather than claiming catalog adjacency. Custom labels render as text. Accepted prerequisite suggestions retain their relationship type.
- Activity selection scopes Class at a Glance, roster map links and insights consistently. Non-submitters remain visible with an explicit no-submission message.
- New activities have concept search, grade/unit filters and a selected-concepts summary. Filtering preserves selections. Labels use current help-tool names.
- Anonymous projection hides the account header, class name and invite code as well as replacing student names. Student-authored map content is not automatically redacted.
- Read-only maps have viewing-oriented isolated-node copy. Clicking or keyboard-activating a note opens its complete explanation without enabling editing.
- PDFs retain compact map chips and add paginated, full-length explanation pages, rendered with browser fonts to preserve mathematical Unicode.
- Dashboard thumbnails have expandable full concepts/explanations. Concept selectors have accessible names.
- A missing demo-toggle RPC produces an actionable message. `migrations/20261113_restore_requested_demo_toggle.sql` contains the existing requested toggle definition and schema reload; it has NOT been applied.

## Role-switching decision

The user's explicit post-merge request restored the demo teacher/student toggle. The earlier admin-only removal and `20261113_remove_demo_role_toggle.sql` rollout instruction are obsolete; that migration was deleted and must not be run. The live API currently lacks `toggle_role()`, which blocks the authenticated teacher workflow. The prepared repair intentionally preserves the requested demo behavior. It does not provide verified teacher authorization; the existing `TODO.md` role-gating issue remains before a real student pilot.

## Validation and deployment boundaries

- `npm test`: 32 passing JavaScript, DOM, endpoint and embedded-Postgres tests; Python prerequisite tests: 9 passing. JavaScript syntax checked.
- Embedded database tests exercise multiple-class membership, activity-scoped teacher RLS, checkpoint immutability, expiry, private authorization tables and deletion cascades.
- Previous live synthetic-account API checks exercised signup, login, saving, checkpoint rejection, continued editing and recovery. Account deletion has automated endpoint/cascade coverage, but no completed live account-deletion check.
- The three account/checkpoint/authorization migrations, daily Cron job and `student-accounts` Edge Function were installed in the earlier work. This does not imply the frontend has deployed.
- The November 13 production recheck found `account-forms.js` absent, no checkpoint button, and the teacher-toggle schema-cache error. Vercel and Supabase dashboards require sign-in, blocking deployment repair and authenticated teacher verification.
- Responsive phone browser testing remains unverified; an earlier viewport override did not change the actual viewport. Do not describe every feature as UI-tested.

## Remaining work

1. Restore Vercel access and deploy the merged frontend plus this follow-up. Verify signup, recovery-key acknowledgment, cloud save/copy/checkpoint/list refresh, and account deletion on disposable accounts.
2. Restore Supabase access and install the requested toggle repair; test teacher/student switching, two classes and teacher-only classroom visibility. Before a real pilot, resolve the separate demo-role authorization issue.
3. Render live API checks passed: Mixed numbers returned distinct authored prerequisites/successors, and an unknown topic returned no prerequisite suggestions. This verifies those cases, not every graph edge.
4. Remove the earlier synthetic QA account `9e648a94-6fe1-4efe-853b-13a15057cc41` after verifying it contains only QA fixtures.
5. Refresh account/checkpoint and filtered-dashboard screenshots in the classroom guide after the UI is actually live. The current guides intentionally describe the older production interface.
6. General improvement ideas remain: fit-entire-map zoom, separate concept identity/display labels for custom synonyms, and a fully exercised phone layout. Exact bank labels avoid the custom-label aggregation mismatch in the guide's six samples.

The graph is intentionally authored and partial. Privacy copy is not a data-processing agreement or compliance certification. No adult authorization codes have been issued as part of this work.

## Live rollout and recording fixtures (November 13)

PR #4 merged as `3c6b939`. The existing Vercel project was connected to the public GitHub repository and this commit was deployed to production. The independent account/checkpoint frontend is now live. Normal save, named copy, checkpoint grouping/read-only viewing, note access, filtered teacher demo views and concept search were checked in the browser. A disposable live API account completed signup, password sign-in, recovery, self-deletion and map/timeline cascades. The original older QA fixture still awaits cleanup.

The recording fixtures in this change replace the sparse, inconsistent sample datasets with two classes, twelve fictional students, six activities and seventy submissions, plus six student projects and three four-frame growth timelines. Both dashboards and sample editor share one source. Fifteen cloud presentation maps and three timelines were also seeded for the existing account. No real students were created. See `DEMO_WALKTHROUGH.md`.

The demo toggle migration remains prepared but unapplied because it enables self-promotion to teacher. The QA deletion set is reviewed but not yet deleted. Phone viewport testing remains unavailable: the override still reported a desktop viewport.

The recording pass also found My Maps and Timeline covering their toolbar triggers after the two-row navigation change. Both panels now move with the editor tools and anchor below that row; expanded Timeline retains its full-screen positioning.

Opening an owned working map from a read-only checkpoint now starts a fresh editing route, rather than retaining read-only state and the old banner. The editing route verifies map ownership before loading.
