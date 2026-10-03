const state = {
  overview: null,
  scope: null,
  claim: null,
  view: 'memories',
  projectId: null,
  branch: null,
  selectedClaimId: null,
  selectedCandidateId: null,
  actionToken: null,
  claimActionMode: null,
  reviewRelation: 'unrelated',
  reviewTargetRef: null,
  reviewRejectArmed: false,
  actionMessage: '',
  actionError: '',
  busy: false,
  search: '',
  authority: 'all',
  claimState: 'all',
  loading: false,
};

const el = {
  projectList: document.querySelector('#project-list'),
  projectTotal: document.querySelector('#project-total'),
  projectTitle: document.querySelector('#project-title'),
  projectKicker: document.querySelector('#project-kicker'),
  branchSelect: document.querySelector('#branch-select'),
  scopeMeta: document.querySelector('#scope-meta'),
  refreshButton: document.querySelector('#refresh-button'),
  tabs: document.querySelector('#tabs'),
  view: document.querySelector('#view'),
  loadingTemplate: document.querySelector('#loading-template'),
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function projectName(projectId) {
  const raw = String(projectId ?? '');
  if (raw.startsWith('local.git/')) {
    return raw
      .slice('local.git/'.length)
      .replace(/@[0-9a-f]{12}$/i, '');
  }
  const parts = raw.split('/');
  return parts.length >= 3 ? parts.slice(2).join('/') : raw;
}

function number(value) {
  return Number(value ?? 0).toLocaleString();
}

function percent(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed.toFixed(2) + '%' : '0.00%';
}

function dateTime(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function duration(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms)) return '—';
  if (ms < 1000) return Math.round(ms) + ' ms';
  if (ms < 60000) return (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + ' s';
  return (ms / 60000).toFixed(1) + ' min';
}

function statusClass(value) {
  if (['healthy', 'ok', 'ready', 'drained', 'active', 'promoted'].includes(value)) {
    return 'status-ok';
  }
  if (['partial', 'degraded', 'stale', 'needs_confirmation', 'conflicted'].includes(value)) {
    return 'status-warn';
  }
  if (['failed', 'broken', 'rejected', 'expired'].includes(value)) {
    return 'status-danger';
  }
  return '';
}

function loading() {
  el.view.replaceChildren(el.loadingTemplate.content.cloneNode(true));
}

async function fetchJson(path) {
  const response = await fetch(path, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.message || response.statusText);
  }
  return payload;
}

async function postAction(path, payload) {
  if (!state.actionToken) {
    throw new Error('Memory Console action session is unavailable. Refresh the page.');
  }
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Agent-Hub-Action-Token': state.actionToken,
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(result?.message || response.statusText);
  }
  return result;
}

function resetActionState() {
  state.claimActionMode = null;
  state.reviewRelation = 'unrelated';
  state.reviewTargetRef = null;
  state.reviewRejectArmed = false;
  state.actionMessage = '';
  state.actionError = '';
}

function actionsAreOpen() {
  return (
    state.claimActionMode !== null
    || state.reviewRejectArmed
    || state.busy
  );
}

function api(path, params = {}) {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) {
      url.searchParams.set(key, value);
    }
  }
  return url.pathname + url.search;
}

function activeProject() {
  return state.overview?.projects.find(
    (item) => item.projectId === state.projectId,
  ) ?? null;
}

function activeBranchSummary() {
  return activeProject()?.branches.find(
    (item) => item.branch === state.branch,
  ) ?? null;
}

function updateUrl() {
  const url = new URL(window.location.href);
  if (state.projectId) url.searchParams.set('project', state.projectId);
  if (state.branch) url.searchParams.set('branch', state.branch);
  if (state.view !== 'memories') url.searchParams.set('view', state.view);
  else url.searchParams.delete('view');
  if (state.selectedClaimId && state.view === 'memories') {
    url.searchParams.set('claim', state.selectedClaimId);
  } else {
    url.searchParams.delete('claim');
  }
  if (state.selectedCandidateId && state.view === 'review') {
    url.searchParams.set('candidate', state.selectedCandidateId);
  } else {
    url.searchParams.delete('candidate');
  }
  history.replaceState(null, '', url);
}

function renderProjects() {
  const projects = state.overview?.projects ?? [];
  el.projectTotal.textContent = String(projects.length);
  el.projectList.innerHTML = projects.map((project) => {
    const branchCount = project.branches.length;
    return `
      <button
        class="project-row ${project.projectId === state.projectId ? 'is-active' : ''}"
        data-project="${escapeHtml(project.projectId)}"
      >
        <span class="project-row-main">
          <span class="project-name">${escapeHtml(projectName(project.projectId))}</span>
          <span class="project-meta">${number(branchCount)} branch${branchCount === 1 ? '' : 'es'} · ${number(project.active)} active</span>
        </span>
        <span class="project-count">${number(project.total)}</span>
      </button>
    `;
  }).join('');

  el.projectList.querySelectorAll('[data-project]').forEach((button) => {
    button.addEventListener('click', () => {
      const project = projects.find(
        (item) => item.projectId === button.dataset.project,
      );
      if (!project || project.projectId === state.projectId) return;
      state.projectId = project.projectId;
      state.branch = project.defaultBranch;
      state.selectedClaimId = null;
      state.selectedCandidateId = null;
      state.claim = null;
      resetActionState();
      loadScope();
    });
  });
}

function renderScopeHeader() {
  const project = activeProject();
  const branch = activeBranchSummary();
  if (!project) return;

  const localProject = project.projectId.startsWith('local.git/');
  el.projectKicker.textContent = localProject
    ? 'Local Git repository'
    : project.canonicalRemote || 'Project';
  el.projectTitle.textContent = localProject
    ? projectName(project.projectId)
    : project.projectId;
  el.scopeMeta.innerHTML = [
    `<span>${number(branch?.active ?? 0)} active</span>`,
    '<span>·</span>',
    `<span>${number(branch?.total ?? 0)} total</span>`,
  ].join('');

  el.branchSelect.innerHTML = project.branches.map((item) => `
    <option
      value="${escapeHtml(item.branch)}"
      ${item.branch === state.branch ? 'selected' : ''}
    >${escapeHtml(item.branch)}</option>
  `).join('');
}

function renderTabs() {
  el.tabs.querySelectorAll('[data-view]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.view === state.view);
  });
}

function memoryFilters(memories) {
  const query = state.search.trim().toLowerCase();
  return memories.filter((memory) => {
    if (
      state.authority !== 'all'
      && memory.authority !== state.authority
    ) return false;
    if (
      state.claimState !== 'all'
      && memory.state !== state.claimState
    ) return false;
    if (!query) return true;

    return [
      memory.ref,
      memory.value,
      memory.authority,
      memory.state,
      memory.provenance?.label,
      memory.kind,
    ].some((value) => String(value ?? '').toLowerCase().includes(query));
  });
}

function memoryRow(memory) {
  return `
    <button
      class="memory-row ${memory.claimId === state.selectedClaimId ? 'is-active' : ''}"
      data-claim="${escapeHtml(memory.claimId)}"
    >
      <span class="memory-row-top">
        <span class="ref">${escapeHtml(memory.ref)}</span>
        <span class="authority">${escapeHtml(memory.authority.replaceAll('_', ' '))}</span>
      </span>
      <span class="memory-value">${escapeHtml(memory.value)}</span>
      <span class="memory-row-bottom">
        <span class="inline-state ${escapeHtml(memory.state)}">${escapeHtml(memory.state)}</span>
        <span>${escapeHtml(memory.provenance?.label ?? 'Unknown')}</span>
        <span>${memory.semanticIndexed ? 'semantic indexed' : 'not indexed'}</span>
        ${memory.stale ? '<span class="status-warn">stale advisory</span>' : ''}
        <span>${escapeHtml(dateTime(memory.createdAt))}</span>
      </span>
    </button>
  `;
}

function inspectorEmpty() {
  return `
    <div class="inspector-empty">
      Select a memory to inspect authority, provenance, pipeline state, usage,
      lifecycle, conflicts and semantic indexing.
    </div>
  `;
}

function chainPart(value) {
  return `<span>${escapeHtml(value)}</span>`;
}

function provenanceChain(claim) {
  const p = claim?.claim?.provenance;
  if (!p) return '—';

  const parts = [];
  if (p.sessionId) parts.push('session ' + p.sessionId);
  if (p.type === 'subagent') {
    parts.push('subagent');
    if (p.agentType) parts.push('type ' + p.agentType);
    if (p.agentId) parts.push('id ' + p.agentId);
  } else if (p.type === 'root_agent') {
    parts.push('root agent');
  } else {
    parts.push(p.label || p.type);
  }
  if (p.turnId) parts.push('turn ' + p.turnId);
  parts.push('decision');

  return parts.map((part, index) => (
    (index ? '<span class="chain-arrow">→</span>' : '') + chainPart(part)
  )).join('');
}

function definition(rows) {
  return `
    <dl class="definition-list">
      ${rows.map(([label, value, className = '']) => `
        <dt>${escapeHtml(label)}</dt>
        <dd class="${escapeHtml(className)}">${escapeHtml(value ?? '—')}</dd>
      `).join('')}
    </dl>
  `;
}

function renderClaimActions(claim) {
  if (
    claim?.authority !== 'user_direct'
    || claim?.state !== 'active'
  ) {
    return '';
  }

  const message = state.actionError
    ? `<div class="action-message error">${escapeHtml(state.actionError)}</div>`
    : state.actionMessage
      ? `<div class="action-message">${escapeHtml(state.actionMessage)}</div>`
      : '<div class="action-message"></div>';

  const replacePanel = state.claimActionMode === 'replace'
    ? `
      <div class="action-panel">
        <label class="action-label" for="replace-memory-value">Replacement value</label>
        <textarea id="replace-memory-value" class="action-textarea">${escapeHtml(claim.value)}</textarea>
        <div class="action-row">
          <button id="confirm-replace-memory" class="text-action" type="button">
            Apply replacement
          </button>
          <button id="cancel-memory-action" class="text-action" type="button">
            Cancel
          </button>
        </div>
        ${message}
      </div>
    `
    : '';

  const forgetPanel = state.claimActionMode === 'forget'
    ? `
      <div class="action-panel">
        <div class="action-message">
          This will expire ${escapeHtml(claim.ref)} for this project and branch.
          History and audit evidence remain.
        </div>
        <div class="action-row">
          <button id="confirm-forget-memory" class="text-action danger" type="button">
            Confirm forget
          </button>
          <button id="cancel-memory-action" class="text-action" type="button">
            Cancel
          </button>
        </div>
        ${message}
      </div>
    `
    : '';

  return `
    <section class="inspect-section">
      <h3>Actions</h3>
      <div class="action-row">
        <button id="replace-memory" class="text-action" type="button">
          Replace
        </button>
        <button id="forget-memory" class="text-action danger" type="button">
          Forget
        </button>
      </div>
      ${replacePanel}
      ${forgetPanel}
    </section>
  `;
}

function renderInspector() {
  if (!state.selectedClaimId) return inspectorEmpty();
  if (!state.claim) {
    return '<div class="loading-row"><span></span><span></span><span></span></div>';
  }

  const detail = state.claim;
  const claim = detail.claim;
  const evidence = detail.evidence ?? {};
  const candidate = detail.candidate;
  const importance = candidate?.importance;
  const usage = detail.recallUsage ?? {};
  const lifecycle = detail.lifecycle ?? [];
  const conflicts = detail.conflicts ?? [];

  return `
    <div class="inspector-scroll">
      <div class="inspector-head">
        <div class="inspector-ref">${escapeHtml(claim.ref)}</div>
        <h2>${escapeHtml(claim.value)}</h2>
      </div>

      <section class="inspect-section">
        <h3>Memory</h3>
        ${definition([
          ['Authority', claim.authority],
          ['State', claim.state, statusClass(claim.state)],
          ['Kind', claim.kind],
          ['Created', dateTime(claim.created_at)],
          ['Branch', claim.branch_scope],
          ['Semantic', detail.semanticIndexed ? 'indexed' : 'not indexed'],
        ])}
      </section>

      <section class="inspect-section">
        <h3>Provenance</h3>
        <div class="inspector-chain">${provenanceChain(detail)}</div>
        <div class="spacer-12"></div>
        ${definition([
          ['Evidence', evidence.id],
          ['Source', evidence.source_ref || evidence.source_kind],
          ['Captured', dateTime(evidence.captured_at)],
          ['Agent type', claim.provenance?.agentType],
          ['Agent id', claim.provenance?.agentId],
        ])}
      </section>

      <section class="inspect-section">
        <h3>Pipeline</h3>
        ${definition([
          ['Candidate', candidate?.ref || 'n/a'],
          ['Status', candidate?.status || 'n/a', statusClass(candidate?.status)],
          ['Importance', importance?.decision || 'n/a'],
          ['Durability', importance?.durability || 'n/a'],
          ['Utility', importance?.future_utility || 'n/a'],
          ['Relation', detail.relation?.relation || 'n/a'],
          ['Relation target', detail.relation?.targetRef || 'none'],
        ])}
      </section>

      <section class="inspect-section">
        <h3>Recall usage</h3>
        ${definition([
          ['Retrieved', number(usage.retrieval_count)],
          ['Budget retained', number(usage.retained_count)],
          ['In context', number(usage.context_count)],
          ['Last retained', dateTime(usage.last_retained_at)],
          ['Last context', dateTime(usage.last_context_at)],
        ])}
      </section>

      <section class="inspect-section">
        <h3>Lifecycle</h3>
        ${lifecycle.length
          ? lifecycle.map((item) => `
              <div class="data-row inspect-event-row">
                <span class="mono">${escapeHtml(item.action)}</span>
                <span class="muted">${escapeHtml(item.sourceRef || '—')} → ${escapeHtml(item.targetRef || '—')} · ${escapeHtml(dateTime(item.created_at))}</span>
              </div>
            `).join('')
          : '<div class="inline-empty">No lifecycle transitions.</div>'}
      </section>

      <section class="inspect-section">
        <h3>Conflicts</h3>
        ${conflicts.length
          ? conflicts.map((item) => `
              <div class="data-row inspect-conflict-row">
                <span class="${statusClass(item.state)}">${escapeHtml(item.state)}</span>
                <span class="mono muted">${escapeHtml(item.claimARef)} ↔ ${escapeHtml(item.claimBRef)}</span>
              </div>
            `).join('')
          : '<div class="inline-empty">No conflicts.</div>'}
      </section>

      <section class="inspect-section">
        <h3>Value</h3>
        <p class="inspect-value">${escapeHtml(claim.value)}</p>
      </section>

      ${renderClaimActions(claim)}
    </div>
  `;
}

async function reloadCurrentData({
  preserveClaim = true,
  preserveCandidate = true,
} = {}) {
  const claimId = preserveClaim ? state.selectedClaimId : null;
  const candidateId = preserveCandidate ? state.selectedCandidateId : null;

  const overview = await fetchJson('/api/overview');
  state.overview = overview;
  state.actionToken = overview.actions?.token ?? null;

  let project = overview.projects.find(
    (item) => item.projectId === state.projectId,
  ) ?? overview.projects[0] ?? null;

  if (!project) {
    state.projectId = null;
    state.branch = null;
    state.scope = null;
    state.claim = null;
    state.selectedClaimId = null;
    state.selectedCandidateId = null;
    renderProjects();
    renderScopeHeader();
    renderView();
    return;
  }

  state.projectId = project.projectId;
  if (!project.branches.some((item) => item.branch === state.branch)) {
    state.branch = project.defaultBranch;
  }

  if (!state.branch) {
    state.scope = null;
    state.claim = null;
    state.selectedClaimId = null;
    state.selectedCandidateId = null;
    renderView();
    return;
  }

  state.scope = await fetchJson(api('/api/scope', {
    projectId: state.projectId,
    branch: state.branch,
  }));

  state.selectedClaimId = (
    claimId
    && state.scope.memories.some((item) => item.claimId === claimId)
  ) ? claimId : null;
  state.selectedCandidateId = (
    candidateId
    && state.scope.candidates.some((item) => item.id === candidateId)
  ) ? candidateId : null;

  state.claim = null;
  if (state.selectedClaimId) {
    state.claim = await fetchJson(api('/api/claim', {
      projectId: state.projectId,
      branch: state.branch,
      claimId: state.selectedClaimId,
    }));
  }

  updateUrl();
  renderView();
}

async function performConsoleAction(path, payload) {
  if (state.busy) return null;
  state.busy = true;
  state.actionError = '';
  renderView();

  try {
    const result = await postAction(path, payload);
    resetActionState();
    state.actionMessage = result.reason ?? 'Memory action applied.';
    await reloadCurrentData();
    return result;
  } catch (error) {
    state.actionError = error.message;
    renderView();
    return null;
  } finally {
    state.busy = false;
  }
}

function renderMemories() {
  const memories = state.scope?.memories ?? [];
  const filtered = memoryFilters(memories);
  const authorities = [...new Set(memories.map((item) => item.authority))].sort();
  const states = [...new Set(memories.map((item) => item.state))].sort();

  el.view.innerHTML = `
    <div class="memory-layout">
      <section class="memory-column">
        <div class="toolbar">
          <input
            id="memory-search"
            class="search"
            type="search"
            autocomplete="off"
            placeholder="Search ref, value, authority, origin…"
            value="${escapeHtml(state.search)}"
          >
          <select id="authority-filter" class="filter">
            <option value="all">All authority</option>
            ${authorities.map((value) => `
              <option value="${escapeHtml(value)}" ${value === state.authority ? 'selected' : ''}>
                ${escapeHtml(value.replaceAll('_', ' '))}
              </option>
            `).join('')}
          </select>
          <select id="state-filter" class="filter">
            <option value="all">All states</option>
            ${states.map((value) => `
              <option value="${escapeHtml(value)}" ${value === state.claimState ? 'selected' : ''}>
                ${escapeHtml(value)}
              </option>
            `).join('')}
          </select>
        </div>
        <div class="memory-list">
          ${filtered.length
            ? filtered.map(memoryRow).join('')
            : '<div class="empty">No memories match the current filters.</div>'}
        </div>
      </section>
      <aside class="inspector">
        ${renderInspector()}
      </aside>
    </div>
  `;

  const search = document.querySelector('#memory-search');
  const authority = document.querySelector('#authority-filter');
  const claimState = document.querySelector('#state-filter');

  search?.addEventListener('input', () => {
    state.search = search.value;
    renderMemories();
  });
  authority?.addEventListener('change', () => {
    state.authority = authority.value;
    renderMemories();
  });
  claimState?.addEventListener('change', () => {
    state.claimState = claimState.value;
    renderMemories();
  });

  el.view.querySelectorAll('[data-claim]').forEach((button) => {
    button.addEventListener('click', () => {
      resetActionState();
      selectClaim(button.dataset.claim);
    });
  });

  document.querySelector('#replace-memory')?.addEventListener('click', () => {
    state.claimActionMode = 'replace';
    state.actionError = '';
    state.actionMessage = '';
    renderMemories();
  });
  document.querySelector('#forget-memory')?.addEventListener('click', () => {
    state.claimActionMode = 'forget';
    state.actionError = '';
    state.actionMessage = '';
    renderMemories();
  });
  document.querySelector('#cancel-memory-action')?.addEventListener('click', () => {
    state.claimActionMode = null;
    state.actionError = '';
    renderMemories();
  });
  document.querySelector('#confirm-replace-memory')?.addEventListener(
    'click',
    async () => {
      const value = document.querySelector('#replace-memory-value')?.value ?? '';
      await performConsoleAction('/api/actions/replace', {
        projectId: state.projectId,
        branch: state.branch,
        claimRef: state.claim?.claim?.ref,
        newValue: value,
      });
    },
  );
  document.querySelector('#confirm-forget-memory')?.addEventListener(
    'click',
    async () => {
      await performConsoleAction('/api/actions/forget', {
        projectId: state.projectId,
        branch: state.branch,
        claimRef: state.claim?.claim?.ref,
      });
    },
  );
}

function summaryStat(label, value) {
  return `
    <div class="summary-stat">
      <div class="summary-stat-label">${escapeHtml(label)}</div>
      <div class="summary-stat-value">${escapeHtml(value)}</div>
    </div>
  `;
}

function reviewableCandidates() {
  return (state.scope?.candidates ?? []).filter((candidate) => candidate.reviewable);
}

function reviewTargets(candidate) {
  const memories = (state.scope?.memories ?? []).filter(
    (memory) => memory.state === 'active',
  );
  if (candidate?.authority === 'user_direct') {
    return memories.filter((memory) => memory.authority === 'user_direct');
  }
  return memories.filter(
    (memory) => ['user_direct', 'agent_inference'].includes(memory.authority),
  );
}

function reviewCandidateRow(candidate) {
  const importance = candidate.importance ?? {};
  return `
    <button
      class="review-row ${candidate.id === state.selectedCandidateId ? 'is-active' : ''}"
      data-candidate="${escapeHtml(candidate.id)}"
      type="button"
    >
      <span class="memory-row-top">
        <span class="ref">${escapeHtml(candidate.ref)}</span>
        <span class="authority">${escapeHtml(candidate.authority.replaceAll('_', ' '))}</span>
      </span>
      <span class="memory-value">${escapeHtml(candidate.value)}</span>
      <span class="review-meta">
        <span class="${statusClass(candidate.status)}">${escapeHtml(candidate.status)}</span>
        <span>judge ${escapeHtml(importance.decision || 'unknown')}</span>
        <span>durability ${escapeHtml(importance.durability || 'unknown')}</span>
        <span>utility ${escapeHtml(importance.future_utility || 'unknown')}</span>
      </span>
    </button>
  `;
}

function renderReviewInspector(candidate) {
  if (!candidate) {
    return `
      <div class="inspector-empty">
        No reviewable candidate selected.
      </div>
    `;
  }

  const importance = candidate.importance ?? {};
  const targets = reviewTargets(candidate);
  if (
    state.reviewRelation !== 'unrelated'
    && !targets.some((memory) => memory.ref === state.reviewTargetRef)
  ) {
    state.reviewTargetRef = targets[0]?.ref ?? null;
  }

  const targetControl = state.reviewRelation === 'unrelated'
    ? ''
    : `
      <label class="action-label" for="review-target">Target memory</label>
      <select id="review-target" class="action-select">
        ${targets.length
          ? targets.map((memory) => `
              <option
                value="${escapeHtml(memory.ref)}"
                ${memory.ref === state.reviewTargetRef ? 'selected' : ''}
              >
                ${escapeHtml(memory.ref)} · ${escapeHtml(memory.authority)} · ${escapeHtml(memory.value)}
              </option>
            `).join('')
          : '<option value="">No eligible target</option>'}
      </select>
    `;

  const message = state.actionError
    ? `<div class="action-message error">${escapeHtml(state.actionError)}</div>`
    : state.actionMessage
      ? `<div class="action-message">${escapeHtml(state.actionMessage)}</div>`
      : '<div class="action-message"></div>';

  const rejectPanel = state.reviewRejectArmed
    ? `
      <div class="action-panel">
        <div class="action-message">
          Rejecting closes ${escapeHtml(candidate.ref)} as ignored.
          No durable Claim will be created.
        </div>
        <div class="action-row">
          <button id="confirm-reject-candidate" class="text-action danger" type="button">
            Confirm reject
          </button>
          <button id="cancel-reject-candidate" class="text-action" type="button">
            Cancel
          </button>
        </div>
      </div>
    `
    : '';

  return `
    <div class="inspector-scroll">
      <div class="inspector-head">
        <div class="inspector-ref">${escapeHtml(candidate.ref)}</div>
        <h2>${escapeHtml(candidate.value)}</h2>
      </div>

      <section class="inspect-section">
        <h3>Candidate</h3>
        ${definition([
          ['Authority', candidate.authority],
          ['Status', candidate.status, statusClass(candidate.status)],
          ['Created', dateTime(candidate.createdAt)],
          ['Evaluated', dateTime(candidate.evaluatedAt)],
          ['Importance', importance.decision || 'unknown'],
          ['Durability', importance.durability || 'unknown'],
          ['Utility', importance.future_utility || 'unknown'],
          ['Confidence', importance.confidence || 'unknown'],
        ])}
      </section>

      <section class="inspect-section">
        <h3>Decision</h3>
        <div class="action-panel">
          <label class="action-label" for="review-relation">Relation</label>
          <select id="review-relation" class="action-select">
            ${['unrelated', 'same', 'update', 'contradict'].map((relation) => `
              <option value="${relation}" ${relation === state.reviewRelation ? 'selected' : ''}>
                ${relation}
              </option>
            `).join('')}
          </select>
          ${targetControl}
          <div class="action-row">
            <button id="confirm-candidate" class="text-action" type="button">
              Confirm candidate
            </button>
            <button id="reject-candidate" class="text-action danger" type="button">
              Reject
            </button>
          </div>
          ${message}
          ${rejectPanel}
        </div>
      </section>

      <section class="inspect-section">
        <h3>Judge reason</h3>
        <p class="inspect-value">${escapeHtml(importance.reason || 'No judge reason recorded.')}</p>
      </section>
    </div>
  `;
}

function renderReview() {
  const candidates = reviewableCandidates();
  if (
    !candidates.some((candidate) => candidate.id === state.selectedCandidateId)
  ) {
    state.selectedCandidateId = candidates[0]?.id ?? null;
    state.reviewRelation = 'unrelated';
    state.reviewTargetRef = null;
    state.reviewRejectArmed = false;
  }

  const selected = candidates.find(
    (candidate) => candidate.id === state.selectedCandidateId,
  ) ?? null;

  el.view.innerHTML = `
    <div class="review-layout">
      <section class="review-list">
        <div class="data-section-head">
          <h2>Review queue</h2>
          <span>${number(candidates.length)} actionable</span>
        </div>
        ${candidates.length
          ? candidates.map(reviewCandidateRow).join('')
          : '<div class="empty">No candidates need explicit review.</div>'}
      </section>
      <aside class="review-inspector">
        ${renderReviewInspector(selected)}
      </aside>
    </div>
  `;

  el.view.querySelectorAll('[data-candidate]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedCandidateId = button.dataset.candidate;
      state.reviewRelation = 'unrelated';
      state.reviewTargetRef = null;
      state.reviewRejectArmed = false;
      state.actionMessage = '';
      state.actionError = '';
      updateUrl();
      renderReview();
    });
  });

  document.querySelector('#review-relation')?.addEventListener('change', (event) => {
    state.reviewRelation = event.target.value;
    state.reviewTargetRef = null;
    state.reviewRejectArmed = false;
    state.actionError = '';
    renderReview();
  });
  document.querySelector('#review-target')?.addEventListener('change', (event) => {
    state.reviewTargetRef = event.target.value || null;
  });
  document.querySelector('#confirm-candidate')?.addEventListener('click', async () => {
    if (!selected) return;
    if (
      state.reviewRelation !== 'unrelated'
      && !state.reviewTargetRef
    ) {
      state.actionError = 'Select an eligible target memory.';
      renderReview();
      return;
    }
    await performConsoleAction('/api/actions/candidate-confirm', {
      projectId: state.projectId,
      branch: state.branch,
      candidateRef: selected.ref,
      relation: state.reviewRelation,
      targetRef: state.reviewTargetRef,
    });
  });
  document.querySelector('#reject-candidate')?.addEventListener('click', () => {
    state.reviewRejectArmed = true;
    state.actionError = '';
    renderReview();
  });
  document.querySelector('#cancel-reject-candidate')?.addEventListener('click', () => {
    state.reviewRejectArmed = false;
    renderReview();
  });
  document.querySelector('#confirm-reject-candidate')?.addEventListener('click', async () => {
    if (!selected) return;
    await performConsoleAction('/api/actions/candidate-reject', {
      projectId: state.projectId,
      branch: state.branch,
      candidateRef: selected.ref,
    });
  });
}

function renderPipeline() {
  const pipeline = state.scope?.pipeline ?? { runs: [], failures: [] };
  const candidates = state.scope?.candidates ?? [];
  const failedRuns = pipeline.runs.filter(
    (run) => ['failed', 'partial'].includes(run.status),
  ).length;
  const promoted = pipeline.runs.reduce(
    (sum, run) => sum + Number(run.promoted_count ?? 0),
    0,
  );
  const pending = candidates.filter((item) => item.status === 'pending').length;

  el.view.innerHTML = `
    <div class="wide-view">
      <div class="summary-strip">
        ${summaryStat('Recent runs', number(pipeline.runs.length))}
        ${summaryStat('Failed / partial', number(failedRuns))}
        ${summaryStat('Promoted', number(promoted))}
        ${summaryStat('Pending', number(pending))}
        ${summaryStat('Failures', number(pipeline.failures.length))}
      </div>

      <section class="data-section">
        <div class="data-section-head">
          <h2>Pipeline runs</h2>
          <span>latest 50</span>
        </div>
        <div class="data-row data-head pipeline-row">
          <span>Run</span><span>Trigger</span><span>Status</span><span>Duration</span><span>Promoted</span>
        </div>
        ${pipeline.runs.length
          ? pipeline.runs.map((run) => `
              <div class="data-row pipeline-row">
                <span class="ref">${escapeHtml(run.ref)}</span>
                <span class="mono">${escapeHtml(run.trigger)}</span>
                <span class="${statusClass(run.status)}">${escapeHtml(run.status)}</span>
                <span class="mono">${escapeHtml(duration(run.duration_ms))}</span>
                <span class="mono">${number(run.promoted_count)}</span>
              </div>
            `).join('')
          : '<div class="empty">No pipeline runs recorded for this scope.</div>'}
      </section>

      <section class="data-section">
        <div class="data-section-head">
          <h2>Failures</h2>
          <span>dead-letter visibility · no retry</span>
        </div>
        ${pipeline.failures.length
          ? pipeline.failures.map((failure) => `
              <div class="data-row failure-row">
                <span class="ref">${escapeHtml(failure.runRef)}</span>
                <span class="mono">${escapeHtml(failure.candidate_ref || '—')}</span>
                <span>${escapeHtml(failure.stage)}</span>
                <span class="status-danger">${escapeHtml(failure.error_class)}: ${escapeHtml(failure.error)}</span>
              </div>
            `).join('')
          : '<div class="empty">No recorded pipeline failures.</div>'}
      </section>
    </div>
  `;
}

function metric(label, value, className = '') {
  return `
    <div class="metric-line">
      <span class="metric-label">${escapeHtml(label)}</span>
      <span class="metric-value ${escapeHtml(className)}">${escapeHtml(value)}</span>
    </div>
  `;
}

function renderHealth() {
  const scopeHealth = state.scope?.health ?? {};
  const runtime = state.scope?.runtime ?? {};
  const database = runtime.database ?? {};
  const embedding = runtime.embedding ?? {};
  const codex = runtime.codex ?? {};

  el.view.innerHTML = `
    <div class="wide-view">
      <div class="summary-strip">
        ${summaryStat('Database', database.status || (scopeHealth.db_healthy ? 'healthy' : 'degraded'))}
        ${summaryStat('E5 worker', embedding.ready ? 'ready' : embedding.status || 'unknown')}
        ${summaryStat('Hooks', codex.status || 'unknown')}
        ${summaryStat('Semantic', percent(scopeHealth.semantic_coverage_percent))}
        ${summaryStat('Pending', number(scopeHealth.pending))}
      </div>

      <section class="data-section">
        <div class="data-section-head"><h2>Scope</h2><span>read-only snapshot</span></div>
        <div class="health-grid">
          ${metric('DB quick check', database.quickCheck || '—', statusClass(database.status))}
          ${metric('Journal mode', database.journalMode || '—')}
          ${metric('Semantic coverage', percent(scopeHealth.semantic_coverage_percent))}
          ${metric('Claims indexed', `${number(scopeHealth.embedded_claims)} / ${number(scopeHealth.claims)}`)}
          ${metric('Pending candidates', number(scopeHealth.pending))}
          ${metric('Review backlog', number(scopeHealth.needs_confirmation) + Number(scopeHealth.kept_for_review ?? 0))}
          ${metric('Failed candidates', number(scopeHealth.failed_candidates))}
          ${metric('Stale agent memories', number(scopeHealth.stale_agent_memories))}
          ${metric('Recent pipeline runs', number(scopeHealth.recent_runs))}
          ${metric('Failed / partial runs', number(scopeHealth.failed_runs))}
        </div>
      </section>

      <section class="data-section">
        <div class="data-section-head"><h2>Runtime</h2><span>host-level checks</span></div>
        <div class="health-grid">
          ${metric('Embedding status', embedding.status || 'unknown', statusClass(embedding.status))}
          ${metric('Embedding ready', embedding.ready ? 'yes' : 'no', embedding.ready ? 'status-ok' : 'status-warn')}
          ${metric('Query canary', embedding.queryCanary ? 'pass' : 'unknown', embedding.queryCanary ? 'status-ok' : '')}
          ${metric('Embedding model', embedding.modelId || '—')}
          ${metric('Codex integration', codex.status || 'unknown', statusClass(codex.status))}
          ${metric('UserPromptSubmit', codex.hook?.userPromptSubmit ? 'configured' : 'missing', codex.hook?.userPromptSubmit ? 'status-ok' : 'status-warn')}
          ${metric('Stop capture', codex.hook?.stopAgentDecisionCapture ? 'configured' : 'missing', codex.hook?.stopAgentDecisionCapture ? 'status-ok' : 'status-warn')}
          ${metric('SubagentStop', codex.hook?.subagentStopAgentDecisionCapture ? 'configured' : 'missing', codex.hook?.subagentStopAgentDecisionCapture ? 'status-ok' : 'status-warn')}
        </div>
      </section>
    </div>
  `;
}

function qualityLines(authority, bucket) {
  return `
    <div class="quality-block">
      <h3>${escapeHtml(authority.replaceAll('_', ' '))}</h3>
      ${metric('Candidates', number(bucket?.candidates))}
      ${metric('Importance · promote', number(bucket?.importance?.promote))}
      ${metric('Importance · ignore', number(bucket?.importance?.ignore))}
      ${metric('Importance · keep', number(bucket?.importance?.keep_candidate))}
      ${metric('Importance · confirm', number(bucket?.importance?.needs_confirmation))}
      ${metric('Relation · same', number(bucket?.relations?.same))}
      ${metric('Relation · update', number(bucket?.relations?.update))}
      ${metric('Relation · contradict', number(bucket?.relations?.contradict))}
      ${metric('Relation · unrelated', number(bucket?.relations?.unrelated))}
    </div>
  `;
}

function renderQuality() {
  const quality = state.scope?.quality ?? {};
  const recall = quality.recall ?? {};
  const authorities = quality.by_authority ?? {};

  el.view.innerHTML = `
    <div class="wide-view">
      <div class="summary-strip">
        ${summaryStat('Recall runs', number(recall.runs))}
        ${summaryStat('Retrieved', number(recall.retrieved))}
        ${summaryStat('Retained', number(recall.retained))}
        ${summaryStat('Selected', number(recall.selected))}
        ${summaryStat('Advisory', number(recall.advisory))}
      </div>

      <section class="data-section">
        <div class="data-section-head"><h2>Judge distribution</h2><span>by authority</span></div>
        <div class="quality-grid">
          ${qualityLines('user_direct', authorities.user_direct)}
          ${qualityLines('agent_inference', authorities.agent_inference)}
        </div>
      </section>

      <section class="data-section">
        <div class="data-section-head"><h2>Recall funnel</h2><span>operational telemetry</span></div>
        <div class="health-grid">
          ${metric('Retrieved', number(recall.retrieved))}
          ${metric('Budget retained', number(recall.retained))}
          ${metric('Answer selected', number(recall.selected))}
          ${metric('Advisory included', number(recall.advisory))}
          ${metric('Blocked', number(recall.blocked))}
          ${metric('Near-duplicates closed', number(quality.deterministic_near_duplicates))}
          ${metric('Stale advisory memories', number(quality.stale_agent_memories))}
        </div>
      </section>
    </div>
  `;
}

function renderStale() {
  const stale = state.scope?.stale ?? [];

  el.view.innerHTML = `
    <div class="wide-view">
      <section class="data-section">
        <div class="data-section-head">
          <h2>Stale advisory agent memories</h2>
          <span>90 days · advisory only · never auto-deleted</span>
        </div>
        <div class="data-row data-head stale-row">
          <span>Memory</span><span>Reason</span><span>Value</span><span>Context use</span>
        </div>
        ${stale.length
          ? stale.map((item) => `
              <div class="data-row stale-row">
                <span class="ref">${escapeHtml(item.ref)}</span>
                <span class="status-warn">${escapeHtml(item.reason)}</span>
                <span>${escapeHtml(item.value)}</span>
                <span class="mono">${number(item.context_count)}</span>
              </div>
            `).join('')
          : '<div class="empty">No stale advisory agent memories in this scope.</div>'}
      </section>
    </div>
  `;
}

function renderView() {
  renderProjects();
  renderScopeHeader();
  renderTabs();

  if (!state.scope) {
    loading();
    return;
  }

  if (state.view === 'review') return renderReview();
  if (state.view === 'pipeline') return renderPipeline();
  if (state.view === 'health') return renderHealth();
  if (state.view === 'quality') return renderQuality();
  if (state.view === 'stale') return renderStale();
  renderMemories();
}

async function selectClaim(claimId) {
  state.selectedClaimId = claimId;
  state.claim = null;
  updateUrl();
  renderMemories();

  try {
    state.claim = await fetchJson(api('/api/claim', {
      projectId: state.projectId,
      branch: state.branch,
      claimId,
    }));
  } catch (error) {
    state.claim = {
      claim: {
        ref: 'error',
        value: error.message,
        provenance: {},
      },
      evidence: {},
      lifecycle: [],
      conflicts: [],
    };
  }
  renderMemories();
}

async function loadScope({
  preferredClaimId = null,
} = {}) {
  if (!state.projectId) return;

  state.scope = null;
  state.claim = null;
  state.selectedClaimId = null;
  state.selectedCandidateId = null;
  resetActionState();
  state.search = '';
  state.authority = 'all';
  state.claimState = 'all';
  updateUrl();
  renderProjects();
  renderScopeHeader();

  if (!state.branch) {
    el.view.innerHTML = '<div class="empty">This project has no memory branches yet.</div>';
    return;
  }

  loading();

  try {
    state.scope = await fetchJson(api('/api/scope', {
      projectId: state.projectId,
      branch: state.branch,
    }));

    if (state.view === 'memories' && state.scope.memories.length > 0) {
      const preferred = state.scope.memories.find(
        (item) => item.claimId === preferredClaimId,
      );
      const active = state.scope.memories.find(
        (item) => item.state === 'active',
      );
      await selectClaim(
        preferred?.claimId
        ?? active?.claimId
        ?? state.scope.memories[0].claimId,
      );
      return;
    }

    renderView();
  } catch (error) {
    el.view.innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
  }
}

async function bootstrap() {
  loading();
  try {
    state.overview = await fetchJson('/api/overview');
    state.actionToken = state.overview.actions?.token ?? null;
    const params = new URL(window.location.href).searchParams;
    const requestedProject = params.get('project');
    const requestedBranch = params.get('branch');
    const requestedView = params.get('view');
    const requestedClaim = params.get('claim');
    const requestedCandidate = params.get('candidate');

    const projects = state.overview.projects ?? [];
    const project = projects.find(
      (item) => item.projectId === requestedProject,
    ) ?? projects[0] ?? null;

    if (!project) {
      el.projectTitle.textContent = 'No memory projects';
      el.view.innerHTML = '<div class="empty">The memory database has no registered projects.</div>';
      renderProjects();
      return;
    }

    state.projectId = project.projectId;
    state.branch = project.branches.some(
      (item) => item.branch === requestedBranch,
    )
      ? requestedBranch
      : project.defaultBranch;
    if (['memories', 'review', 'pipeline', 'health', 'quality', 'stale'].includes(requestedView)) {
      state.view = requestedView;
    }

    await loadScope({
      preferredClaimId: requestedClaim,
    });
    if (
      requestedCandidate
      && state.view === 'review'
      && state.scope.candidates.some(
        (item) => item.id === requestedCandidate && item.reviewable,
      )
    ) {
      state.selectedCandidateId = requestedCandidate;
      updateUrl();
      renderReview();
    }
  } catch (error) {
    el.projectTitle.textContent = 'Memory Console unavailable';
    el.view.innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
  }
}

el.branchSelect.addEventListener('change', () => {
  if (el.branchSelect.value === state.branch) return;
  state.branch = el.branchSelect.value;
  loadScope();
});

el.refreshButton?.addEventListener('click', async () => {
  if (state.busy) return;
  const prior = el.refreshButton.textContent;
  el.refreshButton.textContent = 'Refreshing…';
  try {
    await reloadCurrentData();
  } catch (error) {
    state.actionError = error.message;
    renderView();
  } finally {
    el.refreshButton.textContent = prior;
  }
});

el.tabs.addEventListener('click', (event) => {
  const button = event.target.closest('[data-view]');
  if (!button) return;
  state.view = button.dataset.view;
  state.selectedClaimId = null;
  state.selectedCandidateId = null;
  state.claim = null;
  resetActionState();
  updateUrl();
  renderView();
});

bootstrap();

setInterval(async () => {
  if (
    document.visibilityState !== 'visible'
    || !state.scope
    || actionsAreOpen()
  ) {
    return;
  }
  try {
    await reloadCurrentData();
  } catch {
    // Live refresh is best-effort; explicit Refresh remains available.
  }
}, 10_000);
