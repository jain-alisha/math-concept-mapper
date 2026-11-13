# Span recording demo

All sample people and submissions are fictional. The shared fixtures in
`static/demo-data.js` power both dashboards, activity links and the sample editor.
The sample pages do not create accounts, classes or submissions in Supabase.

## Recording links

- Student: https://spanmath.org/student?sample=1
- Teacher: https://spanmath.org/dashboard?sample=1
- Editor: https://spanmath.org/playground?sample=1

The fixtures contain two classes, twelve students, six activities, seventy
submissions, six student portfolio projects and three four-frame growth timelines.
Each project uses current catalog labels and metadata. Notes give concrete
mathematical reasons and examples; some students have fewer links or unexplained
links, and one student has not submitted each class's final activity.

## Suggested sequence

1. Open the student sample. Show six distinct projects and two class memberships.
2. Choose **Fractions Tell a Story** under **Choose a growth timeline**. Move from
   Starting checkpoint to Connected ideas, then play through the four frames.
3. Open a portfolio map. This is a separate browser-local working copy. Select a
   connection to read/edit its mathematical explanation. Try Explain my map.
4. Open the teacher sample. Choose Math Studio, then Recipe Ratios in Activities.
   Show Class at a Glance and expand Concepts and explanations for one student.
5. Compare common pairs with zero-count pairs in Classwide connection counts.
   Turn Anonymous mode on before demonstrating classroom projection.
6. Choose Math Lab and Fractions Tell a Story. Open a student map to show the
   read-only view and click a note for its complete explanation.
7. Open + New Activity to demonstrate the grade/unit filters and concept search.
   Sample changes reset when the page is reloaded.

Reload sample pages before recording for a consistent starting state. Leave
Anonymous mode off when introducing the fictional class and on when demonstrating
projection. No real student credentials, class invite codes are
needed for the recording.

## Signed-in portfolio

Fifteen presentation maps and three growth timelines were seeded for Alisha's
existing account on November 13. Historical frames are protected checkpoints;
latest versions remain editable. Seed IDs are deterministic, so re-running the
prepared seed does not duplicate records. Existing guide examples are preserved.
The separate cleanup review covers nine QA maps and four QA timelines; deletion
requires confirmation before the prepared cleanup is executed.
