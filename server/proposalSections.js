import { formatEntryForLatex } from './latexEscape.js';
import {
  applyCitationFormattingToProse,
  formatProsePreservingCiteCommands,
  scrubStandaloneCitationLeads
} from './citationEnforce.js';
import { dedupeSentencesAcrossBlocks, splitSentences as redundancySplitSentences } from './proposalRedundancy.js';

const ITEMIZE_OPTIONS =
  '[leftmargin=*,itemsep=0.35em,parsep=0pt,topsep=0.35em,partopsep=0pt]';
const ENUMERATE_OPTIONS =
  '[leftmargin=*,itemsep=0.35em,parsep=0pt,topsep=0.35em,partopsep=0pt]';

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

function truncateToSentences(text, maxSentences = 2) {
  const value = clean(text);
  if (!value) return '';

  const sentences = value.match(/[^.!?]+[.!?]+/g) || [value];
  return sentences
    .slice(0, maxSentences)
    .map((sentence) => sentence.trim())
    .join(' ')
    .trim();
}

function wordCount(text) {
  return clean(text).split(/\s+/).filter(Boolean).length;
}

function splitSentences(text) {
  const value = clean(text);
  if (!value) return [];
  return value.match(/[^.!?]+[.!?]+/g)?.map((sentence) => sentence.trim()) || [value];
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

    const phrase = truncateToSentences(stripProblemBoilerplate(stripLeadingLabel(items[0]), project.problem), 1)
      .replace(/\.$/, '')
      .trim();
    if (phrase.length >= 20) return phrase;
  }

  const researchQuestions = sections.get('research_questions') || [];
  if (researchQuestions.length) {
    const phrase = truncateToSentences(
      stripProblemBoilerplate(stripLeadingLabel(researchQuestions[0]), project.problem),
      1
    )
      .replace(/\.$/, '')
      .trim();
    if (phrase.length >= 20) return phrase;
  }

  return truncateToSentences(stripProblemBoilerplate(text, project.problem), 1).replace(/\.$/, '').trim();
}

function stripLeadingLabel(line) {
  return clean(line).replace(
    /^(?:expected results?|research questions?|metrics?|baselines?|ablations?|success criteria|analysis plan|primary (?:research )?question|hypothes(?:is|es))\s*:\s*/i,
    ''
  );
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
  const lines = splitLines(timelineText);
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
      expectedResults.push(expectedInline[1].trim());
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

function inferExpectedResults(project, milestones, explicitResults) {
  const results = [...explicitResults.filter(Boolean)];

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
      results.push(...parts.map((part) => ensureSentence(stripLeadingLabel(part))));
      continue;
    }

    results.push(ensureSentence(stripLeadingLabel(entry)));
  }

  return results;
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
  const parsed = parseMilestoneEntries(timelineText);
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
  const parsed = parseMilestoneEntries(timelineText);
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
      timing: '',
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
  const entries = rqMappings.filter((mapping) => clean(mapping.question));
  if (!entries.length) return '';

  const body = entries
    .map((mapping) => {
      const milestoneLabel =
        mapping.milestoneIndices.length > 0
          ? `Milestone${mapping.milestoneIndices.length > 1 ? 's' : ''} ${mapping.milestoneIndices.join(', ')}`
          : 'No milestone mapped yet';
      const status = mapping.covered ? milestoneLabel : `${milestoneLabel} (needs explicit coverage)`;
      return `  \\item[${formatEntryForLatex(mapping.id)}.] ${formatEntryForLatex(
        ensureSentence(mapping.question)
      )} \\textit{(${formatEntryForLatex(status)})}`;
    })
    .join('\n');

  return `\\subsection*{Research Questions and Hypotheses Addressed}\n\\noindent Each milestone is aligned with the evaluation plan so reviewers can trace how the work will answer the stated research questions and test the hypotheses:\\par\\vspace{0.4em}\n\\begin{description}[leftmargin=2.2em,style=nextline,font=\\normalfont]\n${body}\n\\end{description}`;
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
    ? truncateToSentences(method, 2).replace(/\.$/, '')
    : `develop and validate a rigorous approach for ${title}`;
  if (!/^(develop|design|investigate|build|train|evaluate|propose|study|create|implement)\b/i.test(objectiveText)) {
    objectiveText = `investigate whether ${objectiveText.charAt(0).toLowerCase()}${objectiveText.slice(1)}`;
  }
  paragraphs.push(`The objective of this proposal is to ${objectiveText}.`);

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
  if (wordCount(abstract) > 280) {
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
  const validation = validateMilestonePlan(timelineText, project);
  const milestones = validation.milestones;
  const parsed = parseMilestoneEntries(timelineText);
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

function categorizeEvaluationContent(evaluationText, project = {}) {
  const lines = splitLines(evaluationText);
  const blocks = detectLabeledBlock(lines);
  const sections = new Map(EVALUATION_SECTIONS.map((section) => [section.key, []]));

  for (const section of EVALUATION_SECTIONS) {
    for (const alias of section.aliases) {
      const key = normalizeKey(alias);
      if (blocks.has(key)) {
        sections.get(section.key).push(...blocks.get(key));
      }
    }
  }

  const unassigned = [];
  for (const line of lines) {
    if (/^[^:]{3,40}:\s*.+/.test(line)) continue;
    unassigned.push(line);
  }

  if (![...sections.values()].some((items) => items.length)) {
    const candidates = (unassigned.length ? unassigned : splitLines(evaluationText)).flatMap((line) =>
      splitSentences(line)
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

  if (!sections.get('research_questions').length && project.problem) {
    sections
      .get('research_questions')
      .push(
        `Does the proposed approach improve upon existing practice for the problem stated in this proposal: ${firstSentence(project.problem)}`
      );
  }

  if (!sections.get('metrics').length && evaluationText) {
    sections.get('metrics').push(evaluationText);
  }

  if (!sections.get('baselines').length && /baseline|compare|versus/i.test(evaluationText || '')) {
    const baselineLine = splitSentences(evaluationText).find((sentence) =>
      /baseline|compare|versus/i.test(sentence)
    );
    if (baselineLine) sections.get('baselines').push(baselineLine);
  }

  if (!sections.get('ablations').length && /ablat/i.test(evaluationText || '')) {
    const ablationLine = splitSentences(evaluationText).find((sentence) => /ablat/i.test(sentence));
    if (ablationLine) sections.get('ablations').push(ablationLine);
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

  return sections;
}

function formatEvaluationItems(items) {
  const entries = (Array.isArray(items) ? items : [])
    .map((entry) => ensureSentence(stripLeadingLabel(entry)))
    .filter(Boolean);

  if (!entries.length) return '';
  if (entries.length === 1) {
    return formatEntryForLatex(entries[0]);
  }

  const body = entries.map((entry) => `  \\item ${formatEntryForLatex(entry)}`).join('\n');
  return `\\begin{itemize}${ITEMIZE_OPTIONS}\n${body}\n\\end{itemize}`;
}

export function buildEvaluationLatexSection(evaluationText, project = {}) {
  const sections = categorizeEvaluationContent(evaluationText, project);
  const blocks = [];

  for (const section of EVALUATION_SECTIONS) {
    const items = sections.get(section.key) || [];
    if (!items.length) continue;

    blocks.push(
      `\\subsection*{${formatEntryForLatex(section.label)}}\n${formatEvaluationItems(items)}`
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

  const intro =
    'The following plan defines how the proposed research will be validated. Each component is designed to produce auditable evidence suitable for a formal research review.';
  return `\n\\noindent ${formatEntryForLatex(intro)}\\par\\vspace{0.6em}\n${blocks.join('\n\n')}\n`;
}

export function normalizeTimelineField(timelineText, project = {}) {
  const original = clean(timelineText);
  if (!original) return { timeline: '', normalized: false, validation: validateMilestonePlan('', project) };

  const parsed = parseMilestoneEntries(original);
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

  const phases = original.split(/\.\s+(?=Phase\s+\d+)/i).filter(Boolean);
  if (phases.length > 1) {
    const lines = phases.map((phase, index) => {
      const body = phase.replace(/^Phase\s+\d+\s*:\s*/i, '').trim();
      return `Milestone ${index + 1}: ${ensureSentence(body).replace(/\.$/, '')}`;
    });
    const normalized = lines.join('\n');
    const validation = validateMilestonePlan(normalized, project);
    return { timeline: normalized, normalized: true, validation };
  }

  const repaired = repairTimelineIfNeeded(original, project);
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
  const replacementBody = buildEvaluationLatexSection(evaluationText, project);
  const result = replaceSectionBody(latex, 'Evaluation Plan', replacementBody);
  const sections = categorizeEvaluationContent(evaluationText, project);
  const sectionCount = EVALUATION_SECTIONS.filter(
    (section) => (sections.get(section.key) || []).length
  ).length;

  return {
    ...result,
    sectionCount
  };
}
