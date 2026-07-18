# Production monitoring

`/api/_middleware.js` adds an `x-request-id` header to API responses. Uncaught API errors return a generic message and request ID; Cloudflare logs receive a structured `api_error` event without exception messages, request bodies, authorization headers, or personal data.

`/api/health` performs read-only D1 and R2 probes. It is deliberately hidden behind the `HEALTH_CHECK_TOKEN` bearer token and returns only `ok` or `unavailable`.

The `Production uptime` GitHub Actions workflow checks this endpoint after every push to `main` and every 15 minutes. A failed workflow appears in the repository Actions page and GitHub notification channels configured for the repository.

## One-time token setup

Generate one strong random token. Save the same value as the Cloudflare Pages secret `HEALTH_CHECK_TOKEN` and the GitHub Actions repository secret `HEALTH_CHECK_TOKEN`.

```powershell
npx wrangler pages secret put HEALTH_CHECK_TOKEN --project-name luana-group-app
```

Add the matching GitHub secret under **Repository settings → Secrets and variables → Actions**, then manually run **Production uptime** once. Never commit or paste the token into an issue, log, or documentation.

To inspect a failure, open the Cloudflare Pages deployment and view Functions logs, or stream them with:

```powershell
npx wrangler pages deployment tail --project-name luana-group-app
```

Search for the request ID reported by the client or uptime run. Rotate the health token by updating both the Cloudflare Pages secret and the GitHub Actions secret, then manually run the uptime workflow.
