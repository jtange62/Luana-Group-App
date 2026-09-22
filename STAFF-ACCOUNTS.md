# Staff accounts

Use More → My account & staff access to change your password. Administrators can create staff accounts, reset temporary passwords, disable access and inspect recent successful actions.

Temporary passwords require a change before other APIs can be used. Password changes, administrator resets and disabling access revoke existing sessions. Individual sessions expire after 12 hours. Shared-password sessions are rejected when AUTH_MODE is accounts.

Passwords are salted PBKDF2-SHA512 hashes with a server-side HMAC pepper derived from SESSION_SECRET. Never expose or casually rotate SESSION_SECRET: rotation requires resetting account passwords as well as sessions. Back up the secret separately from D1. Changing the display name does not rewrite historical bylines; staff audit uses the verified username.

Initial provisioning uses the one-time account-setup endpoint protected by STAFF_SETUP_TOKEN and an atomic insert that refuses to create a second administrator. Setup files belong only in the ignored .wrangler/staff-admin directory. Remove the deployment setup secret after provisioning. Never commit credentials.

Apply migrations/024_staff_accounts.sql before activating AUTH_MODE=accounts. Prepare the administrator before disabling shared access. Other staff must receive accounts from the administrator.

Account recovery is an owner operation through the deployment/database tools. There is no public reset-password or self-registration endpoint.

Validation: npm run check, npm run test:browser, npm run test:accounts. The account browser suite uses an isolated local database under .wrangler/account-tests/state and test-only credentials.
