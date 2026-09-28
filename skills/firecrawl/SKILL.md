---
name: firecrawl
description: >
  Firecrawl web search, scrape, and interact tooling for agents. Use when
  installing or driving the Firecrawl CLI, integrating Firecrawl into app
  code, or producing research/SEO/lead workflows from live web data.
---

# Firecrawl

Search first, scrape clean content, interact with live pages when extraction
is not enough, then produce a deliverable. Keep secrets in the environment,
never in this skill.

## Install

```powershell
npx -y firecrawl-cli@latest init --all --browser
```

That install covers CLI use, app-code integration, and workflow skills, and
opens browser auth for the human. Verify with `firecrawl --status` before
real work.

| Segment | Question | Where it runs |
|---|---|---|
| CLI | Which Firecrawl command now? | This agent session |
| Build | How do I add Firecrawl to this product? | User codebase |
| Workflow | What finished artifact? | This session, producing a file |

## Choose a path

- Live web data this session -> Path A in `references/live-and-build.md`
- Add Firecrawl to app code -> Path B in `references/live-and-build.md`
- Finished research/SEO/lead artifact -> `references/workflows.md`
- Need an account or API key -> `references/auth-and-api.md`
- REST without CLI, or keyless fallback -> `references/auth-and-api.md`

Default live flow: search -> scrape known URLs -> interact only for clicks/forms/login.
On failure, run `firecrawl ask` with the job id instead of guessing.

## References

| File | Load when |
|---|---|
| `references/live-and-build.md` | Path A live tools or Path B app integration |
| `references/workflows.md` | Path C finished deliverables |
| `references/auth-and-api.md` | credentials, Path D/E/F, REST endpoints |
