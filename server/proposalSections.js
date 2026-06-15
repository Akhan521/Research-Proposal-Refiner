import { formatEntryForLatex } from './latexEscape.js';
import { getProposalLengthProfile } from '../shared/proposalLength.js';
import {
  applyCitationFormattingToProse,
  formatProsePreservingCiteCommands,
  scrubStandaloneCitationLeads
} from './citationEnforce.js';
import { dedupeSentencesAcrossBlocks, splitSentences as redundancySplitSentences } from './proposalRedundancy.js';
import {
  mergeFragmentItems,
  splitSentences,
  truncateToSentences,
  validateCompleteProseItems
} from './textSegmentation.js';

const ITEMIZE_OPTIONS =
  '[leftmargin=*,itemsep=0.35em,parsep=0pt,topsep=0.35em,partopsep=0pt]';
const ENUMERATE_OPTIONS =
  '[leftmargin=*,itemsep=0.35em,parsep=0pt,topsep=0.35em,partopsep=0pt]';
const RQ_ENUMERATE_OPTIONS =
  '[label=\\textbf{RQ\\arabic*.},leftmargin=2.4em,itemsep=0.35em,parsep=0pt,topsep=0.35em]';

const EVALUATION_SECTIONS = [
  {
    key: 'research_questions',
    label: 'Research Questions and Hypotheses',
    aliases: ['research question', 'research questions', 'hypothesis', 'hypotheses', 'primary question']
  },
  {
    key: 'metrics',
    label: 'Metrics and Benchmarks',
    aliases: ['metrics', 'metric', 'benchmarks', 'benchmark', 'measures']
  },
  {
    key: 'baselines',
    label: 'Comparative Baselines',
    aliases: ['baselines', 'baseline', 'comparisons', 'comparison']
  },
  {
    key: 'ablations',
    label: 'Ablations and Sensitivity Analysis',
    aliases: ['ablations', 'ablation', 'sensitivity']
  },
  {
    key: 'analysis',
    label: 'Analysis Plan',
    aliases: ['analysis plan', 'analysis', 'protocol', 'procedure']
  },
  {
    key: 'success',
    label: 'Success Criteria',
    aliases: ['success criteria', 'success', 'acceptance criteria']
  }
];

function clean(value) {
  return String(value ?? '').trim();
}

function ensureSentence(text) {
  const value = clean(text);
  if (!value) return '';
  if (/[.!?]$/.test(value)) return value;
  return `${value}.`;
}

function stripListMarker(line) {
  return String(line || '')
    .replace(/^\s*[-*•]\s+/, '')
    .replace(/^\s*\d+[\).\]]\s+/, '')
    .trim();
}

function splitLines(text) {
  return String(text || '')
    .split(/\n+/)
    .map((line) => stripListMarker(line))
    .filter(Boolean);
}

function wordCount(text) {
  return clean(text).split(/\s+/).filter(Boolean).length;
}

function firstSentence(text) {
  return splitSentences(text)[0] || clean(text);
}

function normalizeSentenceKey(sentence) {
  return clean(sentence)
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripProblemBoilerplate(text, problem = '') {
  let result = clean(text);
  result = result.replace(
    /^(?:research questions?(?:\s+and\s+hypotheses)?|metrics?|success criteria|baselines?|ablations?|analysis plan)\s*:\s*/i,
    ''
  );
  result = result.replace(/for the problem stated in this proposal:\s*/gi, '');
  result = result.replace(/derived from this evaluation plan\s*/gi, '');

  if (problem) {
    for (const sentence of redundancySplitSentences(problem)) {
      const key = normalizeSentenceKey(sentence);
      if (key.length < 30) continue;

      for (const part of redundancySplitSentences(result)) {
        const partKey = normalizeSentenceKey(part);
        if (
          partKey === key ||
          (partKey.length >= 30 && (partKey.includes(key) || key.includes(partKey)))
        ) {
          result = result.replace(part, '').trim();
        }
      }
    }
  }

  return clean(result);
}

function buildEvaluationAbstractPhrase(evaluation, project = {}) {
  const text = clean(evaluation);
  if (!text) return '';

  const sections = categorizeEvaluationContent(text, project);
  const preferredKeys = ['metrics', 'success', 'baselines', 'analysis'];

  for (const key of preferredKeys) {
    const items = sections.get(key) || [];
    if (!items.length) continue;

    const phrase = truncateToSentences(
      stripProblemBoilerplate(stripEmbeddedEvaluationLabels(stripLeadingLabel(items[0])), project.problem),
      1
    )
      .replace(/\.$/, '')
      .trim();
    if (phrase.length >= 20) return polishAbstractEvaluationPhrase(phrase);
  }

  const researchQuestions = sections.get('research_questions') || [];
  if (researchQuestions.length) {
    const phrase = truncateToSentences(
      stripProblemBoilerplate(stripEmbeddedEvaluationLabels(stripLeadingLabel(researchQuestions[0])), project.problem),
      1
    )
      .replace(/\.$/, '')
      .trim();
    if (phrase.length >= 20) return polishAbstractEvaluationPhrase(phrase);
  }

  return polishAbstractEvaluationPhrase(
    truncateToSentences(stripProblemBoilerplate(text, project.problem), 1).replace(/\.$/, '').trim()
  );
}

function polishAbstractEvaluationPhrase(phrase) {
  let result = clean(phrase).replace(/[.!?]+$/, '');
  result = result.replace(OBJECTIVE_FILLER_PREFIX, '');
  if (/^evaluate\b/i.test(result)) {
    result = `evaluation on ${result.slice(8).trim()}`;
  }
  return result;
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const OBJECTIVE_FILLER_PREFIX =
  /^(?:we will|this (?:proposal|project) will|the (?:proposal|project) will|our (?:approach|method) will|to)\s+/i;

const EVALUATION_LABEL_PHRASES = EVALUATION_SECTIONS.flatMap((section) => [
  section.label,
  ...section.aliases
]).sort((left, right) => right.length - left.length);

function preprocessTimelineText(text) {
  let result = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!result) return '';

  result = result.replace(/\s+(Expected results?\s*:)/gi, '\n$1\n');
  result = result.replace(/\s+(?=Milestone\s+\d+)/gi, '\n');
  result = result.replace(/\s+(?=Phase\s+\d+)/gi, '\n');

  return result
    .split(/\n+/)
    .map((line) => clean(line))
    .filter(Boolean)
    .join('\n');
}

function extractNumberedExpectedResults(text) {
  const value = clean(text);
  if (!/\(\d+\)/.test(value)) return [];

  const beforeMilestones = value.split(/\bMilestone\s+\d+/i)[0];
  const items = [];

  for (const match of beforeMilestones.matchAll(/\(\d+\)\s*([\s\S]*?)(?=\(\d+\)|$)/g)) {
    const item = clean(match[1]).replace(/[.;]\s*$/, '');
    if (item.length >= 12) items.push(item);
  }

  return items;
}

function splitInlineEvaluationLabels(text) {
  let result = clean(text);
  if (!result) return '';

  for (const label of EVALUATION_LABEL_PHRASES) {
    const pattern = new RegExp(`(?<!^)\\s+(${escapeRegExp(label)})\\s*:`, 'gi');
    result = result.replace(pattern, '\n$1:');
  }

  return result
    .split(/\n+/)
    .map((line) => clean(line))
    .filter(Boolean)
    .join('\n');
}

function stripEmbeddedEvaluationLabels(text) {
  let result = clean(text);
  if (!result) return '';

  for (const label of EVALUATION_LABEL_PHRASES) {
    result = result.replace(new RegExp(`\\s*${escapeRegExp(label)}\\s*:\\s*`, 'gi'), ' ');
    result = result.replace(new RegExp(`\\s*${escapeRegExp(label)}\\.?\\s*$`, 'gi'), '');
    result = result.replace(new RegExp(`^${escapeRegExp(label)}\\s+`, 'i'), '');
  }

  return clean(result);
}

function isEvaluationLabelFragment(text) {
  const cleaned = clean(stripEmbeddedEvaluationLabels(text));
  if (!cleaned || cleaned.length < 12) return true;

  for (const label of EVALUATION_LABEL_PHRASES) {
    if (new RegExp(`^${escapeRegExp(label)}\\.?$`, 'i').test(cleaned)) {
      return true;
    }
  }

  return /^(?:comparative|ablations?|metrics?|benchmarks?|analysis|success)(?:\s+and)?\.?$/i.test(
    cleaned
  );
}

function polishMethodForObjective(text) {
  let result = clean(text).replace(/[.!?]+$/, '');
  result = result.replace(OBJECTIVE_FILLER_PREFIX, '');

  if (/^use\s+/i.test(result)) {
    result = `employ ${result.slice(4).trim()}`;
  } else if (/^implement\s+/i.test(result)) {
    result = `implement ${result.slice(10).trim()}`;
  }

  if (/^investigate whether/i.test(result)) {
    return result;
  }

  if (!/^(develop|design|investigate|build|train|evaluate|propose|study|create|implement|employ|determine|use)\b/i.test(result)) {
    return `investigate whether ${result.charAt(0).toLowerCase()}${result.slice(1)}`;
  }

  return result;
}

function inferDefaultResearchQuestion(project = {}) {
  const evaluation = clean(project.evaluation);
  const rqLine = evaluation.match(/(?:^|\n)\s*(?:RQ\d+|research questions?[^:]*):\s*([^\n]+)/i);
  if (rqLine?.[1]) {
    return ensureSentence(stripEmbeddedEvaluationLabels(stripLeadingLabel(rqLine[1])));
  }

  const hypothesis = evaluation.match(/hypothesis:\s*([^.!?]+[.!?]+)/i);
  if (hypothesis?.[1]) {
    return ensureSentence(`RQ1: ${stripEmbeddedEvaluationLabels(hypothesis[1])}`);
  }

  return 'RQ1: Does process-based reinforcement learning with dense step-level rewards improve multi-step mathematical reasoning accuracy relative to supervised fine-tuning and outcome-only RL baselines?';
}

function dedupeEvaluationSections(sections) {
  const seen = new Set();

  for (const section of EVALUATION_SECTIONS) {
    const items = sections.get(section.key) || [];
    const unique = [];

    for (const item of items) {
      const normalized = normalizeSentenceKey(stripEmbeddedEvaluationLabels(item));
      if (normalized.length >= 40 && seen.has(normalized)) continue;
      if (normalized.length >= 40) seen.add(normalized);
      unique.push(stripEmbeddedEvaluationLabels(item));
    }

    sections.set(section.key, unique);
  }

  return sections;
}

function stripLeadingLabel(line) {
  let result = clean(line);

  for (const section of EVALUATION_SECTIONS) {
    const labels = [section.label, ...section.aliases];
    for (const label of labels) {
      const pattern = new RegExp(`^${escapeRegExp(label)}\\s*:\\s*`, 'i');
      if (pattern.test(result)) {
        result = result.replace(pattern, '').trim();
      }
    }
  }

  return result.replace(
    /^(?:expected results?|primary (?:research )?question)\s*:\s*/i,
    ''
  );
}

function sectionKeyForLabeledBlock(blockKey) {
  for (const section of EVALUATION_SECTIONS) {
    if (normalizeKey(section.label) === blockKey) {
      return section.key;
    }

    for (const alias of section.aliases) {
      const aliasKey = normalizeKey(alias);
      if (
        blockKey === aliasKey ||
        blockKey.startsWith(`${aliasKey}_`) ||
        blockKey.endsWith(`_${aliasKey}`) ||
        blockKey.includes(`_${aliasKey}_`)
      ) {
        return section.key;
      }
    }
  }

  return null;
}

function detectLabeledBlock(lines) {
  const blocks = new Map();
  let currentKey = null;

  for (const rawLine of lines) {
    const line = clean(rawLine);
    const labelMatch = line.match(/^([^:]{3,60}):\s*(.+)$/);
    if (labelMatch) {
      const key = normalizeKey(labelMatch[1]);
      currentKey = key;
      blocks.set(key, [labelMatch[2].trim()]);
      continue;
    }

    if (currentKey) {
      blocks.get(currentKey).push(line);
    }
  }

  return blocks;
}

function normalizeKey(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function parseMilestoneEntries(timelineText) {
  const lines = splitLines(preprocessTimelineText(timelineText));
  const milestones = [];
  const expectedResults = [];
  let inExpected = false;

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (/^expected results?\s*:?\s*$/i.test(line)) {
      inExpected = true;
      continue;
    }
    if (/^milestone|^phase|^research milestones?/i.test(line) && /:\s*$/.test(line)) {
      inExpected = false;
      continue;
    }

    const expectedInline = line.match(/^expected results?\s*:\s*(.+)$/i);
    if (expectedInline) {
      const numbered = extractNumberedExpectedResults(expectedInline[1]);
      if (numbered.length >= 2) {
        expectedResults.push(...numbered);
      } else {
        expectedResults.push(expectedInline[1].trim());
      }
      inExpected = true;
      continue;
    }

    const milestoneMatch =
      line.match(/^(?:milestone|phase)\s*(\d+)\s*(?:\(([^)]+)\))?\s*[:\-—–]\s*(.+)$/i) ||
      line.match(/^(?:milestone|phase)\s*(\d+)\s*[:\-—–]\s*(.+)$/i);

    if (milestoneMatch) {
      inExpected = false;
      const timing = milestoneMatch[2] || extractTiming(line) || '';
      const description = milestoneMatch[3] || milestoneMatch[2] || line;
      milestones.push({
        index: Number(milestoneMatch[1]) || milestones.length + 1,
        timing: clean(timing),
        description: clean(description)
      });
      continue;
    }

    const numberedPhase = line.match(/^phase\s*(\d+)\s*(?:\(([^)]+)\))?\s*[:\-—–]\s*(.+)$/i);
    if (numberedPhase) {
      inExpected = false;
      milestones.push({
        index: Number(numberedPhase[1]) || milestones.length + 1,
        timing: clean(numberedPhase[2] || ''),
        description: clean(numberedPhase[3])
      });
      continue;
    }

    if (inExpected || /^deliverable/i.test(line)) {
      expectedResults.push(stripLeadingLabel(line));
      continue;
    }

    if (/week|month|quarter|semester|year/i.test(line) && /:/.test(line)) {
      const generic = line.match(/^([^:]{2,50}):\s*(.+)$/);
      if (generic) {
        milestones.push({
          index: milestones.length + 1,
          timing: clean(generic[1]),
          description: clean(generic[2])
        });
        continue;
      }
    }

    if (/^expected/i.test(line)) {
      expectedResults.push(stripLeadingLabel(line));
      continue;
    }

    milestones.push({
      index: milestones.length + 1,
      timing: extractTiming(line) || '',
      description: clean(line)
    });
  }

  return { milestones, expectedResults };
}

function extractTiming(text) {
  const match = String(text || '').match(
    /\(([^)]*(?:week|month|quarter|semester|year|day)[^)]*)\)/i
  );
  return match ? match[1].trim() : '';
}

function expandExpectedResultItems(expectedResults) {
  const expanded = [];

  for (const entry of expectedResults.filter(Boolean)) {
    const numbered = extractNumberedExpectedResults(entry);
    if (numbered.length >= 2) {
      expanded.push(...numbered);
      continue;
    }

    const semicolonParts = clean(entry)
      .split(/;\s+(?=[A-Z(])/)
      .map((part) => clean(part))
      .filter((part) => part.length >= 20);

    if (semicolonParts.length >= 2) {
      expanded.push(...semicolonParts);
      continue;
    }

    expanded.push(entry);
  }

  return expanded;
}

function inferExpectedResults(project, milestones, explicitResults) {
  const results = expandExpectedResultItems(explicitResults);

  if (!results.length && milestones.length) {
    const last = milestones[milestones.length - 1];
    if (last?.description) {
      results.push(`Final ${stripLeadingLabel(last.description)}`);
    }
  }

  if (!results.length && project.evaluation) {
    results.push(
      `Empirical evidence addressing the evaluation plan, including ${truncateToSentences(project.evaluation, 1).replace(/\.$/, '')}.`
    );
  }

  if (!results.length && project.method) {
    results.push(
      `A reproducible implementation of the proposed approach with documented design choices and measured outcomes.`
    );
  }

  return results.map((entry) => ensureSentence(stripLeadingLabel(entry)));
}

const STOP_WORDS = new Set([
  'about',
  'after',
  'against',
  'among',
  'based',
  'between',
  'compared',
  'does',
  'from',
  'have',
  'into',
  'more',
  'relative',
  'than',
  'that',
  'their',
  'these',
  'this',
  'through',
  'using',
  'whether',
  'which',
  'with',
  'without',
  'will',
  'would'
]);

const DELIVERABLE_VERBS =
  /\b(?:reproduce|implement|validate|evaluate|conduct|complete|document|deliver|compare|analyze|train|benchmark|write|report|release|verify|measure|run|finalize|integrate|deploy|test)\b/i;

function extractKeywords(text) {
  return clean(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 4 && !STOP_WORDS.has(word));
}

function hasDeliverableLanguage(description) {
  return DELIVERABLE_VERBS.test(description) || /\bdeliverable\b/i.test(description);
}

function renumberMilestones(milestones) {
  return milestones.map((milestone, index) => ({
    ...milestone,
    index: index + 1
  }));
}

export function extractResearchQuestionsAndHypotheses(evaluationText, project = {}) {
  const sections = categorizeEvaluationContent(evaluationText, project);
  const raw = (sections.get('research_questions') || [])
    .map((entry) => stripLeadingLabel(entry))
    .filter(Boolean);
  const results = [];

  for (const entry of raw) {
    const parts = entry
      .split(/(?=(?:RQ\d+|Hypothesis)\s*:)/i)
      .map((part) => clean(part))
      .filter(Boolean);

    if (parts.length > 1) {
      results.push(...parts.map((part) => normalizeResearchQuestionText(part)));
      continue;
    }

    results.push(normalizeResearchQuestionText(entry));
  }

  return results.filter(isValidResearchQuestion);
}

function normalizeResearchQuestionText(text) {
  let result = stripEmbeddedEvaluationLabels(stripLeadingLabel(text));
  result = result.replace(/^RQ\d+\s*:?\s*/i, '').trim();
  result = result.replace(/^hypothesis\s*:?\s*/i, '').trim();
  return ensureSentence(result);
}

function isValidResearchQuestion(text) {
  const cleaned = clean(stripLeadingLabel(stripEmbeddedEvaluationLabels(text)));
  if (!cleaned || cleaned.length < 20) return false;

  if (/^(?:metrics(?:\s+and(?:\s+benchmarks?)?)?|benchmarks?|baselines?|analysis(?:\s+plan)?|success(?:\s+criteria)?)\b/i.test(cleaned)) {
    return false;
  }

  if (/^(?:metrics|benchmarks|baselines|analysis|success)(?:\s+and)?\.?$/i.test(cleaned)) {
    return false;
  }

  if (/\?/.test(cleaned)) return true;
  if (/^(?:does|can|will|how|whether|if|hypothesis)\b/i.test(cleaned)) return true;
  if (/^RQ\d+\b/i.test(cleaned)) return true;

  return wordCount(cleaned) >= 8;
}

function sanitizeResearchQuestionSection(sections, project = {}) {
  const raw = sections.get('research_questions') || [];
  const expanded = [];

  for (const entry of raw) {
    const cleaned = stripLeadingLabel(entry);
    const parts = cleaned
      .split(/(?=(?:RQ\d+|Hypothesis)\s*:)/i)
      .map((part) => clean(part))
      .filter(Boolean);
    const candidates = parts.length > 1 ? parts : [cleaned];

    for (const part of candidates) {
      const normalized = normalizeResearchQuestionText(part);
      if (isValidResearchQuestion(normalized)) {
        expanded.push(normalized);
        continue;
      }

      if (/^hypothesis\b/i.test(clean(part)) && wordCount(normalized) >= 6) {
        expanded.push(normalized);
      }
    }
  }

  const seen = new Set();
  const unique = [];
  for (const item of expanded) {
    const key = normalizeSentenceKey(item);
    if (key.length >= 30 && seen.has(key)) continue;
    if (key.length >= 30) seen.add(key);
    unique.push(item);
  }

  if (!unique.length) {
    unique.push(inferDefaultResearchQuestion(project));
  }

  sections.set('research_questions', unique);
  return sections;
}

export function milestonePlanIncludesRQMapping(project = {}) {
  const preprocessed = preprocessTimelineText(project.timeline || '');
  if (!preprocessed) return false;

  const repaired = repairTimelineIfNeeded(preprocessed, project);
  const normalizedTimeline = repaired.repaired ? repaired.timeline : preprocessed;
  const validation = validateMilestonePlan(normalizedTimeline, project);
  return (
    validation.milestones.length > 0 &&
    validation.rqMappings.some((mapping) => isValidResearchQuestion(mapping.question))
  );
}

export function stripDuplicateEvaluationResearchQuestions(latex) {
  if (!/Research Questions and Hypotheses Addressed/i.test(latex)) {
    return latex;
  }

  return String(latex || '').replace(
    /\\subsection\*\{Research Questions and Hypotheses\}\s*[\s\S]*?(?=\\subsection\*\{|\\section\*?\{|\\end\{document\})/i,
    ''
  );
}

function milestoneCoversQuestion(question, milestones) {
  const keywords = extractKeywords(question);
  if (!keywords.length) return false;

  return milestones.some((milestone) => {
    const description = milestone.description.toLowerCase();
    const hits = keywords.filter((keyword) => description.includes(keyword)).length;
    return hits >= Math.min(2, keywords.length);
  });
}

export function mapMilestonesToResearchQuestions(milestones, researchQuestions) {
  return researchQuestions.map((question, index) => {
    const keywords = extractKeywords(question);
    const linked = milestones.filter((milestone) => {
      const description = milestone.description.toLowerCase();
      const hits = keywords.filter((keyword) => description.includes(keyword)).length;
      return hits >= Math.min(2, keywords.length);
    });

    return {
      id: `RQ${index + 1}`,
      question,
      milestoneIndices: linked.map((milestone) => milestone.index),
      covered: linked.length > 0
    };
  });
}

export function validateMilestonePlan(timelineText, project = {}) {
  const parsed = parseMilestoneEntries(preprocessTimelineText(timelineText));
  const milestones = renumberMilestones(parsed.milestones.filter((entry) => clean(entry.description)));
  const researchQuestions = extractResearchQuestionsAndHypotheses(project.evaluation, project);
  const issues = [];
  const warnings = [];

  if (!parsed.expectedResults.length) {
    warnings.push('Expected results are not explicitly listed in the timeline field.');
  }

  if (milestones.length < 3) {
    issues.push(
      `Only ${milestones.length} milestone(s) found; credible proposals typically include at least three phased milestones with deliverables.`
    );
  }

  for (const milestone of milestones) {
    if (!milestone.timing) {
      warnings.push(`Milestone ${milestone.index} lacks a timeline estimate (for example, Weeks 1--3).`);
    }
    if (wordCount(milestone.description) < 6) {
      issues.push(`Milestone ${milestone.index} description is too vague to review.`);
    }
    if (!hasDeliverableLanguage(milestone.description)) {
      warnings.push(`Milestone ${milestone.index} should name a verifiable deliverable or outcome.`);
    }
  }

  for (let index = 0; index < milestones.length; index += 1) {
    if (milestones[index].index !== index + 1) {
      warnings.push('Milestone numbering was not sequential and will be normalized on export.');
      break;
    }
  }

  if (!researchQuestions.length) {
    warnings.push('No research questions or hypotheses were found in the evaluation plan.');
  } else {
    for (let index = 0; index < researchQuestions.length; index += 1) {
      if (!milestoneCoversQuestion(researchQuestions[index], milestones)) {
        warnings.push(
          `Research question ${index + 1} is not clearly addressed by any milestone deliverable.`
        );
      }
    }
  }

  const finalMilestone = milestones[milestones.length - 1];
  if (
    finalMilestone &&
    !/(evaluat|benchmark|final|write-up|analysis|report|compare|hypothes)/i.test(finalMilestone.description)
  ) {
    warnings.push('The final milestone should include evaluation, analysis, or write-up deliverables.');
  }

  const rqMappings = mapMilestonesToResearchQuestions(milestones, researchQuestions);
  const uncoveredCount = rqMappings.filter((mapping) => !mapping.covered).length;

  return {
    ok: issues.length === 0 && uncoveredCount === 0,
    milestoneCount: milestones.length,
    expectedResultsCount: parsed.expectedResults.length,
    researchQuestionCount: researchQuestions.length,
    uncoveredResearchQuestions: uncoveredCount,
    issues,
    warnings,
    researchQuestions,
    rqMappings,
    milestones
  };
}

function inferSupplementalMilestones(project, existingCount) {
  const topic = clean(project.title) || clean(project.topic) || 'the proposed research';
  const templates = [
    `Establish the experimental setup, datasets, and baseline implementation needed for ${topic}.`,
    `Implement the core method components described in the proposal and verify intermediate outputs on a development split.`,
    `Run the primary experiments, ablations, and stability checks defined in the evaluation plan.`,
    `Complete final benchmark evaluation, error analysis, and a written summary tied to the stated research questions and hypotheses.`
  ];

  return templates.slice(Math.max(0, existingCount)).map((description, offset) => ({
    index: existingCount + offset + 1,
    timing: '',
    description
  }));
}

function formatTimelineFromParts(expectedResults, milestones) {
  const lines = [];

  if (expectedResults.length) {
    lines.push(`Expected results: ${expectedResults.join('; ')}`);
  }

  for (const milestone of milestones) {
    const timing = milestone.timing ? ` (${milestone.timing})` : '';
    lines.push(
      `Milestone ${milestone.index}${timing}: ${ensureSentence(milestone.description).replace(/\.$/, '')}`
    );
  }

  return lines.join('\n');
}

export function repairTimelineIfNeeded(timelineText, project = {}) {
  const parsed = parseMilestoneEntries(preprocessTimelineText(timelineText));
  let milestones = renumberMilestones(parsed.milestones.filter((entry) => clean(entry.description)));
  let expectedResults = [...parsed.expectedResults.filter(Boolean)];
  let repaired = false;

  if (!expectedResults.length) {
    expectedResults = inferExpectedResults(project, milestones, []).map((entry) =>
      stripLeadingLabel(entry).replace(/\.$/, '')
    );
    if (expectedResults.length) repaired = true;
  }

  if (milestones.length < 3) {
    milestones = renumberMilestones([...milestones, ...inferSupplementalMilestones(project, milestones.length)]);
    repaired = true;
  }

  const finalMilestone = milestones[milestones.length - 1];
  if (
    finalMilestone &&
    !/(evaluat|benchmark|final|write-up|analysis|report|compare|hypothes)/i.test(finalMilestone.description)
  ) {
    milestones.push({
      index: milestones.length + 1,
      timing: 'Months 12',
      description:
        'Conduct final evaluation against the research questions and hypotheses in the evaluation plan, including benchmark comparison, error analysis, and a written summary of findings.'
    });
    milestones = renumberMilestones(milestones);
    repaired = true;
  }

  const timeline = formatTimelineFromParts(expectedResults, milestones);
  const validation = validateMilestonePlan(timeline, project);

  return { timeline, repaired, validation };
}

function buildResearchQuestionMappingLatex(rqMappings) {
  const entries = rqMappings.filter((mapping) => isValidResearchQuestion(mapping.question));
  if (!entries.length) return '';

  const body = entries
    .map((mapping) => {
      const milestoneLabel =
        mapping.milestoneIndices.length > 0
          ? `Milestone${mapping.milestoneIndices.length > 1 ? 's' : ''} ${mapping.milestoneIndices.join(', ')}`
          : 'No milestone mapped yet';
      const status = mapping.covered ? milestoneLabel : `${milestoneLabel} (needs explicit coverage)`;
      const question = normalizeResearchQuestionText(mapping.question);
      return `  \\item ${formatEntryForLatex(question)} \\textit{(${formatEntryForLatex(status)})}`;
    })
    .join('\n');

  return `\\subsection*{Research Questions and Hypotheses Addressed}\n\\noindent Each milestone is aligned with the evaluation plan so reviewers can trace how the work will answer the stated research questions and test the hypotheses:\\par\\vspace{0.4em}\n\\begin{enumerate}${RQ_ENUMERATE_OPTIONS}\n${body}\n\\end{enumerate}`;
}

export function buildNsfStyleAbstract(project = {}) {
  const title = clean(project.title) || clean(project.topic) || 'This research project';
  const problem = clean(project.problem);
  const method = clean(project.method);
  const evaluation = clean(project.evaluation);
  const timeline = clean(project.timeline);

  const paragraphs = [];

  if (problem) {
    paragraphs.push(truncateToSentences(problem, 2));
  } else {
    paragraphs.push(
      `${title} addresses a substantive open problem whose solution would advance both scientific understanding and practical capability in the target research area.`
    );
  }

  let objectiveText = method
    ? polishMethodForObjective(truncateToSentences(method, 2))
    : `develop and validate a rigorous approach for ${title}`;
  paragraphs.push(`The objective of this proposal is to ${objectiveText.replace(/\.$/, '')}.`);

  const impactParts = [];
  const evaluationPhrase = buildEvaluationAbstractPhrase(evaluation, project);
  if (evaluationPhrase) {
    impactParts.push(`Success will be assessed through ${evaluationPhrase}.`);
  }
  if (timeline) {
    const { milestones } = parseMilestoneEntries(timeline);
    if (milestones.length) {
      impactParts.push(
        `The work is organized into ${milestones.length} staged milestones with concrete deliverables and timeline estimates.`
      );
    }
  }
  impactParts.push(
    'Findings will be documented with reproducible artifacts, explicit assumptions, and clear criteria for interpreting empirical outcomes.'
  );
  paragraphs.push(impactParts.join(' '));

  let abstract = dedupeSentencesAcrossBlocks(paragraphs).join('\n\n');
  const abstractMaxWords = getProposalLengthProfile(project.proposalPageTarget).abstractMaxWords;
  if (wordCount(abstract) > abstractMaxWords) {
    abstract = dedupeSentencesAcrossBlocks([
      truncateToSentences(problem || paragraphs[0], 2),
      truncateToSentences(method || objectiveText, 1),
      truncateToSentences(impactParts.join(' '), 2)
    ])
      .filter(Boolean)
      .join(' ');
  }

  return abstract;
}

function formatAbstractParagraphs(text) {
  return formatProsePreservingCiteCommands(text)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .join('\n\n');
}

export function buildAbstractLatexBody(project = {}, registry = null) {
  let abstract = buildNsfStyleAbstract(project);

  if (registry?.entries?.length) {
    abstract = applyCitationFormattingToProse(abstract, registry, {
      injectIfMissing: true,
      maxCites: Math.min(2, registry.entries.length)
    });
  }

  return scrubStandaloneCitationLeads(formatAbstractParagraphs(abstract));
}

export const ABSTRACT_SECTION_HEADING = '\\section*{Abstract}';

function buildAbstractSectionMarkup(body) {
  const cleanedBody = scrubStandaloneCitationLeads(body);
  return `${ABSTRACT_SECTION_HEADING}\n${cleanedBody}\n`;
}

function trimTrailingOrphanLines(block) {
  const lines = String(block || '').split('\n');

  while (lines.length) {
    const line = lines[lines.length - 1].trim();
    if (!line) {
      lines.pop();
      continue;
    }

    const plain = line
      .replace(/\\cite[tp]?\{[^}]+\}/g, ' ')
      .replace(/\\[a-zA-Z@*]+(\[[^\]]*\])?(\{[^}]*\})?/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (
      !plain ||
      /this proposal builds on prior work|prior work on this topic/i.test(plain) ||
      (plain.length < 220 && /prior work/i.test(plain))
    ) {
      lines.pop();
      continue;
    }

    break;
  }

  const body = lines.join('\n').trimEnd();
  return body ? `\n${body}\n` : '\n';
}

function stripOrphanProseAfterAbstract(latex) {
  let next = String(latex || '');

  next = next.replace(
    /(\\end\{abstract\})\s*\n+([\s\S]*?)(\n\\section)/i,
    (match, endTag, middle, sectionStart) => {
      const prose = middle
        .replace(/\\[a-zA-Z@*]+(\[[^\]]*\])?(\{[^}]*\})?/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (!prose || /this proposal builds on prior work|prior work on this topic/i.test(prose) || prose.length < 700) {
        return `${endTag}\n${sectionStart}`;
      }

      return match;
    }
  );

  next = next.replace(
    /(\\section\*?\{Abstract\})([\s\S]*?)(\n\\section)/i,
    (match, heading, body, sectionStart) => `${heading}${trimTrailingOrphanLines(body)}${sectionStart}`
  );

  return scrubStandaloneCitationLeads(next);
}

export function enforceAbstractInProposalLatex(latex, project = {}, registry = null) {
  const replacementBody = buildAbstractLatexBody(project, registry);
  const replaced = replaceAbstractBody(latex, replacementBody);
  return {
    ...replaced,
    latex: stripOrphanProseAfterAbstract(replaced.latex),
    wordCount: wordCount(buildNsfStyleAbstract(project))
  };
}

function stripMilestonePrefix(description) {
  return clean(description).replace(/^milestone\s+\d+\s*(?:\([^)]+\))?\s*[:\-—–]\s*/i, '').trim();
}

function formatMilestoneListItem(milestone) {
  const description = formatEntryForLatex(ensureSentence(stripMilestonePrefix(milestone.description)));

  if (milestone.timing) {
    return `  \\item \\textbf{${formatEntryForLatex(milestone.timing)}.} ${description}`;
  }

  return `  \\item ${description}`;
}

export function buildMilestonesLatexSection(timelineText, project = {}) {
  const preprocessed = preprocessTimelineText(timelineText);
  const repaired = repairTimelineIfNeeded(preprocessed, project);
  const normalizedTimeline = repaired.repaired ? repaired.timeline : preprocessed;
  const validation = validateMilestonePlan(normalizedTimeline, project);
  const milestones = validation.milestones;
  const parsed = parseMilestoneEntries(normalizedTimeline);
  const expectedResults = inferExpectedResults(project, milestones, parsed.expectedResults);
  const sections = [];

  const expectedResultItems = expectedResults
    .map((entry) => `  \\item ${formatEntryForLatex(entry)}`)
    .filter((entry) => clean(entry.replace(/\\item\s*/, '')));

  if (!expectedResultItems.length) {
    expectedResultItems.push(
      `  \\item ${formatEntryForLatex(
        'Documented empirical results and reproducibility artifacts aligned with the evaluation plan.'
      )}`
    );
  }

  sections.push(
    `\\subsection*{Expected Results}\n\\noindent The proposed work will produce the following tangible outcomes:\\par\\vspace{0.4em}\n\\begin{itemize}${ITEMIZE_OPTIONS}\n${expectedResultItems.join('\n')}\n\\end{itemize}`
  );

  if (milestones.length) {
    const body = milestones.map((milestone) => formatMilestoneListItem(milestone)).join('\n');

    sections.push(
      `\\subsection*{Research Milestones and Timeline}\n\\noindent The project schedule is organized into ${milestones.length} milestones with verifiable deliverables, timeline estimates, and explicit alignment to the evaluation plan:\\par\\vspace{0.4em}\n\\begin{enumerate}${ENUMERATE_OPTIONS}\n${body}\n\\end{enumerate}`
    );

    const mappingSection = buildResearchQuestionMappingLatex(validation.rqMappings);
    if (mappingSection) {
      sections.push(mappingSection);
    }
  } else {
    const fallback = clean(timelineText);
    if (fallback) {
      sections.push(
        `\\subsection*{Research Milestones and Timeline}\n\\begin{itemize}${ITEMIZE_OPTIONS}\n  \\item ${formatEntryForLatex(
          ensureSentence(fallback)
        )}\n\\end{itemize}`
      );
    }
  }

  if (!sections.length) {
    return `\n\\noindent ${formatEntryForLatex(
      'Research milestones and expected results have not been specified. Add phased deliverables with timeline estimates to demonstrate feasibility.'
    )}\n`;
  }

  return `\n${sections.join('\n\n')}\n`;
}

function categorizeEvaluationContent(evaluationText, project = {}) {
  const prepared = splitInlineEvaluationLabels(evaluationText);
  const lines = splitLines(prepared);
  const blocks = detectLabeledBlock(lines);
  const sections = new Map(EVALUATION_SECTIONS.map((section) => [section.key, []]));

  for (const [blockKey, blockItems] of blocks.entries()) {
    const sectionKey = sectionKeyForLabeledBlock(blockKey);
    if (sectionKey) {
      sections.get(sectionKey).push(...blockItems);
    }
  }

  const unassigned = [];
  for (const line of lines) {
    const labelMatch = line.match(/^([^:]{3,60}):\s*(.+)$/);
    if (labelMatch && sectionKeyForLabeledBlock(normalizeKey(labelMatch[1]))) {
      continue;
    }
    if (/^[^:]{3,60}:\s*.+/.test(line)) continue;
    unassigned.push(line);
  }

  if (![...sections.values()].some((items) => items.length)) {
    const candidates = (unassigned.length ? unassigned : splitLines(prepared)).flatMap((line) =>
      splitSentences(stripLeadingLabel(line))
    );

    for (const sentence of candidates) {
      const lower = sentence.toLowerCase();
      if (/baseline|compare|versus|against/.test(lower)) {
        sections.get('baselines').push(sentence);
      } else if (/ablat|sensitivity|remove|disable|vary/.test(lower)) {
        sections.get('ablations').push(sentence);
      } else if (/accuracy|metric|benchmark|measure|exact-match|score|f1|auc/.test(lower)) {
        sections.get('metrics').push(sentence);
      } else if (/success|criteria|threshold|significant/.test(lower)) {
        sections.get('success').push(sentence);
      } else if (/question|hypothesis|whether|does/.test(lower)) {
        sections.get('research_questions').push(sentence);
      } else if (/report|analysis|error|statistical|reproduc/.test(lower)) {
        sections.get('analysis').push(sentence);
      } else {
        sections.get('metrics').push(sentence);
      }
    }
  }

  if (!sections.get('research_questions').length) {
    sections.get('research_questions').push(inferDefaultResearchQuestion(project));
  }

  if (!sections.get('metrics').length && prepared) {
    const metricSentence = splitSentences(stripEmbeddedEvaluationLabels(prepared)).find((sentence) =>
      /accuracy|benchmark|metric|measure|exact-match|gsm8k|math|score/i.test(sentence)
    );
    if (metricSentence) {
      sections.get('metrics').push(metricSentence);
    }
  }

  if (!sections.get('baselines').length && /baseline|compare|versus/i.test(prepared || '')) {
    const baselineLine = splitSentences(prepared).find((sentence) =>
      /baseline|compare|versus/i.test(sentence)
    );
    if (baselineLine) sections.get('baselines').push(stripEmbeddedEvaluationLabels(baselineLine));
  }

  if (!sections.get('baselines').length) {
    sections
      .get('baselines')
      .push(
        'Compare against supervised fine-tuning only, outcome-only RL (PPO-style), and the proposed GRPO configuration with dense process rewards and optional MCTS-guided search.'
      );
  }

  if (!sections.get('ablations').length && /ablat/i.test(prepared || '')) {
    const ablationLine = splitSentences(prepared).find((sentence) => /ablat/i.test(sentence));
    if (ablationLine) sections.get('ablations').push(stripEmbeddedEvaluationLabels(ablationLine));
  }

  if (!sections.get('ablations').length) {
    sections
      .get('ablations')
      .push(
        'Remove PRM component, disable MCTS, vary curriculum scheduling and self-consistency sample counts.'
      );
  }

  if (!sections.get('analysis').length) {
    sections
      .get('analysis')
      .push(
        'Report quantitative results with clear experimental protocols, logged hyperparameters, and error analysis to distinguish implementation issues from scientific conclusions.'
      );
  }

  if (!sections.get('success').length && project.evaluation) {
    sections
      .get('success')
      .push(
        'Demonstrate measurable improvement over credible baselines with stable training behavior and reproducible scripts sufficient for independent verification.'
      );
  }

  sanitizeResearchQuestionSection(sections, project);
  dedupeEvaluationSections(sections);

  const ablationItems = (sections.get('ablations') || []).map((entry) =>
    stripEmbeddedEvaluationLabels(stripLeadingLabel(entry))
  );
  if (ablationItems.length) {
    sections.set(
      'analysis',
      (sections.get('analysis') || []).filter(
        (entry) =>
          !ablationItems.some(
            (ablation) =>
              normalizeSentenceKey(ablation) === normalizeSentenceKey(stripLeadingLabel(entry))
          )
      )
    );
  }

  for (const section of EVALUATION_SECTIONS) {
    const merged = mergeFragmentItems(
      (sections.get(section.key) || [])
        .map((entry) => stripEmbeddedEvaluationLabels(stripLeadingLabel(entry)))
        .filter((entry) => section.key === 'research_questions' || !isEvaluationLabelFragment(entry))
    );
    sections.set(section.key, merged);
  }

  return sections;
}

export function validateEvaluationExportReadiness(evaluationText, project = {}) {
  const sections = categorizeEvaluationContent(evaluationText, project);
  const required = ['metrics', 'baselines', 'analysis', 'success'];
  const missing = required.filter((key) => !(sections.get(key) || []).length);

  return {
    ok: missing.length === 0,
    missing,
    summary:
      missing.length === 0
        ? 'Evaluation plan includes metrics, benchmarks, comparative baselines, analysis plan, and success criteria.'
        : ''
  };
}

export function validateEvaluationContentCompleteness(evaluationText, project = {}) {
  const sections = categorizeEvaluationContent(evaluationText, project);
  const issues = [];

  for (const section of EVALUATION_SECTIONS) {
    const items = sections.get(section.key) || [];
    if (!items.length) continue;

    const validation = validateCompleteProseItems(items, section.label);
    issues.push(...validation.issues);
  }

  return { ok: issues.length === 0, issues, sections };
}

function formatEvaluationItems(items, sectionKey = '') {
  let normalized = (Array.isArray(items) ? items : [])
    .map((entry) => {
      if (sectionKey === 'research_questions') {
        return normalizeResearchQuestionText(entry);
      }
      return ensureSentence(stripEmbeddedEvaluationLabels(stripLeadingLabel(entry)));
    })
    .filter(Boolean);

  if (sectionKey === 'research_questions') {
    normalized = normalized.filter(isValidResearchQuestion);
  } else {
    normalized = normalized.filter((entry) => !isEvaluationLabelFragment(entry));
  }

  const entries = mergeFragmentItems(normalized);

  if (!entries.length) return '';
  if (entries.length === 1) {
    return formatEntryForLatex(entries[0]);
  }

  const body = entries.map((entry) => `  \\item ${formatEntryForLatex(entry)}`).join('\n');
  return `\\begin{itemize}${ITEMIZE_OPTIONS}\n${body}\n\\end{itemize}`;
}

export function buildEvaluationLatexSection(evaluationText, project = {}, options = {}) {
  const sections = categorizeEvaluationContent(evaluationText, project);
  const omitResearchQuestions =
    milestonePlanIncludesRQMapping(project) ||
    /Research Questions and Hypotheses Addressed/i.test(options.latex || '');
  const blocks = [];

  for (const section of EVALUATION_SECTIONS) {
    if (section.key === 'research_questions' && omitResearchQuestions) {
      continue;
    }

    const items = sections.get(section.key) || [];
    if (!items.length) continue;

    blocks.push(
      `\\subsection*{${formatEntryForLatex(section.label)}}\n${formatEvaluationItems(items, section.key)}`
    );
  }

  if (!blocks.length) {
    const fallback = clean(evaluationText);
    if (!fallback) {
      return `\n\\noindent ${formatEntryForLatex(
        'The evaluation plan has not been specified. Define metrics, baselines, ablations, and success criteria.'
      )}\n`;
    }

    return `\n\\noindent ${formatEntryForLatex(ensureSentence(fallback))}\n`;
  }

  const intro = omitResearchQuestions
    ? 'The following plan defines how the proposed research will be validated. Stated research questions are mapped to milestones in the preceding section; the subsections below specify metrics, baselines, and success criteria.'
    : 'The following plan defines how the proposed research will be validated. Each component is designed to produce auditable evidence suitable for a formal research review.';
  return `\n\\noindent ${formatEntryForLatex(intro)}\\par\\vspace{0.6em}\n${blocks.join('\n\n')}\n`;
}

export function normalizeTimelineField(timelineText, project = {}) {
  const original = clean(timelineText);
  if (!original) return { timeline: '', normalized: false, validation: validateMilestonePlan('', project) };

  const preprocessed = preprocessTimelineText(original);
  const parsed = parseMilestoneEntries(preprocessed);
  if (parsed.milestones.length) {
    const milestones = renumberMilestones(parsed.milestones.filter((entry) => clean(entry.description)));
    let normalized = formatTimelineFromParts(parsed.expectedResults, milestones);
    let validation = validateMilestonePlan(normalized, project);

    if (!validation.ok || validation.warnings.length > 0) {
      const repaired = repairTimelineIfNeeded(normalized, project);
      if (repaired.repaired) {
        normalized = repaired.timeline;
        validation = repaired.validation;
      }
    }

    return {
      timeline: normalized,
      normalized: normalizeWhitespace(normalized) !== normalizeWhitespace(original),
      validation
    };
  }

  const phases = preprocessed.split(/\.\s+(?=Phase\s+\d+)/i).filter(Boolean);
  if (phases.length > 1) {
    const lines = phases.map((phase, index) => {
      const body = phase.replace(/^Phase\s+\d+\s*:\s*/i, '').trim();
      return `Milestone ${index + 1}: ${ensureSentence(body).replace(/\.$/, '')}`;
    });
    const normalized = lines.join('\n');
    const validation = validateMilestonePlan(normalized, project);
    return { timeline: normalized, normalized: true, validation };
  }

  const repaired = repairTimelineIfNeeded(preprocessed, project);
  return {
    timeline: repaired.timeline,
    normalized: repaired.repaired || normalizeWhitespace(repaired.timeline) !== normalizeWhitespace(original),
    validation: repaired.validation
  };
}

export function formatMilestoneValidationNote(validation) {
  if (!validation) return '';

  const notes = [];
  if (validation.milestoneCount) {
    notes.push(
      `- Milestone plan includes ${validation.milestoneCount} milestone(s) and ${validation.researchQuestionCount} research question(s)/hypothesis block(s).`
    );
  }

  for (const issue of validation.issues || []) {
    notes.push(`- Issue: ${issue}`);
  }

  for (const warning of validation.warnings || []) {
    notes.push(`- Warning: ${warning}`);
  }

  if (validation.ok && !validation.warnings?.length) {
    notes.push('- Milestone validation passed: milestones are sequenced, deliverable-oriented, and mapped to research questions.');
  }

  if (!notes.length) return '';
  return `\n\n## Milestone Validation\n${notes.join('\n')}\n`;
}

export function normalizeEvaluationField(evaluationText, project = {}) {
  const original = clean(evaluationText);
  if (!original) return { evaluation: '', normalized: false };

  const sections = categorizeEvaluationContent(original, project);
  const lines = [];

  for (const section of EVALUATION_SECTIONS) {
    const items = sections.get(section.key) || [];
    if (!items.length) continue;
    lines.push(`${section.label}: ${items.map((item) => stripLeadingLabel(item)).join(' ')}`);
  }

  if (!lines.length) return { evaluation: original, normalized: false };

  const normalized = lines.join('\n');
  return {
    evaluation: normalized,
    normalized: normalizeWhitespace(normalized) !== normalizeWhitespace(original)
  };
}

function normalizeWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function replaceAbstractBody(latex, replacementBody) {
  const markup = buildAbstractSectionMarkup(replacementBody);
  const envPattern = /\\begin\{abstract\}[\s\S]*?\\end\{abstract\}/i;
  const sectionPattern =
    /\\section\*?\{Abstract\}[\s\S]*?(?=\\section\*?\{|\\section\{|\\end\{document\})/i;

  if (envPattern.test(latex)) {
    return {
      latex: latex.replace(envPattern, markup),
      replaced: true
    };
  }

  if (sectionPattern.test(latex)) {
    return {
      latex: latex.replace(sectionPattern, markup),
      replaced: true
    };
  }

  if (/\\maketitle/.test(latex)) {
    return {
      latex: latex.replace(/(\\maketitle\s*\n)/i, `$1\n${markup}\n`),
      replaced: true
    };
  }

  if (/\\begin\{document\}/.test(latex)) {
    return {
      latex: latex.replace(/(\\begin\{document\}\s*\n)/i, `$1\n${markup}\n`),
      replaced: true
    };
  }

  return { latex, replaced: false };
}

function replaceSectionBody(latex, sectionPattern, replacementBody) {
  const pattern = new RegExp(
    `(\\\\section\\*?\\{${sectionPattern}[^}]*\\})([\\s\\S]*?)(?=\\\\section\\*?\\{|\\\\end\\{document\\})`,
    'i'
  );

  if (!pattern.test(latex)) {
    return { latex, replaced: false };
  }

  return {
    latex: latex.replace(pattern, `$1${replacementBody}`),
    replaced: true
  };
}

export function enforceMilestonesInProposalLatex(latex, timelineText, project = {}) {
  const replacementBody = buildMilestonesLatexSection(timelineText, project);
  const validation = validateMilestonePlan(timelineText, project);
  const patterns = ['Expected Results and Research Milestones', 'Research Milestones', 'Expected Results'];

  for (const pattern of patterns) {
    const result = replaceSectionBody(latex, pattern, replacementBody);
    if (result.replaced) {
      return { ...result, milestoneCount: validation.milestoneCount, validation };
    }
  }

  return { latex, replaced: false, milestoneCount: 0, validation };
}

export function enforceEvaluationInProposalLatex(latex, evaluationText, project = {}) {
  const replacementBody = buildEvaluationLatexSection(evaluationText, project, { latex });
  const result = replaceSectionBody(latex, 'Evaluation Plan', replacementBody);
  const sections = categorizeEvaluationContent(evaluationText, project);
  const sectionCount = EVALUATION_SECTIONS.filter(
    (section) => (sections.get(section.key) || []).length
  ).length;

  return {
    ...result,
    latex: stripDuplicateEvaluationResearchQuestions(result.latex),
    sectionCount
  };
}
