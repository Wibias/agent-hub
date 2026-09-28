export function slugify(v) {
  return String(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
}

export function expandSeed(row, i = 0) {
  const title = row[0];
  const url = row[1];
  const product = row[2];
  const surface = row[3];
  const stratum = row[4];
  let platform = 'web-responsive';
  let states;
  let sourceKindOverride;
  let jobOverride;
  if (Array.isArray(row[5])) {
    states = row[5];
    sourceKindOverride = typeof row[6] === 'string' ? row[6] : undefined;
    jobOverride = typeof row[7] === 'string' && row[7].length > 40 ? row[7] : undefined;
  } else if (row[5] === 'web-responsive' || row[5] === 'native-mobile') {
    platform = row[5];
    states = row[6];
    sourceKindOverride = typeof row[7] === 'string' ? row[7] : undefined;
    jobOverride = typeof row[8] === 'string' && row[8].length > 40 ? row[8] : undefined;
  } else {
    states = row[5];
  }
  const job =
    jobOverride ??
    (platform === 'native-mobile'
      ? `Guide ${product} mobile users through ${states[0]} with thumb-first actions.`
      : `Explain ${product} ${surface.replace(/-/g, ' ')} before irreversible ${states[states.length - 1]} steps.`);
  return {
    title,
    canonicalUrl: url,
    product,
    surfaceFamily: surface,
    primaryStratum: stratum,
    platform,
    flowStates: states,
    pageRole: row[8] ?? 'help-guide',
    firstScreenJob: job,
    topology: ['doc-sidebar', 'wizard-steps', 'settings-tabs', 'filterable-grid', 'scroll-narrative'][i % 5],
    traversal: ['overview-to-detail', 'stepwise', 'tab-to-form', 'filter-to-item', 'hero-to-proof'][i % 5],
    density: 'medium',
    responsiveBehavior:
      platform === 'native-mobile'
        ? 'Mobile-first help layout with stacked sections and sticky primary action.'
        : 'Responsive documentation layout with collapsible sections on narrow viewports.',
    motion: surface === 'editorial-experimental' ? 'medium' : 'low',
    visualWorld: `${slugify(product)}-docs`,
    strengths: [
      `${product} states prerequisites before advanced controls`,
      'Failure and limit cases are documented inline',
      'Screens map to operator mental model',
    ],
    weaknesses: ['Documentation may lag newest product flags', 'Edge cases require support search'],
    transferableDecisions: [job, `Reuse ${surface} topology for similar ${product} tasks`],
    tags: [slugify(product), surface.split('-')[0], stratum.split('-')[0]],
    sourceKind: sourceKindOverride ?? (stratum === 'evidence-craft' ? 'case-study' : 'guideline'),
    tagExtras: row[9] ?? (platform === 'native-mobile' ? ['native-mobile'] : []),
  };
}
