"""Issue/revoke pilot authorization codes after adult authority is verified.

Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the operator's environment.
Never put the service key, raw code, or evidence in GitHub issues/source control.
"""
import argparse
import hashlib
import json
import os
import secrets
from datetime import datetime, timedelta, timezone
from urllib.request import Request, urlopen


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    issue = sub.add_parser('issue')
    issue.add_argument('--authority', choices=['parent', 'school'], required=True)
    issue.add_argument('--evidence-reference', required=True, help='Private record reference documenting verified authority/approval')
    issue.add_argument('--max-accounts', type=int, default=1)
    issue.add_argument('--days', type=int, default=30)
    revoke = sub.add_parser('revoke')
    revoke.add_argument('authorization_id')
    revoke.add_argument('--delete-accounts', action='store_true', help='Also permanently delete accounts created under this authorization')
    args = parser.parse_args()
    base = os.environ['SUPABASE_URL'].rstrip('/')
    key = os.environ['SUPABASE_SERVICE_ROLE_KEY']

    def api(path, method='GET', data=None):
        request = Request(base + path, method=method, headers={
            'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'Prefer': 'return=representation',
        }, data=json.dumps(data).encode() if data is not None else None)
        with urlopen(request, timeout=30) as response:
            body = response.read()
            return json.loads(body) if body else None

    now = datetime.now(timezone.utc)
    if args.command == 'issue':
        if args.max_accounts < 1 or args.days < 1 or not args.evidence_reference.strip():
            parser.error('Positive capacity/expiry and a verified evidence reference are required.')
        code = secrets.token_hex(20)
        result = api('/rest/v1/student_authorizations', 'POST', {
            'authority': args.authority, 'evidence_reference': args.evidence_reference,
            'verified_at': now.isoformat(), 'expires_at': (now + timedelta(days=args.days)).isoformat(),
            'max_accounts': args.max_accounts, 'code_hash': hashlib.sha256(code.encode()).hexdigest(),
        })
        print('Authorization:', result[0]['id'])
        print('Private code (shown once):', '-'.join(code[i:i+5] for i in range(0,len(code),5)))
    else:
        # UUID validation prevents URL/filter injection.
        from uuid import UUID
        authorization_id = str(UUID(args.authorization_id))
        api('/rest/v1/student_authorizations?id=eq.' + authorization_id, 'PATCH', {'revoked_at': now.isoformat()})
        if args.delete_accounts:
            accounts = api('/rest/v1/student_accounts?select=user_id&authorization_id=eq.' + authorization_id)
            for account in accounts:
                api('/auth/v1/admin/users/' + str(UUID(account['user_id'])), 'DELETE')
            print('Authorization revoked; removed', len(accounts), 'accounts.')
        else:
            print('Authorization revoked for new signups. Existing accounts were kept.')


if __name__ == '__main__':
    main()
