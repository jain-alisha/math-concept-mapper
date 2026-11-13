# Independent student accounts

Students create a username/password account without supplying an email or class
code. They save their private recovery key, then sign in on any device and join
any number of classes through the existing class-code workflow. Existing email
accounts and their maps are preserved. Signup does not migrate or duplicate them.

Supabase Auth still uses its email/password provider internally: the username maps
to an undeliverable `@students.span.invalid` identifier. The browser never receives
a service-role key. A Supabase Edge Function creates a confirmed student user,
stores only the recovery-key hash, and verifies recovery or account deletion.

Teachers see maps attached to their class activities. Personal maps and work for
another class remain private, enforced by database RLS and scoped queries.

## Deploy in this order

1. Apply `migrations/20261113_independent_student_accounts.sql` to the existing
   database. Do not rerun the original schema against existing tables.
2. Apply `migrations/20261113_student_authorizations.sql`.
3. Apply `migrations/20261113_checkpoints_and_retention.sql`. Its final block
   installs/requires Supabase Cron and schedules daily map expiry at 03:17 UTC.
   Verify the `span-expire-cloud-maps` entry in `cron.job`. This is destructive
   only for maps whose last actual edit is more than 12 months old; export any
   older work you intend to retain before enabling it. Do not silently omit cron.
4. Deploy the pre-login Edge Function:

   ```sh
   supabase secrets set STUDENT_ACCOUNT_ORIGINS=https://spanmath.org,https://www.spanmath.org --project-ref rlngqnlwcyvxaqthzyft
   supabase functions deploy student-accounts --project-ref rlngqnlwcyvxaqthzyft
   ```

   Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` inside Edge
   Functions. The committed config disables the gateway JWT check for this new
   signup/recovery endpoint; deletion still verifies the caller's token. The production domains are the default origin allowlist. Add a preview origin
   explicitly to test it.
5. Deploy `static/` through the existing Vercel setup only after the migrations and
   function are installed. Existing email accounts remain supported.
6. Verify a demo username account can sign out/in, join two classes, save/reopen
   maps, recover with its key, and delete its own cloud data. Verify a teacher
   cannot read another class's maps. Never use a real child's data for this test.

## Under-13 authorization

The signup form asks only under-13 or 13+, not a birthdate. Under-13 username signup
requires a code independent of any class. An administrator first verifies the
parent/school's authority and approval through the agreed process and retains the
evidence privately. A code by itself is not verification of parental authority
or a compliance certification. Do not issue one based only on a student's request
or a checkbox. Email signup is labeled for adults/13+.

Use `scripts/student_authorizations.py issue --authority school
--evidence-reference PRIVATE_RECORD_ID --max-accounts 30` with the Supabase URL
and service-role key in the operator's environment. The command prints the random
code once; distribute it privately to the approved adult. Only its hash is stored.
Capacity and expiry are enforced atomically. Parent codes default to one account.
The administrative record contains verification time, evidence reference, expiry,
capacity and revocation state; individual student accounts reference that record.

To withdraw authorization, use `student_authorizations.py revoke AUTHORIZATION_ID`.
This blocks further signups. Add `--delete-accounts` only when the adult requests
permanent deletion of those students' accounts/work. The script uses the Auth
Admin API, which cascades removal of maps, memberships and timelines. Confirm
identity/authority using the retained private evidence before fulfilling requests.

The demo teacher-role toggle remains by the user's earlier choice. Restrict it
before admitting real students. Username signup is not permission to launch an
under-13 school pilot without the verified adult-authorization process above.

## Checkpoints, retention and deletion

“Save starting checkpoint” saves a protected snapshot and places it together with
the editable working map in a growth timeline. The database rejects changes to a
checkpoint's contents/title/date/owner/activity, even through direct API calls.
The student can view it read-only, make a new working copy, or delete it. “Save a
copy” remains a normal editable duplicate.

All cloud maps, including protected checkpoints, expire after 12 months without
actual content/title edits. A server timestamp prevents client clock spoofing;
reassigning a timeline does not renew a map. Empty timelines older than 12 months
are removed by the same daily job. Accounts remain until the user deletes them.

Settings → Classes → Your data has an explicit DELETE confirmation. The backend
uses the verified caller's id, ignores supplied target ids, and hard-deletes the
Auth account. Foreign-key cascades remove its maps, timelines, memberships, and
classes it teaches; other students' maps survive deleted classes as personal work.
Span-local drafts/preferences on that device are cleared after success. Shared
URL snapshots, exported files, backups and provider logs are outside that delete
operation; the privacy notice describes that boundary.

Recovery keys have 160 bits of randomness and are shown before the first sign-in.
They are reusable private reset keys; do not share them with classmates. The
password-reset endpoint is limited per username and globally across all function
instances using service-only database counters. Losing both password and key
requires verified administrator help; a teacher cannot reset a global student
account merely because that student joined their class.

## Validation

`npm ci && npm test` runs endpoint and embedded-Postgres tests along with existing
JavaScript regressions. `python -m unittest discover -s tests -v` runs prerequisite
API tests. Embedded Postgres executes actual RLS, trigger, cascade, authorization,
and expiry SQL; production Cron scheduling and Supabase Auth still need live
checks. No production deployment is implied by these test results.
