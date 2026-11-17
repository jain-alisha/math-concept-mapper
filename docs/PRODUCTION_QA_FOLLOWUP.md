# Production QA follow-up

This change addresses P01–P08 from the November 15 production audit.

| Finding | Change |
|---|---|
| P01 | Built-in sample edits use their own local draft key and resume that draft on reload. They cannot replace the ordinary Playground draft. |
| P02 | Expanding Timeline sets the actual open panel to flex, constrains its frame, and reserves space for playback controls. Closing/reopening can expand again. |
| P03 | Phone legends are grouped into a closed Map hints disclosure; shared-copy wording is shorter and catalogue height is bounded. The browser-only saving warning stays visible. |
| P04 | Duplicate checks resolve the identity of existing nodes even if they do not store a concept ID. |
| P05 | Discussion prompts aggregate by canonical source/target identity, counting each student once and retaining taught-topic alignments. |
| P06 | Timeline names are native buttons. Every arrow is focusable and Enter/Space opens its explanation; read-only arrows only read. Playback and snapshot controls have meaningful accessible names. |
| P07 | Teacher dashboards explicitly distinguish historical All maps insight totals from latest-map previews. Selecting an activity explains that previews and insights share the latest submission per student. |
| P08 | Reviewed related pairs contain specific mathematical examples and work locally. Unreviewed curriculum fallback explicitly asks the student to explain a possible connection rather than claiming a verified relationship. |
| P09 | Pending explicit permission to publish a private support email in the public app/repository. The proposed contact edit is not included in this branch. |

No database migration or new account-reset endpoint is introduced. The existing account-help route remains until the owner approves a private contact.
Existing drafts already replaced before this fix cannot be reconstructed by
separating future draft keys.

Validation: `npm test` (66 passing tests) and
`python3 -m unittest discover -s tests -p 'test_*.py'` (13 passing tests).
Rendered desktop and 390px checks are performed on the branch preview and
production rollout. Publish the matching Python service and
`static/related-connections.json` with the client.
