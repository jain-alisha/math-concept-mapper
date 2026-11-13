# Span pilot QA corrections

Built on main commit `0977a4b` (the existing in-page rename/dialog work), preserving the user's recent commits.

## Changes

- Replaced catalog adjacency/keyword prerequisites with 94 authored, directed edges in `static/prerequisites.json`. Explore and both map checkers share this data. Directional Explore runs locally; unknown or exhausted graph neighborhoods return no invented dependencies. Related-idea requests still use the recommendation backend. Legacy aliases preserve interpretation of existing maps.
- Removed self-service teacher role switching and its unsafe SQL definition. Teacher access uses administrator-managed `app_metadata`, with a clear message in Settings. The migration removes a previously installed demo RPC and reloads the PostgREST schema.
- Moved map explanations/check results outside their disappearing parent menu. Summaries name actual concepts, links and notes; removed raw sidebar note boxes.
- Normalized Unicode hyphens and compatibility characters for search.
- Avoided placing new nodes/ghost suggestions on real nodes, existing link curves or other suggestions. Additional suggestions append and retain positions. Suggestion labels fit their boxes; provenance badges are larger.
- Added the current map title, truthful “Find map start” action, consistent Map Timeline/Clear names, common Escape dismissal, mutually exclusive panels, map-area warning positioning and arrow legend. Both clear buttons use the same existing confirmation.
- Save a copy asks for an explicit new title, guards concurrent clicks, refreshes the map list immediately, confirms the new editing identity and no longer creates hidden timelines. Timeline assignment remains an explicit action in My Maps.
- Student summaries use their actual map concepts and timeline identities. Class summary explicitly uses the same student coverage metric as Curriculum coverage.
- Teacher links open a read-only map in the same tab, with mutation controls and the editing sidebar removed. Read-only guards also cover undo/redo, cloud saving and shared-map URLs.
- Teacher feedback was cut at the user’s request. The earlier local-only drafts were removed; no feedback delivery feature is offered.
- Added visible SVG preview labels, compact arrangements for very wide thumbnails, stable Timeline bounds, responsive dashboard cards, roomier provenance labels, and on/off + aria state for anonymous mode.
- Unified site navigation/auth state and split editor tools into a separate row. Updated homepage hero topics to grades 3–8 and added CoCreate Courses identity, privacy/student-data notice and a verified support-page contact.
- Corrected reported catalog wording, normalized recurring volume/rational-number labels by grade, removed the duplicate exponential-expression topic, and moved whole-number equivalent ratios into grade 6.

## Validation

- `node --test tests/*.test.cjs`: 10 regression tests.
- `python -m unittest discover -s tests -v`: 9 regression tests.
- Syntax checks on every first-party JavaScript file.
- Browser preview checks: explanation visibility/content, Unicode search in both grades, Mixed numbers prerequisites, map placement, shared site/editor navigation, labelled class previews, anonymous mode, and teacher read-only shared-map viewing.
- Authenticated cloud save/copy workflows and production Supabase policies were not exercised against a live signed-in account.

## Rollout

1. Deploy the static directory through the existing Vercel workflow. Its directional suggestions already work without a coordinated backend deployment.
2. Deploy `ai_recommender.py` plus the new graph/catalog to the existing Render service so direct API clients also use the corrected graph.
3. Run `migrations/20261113_remove_demo_role_toggle.sql` in the existing Supabase project. No account roles or maps are deleted. This migration has **not** been applied by this change.
4. Recheck authenticated student/teacher headers, cloud save/copy/list refresh and read-only classroom access with test accounts.

The graph intentionally covers authored relationships only; it is not an exhaustive prerequisite model for every catalog topic. Privacy copy describes current behavior, not a school data-processing agreement or compliance certification. There is no verified private support email in the repository; the public support page warns against posting student information.

## Addendum (2026-11-13, after merge)

Item 2's removal of self-serve role switching was reverted at the user's explicit request immediately after this branch was merged into `main` - the "Switch to teacher/student view" toggle (`toggle_role()`) is back, and `migrations/20261113_remove_demo_role_toggle.sql` was deleted rather than applied. The safety argument for admin-only role management still stands and is tracked in `TODO.md`'s "Auth & roles" section; it just wasn't the call made here. Everything else in this document reflects what's actually on `main`.
