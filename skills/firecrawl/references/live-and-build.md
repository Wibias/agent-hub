## Path A: Live Web Tools

Use this when you need web data during your work: searching the web,
scraping known URLs, interacting with live pages, crawling docs, or
mapping a site.

After install, hand off to the CLI skill:

- `firecrawl/cli` for the overall command workflow
- `firecrawl-search` when you need search first
- `firecrawl-scrape` when you already have a URL
- `firecrawl-interact` when the page needs clicks, forms, or login
- `firecrawl-crawl` for bulk extraction
- `firecrawl-map` for URL discovery
- `firecrawl-ask` when a Firecrawl call fails or returns unexpected output — pass the failing `jobId` and the AI support agent diagnoses it from your team's job logs and account state
- `firecrawl-docs-search` for "how does Firecrawl handle X?" questions — answers grounded in current docs with source citations

Default flow for live web work:

1. start with search when you need discovery
2. move to scrape when you have a URL
3. use interact only when the page needs clicks, forms, or login
4. if any step fails or returns unexpected output, run `firecrawl ask` with the failing `jobId` instead of guessing

If the task becomes "wire Firecrawl into product code," switch to Path B.

---

## Path B: Integrate Firecrawl Into an App

Use this when you're building an application, agent, or workflow that
calls the Firecrawl API **from code** — meaning the integration will run
inside the user's product (a web app, backend service, script, agent
loop, or pipeline) rather than from the agent's own terminal session.

This is the key difference from Path A: Path A runs `firecrawl ...`
commands during the current session to fetch data for the agent itself.
Path B writes code that will keep running long after the agent stops,
using `FIRECRAWL_API_KEY` from the project's `.env` or runtime config
and the matching Firecrawl SDK in the project's language.

The build skills are already installed from the same command above. No
separate install needed.

Choose the project mode before writing code:

- **Fresh project** -> pick the stack, install the SDK, add env vars, and run a smoke test
- **Existing project** -> inspect the repo first, then integrate Firecrawl where the project already handles APIs and secrets

If you already have a key, save it to the project's environment:

```dotenv
FIRECRAWL_API_KEY=fc-...
```

Then hand off to the build skill that fits the step:

- `firecrawl-build` for the overall build workflow and endpoint routing
- `firecrawl-build-onboarding` for auth and project setup (API key, SDK install, smoke test)
- `firecrawl-build-scrape` when the feature scrapes a known URL
- `firecrawl-build-search` when the feature starts with a query and discovers pages
- `firecrawl-build-interact` when the feature needs clicks, forms, or navigation after a scrape
- `firecrawl-build-parse` when the feature parses local or non-public document files (PDF, DOCX, XLSX, etc.)

The required question in the build path is:

- **What should Firecrawl do in the product?**

Use the answer to route to `/search`, `/scrape`, `/interact`, `/parse`, `/crawl`, or `/map`, then run one real Firecrawl request as a smoke test.

If you do not have a key yet, do Path D first.

---
