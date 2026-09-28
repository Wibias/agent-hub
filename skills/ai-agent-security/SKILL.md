---
name: ai-agent-security
description: >-
  Security assessment and hardening for LLM applications, AI agents, RAG, and
  MCP-based tool systems against prompt injection, tool poisoning, MCP server
  compromise, model and data poisoning, vector/embedding weaknesses, guardrail
  evasion, and LLM red-teaming. Use when threat-modeling, security-reviewing,
  hardening, or red-teaming an agent pipeline, RAG system, MCP integration, or
  LLM feature. Not for ordinary implementation of those systems without a
  security objective. Distinct from security-review (classic app/API code),
  audit-tooling (SARIF/Semgrep toolchain selection), fuzzing-and-testing
  (native-code harness fuzzing), and smart-contract-security (blockchain/Solidity).
  Does not cover C2 infrastructure or offensive adversarial exploitation of
  production systems you do not own.
---

# AI Agent Security

> Source: mukul975/Anthropic-Cybersecurity-Skills (https://github.com/mukul975/Anthropic-Cybersecurity-Skills), Apache-2.0 License. Adapted 2026-07-10. Original copyright notice: Copyright (c) 2024-2025 Mahipal. See upstream LICENSE for terms. NOTICE: this adaptation preserves the Apache-2.0 attribution requirement.

> **AUTHORIZED USE ONLY.** All offensive testing techniques described here (red-teaming, probing, injection testing) are for use only against systems you own or have explicit written authorization to assess. Unauthorized probing may violate terms of service or applicable law. Techniques are shared for defensive validation only.

## Overview

AI agents and LLM applications introduce a distinct class of security risks that classical app-security controls do not cover. The threat surface includes:

- **MCP tool poisoning** -- hidden instructions in tool descriptions hijack agent behavior (OWASP MCP03, MITRE ATLAS AML.T0010)
- **Prompt injection (direct and indirect)** -- injected instructions in user input or retrieved artifacts override intended behavior (AML.T0051, OWASP LLM01)
- **RAG pipeline injection** -- poisoned documents in the retrieval corpus plant instructions that execute when retrieved (AML.T0051.001)
- **Agentic tool misuse** -- excessive agency or insufficient least-privilege lets a compromised agent perform unauthorized actions (AML.T0053)
- **Model and data poisoning** -- manipulated training/fine-tuning data or backdoored weights cause attacker-controlled misbehavior (AML.T0020, AML.T0018)
- **Vector/embedding weaknesses** -- embedding inversion, cross-tenant leakage, and retrieval poisoning in RAG vector stores (OWASP LLM08, AML.T0024)
- **LLM guardrail evasion** -- jailbreaks and multi-turn escalation bypass safety layers (AML.T0054)
- **LLM red-teaming at scale** -- continuous automated probing to detect regressions in safety/security posture (AML.T0051, CI/CD gate)

## Decision Tree: Which Reference to Use

```
What is the threat you are facing?

MCP server in agent stack (Claude Desktop, Cursor, VS Code)
  -> references/mcp-tool-security.md
  Tool poisoning / tool shadowing / rug pull / SSRF / unauth exposure
  Uses: mcp-scan, MCP Python SDK

Prompt injection or indirect injection (web pages, PDFs, emails, images)
  -> references/prompt-injection.md
  Direct injection in user input; indirect injection in retrieved artifacts
  Uses: LLM Guard, Meta Prompt Guard 2, deberta-v3, BeautifulSoup, pytesseract

Agentic AI tool invocation governance
  -> references/prompt-injection.md (agentic controls section)
  Least-privilege allowlisting, HITL, NeMo Guardrails, audit logging
  Uses: NeMo Guardrails, jsonschema, AWS STS

Guardrail deployment (Llama Guard, NeMo, LLM Guard pipeline)
  -> references/llm-red-teaming.md (guardrails section)
  Runtime classification and scanning of inputs and outputs
  Uses: Llama Guard 3, NeMo Guardrails, LLM Guard

LLM red-teaming (garak, promptfoo, PyRIT)
  -> references/llm-red-teaming.md
  Probe suites, CI/CD regression gates, multi-turn attacks
  Uses: garak, Promptfoo, PyRIT, DeepTeam

RAG pipeline injection testing
  -> references/llm-red-teaming.md (RAG section)
  Poisoned corpus documents, embedding manipulation, retrieval probing
  Uses: garak latentinjection, Promptfoo rag-document-exfiltration, PyRIT

Data poisoning / model backdoors / ML supply chain
  -> references/data-poisoning.md
  Training data integrity, activation clustering, spectral signatures
  Uses: ART (ActivationDefence, SpectralSignatureDefense), Cleanlab, safetensors

Vector store weaknesses (embedding inversion, cross-tenant leakage)
  -> references/data-poisoning.md (vector section)
  Membership inference, namespace isolation, retrieval poisoning
  Uses: sentence-transformers, qdrant-client, vec2text
```

## Core Security Controls (All AI/LLM Features)

These controls apply regardless of which threat class is primary:

1. **Treat all model output as untrusted input.** Never pass LLM output to `eval`, SQL, shell, `innerHTML`, or file paths without parsing, schema validation, and encoding.

```typescript
// BAD
await db.query(await llm.generate(`Write SQL for: ${userQuestion}`));

// GOOD
const intent = CommandSchema.parse(JSON.parse(await llm.replyJson(userMessage)));
await runAllowlistedAction(intent.action, intent.params);
```

2. **The system prompt is not a security boundary.** Enforce permissions in code, not prompt text.

3. **Keep secrets and per-user data out of prompts.** Anything in the context window can be echoed back (OWASP LLM07).

4. **Scope tool permissions to the minimum.** Require human confirmation for any destructive or irreversible action.

5. **Bound consumption.** Cap tokens, request rate, and recursion/loop depth to prevent runaway agent costs (OWASP LLM10).

6. **Validate retrieval.** In RAG, treat the vector store as a trust boundary. Scan retrieved chunks for injection markers before concatenating into the prompt.

## Key Tool Summary

| Tool | Threat class | Install |
|------|-------------|---------|
| mcp-scan (Invariant Labs) | MCP tool poisoning, rug pull, SSRF | `uvx mcp-scan@latest` |
| garak (NVIDIA) | LLM injection, jailbreak, leakage probes | `pip install -U garak` |
| Promptfoo | CI/CD red-team regression gate | `npm install -g promptfoo` |
| PyRIT (Microsoft) | Multi-turn adversarial attacks | `pip install pyrit` |
| DeepTeam (Confident AI) | Programmatic vulnerability testing | `pip install -U deepteam` |
| LLM Guard (ProtectAI) | Input/output scanner pipeline | `pip install llm-guard` |
| Llama Guard 3 (Meta) | Semantic safety classifier | `pip install "transformers>=4.43"` |
| NeMo Guardrails (NVIDIA) | Programmable dialog/tool rails | `pip install nemoguardrails` |
| ART (IBM) | Data poisoning / backdoor detection | `pip install adversarial-robustness-toolbox` |
| Cleanlab | Label-quality and outlier detection | `pip install cleanlab` |
| safetensors | Safe model weight loading | `pip install safetensors` |

## MITRE ATLAS Reference

| ID | Technique | Addressed by |
|----|-----------|-------------|
| AML.T0010 | ML Supply Chain Compromise | mcp-tool-security.md, data-poisoning.md |
| AML.T0018 | Backdoor ML Model | data-poisoning.md |
| AML.T0020 | Poison Training Data | data-poisoning.md |
| AML.T0024 | Exfiltration via ML Inference API | data-poisoning.md (vector section) |
| AML.T0051 | LLM Prompt Injection | prompt-injection.md, llm-red-teaming.md |
| AML.T0051.001 | LLM Prompt Injection: Indirect | prompt-injection.md, llm-red-teaming.md |
| AML.T0053 | LLM Plugin Compromise | mcp-tool-security.md, prompt-injection.md |
| AML.T0054 | LLM Jailbreak | llm-red-teaming.md |
| AML.T0057 | LLM Data Leakage | prompt-injection.md, data-poisoning.md |

## References

Load the relevant reference file for detailed workflows, code patterns, and tool commands:

- `references/mcp-tool-security.md` -- MCP server auditing (mcp-scan, tool poisoning, SSRF, rug pull)
- `references/prompt-injection.md` -- prompt injection detection and agentic tool governance
- `references/llm-red-teaming.md` -- garak, Promptfoo, PyRIT, Llama Guard, NeMo Guardrails, RAG testing
- `references/data-poisoning.md` -- data/model poisoning detection and vector/embedding weaknesses

## Verification Checklist

- [ ] MCP servers scanned with mcp-scan before adding to agent stack
- [ ] Tool allowlist with deny-by-default enforced; argument schemas validated
- [ ] High-impact tool calls gated behind human-in-the-loop approval
- [ ] Retrieved content scanned for injection before model ingestion
- [ ] LLM output treated as untrusted data (no eval/SQL/shell/innerHTML)
- [ ] Secrets and per-tenant data excluded from prompt context
- [ ] Token/request rate caps in place
- [ ] Guardrail stack (LLM Guard + Llama Guard or NeMo) deployed for production LLM apps
- [ ] Red-team suite (garak/promptfoo) runs in CI and fails build on new vulnerabilities
- [ ] Training data and model weights integrity verified (hashes, safetensors)
- [ ] Vector store tenant isolation enforced server-side (not client-filter only)
