# Independent student accounts

Students create a username and password without an email address or class code.
The account works on other devices and can join several classes. Existing email
accounts, passwords, maps and memberships are preserved.

Username signup does not ask for an age group or an authorization code. There is
no separate key to save. Signup signs the student in with the password they chose.
Email accounts retain ordinary email password-reset links. Username accounts do
not have email reset links; the sign-in page links to Span for account help.

## Implementation

Supabase Auth uses an internal, undeliverable `@students.span.invalid` login
identifier. The browser never receives a service-role credential. The Edge
Function creates a confirmed student user and stores only its user ID and unique
username in `student_accounts`. Signup is rate-limited and restricted to approved
origins. Account deletion takes its identity from a verified access token.

Class membership is separate from account identity. Teachers can read only maps
attached to activities in classes they teach; personal and other-class maps remain
private under database RLS.

## Deployment

For an existing installation, apply
`migrations/20261113_simplify_student_accounts.sql`, then deploy the updated
`student-accounts` Edge Function before publishing the new static signup UI.
The cleanup migration removes retired signup fields and their auxiliary table;
it does not delete users, passwords, maps, checkpoints, timelines or memberships.

For a new installation, apply `supabase-schema.sql`, then
`20261113_independent_student_accounts.sql`,
`20261113_simplify_student_accounts.sql`, and
`20261113_checkpoints_and_retention.sql`. Do not rerun the base schema on an
existing database. Verify the existing daily `span-expire-cloud-maps` Cron job;
there is no need to reschedule it for a signup change.

```sh
supabase functions deploy student-accounts --project-ref rlngqnlwcyvxaqthzyft
```

Supabase supplies the server credentials inside the Edge Function. Gateway JWT
checking is disabled for this pre-login signup endpoint; account deletion still
verifies its caller. `STUDENT_ACCOUNT_ORIGINS` defaults to Span's production
origins, never a wildcard. Explicitly add any required preview origin.

## Data controls

Save starting checkpoint creates an immutable baseline and pairs it with the
editable map in a growth timeline. Ordinary Save a copy makes an editable
copy; timeline assignment remains explicit. Cloud maps and checkpoints expire
after twelve months without real edits; the account remains until deletion.

Settings → Classes → Your data provides account deletion. The verified account's
maps, timelines, memberships and taught classes cascade. Shared snapshots and
exported files are outside that deletion.

## Validation

`npm test` exercises username signup/sign-in forms, endpoint validation, actual
PostgreSQL RLS, multi-class membership, checkpoint immutability, account-registry
privacy, rate limiting, cleanup migration preservation, expiry and deletion.
Python tests cover the authored concept graph and recommendation endpoint.
Production deployment and authenticated UI checks must be reported separately.
