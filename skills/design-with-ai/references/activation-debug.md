# Diagnosing whether design-with-ai actually ran

Use for a repeated UI issue that survives multiple nominal "design-with-ai"
passes, or when a user asks whether the current skill was applied. Do not run
this extra workflow for ordinary successful design edits.

## Distinguish four independent claims

| Claim | Useful evidence | What it does not establish |
|---|---|---|
| Hub has the rules | Current Hub git revision and skill references | Installed skill version |
| Skill is discoverable and current | Read-only `check-activation.mjs` output | The host chose or read it |
| Agent followed the procedure | Actual host transcript/tool events showing loaded SKILL.md/references, and commands with exit status | UI task success |
| Product issue is fixed | Target app behavior tests plus matched rendered evidence and validated before/after receipt | Future stochastic reliability |

A green Hub CI run tests its own repository. It cannot establish any of the last
three claims in another checkout or on a user's desktop.

## 1. Check local discovery from the intended workspace

Use an authoritative, **separately chosen** Hub checkout to run the diagnostic.
Do not take the expected version from whichever installed skill happens to
be found, or a stale installed copy could compare successfully with itself.

```shell
node "<hub-checkout>/skills/design-with-ai/scripts/check-activation.mjs" --workspace "<product-repo>" --canonical "<hub-checkout>/skills/design-with-ai"
```

The command is read-only, uses Node 20+, works on Windows/macOS/Linux, emits
JSON, and returns nonzero for no copy, a divergent copy, or multiple distinct
discoverable copies. It checks the current workspace up to its Git root and
the user-level `~/.agents/skills/design-with-ai` location as documented for
Codex. It resolves symlinks so two aliases of one physical installation are
not mistaken for two copies.

The `canonicalSkillHash` and `differences` fields identify material file
mismatches without exposing their contents. The diagnostic deliberately
reports `modelInvokedThisSkill: NOT_VERIFIED` and
`gateExecutedInUserProject: NOT_VERIFIED` **even when the files match**.
Another host or a plugin-managed cache can have additional discovery paths
that this Codex-local diagnostic cannot see.

If the reported installation is stale or ambiguous, fix the *installation*
or host selection first. Do not add another general design guideline to
mask a loading problem. Codex detects most changed skills automatically;
when changes do not appear, restart the active Codex session as recommended
by the platform documentation. Never edit a plugin-managed discovery cache.

## 2. Verify real agent execution from external evidence

Inspect the actual run transcript or host trace (when available), not the
agent's final self-description:

1. Was the expected `design-with-ai/SKILL.md` read? Which full path?
2. Were `existing-ui-workflows.md`, the baseline/task rules, and
   `verification-contract.md` actually accessed for the selected workflow?
3. Was a prior-findings manifest preserved from *before* UI changes?
4. Was `verify-iteration-receipt.mjs --receipt ... --baseline ...` executed
   for an iterative improvement with known defects, and what was its exit code?
5. Were real target-app behavior and render tests executed, with their own
   exit codes and artifact paths?

A script mentioned in the final message is **not** proof it was executed.
If the trace is unavailable, label invocation and execution `NOT_VERIFIED`,
not `PASS`. Never fabricate a trace from the assistant's narrative.

## 3. Prove the three observed product failures, not only taste

For a contact-sheet video pipeline with the reported problems, use the target
app's own tests or browser runner:

- **Navigation:** In the same desktop viewport, determine whether global and
  page-toolbar `Settings` controls reach the same effective target and serve
  the same task. If so, verify the redundant control was removed. Different
  deep links, legal links, and breakpoint-exclusive paths remain valid.
- **Publish readiness:** In a fixture with QA passed and TikTok account not
  authorized, attempt the *safe UI path* without triggering a real upload.
  Verify that the button is unavailable with a useful explanation or leads to
  the actual setup/authorization flow. Verify the authorized case separately.
  A screenshot cannot prove route or permission behavior.
- **Job detail:** Verify the finished-video inspector exposes only actual,
  useful recorded data (such as script, captions, voice, QA, outputs), when
  available. A read-only viewer is acceptable if no such information or
  actions exist. Do not invent an editor.

Prefer role/name selectors and observable browser assertions in existing
Playwright tests where Playwright is already used. Do not force-install
Playwright or write a new end-to-end harness during an unrelated skill change.
Include representative viewport and state screenshots for visual review;
do not confuse screenshot differences with behavioral proof.

## 4. Final evidence and next decision

Run the existing independent receipt validator using the frozen
`prior-findings.json`, not a reconstructed after-only list:

```shell
node "<hub-checkout>/skills/design-with-ai/scripts/verify-iteration-receipt.mjs" --receipt "<iteration-receipt.json>" --baseline "<prior-findings.json>"
```

Decide from verified evidence:

- **Not discoverable/stale/multiple copies:** Repair installation or resolve
  which skill the host loads. Do not claim skill behavior has been tested.
- **Matching discovery but missing host trace:** Activation remains unknown.
  Obtain trace/log evidence, not another repaint.
- **Skill invoked but no receipt/behavioral checks:** Execution/verification
  gap. Add or enforce a project-local required test/check for this application
  when authorized.
- **All tools used, but behavior still wrong:** A genuine implementation or
  product-contract failure. Repair the actual UI and retest.
- **Issue already justified or impossible in authorized scope:** Record
  `KEEP_JUSTIFIED`, `DEFERRED`, or `NOT_VERIFIED` with evidence; don't
  silently remove the baseline issue.

Record the Hub revision, canonical skill hash, detected copies, verified
trace status, target app revision, test commands/results, and open issue IDs
in the existing task/PR handoff. No new global telemetry service is required.

## External sources consulted

- OpenAI, *Build skills*: Codex discovery paths, automatic updates and restart
  guidance: https://learn.chatgpt.com/docs/build-skills
- OpenAI, *Evaluate agent workflows*: traces, graders and end-to-end coverage:
  https://developers.openai.com/api/docs/guides/agent-evals
- OpenAI, *Testing Agent Skills Systematically with Evals*: real scenario
  evaluation and explicit trigger checks:
  https://developers.openai.com/blog/eval-skills
- Playwright, *Locators*: user-visible roles/names for robust UI assertions:
  https://playwright.dev/docs/locators
