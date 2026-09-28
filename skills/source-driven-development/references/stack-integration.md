# Source-Driven Development - Project Integration

Load this reference when project-specific library or platform guidance may affect official-source retrieval.

## Project-local authority

Do not carry one project's stack assumptions into another project.

Before adding platform-specific source rules:

1. inspect the active project's `AGENTS.md`, dependency files, and project documentation;
2. use project-local guidance when it defines an official documentation source or integration constraint;
3. otherwise detect the stack from the active project and use the official source hierarchy from `../SKILL.md`;
4. keep host-specific connector names as optional retrieval accelerators, not requirements.

Examples:

- If the project uses Supabase, prefer Supabase's official documentation for auth, RLS, and migration semantics.
- If the project uses a hosting provider, use that provider's official deployment/runtime documentation.
- If a documentation connector such as Context7 is available, use it to locate the official page, then cite the underlying official source.

Never assume a specific product, hosting provider, repository path, or connector merely because another project used it.
