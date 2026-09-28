## Get Credentials

Firecrawl users can get an API key in two ways:

- **Dashboard or CLI (default)** — browser sign-in, CLI `--browser` auth,
  install skills/MCP, or create an API key in the dashboard. Continue
  with Path D below, or run the install command first.
- **WorkOS ID-JAG (supported agent platforms only)** — if your platform
  can mint a WorkOS ID-JAG identity assertion, fetch
  `https://www.firecrawl.dev/auth.md` and follow it end-to-end. Do not
  run the browser or CLI auth flow in Path D.

**Which should I use?** Stay on this page unless you know your platform
supports WorkOS ID-JAG.

**How you might arrive:**

- **Docs or website sent you here** — continue with Choose Your Path
  below for CLI/skills/MCP onboarding.
- **API `401` with discovery metadata** — if ID-JAG applies, use the
  WorkOS ID-JAG option above. Everyone else: use Path D.
- **Direct URL** — you are reading the right doc for browser/CLI
  onboarding.
- **Already have `FIRECRAWL_API_KEY`** — skip credential setup; pick
  Path A–E below.

Human-readable overview:
https://docs.firecrawl.dev/ai-onboarding#get-credentials

## Path D: Account Authorization Or API Key

Use this when the human still needs to sign up, sign in, authorize
access, or obtain an API key.

This is the default credential path for coding agents and
human-in-the-loop auth. If WorkOS ID-JAG applies, use Get Credentials
above instead — do not run this section.

If you ran the install command above with `--browser`, the human was
already prompted to sign in. Check if the key is available before
running this flow.

If you already have a valid `FIRECRAWL_API_KEY`, skip this path.

If you're the human reading this in the browser, create an account or
sign in at:

- https://www.firecrawl.dev/signin?view=signup&source=agent-suggested

If you're an agent and need the human to authorize an API key, use this
flow:

**Step 1 — Generate auth parameters:**

```bash
SESSION_ID=$(openssl rand -hex 32)
CODE_VERIFIER=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n' | head -c 43)
CODE_CHALLENGE=$(printf '%s' "$CODE_VERIFIER" | openssl dgst -sha256 -binary | openssl base64 -A | tr '+/' '-_' | tr -d '=')
```

**Step 2 — Ask the human to open this URL:**

```
https://www.firecrawl.dev/cli-auth?code_challenge=$CODE_CHALLENGE&source=coding-agent#session_id=$SESSION_ID
```

If they already have a Firecrawl account, they'll sign in and authorize.
If not, they'll create one first and then authorize. The API key comes
back to you automatically after they click "Authorize."

**Step 3 — Poll for the API key:**

```bash
POST https://www.firecrawl.dev/api/auth/cli/status
Content-Type: application/json

{"session_id": "$SESSION_ID", "code_verifier": "$CODE_VERIFIER"}
```

Poll every 3 seconds. Responses:

- `{"status": "pending"}` — keep polling
- `{"status": "complete", "apiKey": "fc-...", "teamName": "..."}` — done

**Step 4 — Save the key and continue:**

```bash
echo "FIRECRAWL_API_KEY=fc-..." >> .env
```

---

## Path E: Use Firecrawl Without Installing Anything

Use this when you don't want to install a CLI or skills package. This
works for both use cases:

- **Live web work** — an agent calling the API directly for search,
  scrape, or interact during a session
- **Building with Firecrawl** — integrating the REST API into app code

You still need an API key. Two ways to get one:

- **Human pastes it in** — if you already have a key, just set
  `FIRECRAWL_API_KEY=fc-...` in your environment or pass it directly
- **Automated flow** — do Path D to walk the human through browser auth
  and receive the key automatically

If WorkOS ID-JAG applies, see Get Credentials above instead of Path D.

If the human is completely unable to sign up or authorize a key right
now, Path F covers search, scrape, and interact on the keyless free tier
(rate-limited). Prefer getting a key whenever possible: an account gives
higher limits and the full set of endpoints, so move to one as soon as it
is available.

**Base URL:** `https://api.firecrawl.dev/v2`

**Auth header:** `Authorization: Bearer fc-YOUR_API_KEY`

### Available endpoints

- `POST /search` — discover pages by query, returns results with optional full-page content
- `POST /scrape` — extract clean markdown from a single URL
- `POST /interact` — browser actions on live pages (clicks, forms, navigation)
- `POST /support/ask` — diagnose a failing Firecrawl call. Pass `{ question, jobId? }`; returns a prose `answer` plus machine-readable `fixParameters` to retry with. Auto-scoped to your team via the bearer key
- `POST /support/docs-search` — answer "how do I…" questions from Firecrawl's official docs. Pass `{ question }`; returns the answer plus citations to the docs pages used

### Documentation and references

The API docs are the source of truth for request/response schemas,
parameters, and SDKs:

- **API reference:** https://docs.firecrawl.dev
- **Skills repo** (for agent integration patterns): https://github.com/firecrawl/skills

---

## Path F: Keyless Free Tier (Fallback)

Use this when you need Firecrawl right now and cannot obtain an API key,
for example when the human is not available to sign up. The keyless free
tier lets you search, scrape, and interact without an API key. It is
rate-limited, so use it as a fallback rather than the default.

- **MCP**: point any MCP-compatible client at `https://mcp.firecrawl.dev/v2/mcp`
- **CLI**: run `npx -y firecrawl-cli@latest` and use `scrape`, `search`, or `interact` with no login
- **API**: call the same REST endpoints without an `Authorization` header

Search, scrape, and interact are available keyless. Crawl, map, agent,
and other endpoints still require an API key.

Prefer a free account when the human can sign up: do Path D to get an
account or API key, which unlocks higher limits and the full set of
endpoints. If you hit rate limits on the keyless free tier, ask the human
to sign up at https://www.firecrawl.dev/signin.

---

## Session-specific auth

Do not store a real API key in this skill. Use FIRECRAWL_API_KEY from the environment, .env, or the human. If no key is available, use Path F (keyless free tier).
