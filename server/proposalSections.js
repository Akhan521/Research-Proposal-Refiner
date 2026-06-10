import { formatEntryForLatex } from './latexEscape.js';

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
  if (evaluation) {
    impactParts.push(
      `Success will be assessed through ${truncateToSentences(evaluation, 1).replace(/\.$/, '')}.`
    );
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

  let abstract = paragraphs.join('\n\n');
  if (wordCount(abstract) > 280) {
    abstract = [
      truncateToSentences(problem || paragraphs[0], 2),
      truncateToSentences(method || objectiveLead, 1),
      truncateToSentences(impactParts.join(' '), 2)
    ]
      .filter(Boolean)
      .join(' ');
  }

  return abstract;
}

export function buildAbstractLatexBody(project = {}) {
  return formatEntryForLatex(buildNsfStyleAbstract(project));
}

export function buildMilestonesLatexSection(timelineText, project = {}) {
  const parsed = parseMilestoneEntries(timelineText);
  const milestones = parsed.milestones.filter((entry) => clean(entry.description));
  const expectedResults = inferExpectedResults(project, milestones, parsed.expectedResults);
  const sections = [];

  sections.push(
    `\\subsection*{Expected Results}\n\\noindent The proposed work will produce the following tangible outcomes:\\par\\vspace{0.4em}\n\\begin{itemize}${ITEMIZE_OPTIONS}\n${expectedResults
      .map((entry) => `  \\item ${formatEntryForLatex(entry)}`)
      .join('\n')}\n\\end{itemize}`
  );

  if (milestones.length) {
    const body = milestones
      .map((milestone) => {
        const label = milestone.timing
          ? `\\textbf{Milestone ${milestone.index} (${formatEntryForLatex(milestone.timing)}).}`
          : `\\textbf{Milestone ${milestone.index}.}`;
        return `  \\item ${label} ${formatEntryForLatex(ensureSentence(milestone.description))}`;
      })
      .join('\n');

    sections.push(
      `\\subsection*{Research Milestones and Timeline}\n\\noindent The project schedule is organized into the following milestones. Each milestone includes a verifiable deliverable to support feasibility and progress tracking:\\par\\vspace{0.4em}\n\\begin{enumerate}${ENUMERATE_OPTIONS}\n${body}\n\\end{enumerate}`
    );
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
  if (!original) return { timeline: '', normalized: false };

  const parsed = parseMilestoneEntries(original);
  if (parsed.milestones.length) {
    const lines = [];
    if (parsed.expectedResults.length) {
      lines.push(`Expected results: ${parsed.expectedResults.join('; ')}`);
    }
    for (const milestone of parsed.milestones) {
      const timing = milestone.timing ? ` (${milestone.timing})` : '';
      lines.push(
        `Milestone ${milestone.index}${timing}: ${ensureSentence(milestone.description).replace(/\.$/, '')}`
      );
    }
    const normalized = lines.join('\n');
    return {
      timeline: normalized,
      normalized: normalizeWhitespace(normalized) !== normalizeWhitespace(original)
    };
  }

  const phases = original.split(/\.\s+(?=Phase\s+\d+)/i).filter(Boolean);
  if (phases.length > 1) {
    const lines = phases.map((phase, index) => {
      const body = phase.replace(/^Phase\s+\d+\s*:\s*/i, '').trim();
      return `Milestone ${index + 1}: ${ensureSentence(body).replace(/\.$/, '')}`;
    });
    const normalized = lines.join('\n');
    return { timeline: normalized, normalized: true };
  }

  return { timeline: original, normalized: false };
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
  const pattern = /(\\begin\{abstract\})([\s\S]*?)(\\end\{abstract\})/i;
  if (!pattern.test(latex)) {
    return { latex, replaced: false };
  }

  return {
    latex: latex.replace(pattern, `$1\n${replacementBody}\n$3`),
    replaced: true
  };
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

export function enforceAbstractInProposalLatex(latex, project = {}) {
  const replacementBody = buildAbstractLatexBody(project);
  return {
    ...replaceAbstractBody(latex, replacementBody),
    wordCount: wordCount(buildNsfStyleAbstract(project))
  };
}

export function enforceMilestonesInProposalLatex(latex, timelineText, project = {}) {
  const replacementBody = buildMilestonesLatexSection(timelineText, project);
  const patterns = ['Expected Results and Research Milestones', 'Research Milestones', 'Expected Results'];

  for (const pattern of patterns) {
    const result = replaceSectionBody(latex, pattern, replacementBody);
    if (result.replaced) {
      const { milestones } = parseMilestoneEntries(timelineText);
      return { ...result, milestoneCount: milestones.length };
    }
  }

  return { latex, replaced: false, milestoneCount: 0 };
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
