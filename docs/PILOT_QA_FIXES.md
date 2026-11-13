# Span pilot QA status

Current implementation includes independent username/password accounts,
multiple-class membership, protected starting checkpoints, editable working
copies, daily twelve-month map expiry, self-service account deletion and
activity-scoped teacher map visibility. Teacher feedback drafts were cut.

The current revision replaces skill/task labels with short concept nouns and
stable identities. Historical label aliases preserve old maps, links, activity
keys and taught-topic keys. Original curriculum alignments stay in metadata;
see `CONCEPT_BANK.md`.

Signup now uses a normal username/password or email/password flow without extra
age/code fields or a separate key step. See `INDEPENDENT_STUDENT_ACCOUNTS.md` for
existing-database cleanup and Edge Function deployment order.

The dashboard setting is **Disable map help**, consistently used for assignment
configuration and instructions. **Map help** contains Explain my map and What
could I improve? The setting also disables Find related ideas.

The user requested the ungated demo teacher/student toggle. The corrected SQL
function switches both ways. Teacher role gating for a real deployment remains
tracked separately in TODO.md.

Other completed fixes include authored graph direction, Unicode search, readable
notes, PDF explanation pages, activity-filtered thumbnails/roster/insights,
anonymous names/titles/class headers, lower-first progress ordering, toolbar
panels anchored below their buttons, and separate stacked assignment/shared-copy
notices above the map. Demo data is fictional and deterministic.

## Validation and rollout

Run `npm test` and `python -m unittest discover -s tests -v`. Tests do not imply a
completed production UI pass. Publish the database/function account changes
before the static signup UI, and deploy the matching graph/catalog to Render.
Recheck production signup, cloud saving, teacher/student headers and legacy maps.

Current screenshots must be captured after the concept-bank rollout. Do not use
old skill-label screenshots with new noun-label instructions. Activity 3 starts
from its own sample or an existing map from the same assignment; its two proposed
rescues illustrate revisions to that sample.
