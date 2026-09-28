---
name: seo-audit
description: >
  Audits websites for technical SEO, on-page optimization, and Core Web Vitals.
  Use when the user asks for an SEO audit, technical SEO review, ranking drop
  diagnosis, meta tags, page speed, crawl errors, or indexing issues. Not a UI
  redesign tool and not a copywriting tool.
metadata:
  version: 1.1.0
---

# SEO Audit

Identify SEO issues and give ranked, evidence-backed fixes. Load the matching
reference instead of keeping the full checklist in this file.

## Intake

Read any project marketing context file first. Then confirm only what is still missing:

- site type, business goal, and priority keywords
- known issues, traffic baseline, recent migrations
- full-site vs selected pages; Search Console / analytics access

## Schema detection

`web_fetch` and `curl` cannot reliably detect JSON-LD. Many CMS plugins inject
schema in the browser. Do not report "no schema" from static HTML. Use a
rendered DOM query, [Rich Results Test](https://search.google.com/test/rich-results),
or a JavaScript-rendering crawl export.

## Priority order

1. Crawlability and indexation
2. Technical foundations and Core Web Vitals
3. On-page optimization
4. Content quality
5. Authority and links

## References

| File | Load when |
|---|---|
| `references/technical-seo.md` | crawl, index, speed, mobile, HTTPS, URLs |
| `references/on-page-seo.md` | titles, meta, headings, content, images, internal links, keywords |
| `references/content-and-site-types.md` | E-E-A-T, depth, SaaS / ecommerce / blog / local patterns |
| `references/output-and-tools.md` | report shape, tools, follow-up questions |

Source: MengTo/Skills (https://github.com/MengTo/Skills), MIT License. Adapted 2026-07-09.
