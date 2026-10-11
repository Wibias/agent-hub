import {
  extractEvidenceBoundMemories,
  persistEvidenceBoundExtraction,
} from './evidence-bound-extraction.mjs';
import {
  EvidenceBoundProposalStore,
} from './evidence-bound-proposal-store.mjs';

export async function runEvidenceBoundExtractionPipeline({
  dbPath,
  projectId,
  branch,
  evidence,
  judge,
  evaluatorId,
  inspectTextSensitivity,
  clock = () => new Date().toISOString(),
}) {
  if (typeof clock !== 'function') {
    throw new TypeError('clock must be a function');
  }

  const extraction = await extractEvidenceBoundMemories({
    projectId,
    branch,
    evidence,
    judge,
  });

  if (extraction.memories.length === 0) {
    return {
      ...extraction,
      proposals: [],
    };
  }

  const store = new EvidenceBoundProposalStore({
    dbPath,
    inspectTextSensitivity,
    clock,
  });
  try {
    const persisted = persistEvidenceBoundExtraction({
      memory: store,
      extraction,
      evaluatorId,
      createdAt: clock(),
    });
    return {
      ...extraction,
      proposals: persisted.proposals,
    };
  } finally {
    store.close();
  }
}
