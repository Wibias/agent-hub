import { assertProvider, assertProviderReport, Capability, ProviderStatus, providerFailure } from "./contract.mjs";

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
          "Provider runtime unavailable"));
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
