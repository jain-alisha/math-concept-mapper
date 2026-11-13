# Concept bank

Nodes name mathematical ideas: Equal parts, Unit fraction, Number line, Ratio,
Unit rate, Ratio table, and similar short nouns. They are not task prompts.

`static/concepts.json` keeps the grade/unit picker order. Repeated skills that
name the same idea merge within that unit. A concept has one stable `math:` ID
across grades and units; its grade/unit alignments stay in metadata.

`data/concept-alignment.json` retains all 625 original skill alignments, the short
concept names and historical-label lookup keys. No external standard codes were
supplied in the original catalog, so none are invented. Supplied codes can be
added to alignment records later without lengthening node labels.

Run `python3 scripts/build_concept_bank.py` after editing alignment metadata. It
builds `static/concept-bank.js`, the shared compatibility index used by the editor,
student views and teacher data access. Keep picker order in `static/concepts.json`
consistent with the authored alignments.

Old shared links and saved maps resolve to the new display names and stable IDs
when read. Their coordinates, arrows, explanations and stored source snapshots
are not overwritten. Unknown custom labels stay unchanged. Renaming a concept
clears the old concept ID, allowing a truly custom idea.

Class activity and taught-topic keys resolve through the same index so the
teacher's assigned concepts and student map labels continue to agree. New saves
carry the stable ID. Original objective text is retained as alignment metadata.

`static/prerequisites.json` contains reviewed, directed concept relationships.
Collapsing the old skills removes self-dependencies and requires review of the
remaining edge directions. An empty neighborhood does not invent prerequisites.
Related suggestions remain separate from authored prerequisite relationships.

## Map help

The dashboard setting is named **Disable map help**. When on, it hides **Map help**
(Explain my map and What could I improve?) and **Find related ideas** for that
assignment. The assignment banner and sidebar instructions use the same setting
name. Keep this wording consistent in screenshots and teacher guides.
