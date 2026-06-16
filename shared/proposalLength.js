export const PROPOSAL_PAGE_MIN = 1;
export const PROPOSAL_PAGE_MAX = 5;
export const PROPOSAL_PAGE_DEFAULT = 3;
export const PROPOSAL_PAGE_OPTIONS = [1, 2, 3, 4, 5];
export const PROPOSAL_RESOURCES_MIN = 3;

export function normalizeProposalPageTarget(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return PROPOSAL_PAGE_DEFAULT;
  return Math.max(PROPOSAL_PAGE_MIN, Math.min(PROPOSAL_PAGE_MAX, Math.round(parsed)));
}

export function getResourceItemCap(profileCap) {
  const parsed = Number(profileCap);
  if (!Number.isFinite(parsed)) return PROPOSAL_RESOURCES_MIN;
  return Math.max(PROPOSAL_RESOURCES_MIN, Math.round(parsed));
}

export function getProposalLengthProfile(pageTarget) {
  const pages = normalizeProposalPageTarget(pageTarget);

  const profiles = {
    1: {
      abstractMaxWords: 95,
      motivationSentences: 1,
      methodSentences: 1,
      methodEnumerateItems: 2,
      includePlainSummary: false,
      expectedResultCap: 1,
      milestoneCap: 2,
      compactEvaluation: true,
      evaluationSentences: 1,
      riskItems: 1,
      resourcesItems: 3,
      bibliographyCap: 2,
      dropFigure: true,
      dropRisks: true,
      dropProjectGoal: true,
      dropMotivation: true,
      abstractSentences: 2,
      tightenSpacing: true
    },
    2: {
      abstractMaxWords: 140,
      motivationSentences: 2,
      methodSentences: 2,
      methodEnumerateItems: 3,
      includePlainSummary: false,
      expectedResultCap: 2,
      milestoneCap: 3,
      compactEvaluation: true,
      evaluationSentences: 2,
      riskItems: 2,
      resourcesItems: 3,
      bibliographyCap: 3,
      dropFigure: true,
      dropRisks: true,
      dropProjectGoal: false,
      tightenSpacing: true
    },
    3: {
      abstractMaxWords: 190,
      motivationSentences: 3,
      methodSentences: 3,
      methodEnumerateItems: 4,
      includePlainSummary: false,
      expectedResultCap: 3,
      milestoneCap: 4,
      compactEvaluation: true,
      evaluationSentences: 3,
      riskItems: 3,
      resourcesItems: 3,
      bibliographyCap: 4,
      dropFigure: true,
      dropRisks: false,
      dropProjectGoal: false,
      tightenSpacing: true
    },
    4: {
      abstractMaxWords: 250,
      motivationSentences: 4,
      methodSentences: 4,
      methodEnumerateItems: 5,
      includePlainSummary: true,
      expectedResultCap: 4,
      milestoneCap: 6,
      compactEvaluation: false,
      evaluationSentences: 5,
      riskItems: 4,
      resourcesItems: 4,
      bibliographyCap: 5,
      dropFigure: false,
      dropRisks: false,
      dropProjectGoal: false,
      tightenSpacing: false
    },
    5: {
      abstractMaxWords: 280,
      motivationSentences: 5,
      methodSentences: 5,
      methodEnumerateItems: 5,
      includePlainSummary: true,
      expectedResultCap: 4,
      milestoneCap: 7,
      compactEvaluation: false,
      evaluationSentences: 6,
      riskItems: 4,
      resourcesItems: 5,
      bibliographyCap: 5,
      dropFigure: false,
      dropRisks: false,
      dropProjectGoal: false,
      tightenSpacing: false
    }
  };

  return { pages, ...profiles[pages] };
}
