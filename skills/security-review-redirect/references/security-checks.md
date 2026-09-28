# Security Checks Reference

## Repository Hygiene

Inspect:

- Committed `.env`, `.pem`, `.key`, credential JSON, service account, database dump, token, cookie, or local config files.
- Hardcoded API keys in frontend source, build artifacts, examples, tests, or docs.
- Public/private environment variable prefix mistakes such as private keys exposed through client-safe prefixes.
- README or screenshots that reveal tokens, internal URLs, webhook secrets, customer data, or admin panels.
- CI/CD config that prints secrets or uses broad tokens.
- Missing `.gitignore` entries for local env, build output, cache, coverage, and generated credentials.

## Authentication

Check:

- Protected routes reject unauthenticated access on the server.
- Login, logout, session refresh, password reset, OAuth callback, and email verification flows behave correctly.
- Password auth uses a reputable hashing mechanism and never stores plaintext passwords.
- Session cookies use secure defaults in production: `HttpOnly`, `Secure`, `SameSite`, reasonable expiry.
- OAuth state/nonce and callback validation exist where relevant.
- Magic link or reset tokens are single-use, expire quickly, and are not logged.
- Auth redirects do not allow open redirects to attacker-controlled URLs.

## Authorization And Multi-Tenancy

Look for:

- User, team, org, tenant, role, or ownership checks on every protected read/write action.
- API endpoints that accept `userId`, `tenantId`, `role`, `plan`, or `isAdmin` from the client and trust it.
- Direct object reference bugs where a user can access another user's resource by changing an ID.
- Admin pages protected only by hidden navigation or client-side checks.
- Plan or payment gates enforced only in frontend code.
- Database queries missing owner or tenant filters.
- Webhooks or background jobs that mutate data without validating event authenticity and ownership.

## Input Validation And Injection

Check:

- SQL queries use parameterized APIs or safe ORM methods.
- No string-built SQL, shell commands, template expressions, or eval-like execution with user input.
- API handlers validate body, query, params, and file metadata.
- HTML rendering does not inject untrusted content without sanitization.
- Markdown, rich text, or user-generated content is sanitized before rendering.
- Redirect URLs, callback URLs, and return paths are restricted.
- SSRF risk exists if backend fetches user-provided URLs.

## File Uploads

Check:

- File type, size, extension, MIME, and content are validated.
- Uploaded files are stored outside executable paths.
- Public file URLs do not expose private user data.
- Filenames are normalized and do not allow path traversal.
- Image processing avoids unsafe SVG/script handling unless sanitized.
- Malware scanning or quarantine is considered for high-risk products.

## API, CORS, Headers, And Rate Limits

Inspect:

- CORS is not `*` for authenticated or cookie-based APIs.
- CSRF protections exist when using cookies for state-changing requests.
- Security headers are present where appropriate: CSP, frame options, HSTS, referrer policy.
- Expensive endpoints, auth endpoints, contact forms, AI calls, scraping jobs, and public APIs have rate limits or abuse controls.
- **When more than one application instance can serve the same protected traffic, a correctness-sensitive rate limit (especially auth/recovery/abuse controls) counts against shared/authoritative state rather than per-instance memory unless the architecture proves equivalent global enforcement.** Otherwise horizontal scaling multiplies the effective limit.
- Error responses avoid leaking stack traces, SQL messages, tokens, or internal paths in production.
- API keys and webhooks use constant-time or framework-safe comparison where relevant.

## Payments And Webhooks

Check:

- Webhook signatures are verified with provider SDKs or documented verification.
- Test and live mode keys are not mixed.
- Paid status, plan, subscription, and entitlement changes come from trusted server-side events.
- Checkout success pages do not grant access before webhook confirmation unless explicitly safe.
- Customer IDs and subscription IDs are scoped to the authenticated user or tenant.
- Refund, cancellation, failed payment, and expired subscription states are handled.

## Dependencies And Supply Chain

Check:

- Lockfiles exist and match the package manager.
- Dependency audit commands are available for the stack.
- Packages are not loaded from suspicious URLs or unpinned install scripts.
- Build scripts do not curl remote executable code without verification.
- Deprecated auth, crypto, or request libraries are flagged for review.
- GitHub Actions or CI workflows avoid untrusted pull request secret exposure.

## Logging, Privacy, And Operations

Check:

- Logs do not include passwords, access tokens, refresh tokens, reset links, cookies, authorization headers, payment data, or sensitive personal data.
- Error monitoring redacts sensitive fields.
- Backups and exports avoid public buckets or world-readable files.
- Admin/support tools are authenticated and audited.
- Deletion/export requests have a plausible engineering path for user data.
- Production config avoids debug mode, verbose stack traces, and permissive local settings.

## Mobile And Client Apps

Check:

- Assume any bundled key in a mobile/frontend app is public.
- Sensitive operations go through a server the developer controls.
- Deep links validate destination and auth state.
- Local storage does not hold long-lived high-privilege secrets unnecessarily.
- Backend APIs do not trust client app identity alone.

## Reporting Guidance

For every confirmed finding, include:

- A concise title.
- Severity.
- Evidence with file and line where possible.
- Why it matters in this app's actual context.
- The minimum viable fix.
- A verification step.

Avoid padding the report with generic advice. If no serious issue is found, say that clearly and list the main areas inspected plus residual risk.
