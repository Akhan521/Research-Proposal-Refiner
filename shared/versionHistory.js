export const VERSION_HISTORY_MAX = 12;

export const VERSION_TRIGGER_LABELS = {
  manual: 'Manual',
  draft: 'Draft',
  accept: 'Accept',
  decision: 'Decision',
  field: 'Field',
  structure: 'Structure',
  update: 'Update'
};

export function createVersionId() {
  return `v-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export function trimVersionHistory(entries, max = VERSION_HISTORY_MAX) {
  if (!Array.isArray(entries)) return [];
  return entries.slice(-max);
}

export function normalizeVersionHistory(value) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((entry) => entry && typeof entry === 'object' && entry.id && entry.savedAt)
    .map((entry) => ({
      id: String(entry.id),
      label: String(entry.label || 'Checkpoint'),
      trigger: String(entry.trigger || 'manual'),
      savedAt: String(entry.savedAt),
      topicInput: typeof entry.topicInput === 'string' ? entry.topicInput : '',
      project:
        entry.project && typeof entry.project === 'object' && !Array.isArray(entry.project) ? entry.project : {},
      fieldSuggestions: Array.isArray(entry.fieldSuggestions) ? entry.fieldSuggestions : [],
      decisions: Array.isArray(entry.decisions) ? entry.decisions : [],
      questions: Array.isArray(entry.questions) ? entry.questions : [],
      result: entry.result && typeof entry.result === 'object' ? entry.result : null,
      activeWorkspaceView:
        typeof entry.activeWorkspaceView === 'string' ? entry.activeWorkspaceView : 'start',
      activeTab: typeof entry.activeTab === 'string' ? entry.activeTab : 'latex',
      suggestionIndex: Number.isFinite(Number(entry.suggestionIndex)) ? Number(entry.suggestionIndex) : 0,
      decisionIndex: Number.isFinite(Number(entry.decisionIndex)) ? Number(entry.decisionIndex) : 0,
      proposalPageTarget: entry.proposalPageTarget
    }));
}

export function summarizeVersion(version, { projectFields = [] } = {}) {
  if (!version) return '';

  const filledFields = projectFields.filter(([field]) => Boolean(version.project?.[field])).length;
  const fieldTotal = projectFields.length;
  const hasDraft = Boolean(version.result?.proposalLatex);
  const parts = [];

  if (fieldTotal) {
    parts.push(`${filledFields}/${fieldTotal} fields`);
  }

  if (hasDraft) {
    parts.push('draft ready');
  } else if (version.fieldSuggestions?.length) {
    parts.push(`${version.fieldSuggestions.length} suggestions`);
  }

  return parts.join(' · ') || 'Workspace snapshot';
}
