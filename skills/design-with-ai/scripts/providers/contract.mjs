// Internal provider contracts. Provider reports are untrusted evidence, not verdicts.
export const Capability = Object.freeze({
  STATIC_AUDIT: "static-audit",
  RENDERED_AUDIT: "rendered-audit",
  ART_DIRECTION: "art-direction",
});
export const ProviderStatus = Object.freeze({
  PASS: "PASS",
  FINDINGS: "FINDINGS",
  UNAVAILABLE: "UNAVAILABLE",
  BLOCKED: "BLOCKED",
  ERROR: "ERROR",
});
export const QualityProfile = Object.freeze({
  QUICK: "quick",
  STANDARD: "standard",
  DEEP: "deep",
});

const filled = (value) => typeof value === "string" && value.trim().length > 0;
const own = (values, value) => Object.values(values).includes(value);

export function assertProvider(provider) {
  if (!provider || !/^[a-z][a-z0-9-]*$/.test(provider.id ?? "")) {
    throw new TypeError("Provider requires a stable lowercase id");
  }
  if (!Array.isArray(provider.capabilities) || provider.capabilities.length === 0 ||
      new Set(provider.capabilities).size !== provider.capabilities.length ||
      !provider.capabilities.every((capability) => own(Capability, capability))) {
    throw new TypeError("Provider requires unique supported capabilities");
  }
  if (typeof provider.probe !== "function" || typeof provider.inspect !== "function") {
    throw new TypeError("Provider requires probe() and inspect()");
  }
  return provider;
}

export function assertProviderReport(report, { providerId, capability } = {}) {
  if (!report || typeof report !== "object" || Array.isArray(report) ||
      !filled(report.provider) || !own(Capability, report.capability) ||
      !own(ProviderStatus, report.status) || !Array.isArray(report.findings)) {
    throw new TypeError("Invalid provider report envelope");
  }
  if ((providerId && report.provider !== providerId) ||
      (capability && report.capability !== capability)) {
    throw new TypeError("Provider report identity or capability mismatch");
  }
  if ([ProviderStatus.PASS, ProviderStatus.UNAVAILABLE, ProviderStatus.BLOCKED,
      ProviderStatus.ERROR].includes(report.status) && report.findings.length) {
    throw new TypeError("Non-finding report cannot contain findings");
  }
  if (report.status === ProviderStatus.FINDINGS && report.findings.length === 0) {
    throw new TypeError("FINDINGS report requires at least one finding");
  }
  const ids = new Set();
  for (const finding of report.findings) {
    if (!finding || typeof finding !== "object" || Array.isArray(finding) ||
        !filled(finding.id) || !filled(finding.providerRuleId) ||
        !filled(finding.message) || !["P0", "P1", "P2"].includes(finding.priority) ||
        !finding.location || typeof finding.location !== "object" ||
        !filled(finding.location.file) || !filled(finding.location.route) ||
        !Array.isArray(finding.evidence) || !finding.evidence.length) {
      throw new TypeError("Provider finding requires identity, priority, location and evidence");
    }
    if (ids.has(finding.id)) throw new TypeError("Duplicate provider finding ID");
    ids.add(finding.id);
    for (const item of finding.evidence) {
      if (!item || !filled(item.kind) || !filled(item.ref)) {
        throw new TypeError("Provider evidence needs a kind and source reference");
      }
    }
  }
  if ([ProviderStatus.BLOCKED, ProviderStatus.ERROR, ProviderStatus.UNAVAILABLE].includes(report.status) &&
      !filled(report.reason)) {
    throw new TypeError("Non-success provider report requires a reason");
  }
  return report;
}

export function providerFailure(provider, capability, status, reason) {
  if (![ProviderStatus.UNAVAILABLE, ProviderStatus.BLOCKED, ProviderStatus.ERROR].includes(status)) {
    throw new TypeError("providerFailure status must be unavailable, blocked or error");
  }
  return assertProviderReport({ provider, capability, status, reason, findings: [] });
}
