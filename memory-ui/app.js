const state = {
  overview: null,
  scope: null,
  claim: null,
  graph: null,
  graphLoading: false,
  graphError: '',
  graphSearch: '',
  graphOrigin: 'all',
  graphGroup: 'all',
  graphNodeState: 'all',
  selectedGraphNodeId: null,
  graphInspectorOpen: false,
  memoryInspectorOpen: false,
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

function resetGraphState({ keepData = false } = {}) {
  if (!keepData) state.graph = null;
  state.graphLoading = false;
  state.graphError = '';
  state.graphSearch = '';
  state.graphOrigin = 'all';
  state.graphGroup = 'all';
  state.graphNodeState = 'all';
  state.selectedGraphNodeId = null;
  state.graphInspectorOpen = false;
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
      resetGraphState();
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
    const active = button.dataset.view === state.view;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
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
        <span class="authority">${escapeHtml(graphAuthorityLabel(memory.authority))}</span>
      </span>
      <span class="memory-value">${escapeHtml(memoryDisplayTitle(memory.value))}</span>
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

function compactTechnicalId(value) {
  const raw = String(value ?? '');
  if (raw.length <= 28) return raw;
  if (/^[0-9a-f-]{30,}$/i.test(raw)) {
    return raw.slice(0, 8) + '…' + raw.slice(-6);
  }
  return raw.slice(0, 22) + '…' + raw.slice(-8);
}

function chainPart(value, {
  fullValue = null,
} = {}) {
  const title = fullValue
    ? ` title="${escapeHtml(fullValue)}"`
    : '';
  return `<span${title}>${escapeHtml(value)}</span>`;
}

function provenanceChain(claim) {
  const p = claim?.claim?.provenance;
  if (!p) return '—';

  const parts = [];
  if (p.sessionId) {
    parts.push({
      value: 'session ' + compactTechnicalId(p.sessionId),
      fullValue: 'session ' + p.sessionId,
    });
  }
  if (p.type === 'subagent') {
    parts.push({ value: 'subagent' });
    if (p.agentType) parts.push({ value: 'type ' + p.agentType });
    if (p.agentId) {
      parts.push({
        value: 'id ' + compactTechnicalId(p.agentId),
        fullValue: 'id ' + p.agentId,
      });
    }
  } else if (p.type === 'root_agent') {
    parts.push({ value: 'root agent' });
  } else {
    parts.push({ value: p.label || p.type });
  }
  if (p.turnId) {
    parts.push({
      value: 'turn ' + compactTechnicalId(p.turnId),
      fullValue: 'turn ' + p.turnId,
    });
  }
  parts.push({ value: 'decision' });

  return parts.map((part, index) => (
    (index ? '<span class="chain-arrow">→</span>' : '')
    + chainPart(part.value, { fullValue: part.fullValue })
  )).join('');
}

function definition(rows) {
  return `
    <dl class="definition-list">
      ${rows.map(([label, value, className = '', fullValue = null]) => {
        const title = fullValue
          ? ` title="${escapeHtml(fullValue)}"`
          : '';
        return `
          <dt>${escapeHtml(label)}</dt>
          <dd class="${escapeHtml(className)}"${title}>${escapeHtml(value ?? '—')}</dd>
        `;
      }).join('')}
    </dl>
  `;
}

/** Keep optional diagnostics inspectable without showing a sea of n/a fields. */
function definitionOptional(rows) {
  const meaningful = rows.filter((row) => row[1] !== undefined && row[1] !== null
    && row[1] !== '' && row[1] !== '—' && row[1] !== 'n/a' && row[1] !== 'none');
  return meaningful.length ? definition(meaningful) : '';
}

/** Render an optional advanced disclosure only when data exists. */
function optionalInspectorSection(label, rows) {
  const content = definitionOptional(rows);
  if (!content) return '';
  return "<section class='inspect-section'><details class='inspector-advanced'><summary>"
    + escapeHtml(label) + '</summary>' + content + '</details></section>';
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
        <h3>Source & status</h3>
        ${definition([
          ['Evidence authority', graphAuthorityLabel(claim.authority)],
          ['Record state', claim.state, statusClass(claim.state)],
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
          [
            'Evidence',
            compactTechnicalId(evidence.id),
            'mono technical-id',
            evidence.id,
          ],
          [
            'Source',
            compactTechnicalId(evidence.source_ref || evidence.source_kind),
            'mono technical-id',
            evidence.source_ref || evidence.source_kind,
          ],
          ['Captured', dateTime(evidence.captured_at)],
          ['Agent type', claim.provenance?.agentType],
          [
            'Agent id',
            compactTechnicalId(claim.provenance?.agentId),
            'mono technical-id',
            claim.provenance?.agentId,
          ],
        ])}
      </section>

      ${optionalInspectorSection('Pipeline details', [
        ['Candidate', candidate?.ref],
        ['Status', candidate?.status, statusClass(candidate?.status)],
        ['Importance', importance?.decision],
        ['Durability', importance?.durability],
        ['Utility', importance?.future_utility],
        ['Relation', detail.relation?.relation],
        ['Relation target', detail.relation?.targetRef],
      ])}
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
  const graphNodeId = state.selectedGraphNodeId;

  const overview = await fetchJson('/api/overview');
  state.overview = overview;
  state.actionToken = overview.actions?.token ?? null;

  const project = overview.projects.find(
    (item) => item.projectId === state.projectId,
  ) ?? overview.projects[0] ?? null;

  if (!project) {
    state.projectId = null;
    state.branch = null;
    state.scope = null;
    state.claim = null;
    state.graph = null;
    state.selectedClaimId = null;
    state.selectedCandidateId = null;
    state.selectedGraphNodeId = null;
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
    state.graph = null;
    state.selectedClaimId = null;
    state.selectedCandidateId = null;
    state.selectedGraphNodeId = null;
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

  if (state.view === 'graph') {
    await loadGraph({
      render: false,
      preferredNodeId: graphNodeId,
    });
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
    <div class="memory-layout ${state.memoryInspectorOpen ? 'is-details-open' : ''}">
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
      <aside class="inspector" aria-label="Selected memory details">
        <div class="mobile-detail-heading"><strong>Memory details</strong><button class="text-action" id="memory-close-details" type="button">Close</button></div>
        ${renderInspector()}
      </aside>
    </div>
  `;

  const search = document.querySelector('#memory-search');
  const authority = document.querySelector('#authority-filter');
  const claimState = document.querySelector('#state-filter');

  search?.addEventListener('input', () => {
    const selection = { start: search.selectionStart, end: search.selectionEnd };
    state.search = search.value;
    renderMemories();
    restoreGraphControlFocus('memory-search', selection);
  });
  authority?.addEventListener('change', () => {
    state.authority = authority.value;
    renderMemories();
    restoreGraphControlFocus('authority-filter');
  });
  claimState?.addEventListener('change', () => {
    state.claimState = claimState.value;
    renderMemories();
    restoreGraphControlFocus('state-filter');
  });

  el.view.querySelectorAll('[data-claim]').forEach((button) => {
    button.addEventListener('click', () => {
      resetActionState();
      selectClaim(button.dataset.claim);
    });
  });

  document.querySelector('#memory-close-details')?.addEventListener('click', () => {
    state.memoryInspectorOpen = false;
    renderMemories();
    const selectedRow = [...el.view.querySelectorAll('[data-claim]')]
      .find((item) => item.dataset.claim === state.selectedClaimId);
    selectedRow?.focus({ preventScroll: true });
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

/** Apply project-local search, lifecycle and authority filters to displayed nodes. */
function graphFilteredNodes() {
  const graph = state.graph;
  if (!graph) return [];
  const query = state.graphSearch.trim().toLowerCase();
  return graph.nodes.filter((node) => {
    if (
      state.graphNodeState !== 'all'
      && node.state !== state.graphNodeState
    ) return false;
    if (state.graphGroup !== 'all' && node.group !== state.graphGroup) return false;
    if (!query) return true;
    return [
      node.ref,
      node.value,
      node.subject,
      node.predicate,
      node.kind,
      node.authority,
      node.state,
    ].some((value) => String(value ?? '').toLowerCase().includes(query));
  });
}

/** Keep only displayed edges and apply the selected relation-origin filter. */
function graphFilteredEdges(nodes) {
  const graph = state.graph;
  if (!graph) return [];
  const visible = new Set(nodes.map((node) => node.id));
  return graph.edges.filter((edge) => (
    visible.has(edge.from)
    && visible.has(edge.to)
    && (state.graphOrigin === 'all'
      || (state.graphOrigin === 'typed'
        ? edge.source === 'typed_relation'
        : edge.source !== 'typed_relation' && edge.origin === state.graphOrigin))
  ));
}

/** Render excerpts from recorded claim text only; never reinterpret content. */
function memoryDisplayTitle(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
    .replace(/^(?:memory|agent decision):\s*/i, '');
  return text || 'Untitled memory';
}

/** Two readable lines at a stable width; the full original stays in the inspector. */
function graphLabelLines(value, maxChars = 27) {
  const words = [...memoryDisplayTitle(value)].join('').split(/\s+/);
  const lines = ['', ''];
  let index = 0;
  for (const word of words) {
    const next = lines[index] ? lines[index] + ' ' + word : word;
    if ([...next].length <= maxChars) {
      lines[index] = next;
      continue;
    }
    if (index === 0) {
      if (!lines[0]) lines[0] = [...word].slice(0, maxChars).join('');
      index = 1;
      if ([...word].length > maxChars) {
        lines[1] = [...word].slice(maxChars, maxChars * 2 - 1).join('');
      } else {
        lines[1] = word;
      }
    } else {
      break;
    }
  }
  const original = memoryDisplayTitle(value);
  const shown = lines.filter(Boolean).join(' ');
  if ([...original].length > [...shown].length) {
    lines[1] = [...(lines[1] || lines[0])].slice(0, maxChars - 1).join('') + '…';
    if (!lines[1]) lines[1] = '…';
  }
  return lines.filter(Boolean);
}

/** A bounded semantic layout: connected claims are positioned next to each other. */
function graphReadableLayout(nodes, edges) {
  if (nodes.length > 24) return null;
  const cols = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(nodes.length))));
  const rows = Math.max(1, Math.ceil(nodes.length / cols));
  const width = 1200;
  const height = Math.max(720, 120 + rows * 156);
  const firstX = (width - (cols - 1) * 280) / 2;
  const firstY = (height - (rows - 1) * 156) / 2;
  const byId = new Map(nodes.map(node => [node.id, node]));
  const adjacent = new Map(nodes.map(node => [node.id, new Set()]));
  for (const edge of edges) {
    if (!adjacent.has(edge.from) || !adjacent.has(edge.to)) continue;
    adjacent.get(edge.from).add(edge.to);
    adjacent.get(edge.to).add(edge.from);
  }
  const ordered = [];
  const visited = new Set();
  const roots = [...nodes].sort((a, b) =>
    adjacent.get(b.id).size - adjacent.get(a.id).size || a.id.localeCompare(b.id, 'en'));
  for (const root of roots) {
    if (visited.has(root.id)) continue;
    const queue = [root.id];
    visited.add(root.id);
    for (let index = 0; index < queue.length; index += 1) {
      const id = queue[index];
      ordered.push(byId.get(id));
      const links = [...adjacent.get(id)].sort((a, b) => a.localeCompare(b, 'en'));
      for (const next of links) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }
  }
  const positions = new Map(ordered.map((node, i) => [node.id, {
    x: firstX + (i % cols) * 280,
    y: firstY + Math.floor(i / cols) * 156,
  }]));
  return { positions, width, height };
}

/** Keep relation semantics from the actual edge, never from inferred keywords. */
function graphRelationLabel(edge) {
  return String(edge?.relation ?? 'related').replaceAll('_', ' ');
}

/** Semantic claim excerpts inside interactive SVG cards, never opaque refs. */
function graphNodeCardSvg(node) {
  const lines = graphLabelLines(node.value);
  const meta = node.state + ' · ' + graphAuthorityLabel(node.authority);
  const clippedMeta = [...meta].length > 37 ? [...meta].slice(0, 36).join('') + '…' : meta;
  return "<rect class='graph-node-card' x='-126' y='-42' width='252' height='84' rx='9'></rect>"
    + "<circle cx='-109' cy='-21' r='5'></circle>"
    + "<text class='graph-node-title' x='-96' y='" + (lines.length === 1 ? '-7' : '-17') + "'>"
    + lines.map((line, index) => "<tspan x='-96' dy='" + (index === 0 ? '0' : '18') + "'>" + escapeHtml(line) + '</tspan>').join('')
    + '</text>'
    + "<text class='graph-node-caption' x='-96' y='29'>" + escapeHtml(clippedMeta) + '</text>';
}

/** Only actual selected-node relations receive inline semantic labels. */
function graphSelectedRelationNote(edge, from, to, selected) {
  if (!selected || (edge.from !== selected.id && edge.to !== selected.id)) return '';
  const relation = graphRelationLabel(edge);
  const width = Math.min(196, Math.max(68, relation.length * 7.3 + 24));
  const x = ((from.x + to.x) / 2).toFixed(2);
  const y = ((from.y + to.y) / 2).toFixed(2);
  const source = edge.source === 'typed_relation' ? 'advisory' : edge.origin;
  const direction = edge.from === selected.id ? 'outgoing' : 'incoming';
  return "<g class='graph-edge-note " + escapeHtml(source) + "' transform='translate(" + x + ' ' + y + ")'>"
    + "<rect x='" + (-width / 2).toFixed(1) + "' y='-12' width='" + width.toFixed(1) + "' height='24' rx='5'></rect>"
    + "<text y='4' text-anchor='middle'>" + escapeHtml(relation) + '</text>'
    + '<title>' + escapeHtml(relation + ' · ' + direction) + '</title></g>';
}
function graphPositions(nodes, edges) {
  const width = 1000;
  const height = 680;
  const pad = 56;
  const sorted = [...nodes].sort((left, right) => left.id.localeCompare(right.id, 'en'));
  const positions = new Map();
  if (sorted.length === 0) return positions;
  if (sorted.length === 1) {
    positions.set(sorted[0].id, { x: width / 2, y: height / 2 });
    return positions;
  }

  const radius = Math.min(width, height) * 0.37;
  sorted.forEach((node, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / sorted.length;
    positions.set(node.id, {
      x: width / 2 + Math.cos(angle) * radius,
      y: height / 2 + Math.sin(angle) * radius,
    });
  });

  const nodeIds = sorted.map((node) => node.id);
  const iterations = sorted.length > 220 ? 4 : sorted.length > 100 ? 6 : 10;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const delta = new Map(nodeIds.map((id) => [id, { x: 0, y: 0 }]));
    const repel = sorted.length > 220 ? 1500 : 2600;
    for (let leftIndex = 0; leftIndex < nodeIds.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < nodeIds.length; rightIndex += 1) {
        const leftId = nodeIds[leftIndex];
        const rightId = nodeIds[rightIndex];
        const left = positions.get(leftId);
        const right = positions.get(rightId);
        let dx = left.x - right.x;
        let dy = left.y - right.y;
        let distanceSquared = dx * dx + dy * dy;
        if (distanceSquared < 25) {
          dx += (leftIndex % 3) - 1;
          dy += (rightIndex % 3) - 1;
          distanceSquared = Math.max(25, dx * dx + dy * dy);
        }
        const distance = Math.sqrt(distanceSquared);
        const force = Math.min(7, repel / distanceSquared);
        const ux = dx / distance;
        const uy = dy / distance;
        delta.get(leftId).x += ux * force;
        delta.get(leftId).y += uy * force;
        delta.get(rightId).x -= ux * force;
        delta.get(rightId).y -= uy * force;
      }
    }

    for (const edge of edges) {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) continue;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const desired = edge.origin === 'explicit' ? 128 : 158;
      const strength = edge.origin === 'explicit' ? 0.026 : 0.014;
      const force = Math.max(-5, Math.min(5, (distance - desired) * strength));
      const ux = dx / distance;
      const uy = dy / distance;
      delta.get(edge.from).x += ux * force;
      delta.get(edge.from).y += uy * force;
      delta.get(edge.to).x -= ux * force;
      delta.get(edge.to).y -= uy * force;
    }

    for (const id of nodeIds) {
      const point = positions.get(id);
      const move = delta.get(id);
      point.x = Math.max(pad, Math.min(width - pad, point.x + move.x));
      point.y = Math.max(pad, Math.min(height - pad, point.y + move.y));
    }
  }

  return positions;
}


/** Human-readable presentation labels never change the canonical authority. */
function graphAuthorityLabel(authority) {
  return ({
    user_direct: 'Direct user statement',
    agent_inference: 'Agent interpretation',
    repo_trusted: 'Repository-backed evidence',
    session: 'Session observation',
    tool: 'Tool observation',
    untrusted: 'Unverified source',
  })[authority] ?? String(authority ?? 'Unknown').replaceAll('_', ' ');
}

/** Git verification is independent of the memory source's authority. */
function graphFreshnessLabel(status) {
  return ({
    fresh: 'Git file verified',
    stale: 'Git file not verified',
    unchecked: 'Git check unavailable',
    not_repository: 'Not a Git record',
  })[status] ?? 'Verification unknown';
}

/** Explain why a Git check passed, failed or does not apply. */
function graphFreshnessHelp(status) {
  return ({
    fresh: 'The recorded file matches the selected checkout at this revision.',
    stale: 'The recorded Git blob could not be verified here. It may have changed, disappeared or become inaccessible.',
    unchecked: 'The file was not verified. Check the selected repository, branch and Git access.',
    not_repository: 'This memory is not based on a repository file. Git freshness does not apply.',
  })[status] ?? 'No verified Git freshness result is available.';
}

/** Summarize all scoped graph nodes, regardless of the active UI filters. */
function graphVerificationSummary(graph) {
  const statuses = { fresh: 0, stale: 0, unchecked: 0 };
  for (const node of graph?.nodes ?? []) {
    const status = node.freshness?.status;
    if (Object.hasOwn(statuses, status)) statuses[status] += 1;
  }
  const total = statuses.fresh + statuses.stale + statuses.unchecked;
  if (graph?.gitContext?.status !== 'verified') return {
    tone: 'caution', label: 'GIT CONTEXT',
    title: 'Repository verification unavailable',
    message: 'The selected checkout is not verified. Repository memories must not be treated as fresh.',
    count: total ? total + ' Git-linked' : 'No verified checkout',
  };
  if (statuses.stale > 0) return {
    tone: 'caution', label: 'EVIDENCE STATUS',
    title: statuses.stale + (statuses.stale === 1 ? ' Git-linked memory needs review' : ' Git-linked memories need review'),
    message: 'At least one recorded file could not be verified. Open a node to inspect its evidence.',
    count: statuses.fresh + ' / ' + total + ' verified',
  };
  if (statuses.unchecked > 0) return {
    tone: 'caution', label: 'EVIDENCE STATUS',
    title: 'Some Git-linked memories are unchecked',
    message: 'A verified checkout does not guarantee that each referenced file was checked.',
    count: statuses.fresh + ' / ' + total + ' verified',
  };
  if (total === 0 && graph?.stats?.truncated) return {
    tone: 'neutral', label: 'EVIDENCE STATUS',
    title: 'No Git-linked memories in the returned graph',
    message: 'The graph is limited. Omitted memories may include Git-linked evidence.',
    count: '0 Git-linked shown',
  };
  if (total === 0) return {
    tone: 'neutral', label: 'EVIDENCE STATUS',
    title: 'No repository-backed memories in this scope',
    message: 'The graph can show session or agent memories without any Git file evidence.',
    count: '0 Git-linked',
  };
  return {
    tone: 'verified', label: 'EVIDENCE STATUS',
    title: 'Repository evidence verified',
    message: 'All Git-linked nodes in this scoped graph match the selected checkout.',
    count: statuses.fresh + ' / ' + total + ' verified',
  };
}

/** Normalize origin terminology without changing underlying edge classes. */
function graphRelationOriginLabel(edge) {
  if (edge?.source === 'typed_relation') return 'Advisory';
  if (edge?.origin === 'inferred') return 'Similarity';
  return 'Recorded';
}

/** Restore keyboard focus and text selection after graph controls rerender. */
function restoreGraphControlFocus(id, selection = null) {
  const target = document.getElementById(id);
  if (!target) return;
  target.focus({ preventScroll: true });
  if (selection && typeof target.setSelectionRange === 'function'
    && Number.isInteger(selection.start) && Number.isInteger(selection.end)) {
    target.setSelectionRange(selection.start, selection.end);
  }
}

/** Focus the re-rendered SVG node and reveal it only when outside the viewport. */
function focusSelectedGraphNode(nodeId) {
  const next = [...el.view.querySelectorAll('.graph-node[data-graph-node]')]
    .find((item) => item.dataset.graphNode === nodeId);
  if (!next) return;
  next.focus({ preventScroll: true });
  if (typeof next.getBoundingClientRect !== 'function') return;
  const box = next.getBoundingClientRect();
  const viewport = window.visualViewport;
  const viewportWidth = viewport?.width ?? window.innerWidth;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  const viewportLeft = viewport?.offsetLeft ?? 0;
  const viewportTop = viewport?.offsetTop ?? 0;
  const canvas = next.closest?.('.graph-canvas-wrap')?.getBoundingClientRect();
  const outsideViewport = box.top < viewportTop || box.bottom > viewportTop + viewportHeight
    || box.left < viewportLeft || box.right > viewportLeft + viewportWidth;
  const outsideCanvas = canvas && (box.top < canvas.top || box.bottom > canvas.bottom
    || box.left < canvas.left || box.right > canvas.right);
  if ((outsideViewport || outsideCanvas) && typeof next.scrollIntoView === 'function') {
    next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

/** Format distinct canonical, typed and embedding-provenance descriptions. */
function graphEdgeProvenance(edge) {
  const provenance = edge?.provenance ?? {};
  if (edge?.source === 'typed_relation') {
    return [
      'Advisory',
      provenance.policyVersion,
      provenance.sourceEvidenceId ? compactTechnicalId(provenance.sourceEvidenceId) : null,
      provenance.targetEvidenceId ? compactTechnicalId(provenance.targetEvidenceId) : null,
      provenance.validatedAt ? dateTime(provenance.validatedAt) : null,
      provenance.reason ? String(provenance.reason).slice(0, 180) : null,
    ].filter(Boolean).join(' · ');
  }
  if (edge?.origin === 'inferred') {
    const model = [provenance.modelId, provenance.modelRevision]
      .filter(Boolean)
      .join('@');
    const dimensions = Number.isFinite(Number(provenance.dimensions))
      ? `${Number(provenance.dimensions)}d`
      : null;
    return [model, dimensions].filter(Boolean).join(' · ') || 'embedding similarity';
  }
  if (edge?.relation === 'conflicts_with') {
    return provenance.state ? `conflict ${provenance.state}` : 'canonical conflict';
  }
  return [
    provenance.evidenceId ? compactTechnicalId(provenance.evidenceId) : null,
    provenance.createdAt ? dateTime(provenance.createdAt) : null,
  ].filter(Boolean).join(' · ') || 'canonical lifecycle';
}

function graphNeighbors(node, edges) {
  if (!node || !state.graph) return [];
  const byId = new Map(state.graph.nodes.map((item) => [item.id, item]));
  return edges
    .filter((edge) => edge.from === node.id || edge.to === node.id)
    .map((edge) => {
      const neighborId = edge.from === node.id ? edge.to : edge.from;
      return { edge, node: byId.get(neighborId) ?? null };
    })
    .filter((item) => item.node)
    .sort((left, right) => (
      (left.edge.origin === right.edge.origin ? 0 : left.edge.origin === 'explicit' ? -1 : 1)
      || Number(right.edge.weight ?? 0) - Number(left.edge.weight ?? 0)
      || left.node.ref.localeCompare(right.node.ref, 'en')
    ));
}

function graphInspector(node, visibleEdges) {
  if (!node) {
    return `
      <div class="inspector-empty">
        Select a graph node to inspect its memory metadata and connected relations.
      </div>
    `;
  }
  const neighbors = graphNeighbors(node, visibleEdges);
  const usage = node.usage ?? {};
  return `
    <div class="inspector-scroll">
      <div class="inspector-head">
        <div class="inspector-ref">${escapeHtml(node.ref)}</div>
        <h2>${escapeHtml(node.value)}</h2>
        <p class="graph-inspector-subtitle">What this memory records, where it came from and which connections are visible.</p>
      </div>
      <div class="graph-evidence-status ${escapeHtml(node.freshness?.status ?? 'unknown')}">
        <span class="graph-evidence-kicker">VERIFICATION CONTEXT</span>
        <strong>${escapeHtml(graphFreshnessLabel(node.freshness?.status))}</strong>
        <p>${escapeHtml(graphFreshnessHelp(node.freshness?.status))}</p>
      </div>
      <section class="inspect-section">
        <h3>Source & state</h3>
        ${definition([
          ['Evidence authority', graphAuthorityLabel(node.authority)],
          ['Record state', node.state, statusClass(node.state)],
          ['Lifecycle state', node.lifecycleStatus],
          ['Evidence group', node.groupLabel || graphAuthorityLabel(node.group)],
          ['Recorded', dateTime(node.createdAt)],
        ])}
        <details class="graph-technical">
          <summary>Technical metadata</summary>
          ${definition([
            ['Kind', node.kind],
            ['Subject', node.subject],
            ['Predicate', node.predicate],
            ['Raw authority', node.authority],
            ['Raw Git state', node.freshness?.status || 'unknown'],
            ['Git detail', node.freshness?.explanation],
            ['Semantic index', node.semanticIndexed ? 'indexed' : 'not indexed'],
          ])}
        </details>
        <div class="action-row graph-open-row">
          <button id="graph-open-memory" class="text-action" type="button">
            Open in Memories
          </button>
        </div>
      </section>
      <section class="inspect-section">
        <h3>Recall usage</h3>
        ${definition([
          ['Retrieved', number(usage.retrievalCount)],
          ['Budget retained', number(usage.retainedCount)],
          ['In context', number(usage.contextCount)],
          ['Last retained', dateTime(usage.lastRetainedAt)],
          ['Last context', dateTime(usage.lastContextAt)],
        ])}
      </section>
      <section class="inspect-section">
        <h3>Connected memories</h3>
        <p class="graph-section-intro">Recorded connections and advisory suggestions are different kinds of evidence. Select a neighbor to inspect it.</p>
        <div class="graph-neighbor-list">
          ${neighbors.length
            ? neighbors.map(({ edge, node: neighbor }) => `
                <button class="graph-neighbor" type="button" data-graph-node="${escapeHtml(neighbor.id)}">
                  <span class="graph-neighbor-top">
                    <span class="graph-neighbor-name">${escapeHtml(memoryDisplayTitle(neighbor.value))}</span>
                    <span class="graph-origin ${escapeHtml(edge.origin)}">${escapeHtml(graphRelationOriginLabel(edge))}</span>
                  </span>
                  <span class="graph-neighbor-relation">${escapeHtml(edge.relation.replaceAll('_', ' '))}</span>
                  <span class="graph-neighbor-meta">
                    <span class="graph-neighbor-ref">${escapeHtml(neighbor.ref)}</span> · ${edge.relation === 'semantic_similarity' ? `weight ${Number(edge.weight ?? 0).toFixed(3)} · ` : ''}${escapeHtml(graphEdgeProvenance(edge))}
                  </span>
                </button>
              `).join('')
            : '<div class="inline-empty">No visible relations for this node.</div>'}
        </div>
      </section>
    </div>
  `;
}

/** Render a bounded read-only graph without implying advisory authority. */
function renderGraph() {
  if (state.graphLoading && !state.graph) {
    loading();
    return;
  }
  if (state.graphError) {
    el.view.innerHTML = `<div class="error">${escapeHtml(state.graphError)}</div>`;
    return;
  }
  if (!state.graph) {
    el.view.innerHTML = '<div class="empty">Graph data has not been loaded for this scope.</div>';
    return;
  }

  const nodes = graphFilteredNodes();
  const edges = graphFilteredEdges(nodes);
  const states = [...new Set(state.graph.nodes.map((node) => node.state))].sort();
  const groups = state.graph.groups ?? [];
  const readableLayout = graphReadableLayout(nodes, edges);
  const positions = readableLayout?.positions ?? graphPositions(nodes, edges);
  const graphWidth = readableLayout?.width ?? 1000;
  const graphHeight = readableLayout?.height ?? 680;
  const selected = nodes.find((node) => node.id === state.selectedGraphNodeId)
    ?? nodes.find((node) => node.state === 'active')
    ?? nodes[0]
    ?? null;
  if (selected && selected.id !== state.selectedGraphNodeId) {
    state.selectedGraphNodeId = selected.id;
  }

  const labelEveryNode = nodes.length <= 24;
  const stats = state.graph.stats ?? {};
  const gitContext = state.graph.gitContext ?? { status: 'unconfigured', revisionSha: null };
  const verification = graphVerificationSummary(state.graph);
  el.view.innerHTML = `
    <div class="graph-layout ${state.graphInspectorOpen ? 'is-details-open' : ''}">
      <section class="graph-stage" aria-label="Memory connections">
        <div class="graph-context" data-verification-tone="${escapeHtml(verification.tone)}">
          <div class="graph-context-body">
            <span class="graph-context-kicker">${escapeHtml(verification.label)}</span>
            <strong>${escapeHtml(verification.title)}</strong>
            <p>${escapeHtml(verification.message)}</p>
          </div>
          <span class="graph-context-count">${escapeHtml(verification.count)}</span>
        </div>
        <div class="graph-toolbar">
          <label class="sr-only" for="graph-search">Search memories in this graph</label>
          <input
            id="graph-search"
            class="search"
            type="search"
            autocomplete="off"
            placeholder="Find a memory, source or topic…"
            value="${escapeHtml(state.graphSearch)}"
          >
          <select id="graph-origin-filter" class="filter" aria-label="Relation type">
            <option value="all" ${state.graphOrigin === 'all' ? 'selected' : ''}>All relations</option>
            <option value="explicit" ${state.graphOrigin === 'explicit' ? 'selected' : ''}>Recorded only</option>
            <option value="inferred" ${state.graphOrigin === 'inferred' ? 'selected' : ''}>Similarity only</option>
            <option value="typed" ${state.graphOrigin === 'typed' ? 'selected' : ''}>Advisory only</option>
          </select>
          <select id="graph-group-filter" class="filter" aria-label="Filter graph by Evidence authority">
            <option value="all" ${state.graphGroup === 'all' ? 'selected' : ''}>All sources</option>
            ${groups.map((group) => `
              <option value="${escapeHtml(group.id)}" ${group.id === state.graphGroup ? 'selected' : ''}>
                ${escapeHtml(group.label)} (${number(group.count)})
              </option>
            `).join('') }
          </select>
          <select id="graph-state-filter" class="filter" aria-label="Filter graph by memory state">
            <option value="all">All states</option>
            ${states.map((value) => `
              <option value="${escapeHtml(value)}" ${value === state.graphNodeState ? 'selected' : ''}>
                ${escapeHtml(value)}
              </option>
            `).join('')}
          </select>
        </div>
        <div class="graph-meta">
          <div class="graph-legend" aria-label="Graph relation legend">
            <span class="graph-legend-item"><span class="graph-legend-swatch explicit"></span>Explicit relation · recorded</span>
            <span class="graph-legend-item"><span class="graph-legend-swatch typed"></span>Advisory typed · not proof</span>
            <span class="graph-legend-item"><span class="graph-legend-swatch inferred"></span>Inferred similarity (optional)</span>
          </div>
          <div class="graph-stats">
            <span>${number(nodes.length)} of ${number(stats.nodeCount)} memories shown</span>
            <span>·</span>
            <span>${number(edges.length)} of ${number(stats.edgeCount)} links shown</span>
            <span>· ${number(stats.typedRelations)} typed</span>
            <span>· Checkout: ${gitContext.status === 'verified' ? 'verified' : 'not verified'}</span>
            ${stats.typedRelationsOmittedByBound > 0 ? `<span>· ${number(stats.typedRelationsOmittedByBound)} advisory links omitted</span>` : ''}
            ${stats.repositoryNodesUnchecked ? `<span>· ${number(stats.repositoryNodesUnchecked)} Git records unchecked</span>` : ''}
            ${stats.truncated ? `<span>· ${number(stats.omittedClaims)} omitted by bound</span>` : ''}
          </div>
        </div>
        <div class="graph-canvas-wrap">
          ${nodes.length ? `
            <svg class="graph-canvas" viewBox="0 0 ${graphWidth} ${graphHeight}" role="group" aria-label="Interactive memory relation graph">
              <g class="graph-edges">
                ${edges.map((edge) => {
                  const from = positions.get(edge.from);
                  const to = positions.get(edge.to);
                  if (!from || !to) return '';
                  return `
                    <line
                      class="graph-edge ${escapeHtml(edge.origin)} ${escapeHtml(edge.source || '')} ${edge.current === false ? 'is-historical' : ''}"
                      x1="${from.x.toFixed(2)}"
                      y1="${from.y.toFixed(2)}"
                      x2="${to.x.toFixed(2)}"
                      y2="${to.y.toFixed(2)}"
                    >
                      <title>${escapeHtml(edge.relation)} · ${escapeHtml(edge.origin)}${edge.relation === 'semantic_similarity' && Number.isFinite(edge.weight) ? ` · ${edge.weight.toFixed(3)}` : ''}</title>
                    </line>
                    ${graphSelectedRelationNote(edge, from, to, selected)}
                  `;
                }).join('')}
              </g>
              <g class="graph-nodes">
                ${nodes.map((node) => {
                  const point = positions.get(node.id);
                  const selectedClass = node.id === selected?.id ? ' is-selected' : '';
                  const stateClass = ` state-${String(node.state ?? 'unknown').replace(/[^a-z0-9_-]/gi, '-')}`;
                  const groupClass = ` group-${String(node.group ?? 'unknown').replace(/[^a-z0-9_-]/gi, '-')}`;
                  const freshClass = ` freshness-${String(node.freshness?.status ?? 'unknown').replace(/[^a-z0-9_-]/gi, '-')}`;
                  return `
                    <g
                      class="graph-node${selectedClass}${stateClass}${groupClass}${freshClass}"
                      data-graph-node="${escapeHtml(node.id)}"
                      transform="translate(${point.x.toFixed(2)} ${point.y.toFixed(2)})"
                      role="button"
                      tabindex="0"
                      aria-pressed="${node.id === selected?.id ? 'true' : 'false'}"
                      aria-label="${escapeHtml(`${memoryDisplayTitle(node.value)}; ${node.state}; ${graphAuthorityLabel(node.authority)}`)}"
                    >
                      ${(labelEveryNode || node.id === selected?.id) ? graphNodeCardSvg(node) : '<circle r="9"></circle>'}
                      <title>${escapeHtml(node.ref)} · ${escapeHtml(node.state)} · ${escapeHtml(node.value)}</title>
                    </g>
                  `;
                }).join('')}
              </g>
            </svg>
          ` : '<div class="empty">No graph nodes match the current filters.</div>'}
        </div>
      </section>
      <aside class="graph-inspector" aria-label="Selected memory details">
        <div class="mobile-detail-heading"><strong>Memory details</strong><button class="text-action" id="graph-close-details" type="button">Close</button></div>
        ${graphInspector(selected, edges)}
      </aside>
    </div>
  `;

  const search = document.querySelector('#graph-search');
  const origin = document.querySelector('#graph-origin-filter');
  const group = document.querySelector('#graph-group-filter');
  const nodeState = document.querySelector('#graph-state-filter');
  search?.addEventListener('input', () => {
    const selection = { start: search.selectionStart, end: search.selectionEnd };
    state.graphSearch = search.value;
    renderGraph();
    restoreGraphControlFocus('graph-search', selection);
  });
  origin?.addEventListener('change', () => {
    state.graphOrigin = origin.value;
    renderGraph();
    restoreGraphControlFocus('graph-origin-filter');
  });
  group?.addEventListener('change', () => {
    state.graphGroup = group.value;
    renderGraph();
    restoreGraphControlFocus('graph-group-filter');
  });
  nodeState?.addEventListener('change', () => {
    state.graphNodeState = nodeState.value;
    renderGraph();
    restoreGraphControlFocus('graph-state-filter');
  });

  const selectGraphNode = (nodeId) => {
    if (!state.graph?.nodes.some((node) => node.id === nodeId)) return;
    state.selectedGraphNodeId = nodeId;
    state.graphInspectorOpen = true;
    renderGraph();
    focusSelectedGraphNode(nodeId);
  };
  el.view.querySelectorAll('[data-graph-node]').forEach((target) => {
    target.addEventListener('click', () => selectGraphNode(target.dataset.graphNode));
    target.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      selectGraphNode(target.dataset.graphNode);
    });
  });

  document.querySelector('#graph-close-details')?.addEventListener('click', () => {
    state.graphInspectorOpen = false;
    renderGraph();
    if (state.selectedGraphNodeId) focusSelectedGraphNode(state.selectedGraphNodeId);
  });

  document.querySelector('#graph-open-memory')?.addEventListener('click', async () => {
    if (!selected) return;
    state.view = 'memories';
    state.selectedClaimId = null;
    state.claim = null;
    resetActionState();
    state.memoryInspectorOpen = true;
    updateUrl();
    renderView();
    await selectClaim(selected.id);
  });
}

async function loadGraph({
  render = true,
  preferredNodeId = state.selectedGraphNodeId,
} = {}) {
  if (!state.projectId || !state.branch) return;
  state.graphLoading = true;
  state.graphError = '';
  if (render) renderGraph();
  try {
    const graph = await fetchJson(api('/api/graph', {
      projectId: state.projectId,
      branch: state.branch,
    }));
    state.graph = graph;
    if (state.graphGroup !== 'all' && !(graph.groups ?? []).some((item) => item.id === state.graphGroup)) {
      state.graphGroup = 'all';
    }
    state.selectedGraphNodeId = (
      preferredNodeId
      && graph.nodes.some((node) => node.id === preferredNodeId)
    )
      ? preferredNodeId
      : graph.nodes.find((node) => node.state === 'active')?.id
        ?? graph.nodes[0]?.id
        ?? null;
  } catch (error) {
    state.graph = null;
    state.selectedGraphNodeId = null;
    state.graphError = error.message;
  } finally {
    state.graphLoading = false;
  }
  if (render) renderGraph();
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

  if (state.view === 'graph') return renderGraph();
  if (state.view === 'review') return renderReview();
  if (state.view === 'pipeline') return renderPipeline();
  if (state.view === 'health') return renderHealth();
  if (state.view === 'quality') return renderQuality();
  if (state.view === 'stale') return renderStale();
  renderMemories();
}

async function selectClaim(claimId) {
  state.selectedClaimId = claimId;
  state.memoryInspectorOpen = true;
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

/** Clear scope-specific state before loading another project or branch. */
async function loadScope({
  preferredClaimId = null,
} = {}) {
  if (!state.projectId) return;

  state.scope = null;
  state.claim = null;
  state.graph = null;
  state.graphError = '';
  state.graphLoading = false;
  state.selectedClaimId = null;
  state.selectedCandidateId = null;
  state.selectedGraphNodeId = null;
  state.memoryInspectorOpen = false;
  state.graphInspectorOpen = false;
  resetActionState();
  state.search = '';
  state.authority = 'all';
  state.claimState = 'all';
  state.graphSearch = '';
  state.graphOrigin = 'all';
  state.graphGroup = 'all';
  state.graphNodeState = 'all';
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

    if (state.view === 'graph') {
      await loadGraph();
      return;
    }

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
    if (['memories', 'graph', 'review', 'pipeline', 'health', 'quality', 'stale'].includes(requestedView)) {
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

el.tabs.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-view]');
  if (!button || button.dataset.view === state.view) return;
  state.view = button.dataset.view;
  state.memoryInspectorOpen = false;
  state.graphInspectorOpen = false;
  state.selectedClaimId = null;
  state.selectedCandidateId = null;
  state.claim = null;
  resetActionState();
  updateUrl();
  renderTabs();
  if (state.view === 'graph') {
    await loadGraph();
    return;
  }
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

// graph-quality-v2-ui
