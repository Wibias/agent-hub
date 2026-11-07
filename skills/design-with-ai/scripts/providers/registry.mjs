import { assertProvider, assertProviderReport, Capability, ProviderStatus, providerFailure } from "./contract.mjs";

// Taste probe reasons are fixed, known strings. Never echo paths or arbitrary
// third-party probe errors into persisted status reports.
const SAFE_TASTE_PROBE_REASONS = new Set([
  "Taste Skill 2.5.0 needs Node 22+",
  "An explicit locally installed Taste Skill root is required",
  "Taste Skill v2.5.0 consistency.mjs is not installed",
  "Taste Skill root cannot be read",
]);

// Only these exact messages are authored by bundled providers and contain no
// input-dependent paths, browser URLs or third-party exception text.
const SAFE_BUNDLED_PROBE_REASONS = new Map([
  ["native-dwa", new Set(["DWA taste-gate script is missing"])],
  ["impeccable", new Set(["Pinned, bundled Impeccable JS detector is unavailable"])],
]);
function safeProbeReason(id, reason) {
  if ((id === "taste-skill" && SAFE_TASTE_PROBE_REASONS.has(reason)) ||
      SAFE_BUNDLED_PROBE_REASONS.get(id)?.has(reason)) {
    return reason;
  }
  return "Provider runtime unavailable";
}

export function createProviderRegistry(providers = []) {
  const items = new Map();
  for (const provider of providers) {
    assertProvider(provider);
    if (items.has(provider.id)) throw new TypeError("Duplicate provider: " + provider.id);
    items.set(provider.id, provider);
  }
  return {
    list: () => [...items.values()].map(({ id, capabilities }) =>
      ({ id, capabilities: [...capabilities] })),
    get: (id) => items.get(id) ?? null,
  };
}

// Explicit per-run selection: no provider can silently become a workflow owner.
export async function runProviders(registry, {
  capability = Capability.STATIC_AUDIT,
  required = [], optional = [], request = {},
} = {}) {
  if (!Object.values(Capability).includes(capability) ||
      !Array.isArray(required) || !Array.isArray(optional) ||
      ![...required, ...optional].every((id) => typeof id === "string" && id) ||
      new Set([...required, ...optional]).size !== required.length + optional.length) {
    throw new TypeError("Invalid provider selection");
  }
  const reports = [];
  for (const [ids, isRequired] of [[required, true], [optional, false]]) {
    for (const id of ids) {
      const provider = registry.get(id);
      if (!provider) {
        reports.push(providerFailure(id, capability,
          isRequired ? ProviderStatus.BLOCKED : ProviderStatus.UNAVAILABLE,
          "Provider is not registered"));
        continue;
      }
      if (!provider.capabilities.includes(capability)) {
        reports.push(providerFailure(id, capability,
          isRequired ? ProviderStatus.BLOCKED : ProviderStatus.UNAVAILABLE,
          "Capability is not supported"));
        continue;
      }
      let probe;
      try {
        probe = await provider.probe({ capability, request });
      } catch {
        reports.push(providerFailure(id, capability, ProviderStatus.ERROR,
          "Provider probe failed"));
        continue;
      }
      if (!probe || probe.available !== true) {
        reports.push(providerFailure(id, capability,
          isRequired ? ProviderStatus.BLOCKED : ProviderStatus.UNAVAILABLE,
          safeProbeReason(id, probe?.reason)));
        continue;
      }
      try {
        reports.push(assertProviderReport(await provider.inspect({ ...request, capability }),
          { providerId: id, capability }));
      } catch {
        reports.push(providerFailure(id, capability, ProviderStatus.ERROR,
          "Provider inspection failed"));
      }
    }
  }
  return reports;
}
