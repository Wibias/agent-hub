import { runP11RuntimeQuery } from './p11-runtime-router.mjs';
import { planP40FailClosedRollback } from './p40-profile-authorization.mjs';

const PROFILES = new Set(['standard', 'deep']);
function validScope(scope) {
  return !!scope && scope.mode === 'isolated-shadow-rehearsal'
    && scope.default_off === true && scope.production_route_wiring === false
    && Array.isArray(scope.profiles) && scope.profiles.length > 0
    && scope.profiles.length <= 2
    && scope.profiles.every(p => PROFILES.has(p))
    && new Set(scope.profiles).size === scope.profiles.length;
}

/**
 * Local-only P44 runtime rehearsal. Default is NO transport.
 * The public output always originates from P11 Legacy, with usage recorded
 * by P11 at most once. No production router imports this module.
 */
export function createP44IsolatedShadowRollbackHarness({
  shadowProbe,
  legacyRunner = runP11RuntimeQuery,
  timeoutMs = 5000,
} = {}) {
  if (typeof shadowProbe !== 'function' || typeof legacyRunner !== 'function'
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) {
    throw new TypeError('P44 requires an isolated probe and Legacy runner');
  }
  let state = 'disabled';
  let profiles = [];
  let attempts = 0;
  let killReason = null;

  function status() {
    return {
      schema_version: 'reference-graph.p44-isolated-shadow-rollback.v1',
      rehearsal_state: state,
      local_probe_enabled: state === 'armed',
      local_kill_switch_latched: state === 'latched',
      shadow_probe_attempts: attempts,
      kill_reason: killReason,
      production_graph_activated: false,
      production_rollback_performed: false,
      activation_authorized: false,
      repository_default_graph_enabled: false,
    };
  }
  function latch(profile, trigger) {
    const decision = planP40FailClosedRollback({ profile, trigger });
    if (decision.authoritative_source !== 'legacy-control'
      || decision.transport_enabled !== false) {
      throw new Error('P44 rollback boundary invalid');
    }
    state = 'latched';
    killReason = trigger;
  }

  return Object.freeze({
    status,
    armForRehearsal(scope) {
      if (state !== 'disabled' || !validScope(scope)) {
        throw new TypeError('P44 cannot arm outside isolated default-off rehearsal');
      }
      profiles = [...scope.profiles];
      state = 'armed';
      return status();
    },
    revokeForRehearsal() {
      if (state === 'armed') latch(profiles[0], 'manual-revoke');
      else if (state === 'disabled') {
        state = 'latched';
        killReason = 'manual-revoke';
      }
      return status();
    },
    async run({
      records, patterns, request, now = new Date(),
      recordUsageEnabled = false, recordUsageFn, usageLogPath,
    } = {}) {
      // The only public result comes from the existing Legacy router.
      const legacy = await legacyRunner({
        records, patterns, request, now,
        graphMode: 'legacy', recordUsageEnabled,
        recordUsageFn, usageLogPath,
      });
      if (legacy?.routing?.authoritative_source !== 'legacy-control'
        || legacy.routing.attempted !== false) {
        throw new Error('P44 expected authentic Legacy response');
      }
      let probeStatus = 'off';
      let reason = null;
      if (state === 'armed' && profiles.includes(request?.profile)
        && PROFILES.has(request?.profile)) {
        attempts++;
        const controller = new AbortController();
        let timer;
        const deadline = new Promise((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('P44 bounded timeout'));
          }, timeoutMs);
        });
        try {
          const probe = await Promise.race([
            Promise.resolve().then(() => shadowProbe({
              records, patterns, request, now, signal: controller.signal,
            })),
            deadline,
          ]);
          if (probe?.status === 'exact' && probe.record_order_exact === true
            && probe.pattern_order_exact === true
            && probe.authoritative_source === 'legacy-control'
            && probe.activation_authorized === false
            && probe.graph_runtime_activated === false) {
            probeStatus = 'exact';
          } else {
            latch(request.profile, 'parity-mismatch');
            probeStatus = 'blocked';
            reason = 'parity-mismatch';
          }
        } catch {
          reason = controller.signal.aborted ? 'timeout' : 'http-error';
          latch(request.profile, reason);
          probeStatus = 'blocked';
        } finally {
          clearTimeout(timer);
        }
      }
      return {
        result: legacy.result,
        routing: legacy.routing,
        shadow: {
          status: probeStatus,
          reason,
          authoritative_source: 'legacy-control',
          public_result_kept_legacy: true,
          ...status(),
        },
      };
    },
  });
}
