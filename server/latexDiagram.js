import { formatEntryForLatex } from './latexEscape.js';

const FORWARD_ARROW_SPLIT = /(?:\\rightarrow|\\Rightarrow|\$\\rightarrow\$|→|->)/;
const BACKWARD_ARROW_PATTERN = /(?:\\leftarrow|\\gets|\$\\leftarrow\$|←|<-|&lt;-)/;
const UP_ARROW_PATTERN = /(?:\\uparrow|\$\\uparrow\$|↑)/;
const MAX_HORIZONTAL_NODES = 3;
const MAX_HORIZONTAL_CHARS = 72;
const MAX_LABEL_CHARS = 34;
const GENERIC_WORKFLOW_LABELS = [
  /^problem definition$/i,
  /^core method implementation$/i,
  /^evaluation and ablations$/i,
  /^analysis and write-up$/i,
  /^data setup for /i
];
const GROUNDING_STOP_WORDS = new Set([
  'about',
  'after',
  'among',
  'based',
  'between',
  'from',
  'into',
  'that',
  'this',
  'through',
  'using',
  'with',
  'without',
  'will',
  'would',
  'their',
  'these',
  'those'
]);
const ALLOWED_LABEL_PATTERN = /^[\w\s.,;:+\-/()&'’]+$/i;
const LEAKED_MARKUP_PATTERN =
  /\\textbackslash|\\textbf|\\textit|\\emph|\\texttt|\\centering|\\parbox|\\fbox|\\\\\[|\\\\(?![a-zA-Z@*])|\$[^$]+\$/;

function clean(value) {
  return String(value ?? '').trim();
}

function decodeLatexEscapes(text) {
  return String(text || '')
    .replace(/\\textbackslash\{\}/g, '')
    .replace(/\\textasciitilde\{\}/g, '~')
    .replace(/\\textasciicircum\{\}/g, '^')
    .replace(/\\&/g, '&')
    .replace(/\\%/g, '%')
    .replace(/\\#/g, '#')
    .replace(/\\_/g, '_')
    .replace(/\\\$/g, '$')
    .replace(/\\\{/g, '{')
    .replace(/\\\}/g, '}')
    .replace(/\\textbackslash/g, '')
    .replace(/~+/g, ' ');
}

const UNWRAP_TEXT_COMMANDS = ['textbf', 'textit', 'emph', 'texttt', 'text', 'mathrm', 'mathbf', 'textrm'];

function unwrapTextCommands(text) {
  let result = String(text || '');

  for (const command of UNWRAP_TEXT_COMMANDS) {
    result = result.replace(
      new RegExp(`\\\\?${command}\\*?(?:\\[[^\\]]*\\])?\\{([^{}]*(?:\\{[^{}]*\\}[^{}]*)*)\\}`, 'gi'),
      ' $1 '
    );
  }

  return result;
}

function stripLatexCommands(text) {
  let result = unwrapTextCommands(text);

  for (let pass = 0; pass < 24; pass += 1) {
    const next = result
      .replace(/\\[a-zA-Z@*]+\*?(?:\[[^\]]*\])?\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, ' ')
      .replace(/\\[a-zA-Z@*]+\*?(?:\[[^\]]*\])?/g, ' ')
      .replace(/\\\\(?:\[[^\]]*\])?/g, ' ')
      .replace(new RegExp(`\\b(?:${UNWRAP_TEXT_COMMANDS.join('|')})\\b`, 'gi'), ' ');

    if (next === result) break;
    result = next;
  }

  return result;
}

export function sanitizeDiagramLabel(raw, maxLength = MAX_LABEL_CHARS) {
  let text = decodeLatexEscapes(String(raw || ''));
  text = text.replace(/\$([^$]+)\$/g, '$1');
  text = stripLatexCommands(text);
  text = text.replace(/[—–]/g, '-');
  text = text.replace(/[{}\\$#%^~]/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();

  if (!text) return '';

  return shortenLabel(text, maxLength);
}

function stripLatexMarkup(raw) {
  return sanitizeDiagramLabel(raw, 120);
}

function hasLeakedMarkup(text) {
  return LEAKED_MARKUP_PATTERN.test(String(text || ''));
}

function isReadableDiagramLabel(label) {
  const value = clean(label);
  if (!value || value.length < 2) return false;
  if (hasLeakedMarkup(value)) return false;
  if (/[{}\\$#%^]/.test(value)) return false;
  return ALLOWED_LABEL_PATTERN.test(value);
}

export function validateDiagramLabelContent(label, role = 'step', maxLength = MAX_LABEL_CHARS) {
  const original = clean(label);
  const sanitized = sanitizeDiagramLabel(original, maxLength);
  const issues = [];

  if (!original) {
    issues.push(`${role} label is empty.`);
    return { ok: false, issues, sanitized, original, corrected: false };
  }

  if (!sanitized) {
    issues.push(`${role} label "${previewLabel(original)}" could not be converted to readable text.`);
    return { ok: false, issues, sanitized, original, corrected: false };
  }

  if (original !== sanitized) {
    issues.push(
      `${role} label "${previewLabel(original)}" contained LaTeX markup and was rewritten as "${sanitized}".`
    );
  }

  if (!isReadableDiagramLabel(sanitized)) {
    issues.push(`${role} label "${sanitized}" still contains unsupported diagram characters.`);
  }

  return {
    ok: isReadableDiagramLabel(sanitized),
    issues,
    sanitized,
    original,
    corrected: original !== sanitized
  };
}

export function sanitizeDiagramSteps(steps) {
  const labels = (Array.isArray(steps) ? steps : []).map((step) => clean(step)).filter(Boolean);
  const results = labels.map((label) => validateDiagramLabelContent(label, 'Workflow step'));
  const sanitized = results.map((result) => result.sanitized).filter(Boolean);
  const issues = results.flatMap((result) => result.issues);
  const corrected = results.some((result) => result.corrected);

  return {
    steps: dedupeSteps(sanitized),
    issues,
    corrected,
    ok: sanitized.length >= 2 && results.every((result) => result.ok)
  };
}

export function validateDiagramContent(steps, metadata = {}) {
  const stepResults = sanitizeDiagramSteps(steps);
  const titleResult = validateDiagramLabelContent(metadata.title || 'Agent Workflow Diagram', 'Diagram title');
  const footnoteResult = metadata.footnote
    ? validateDiagramLabelContent(metadata.footnote, 'Diagram note', 100)
    : { ok: true, issues: [], sanitized: '', original: '', corrected: false };
  const captionResult = metadata.caption
    ? validateDiagramLabelContent(metadata.caption, 'Figure caption', 180)
    : { ok: true, issues: [], sanitized: '', original: '', corrected: false };

  const issues = [
    ...stepResults.issues,
    ...titleResult.issues,
    ...footnoteResult.issues,
    ...captionResult.issues
  ];

  const ok =
    stepResults.ok &&
    titleResult.ok &&
    footnoteResult.ok &&
    captionResult.ok &&
    stepResults.steps.length >= 2;

  return {
    ok,
    issues,
    steps: stepResults.steps,
    title: titleResult.sanitized || 'Agent Workflow Diagram',
    footnote: footnoteResult.sanitized || metadata.footnote || '',
    caption: captionResult.sanitized || metadata.caption || '',
    corrected:
      stepResults.corrected ||
      titleResult.corrected ||
      footnoteResult.corrected ||
      captionResult.corrected
  };
}

export function verifyRenderedDiagramContent(latex) {
  const body = String(latex || '');
  const issues = [];
  const nodePattern = /\\fbox\{\\parbox\{[^}]*\}\{[^}]*\\centering\s*([^}]*)\}/g;
  const nodes = [...body.matchAll(nodePattern)].map((match) => sanitizeDiagramLabel(match[1] || ''));

  if (!nodes.length) {
    issues.push('Rendered diagram is missing validated node boxes.');
  }

  if (nodes.length < 2) {
    issues.push('Rendered diagram must include at least two workflow nodes.');
  }

  for (const [index, node] of nodes.entries()) {
    if (!isValidWorkflowStep(node)) {
      issues.push(`Rendered node ${index + 1} has invalid label "${previewLabel(node, 24)}".`);
    }
    if (hasLeakedMarkup(node)) {
      issues.push(`Rendered node ${index + 1} still contains LaTeX markup.`);
    }
    if (/\\textbackslash/.test(node)) {
      issues.push(`Rendered node ${index + 1} contains escaped backslash text.`);
    }
    if (/\$/.test(node)) {
      issues.push(`Rendered node ${index + 1} contains math delimiters.`);
    }
    if (/^@|@{}|^\s*c@\s*$/i.test(node)) {
      issues.push(`Rendered node ${index + 1} looks like table markup instead of workflow text.`);
    }
  }

  const titleMatch = body.match(/\\textbf\{([^}]*)\}/);
  if (titleMatch && hasLeakedMarkup(titleMatch[1])) {
    issues.push('Rendered diagram title contains LaTeX markup.');
  }

  const footnoteMatch = body.match(/\\textit\{([^}]*)\}/g) || [];
  for (const match of footnoteMatch) {
    const inner = match.replace(/^\\textit\{|\}$/g, '');
    if (hasLeakedMarkup(inner) || /\\[a-zA-Z@*]/.test(inner)) {
      issues.push('Rendered diagram note contains LaTeX markup.');
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    nodeCount: nodes.length
  };
}

function previewLabel(label, maxLength = 48) {
  const value = clean(label);
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function shortenLabel(label, maxLength = MAX_LABEL_CHARS) {
  const value = clean(label);
  if (value.length <= maxLength) return value;
  const trimmed = value.slice(0, Math.max(1, maxLength - 3)).trim();
  return `${trimmed}...`;
}

export function detectFlowIssues(source) {
  const text = String(source || '');
  const issues = [];

  if (BACKWARD_ARROW_PATTERN.test(text)) {
    issues.push('Backward arrows detected; workflow will be normalized to top-down flow.');
  }

  if (UP_ARROW_PATTERN.test(text)) {
    issues.push('Upward arrows detected; workflow will be normalized to top-down flow.');
  }

  return issues;
}

export function getCanonicalWorkflowOrder(project = {}, options = {}) {
  const inference = inferWorkflowWithSource(project, options);
  if (inference.source === 'generic-fallback') {
    return null;
  }
  return inference.steps.slice(0, 8);
}

export function normalizeWorkflowOrder(steps, project = {}) {
  const labels = (Array.isArray(steps) ? steps : []).map((step) => clean(step)).filter(Boolean);
  const canonical = getCanonicalWorkflowOrder(project);

  if (!canonical || labels.length < 2) {
    return { steps: labels, reordered: false };
  }

  const rank = new Map(canonical.map((step, index) => [step.toLowerCase(), index]));
  const allKnown = labels.every((step) => rank.has(step.toLowerCase()));

  if (!allKnown) {
    return { steps: labels, reordered: false };
  }

  const sorted = [...labels].sort(
    (left, right) => rank.get(left.toLowerCase()) - rank.get(right.toLowerCase())
  );
  const reordered = sorted.some((step, index) => step !== labels[index]);

  return { steps: sorted, reordered };
}

export function validateDiagramFlow(steps, layout, source = '', project = {}) {
  const labels = (Array.isArray(steps) ? steps : []).map((step) => clean(step)).filter(Boolean);
  const issues = [...detectFlowIssues(source)];
  const details = {
    layout,
    forwardArrowCount: 0,
    downwardArrowCount: 0,
    reordered: false
  };

  if (labels.length < 2) {
    issues.push('Workflow must include at least two ordered steps.');
    return { ok: false, issues, details };
  }

  const { steps: orderedSteps, reordered } = normalizeWorkflowOrder(labels, project);
  const linearSteps = removeAdjacentDuplicates(orderedSteps);
  details.reordered = reordered;
  if (reordered) {
    issues.push('Diagram step order was corrected to match the method workflow sequence.');
  }
  if (linearSteps.length !== orderedSteps.length) {
    issues.push('Adjacent duplicate steps were removed to preserve a linear workflow.');
  }

  const expected = expectedArrowCounts(linearSteps.length, layout);
  details.forwardArrowCount = expected.forward;
  details.downwardArrowCount = expected.downward;

  const semanticIssue = validateSemanticFlow(linearSteps);
  if (semanticIssue && !reordered) {
    issues.push(semanticIssue);
  }

  return {
    ok: linearSteps.length >= 2 && !issues.some((issue) => /must include|should appear/i.test(issue)),
    issues,
    details,
    steps: linearSteps
  };
}

function removeAdjacentDuplicates(steps) {
  return steps.filter(
    (step, index) => index === 0 || step.toLowerCase() !== steps[index - 1].toLowerCase()
  );
}

function validateSemanticFlow(steps) {
  const lower = steps.map((step) => step.toLowerCase());
  const inputIndex = lower.findIndex((step) => /input|prompt|problem/.test(step));
  const outputIndex = lower.findIndex((step) => /output|answer|result|response/.test(step));
  const updateIndex = lower.findIndex((step) => /update|optimi[sz]e|train/.test(step));

  if (inputIndex > 0 && inputIndex !== -1) {
    return 'Input or problem nodes should appear at the start of the workflow.';
  }

  if (outputIndex !== -1 && updateIndex !== -1 && outputIndex < updateIndex) {
    return 'Final outputs should appear after training or policy-update steps.';
  }

  return '';
}

function expectedArrowCounts(stepCount, layout) {
  if (stepCount < 2) {
    return { forward: 0, downward: 0 };
  }

  if (layout === 'horizontal') {
    return { forward: stepCount - 1, downward: 0 };
  }

  if (layout === 'vertical') {
    return { forward: 0, downward: stepCount - 1 };
  }

  const rows = chunkSteps(new Array(stepCount).fill(0), MAX_HORIZONTAL_NODES).map((row) => row.length);
  const forward = rows.reduce((sum, count) => sum + Math.max(count - 1, 0), 0);
  const downward = Math.max(rows.length - 1, 0);
  return { forward, downward };
}

export function verifyRenderedDiagramFlow(latex, layout, stepCount) {
  const body = String(latex || '');
  const issues = [];
  const expected = expectedArrowCounts(stepCount, layout);
  const forwardMatches = body.match(/\\rightarrow/g) || [];
  const downwardMatches = body.match(/\\downarrow/g) || [];

  if (BACKWARD_ARROW_PATTERN.test(body) || /\\leftarrow/.test(body)) {
    issues.push('Rendered diagram contains backward arrows.');
  }

  if (layout === 'vertical') {
    if (forwardMatches.length > 0) {
      issues.push('Vertical workflow diagram should use downward arrows only, not horizontal forward arrows.');
    }
    if (downwardMatches.length < expected.downward) {
      issues.push('Rendered diagram is missing downward arrows between workflow stages.');
    }
  } else if (forwardMatches.length < expected.forward) {
    issues.push('Rendered diagram is missing forward arrows between workflow steps.');
  }

  if (layout !== 'horizontal' && layout !== 'vertical' && downwardMatches.length < expected.downward) {
    issues.push('Rendered diagram is missing downward arrows between workflow stages.');
  }

  return {
    ok: issues.length === 0,
    issues,
    forwardArrows: forwardMatches.length,
    downwardArrows: downwardMatches.length,
    expected
  };
}

function isValidWorkflowStep(label) {
  const value = sanitizeDiagramLabel(label);
  if (!value || value.length < 2) return false;
  if (/^[@c>\s.:;]+$/.test(value)) return false;
  if (/@\{\}|\\hspace|linewidth|rightarrow|leftarrow|tabular|fbox|parbox/i.test(value)) return false;
  return isReadableDiagramLabel(value);
}

function isWorkflowCandidateLine(line) {
  const value = clean(line).replace(/\\\\\[[^\]]*\]\s*$/g, '');
  if (!value) return false;
  if (
    /^\\begin\{|^\\end\{|^\\parbox|^\\tabular|^@{}|^\\fbox|^\\minipage|^\\setlength|^\\caption/i.test(
      value
    )
  ) {
    return false;
  }
  if (/@\{\}|\\tabular|linewidth|fboxsep/i.test(value) && !/[A-Za-z]{3,}/.test(value)) {
    return false;
  }
  if (!/(\\rightarrow|\\Rightarrow|\$\\rightarrow\$|→|->)/.test(value)) return false;

  const parts = value
    .split(FORWARD_ARROW_SPLIT)
    .map((part) => sanitizeDiagramLabel(part))
    .filter(Boolean);

  return parts.filter((part) => isValidWorkflowStep(part)).length >= 2;
}

function extractWorkflowSourceText(source) {
  const text = String(source || '');
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  let bestLine = '';
  let bestScore = 0;

  for (const line of lines) {
    if (!isWorkflowCandidateLine(line)) continue;

    const parts = line
      .split(FORWARD_ARROW_SPLIT)
      .map((part) => sanitizeDiagramLabel(part))
      .filter((part) => isValidWorkflowStep(part));

    const score = parts.length * 10 - parts.join(' ').length / 20;
    if (score > bestScore) {
      bestScore = score;
      bestLine = line;
    }
  }

  if (bestLine) return bestLine;

  const compact = text.replace(/\s+/g, ' ').trim();
  const inlineMatch = compact.match(
    /([A-Za-z][^\\]{1,80}(?:\\rightarrow|->|→)[^\\]{1,80}(?:\\rightarrow|->|→)[A-Za-z][^\\]{1,80})/
  );

  return inlineMatch && isWorkflowCandidateLine(inlineMatch[1]) ? inlineMatch[1] : '';
}

function extractStepsFromRenderedDiagram(body) {
  const nodes = [...String(body || '').matchAll(/\\fbox\{\\parbox\{[^}]*\}\{[^}]*\\centering\s*([^}]+)\}/g)]
    .map((match) => sanitizeDiagramLabel(match[1]))
    .filter((label) => isValidWorkflowStep(label));

  return dedupeSteps(nodes);
}

function buildGroundingCorpus(project = {}) {
  return [project.method, project.timeline, project.evaluation, project.problem, project.title, project.topic]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function significantWords(text) {
  return String(text || '')
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^\w-]/g, ''))
    .filter((word) => word.length > 3 && !GROUNDING_STOP_WORDS.has(word));
}

export function isGenericWorkflowStep(step) {
  const value = clean(step).toLowerCase();
  return GENERIC_WORKFLOW_LABELS.some((pattern) => pattern.test(value));
}

export function stepMatchesProjectCorpus(step, corpus) {
  const words = significantWords(step);
  if (!words.length) return false;
  const hits = words.filter((word) => corpus.includes(word));
  return hits.length >= Math.max(1, Math.ceil(words.length * 0.34));
}

export function validateDiagramGrounding(steps, project = {}, meta = {}) {
  const labels = (Array.isArray(steps) ? steps : []).map((step) => clean(step)).filter(Boolean);
  const corpus = buildGroundingCorpus(project);
  const genericSteps = labels.filter((step) => isGenericWorkflowStep(step));
  const groundedSteps = labels.filter((step) => stepMatchesProjectCorpus(step, corpus));
  const issues = [];

  if (!labels.length) {
    issues.push('Workflow diagram has no steps to validate against project content.');
  }

  if (genericSteps.length) {
    issues.push(
      `Diagram uses generic template step(s): ${genericSteps.map((step) => `"${step}"`).join(', ')}.`
    );
  }

  if (labels.length && groundedSteps.length < Math.min(2, labels.length)) {
    issues.push('Workflow steps are not grounded in the proposal method, timeline, or evaluation text.');
  }

  if (meta.source === 'generic-fallback') {
    issues.push('Diagram fell back to a generic workflow template instead of project-specific steps.');
  }

  return {
    ok: issues.length === 0,
    issues,
    genericFallbackUsed: genericSteps.length > 0 || meta.source === 'generic-fallback',
    groundedCount: groundedSteps.length,
    stepCount: labels.length,
    source: meta.source || 'unknown'
  };
}

export function resolveWorkflowSteps(parsedSteps, source, project = {}, options = {}) {
  const inference = inferWorkflowWithSource(project, options);
  const corpus = buildGroundingCorpus(project);
  const validParsed = (Array.isArray(parsedSteps) ? parsedSteps : []).filter((step) =>
    isValidWorkflowStep(step)
  );

  if (validParsed.length >= 2) {
    const grounded = validParsed.filter((step) => stepMatchesProjectCorpus(step, corpus));
    if (grounded.length >= 2 && !validParsed.some((step) => isGenericWorkflowStep(step))) {
      return compressWorkflowSteps(validParsed);
    }
  }

  const fromRendered = extractStepsFromRenderedDiagram(source);
  if (fromRendered.length >= 2) {
    const grounded = fromRendered.filter((step) => stepMatchesProjectCorpus(step, corpus));
    if (grounded.length >= 2 && !fromRendered.some((step) => isGenericWorkflowStep(step))) {
      return compressWorkflowSteps(fromRendered);
    }
  }

  return inference.steps;
}

function compressWorkflowSteps(steps) {
  return dedupeSteps(
    steps.map((step) => {
      const sanitized = sanitizeDiagramLabel(step);
      if (sanitized.length <= 26) return sanitized;
      return shortenLabel(sanitized, 26);
    })
  );
}

export function parseWorkflowSteps(source) {
  const text = extractWorkflowSourceText(source);
  if (!text) return [];

  const arrowParts = text
    .split(FORWARD_ARROW_SPLIT)
    .map((part) => sanitizeDiagramLabel(part))
    .filter((part) => isValidWorkflowStep(part));

  if (arrowParts.length >= 2) {
    return dedupeSteps(arrowParts);
  }

  const fboxParts = [...text.matchAll(/\\fbox\{(?:\\parbox\{[^}]*\}\{)?([^}]+)\}?\}/g)]
    .map((match) => shortenLabel(stripLatexMarkup(match[1])))
    .filter(Boolean);

  if (fboxParts.length >= 2) {
    return dedupeSteps(fboxParts);
  }

  const nodeParts = [...text.matchAll(/\\node[^[]*\[([^\]]*)\]\s*\{([^}]+)\}/g)]
    .map((match) => shortenLabel(stripLatexMarkup(match[2] || match[1])))
    .filter(Boolean);

  if (nodeParts.length >= 2) {
    return dedupeSteps(nodeParts);
  }

  const lineParts = text
    .split(/\n+/)
    .map((line) => shortenLabel(stripLatexMarkup(line)))
    .filter((line) => line.length >= 2 && line.length <= MAX_LABEL_CHARS);

  if (lineParts.length >= 2 && lineParts.length <= 8) {
    return dedupeSteps(lineParts);
  }

  return [];
}

function dedupeSteps(steps) {
  const seen = new Set();
  const result = [];

  for (const step of steps) {
    const key = step.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(step);
  }

  return result.slice(0, 8);
}

function extractNumberedSteps(text) {
  const steps = [];

  for (const raw of String(text || '').split(/\n+/)) {
    const line = raw.trim();
    if (!/^(?:\d+[\).\]]\s+|-\s+|\*\s+|\\item\s+)/.test(line)) continue;

    const body = line.replace(/^(?:\d+[\).\]]\s+|-\s+|\*\s+|\\item\s+)/, '').trim();
    const label = shortenLabel(stripLatexMarkup(body), 34);
    if (label.length >= 6) steps.push(label);
  }

  return dedupeSteps(steps);
}

function extractClauseSteps(text) {
  return dedupeSteps(
    String(text || '')
      .split(/\s*;\s*|\s+then\s+|\s*,\s+and\s+|\s+and\s+(?=[A-Za-z])/i)
      .map((part) => shortenLabel(stripLatexMarkup(part), 32))
      .filter((part) => part.length >= 8 && part.length <= 34)
  );
}

function extractMethodSectionBody(latex) {
  const match = String(latex || '').match(
    /\\section\*?\{(?:Method|Approach|Training Workflow|Method and [^}]+)\}([\s\S]*?)(?=\\section\*?\{|\\end\{document\})/i
  );
  return match ? match[1] : '';
}

function milestoneDescriptionToStep(description) {
  const cleaned = clean(description)
    .replace(/^milestone\s+\d+\s*(?:\([^)]+\))?\s*[:\-—–]\s*/i, '')
    .replace(/^phase\s+\d+\s*(?:\([^)]+\))?\s*[:\-—–]\s*/i, '');
  return shortenLabel(stripLatexMarkup(cleaned), 32);
}

function extractMilestoneWorkflowSteps(project = {}) {
  const timeline = String(project.timeline || '');
  if (!timeline) return [];

  const steps = [];
  for (const rawLine of timeline.split(/\n+/)) {
    const line = clean(rawLine);
    const milestoneMatch =
      line.match(/^(?:milestone|phase)\s*\d+\s*(?:\([^)]+\))?\s*[:\-—–]\s*(.+)$/i) ||
      line.match(/^(?:milestone|phase)\s*\d+\s*[:\-—–]\s*(.+)$/i);

    if (!milestoneMatch) continue;

    const label = milestoneDescriptionToStep(milestoneMatch[1] || milestoneMatch[0]);
    if (label.length >= 8) steps.push(label);
  }

  return dedupeSteps(steps).slice(0, 6);
}

function deriveWorkflowFromMethodPhrases(project = {}) {
  const method = String(project.method || '');
  if (!method) return [];

  const candidates = [];
  const phrasePatterns = [
    [/group-relative policy optimization|\bgrpo\b/i, 'GRPO policy optimization'],
    [/dense(?:,\s*)?process rewards?|process-level rewards?/i, 'Dense process rewards'],
    [/curriculum scheduling|difficulty curriculum/i, 'Curriculum scheduling'],
    [/self-consistency|majority vote/i, 'Self-consistency voting'],
    [/supervised fine-tuning|\bsft\b/i, 'Supervised fine-tuning baseline'],
    [/executable (?:python )?verification|code verification/i, 'Executable verification'],
    [/multi-?sample rollouts?/i, 'Multi-sample rollouts'],
    [/policy optimization|policy update/i, 'Policy optimization'],
    [/reward aggregation|reward signals?/i, 'Reward design'],
    [/benchmark evaluation|exact-match/i, 'Benchmark evaluation']
  ];

  for (const [pattern, label] of phrasePatterns) {
    if (pattern.test(method)) candidates.push(label);
  }

  if (candidates.length >= 2) {
    return dedupeSteps(candidates).slice(0, 6);
  }

  const verbChunks =
    method.match(
      /\b(?:train|implement|evaluate|compare|score|optimize|aggregate|reproduce|conduct|validate|monitor)\w*\s+[^,.;]{8,42}/gi
    ) || [];

  const derived = verbChunks
    .map((chunk) => shortenLabel(stripLatexMarkup(chunk), 32))
    .filter((chunk) => chunk.length >= 8 && chunk.length <= 34);

  return dedupeSteps(derived).slice(0, 6);
}

function condenseMethodToWorkflow(project = {}) {
  const method = String(project.method || '');
  const sentences = method
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => shortenLabel(stripLatexMarkup(sentence), 30))
    .filter((sentence) => sentence.length >= 8 && sentence.length <= 34);

  if (sentences.length >= 3) {
    return dedupeSteps(sentences).slice(0, 6);
  }

  const clauses = extractClauseSteps(method);
  if (clauses.length >= 2) {
    return clauses.slice(0, 6);
  }

  return [];
}

function genericWorkflowFromProject(project = {}) {
  const topic = clean(project.title) || clean(project.topic) || 'this research';
  const shortTopic = shortenLabel(topic, 24);
  const problemLead = shortenLabel(stripLatexMarkup(firstSentence(project.problem || '')), 30);
  const methodLead = shortenLabel(stripLatexMarkup(firstSentence(project.method || '')), 30);

  const steps = [];
  if (problemLead.length >= 8) {
    steps.push(shortenLabel(`Define ${problemLead}`, 32));
  } else {
    steps.push('Problem Definition');
  }

  if (methodLead.length >= 8) {
    steps.push(methodLead);
  } else {
    steps.push(shortenLabel(`Data setup for ${shortTopic}`, 30));
  }

  steps.push('Core Method Implementation', 'Evaluation and Ablations', 'Analysis and Write-up');
  return steps;
}

function firstSentence(text) {
  const value = clean(text);
  if (!value) return '';
  return value.match(/[^.!?]+[.!?]+/)?.[0]?.trim() || value;
}

export function buildDiagramMetadata(project = {}) {
  const title = clean(project.title) || clean(project.topic) || 'Research Workflow';
  const method = String(project.method || '');
  const isRl = /reinforcement|grpo|ppo|policy gradient|rl training/i.test(method);
  const isAgent = /agent|tool use|workflow|orchestrat/i.test(method);
  const shortTitle = shortenLabel(title, 64);

  let diagramTitle = 'Method Workflow Diagram';
  if (isRl) diagramTitle = 'Training Workflow Diagram';
  else if (isAgent) diagramTitle = 'Agent Workflow Diagram';

  let caption = `Workflow diagram illustrating the proposed method for ${shortTitle}.`;
  if (isRl) {
    caption = `Training workflow for ${shortTitle}: data preparation, reward design, policy optimization, and evaluation.`;
  } else if (isAgent) {
    caption = `Agent workflow for ${shortTitle}: inputs, reasoning steps, tool use, and outputs.`;
  }

  const footnote = isRl
    ? '(Iterative training loop until convergence)'
    : isAgent
      ? '(Iterative agent loop until task completion)'
      : '';

  return { title: diagramTitle, caption, footnote };
}

export function inferWorkflowWithSource(project = {}, options = {}) {
  const method = project.method || '';
  const latex = options.latex || '';

  const fromArrows = parseWorkflowSteps(method);
  if (fromArrows.length >= 2) {
    return { steps: compressWorkflowSteps(fromArrows), source: 'method-arrows' };
  }

  const numbered = extractNumberedSteps(method);
  if (numbered.length >= 2) {
    return { steps: compressWorkflowSteps(numbered), source: 'method-numbered' };
  }

  const fromLatexItems = extractNumberedSteps(extractMethodSectionBody(latex));
  if (fromLatexItems.length >= 2) {
    return { steps: compressWorkflowSteps(fromLatexItems), source: 'latex-method-items' };
  }

  const fromMilestones = extractMilestoneWorkflowSteps(project);
  if (fromMilestones.length >= 3) {
    return { steps: compressWorkflowSteps(fromMilestones), source: 'timeline-milestones' };
  }

  const clauses = extractClauseSteps(method);
  if (clauses.length >= 2) {
    return { steps: compressWorkflowSteps(clauses), source: 'method-clauses' };
  }

  const condensed = condenseMethodToWorkflow(project);
  if (condensed.length >= 2) {
    return { steps: compressWorkflowSteps(condensed), source: 'method-condensed' };
  }

  const derived = deriveWorkflowFromMethodPhrases(project);
  if (derived.length >= 2) {
    return { steps: compressWorkflowSteps(derived), source: 'method-phrases' };
  }

  if (fromMilestones.length >= 2) {
    return { steps: compressWorkflowSteps(fromMilestones), source: 'timeline-milestones' };
  }

  return {
    steps: compressWorkflowSteps(genericWorkflowFromProject(project)),
    source: 'generic-fallback'
  };
}

export function inferWorkflowStepsFromProject(project = {}, options = {}) {
  return inferWorkflowWithSource(project, options).steps;
}

export function buildProjectWorkflowFigure(project = {}, options = {}) {
  const meta = buildDiagramMetadata(project);
  const inference = inferWorkflowWithSource(project, options);
  let steps = resolveWorkflowSteps(
    parseWorkflowSteps(project.method || ''),
    project.method || '',
    project,
    options
  );

  const initialGrounding = validateDiagramGrounding(steps, project, { source: inference.source });
  if (!initialGrounding.ok && inference.source !== 'generic-fallback') {
    steps = inference.steps;
  }

  const validation = validateDiagram(steps, {
    project,
    source: project.method || '',
    title: meta.title,
    footnote: meta.footnote,
    caption: meta.caption
  });
  const finalSteps = validation.steps || steps;
  const grounding = validateDiagramGrounding(finalSteps, project, { source: inference.source });
  const replacement = buildFigureEnvironment(
    finalSteps,
    validation.content?.caption || meta.caption,
    '[h]',
    {
      layout: validation.layout,
      title: validation.content?.title || meta.title,
      footnote: validation.content?.footnote || meta.footnote,
      project
    }
  );

  const renderedFlow = verifyRenderedDiagramFlow(replacement, validation.layout, finalSteps.length);
  const renderedContent = verifyRenderedDiagramContent(replacement);

  return {
    replacement,
    steps: finalSteps,
    validation: {
      ...validation,
      grounding,
      inferenceSource: inference.source,
      issues: [...(validation.issues || []), ...grounding.issues],
      renderedFlow,
      renderedContent
    }
  };
}

export function chooseDiagramLayout(_steps) {
  return 'vertical';
}

export function validateDiagramBounds(steps, layout = null) {
  const labels = (Array.isArray(steps) ? steps : []).map((step) => clean(step)).filter(Boolean);
  const chosen = layout || chooseDiagramLayout(labels);
  const issues = [];

  if (!labels.length) {
    issues.push('No workflow steps were detected for the diagram.');
  }

  if (chosen === 'horizontal') {
    if (labels.length > MAX_HORIZONTAL_NODES) {
      issues.push(`Horizontal layout supports at most ${MAX_HORIZONTAL_NODES} nodes.`);
    }
    const totalChars = labels.reduce((sum, label) => sum + label.length, 0);
    if (totalChars > MAX_HORIZONTAL_CHARS) {
      issues.push('Combined node labels are too wide for a single horizontal row.');
    }
  }

  const longLabels = labels.filter((label) => label.length > MAX_LABEL_CHARS);
  if (longLabels.length) {
    issues.push(`Node labels exceed ${MAX_LABEL_CHARS} characters and will be shortened.`);
  }

  return {
    ok: issues.length === 0,
    issues,
    layout: chosen,
    nodeCount: labels.length
  };
}

export function validateDiagram(steps, options = {}) {
  const labels = (Array.isArray(steps) ? steps : []).map((step) => clean(step)).filter(Boolean);
  const content = validateDiagramContent(labels, {
    title: options.title,
    footnote: options.footnote,
    caption: options.caption
  });
  const sanitizedSteps = content.steps.length ? content.steps : labels;
  const bounds = validateDiagramBounds(sanitizedSteps, 'vertical');
  const flow = validateDiagramFlow(sanitizedSteps, bounds.layout, options.source || '', options.project || {});
  const orderedSteps = flow.steps || sanitizedSteps;

  return {
    ok: bounds.ok && flow.ok && content.ok,
    issues: [...content.issues, ...bounds.issues, ...flow.issues],
    layout: bounds.layout,
    nodeCount: orderedSteps.length,
    steps: orderedSteps,
    flow: flow.details,
    content: {
      corrected: content.corrected,
      title: content.title,
      footnote: content.footnote,
      caption: content.caption
    }
  };
}

function buildNodeBox(label, widthFraction) {
  const safeLabel = sanitizeDiagramLabel(label);
  return `\\fbox{\\parbox{${widthFraction}\\linewidth}{\\centering ${formatEntryForLatex(safeLabel)}}}`;
}

function buildRow(steps, boxWidth) {
  const cells = [];

  for (let index = 0; index < steps.length; index += 1) {
    if (index > 0) {
      cells.push('{\\scriptsize $\\rightarrow$}');
    }
    cells.push(buildNodeBox(steps[index], boxWidth));
  }

  const colSpec = `@{}${Array(cells.length).fill('c').join('@{}')}@{}`;
  return `\\begin{tabular}{${colSpec}}\n${cells.join(' & ')}\n\\end{tabular}`;
}

function chunkSteps(steps, size) {
  const chunks = [];
  for (let index = 0; index < steps.length; index += size) {
    chunks.push(steps.slice(index, index + size));
  }
  return chunks;
}

function buildInterRowConnector(columnsInPreviousRow) {
  const offset = columnsInPreviousRow === 1 ? '0.10' : columnsInPreviousRow === 2 ? '0.34' : '0.58';
  return `{\\centering \\hspace{${offset}\\linewidth}$\\downarrow$ \\par}`;
}

function buildRowsDiagram(steps) {
  const rows = chunkSteps(steps, MAX_HORIZONTAL_NODES);
  const parts = [];

  for (let index = 0; index < rows.length; index += 1) {
    parts.push(buildRow(rows[index], rowWidthFraction(rows[index].length)));
    if (index < rows.length - 1) {
      parts.push(buildInterRowConnector(rows[index].length));
    }
  }

  return parts.join('\n\n\\vspace{0.35em}\n');
}

function rowWidthFraction(columns) {
  if (columns <= 1) return 0.72;
  if (columns === 2) return 0.38;
  return 0.27;
}

function buildHorizontalDiagram(steps) {
  return buildRow(steps, rowWidthFraction(steps.length));
}

function buildVerticalDiagram(steps) {
  const parts = steps.map((step) => buildNodeBox(step, 0.78));
  return parts.join('\n\n\\vspace{0.35em}\n{\\centering $\\downarrow$ \\par}\n\\vspace{0.25em}\n\n');
}

export function buildWorkflowDiagramLatex(steps, options = {}) {
  const labels = (Array.isArray(steps) ? steps : [])
    .map((step) => sanitizeDiagramLabel(step))
    .filter(Boolean);
  const layout = 'vertical';
  const title = sanitizeDiagramLabel(options.title || 'Agent Workflow Diagram', 80);
  const footnote = sanitizeDiagramLabel(options.footnote || '', 100);

  let body = '';
  if (!labels.length) {
    body = buildVerticalDiagram(inferWorkflowStepsFromProject(options.project || {}));
  } else {
    body = buildVerticalDiagram(labels);
  }

  const footnoteBlock = footnote
    ? `\\vspace{0.45em}\n\n{\\centering\\parbox{0.9\\linewidth}{\\centering\\itshape ${formatEntryForLatex(footnote)}} \\par}`
    : '';

  return `\\fbox{%
  \\begin{minipage}{0.94\\linewidth}
  \\centering
  \\footnotesize
  \\setlength{\\fboxsep}{5pt}
  \\textbf{${formatEntryForLatex(title)}}\\\\[0.55em]
  ${body}
  ${footnoteBlock}
  \\end{minipage}%
}`;
}

export function buildFigureEnvironment(steps, caption, placement = '[h]', options = {}) {
  const diagram = buildWorkflowDiagramLatex(steps, options);
  const captionText =
    sanitizeDiagramLabel(caption, 180) || 'Workflow diagram illustrating the proposed method.';

  return `\\begin{figure}${placement}
\\centering
${diagram}
\\caption{${formatEntryForLatex(captionText)}}
\\end{figure}`;
}

function extractFigureBlocks(latex) {
  const blocks = [];
  const pattern = /\\begin\{figure\}(\[[^\]]*\])?([\s\S]*?)\\end\{figure\}/gi;
  let match;

  while ((match = pattern.exec(latex)) !== null) {
    blocks.push({
      start: match.index,
      end: match.index + match[0].length,
      placement: match[1] || '[h]',
      body: match[2] || '',
      raw: match[0]
    });
  }

  return blocks;
}

function extractCaption(body) {
  const match = String(body || '').match(/\\caption\{([\s\S]*?)\}/);
  return match ? stripLatexMarkup(match[1]) : '';
}

function extractFootnote(body) {
  const text = String(body || '');
  const iterative = text.match(/\\textit\{\(([^}]+)\)\}/);
  if (iterative) {
    return sanitizeDiagramLabel(`(${iterative[1]})`, 100);
  }

  const matches = [...text.matchAll(/\\textit\{([^}]+)\}/g)];
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const candidate = sanitizeDiagramLabel(matches[index][1], 100);
    if (!candidate) continue;
    if (/^\(.*\)$/.test(candidate) || /iterative|loop|until|convergence|repeat/i.test(candidate)) {
      return candidate;
    }
  }

  return '';
}

function resolveDiagramFootnote(body, steps, fallback = '(Iterative loop until convergence)') {
  const footnote = extractFootnote(body);
  const stepNames = new Set((steps || []).map((step) => step.toLowerCase()));

  if (footnote && !stepNames.has(footnote.toLowerCase())) {
    return footnote;
  }

  return sanitizeDiagramLabel(fallback, 100);
}

function extractDiagramTitle(body) {
  const match = String(body || '').match(/\\textbf\{([\s\S]*?)\}/);
  return match ? stripLatexMarkup(match[1]) : '';
}

function replaceFigureBlock(block, project, options = {}) {
  const bodyWithoutCaption = block.body.replace(/\\caption\{[\s\S]*?\}/, '');
  const meta = buildDiagramMetadata(project);
  const caption = extractCaption(block.body) || meta.caption;
  const parsedSteps = resolveWorkflowSteps(
    parseWorkflowSteps(bodyWithoutCaption),
    bodyWithoutCaption,
    project,
    options
  );

  const title = extractDiagramTitle(bodyWithoutCaption) || meta.title;
  const footnote = resolveDiagramFootnote(bodyWithoutCaption, parsedSteps, meta.footnote);
  const validation = validateDiagram(parsedSteps, {
    source: bodyWithoutCaption,
    project,
    title,
    footnote,
    caption
  });
  const steps = validation.steps || parsedSteps;

  let finalSteps = steps;
  let finalValidation = validation;
  let replacement = buildFigureEnvironment(
    finalSteps,
    validation.content?.caption || caption,
    block.placement,
    {
      layout: validation.layout,
      title: validation.content?.title || title,
      footnote: validation.content?.footnote || footnote,
      project
    }
  );

  let renderedFlow = verifyRenderedDiagramFlow(replacement, validation.layout, finalSteps.length);
  let renderedContent = verifyRenderedDiagramContent(replacement);

  if (!renderedContent.ok) {
    finalSteps = inferWorkflowWithSource(project, options).steps;
    finalValidation = validateDiagram(finalSteps, {
      source: bodyWithoutCaption,
      project,
      title,
      footnote,
      caption
    });
    replacement = buildFigureEnvironment(
      finalSteps,
      finalValidation.content?.caption || caption,
      block.placement,
      {
        layout: finalValidation.layout,
        title: finalValidation.content?.title || title,
        footnote: finalValidation.content?.footnote || footnote,
        project
      }
    );
    renderedFlow = verifyRenderedDiagramFlow(replacement, finalValidation.layout, finalSteps.length);
    renderedContent = verifyRenderedDiagramContent(replacement);
  }

  const grounding = validateDiagramGrounding(finalSteps, project, {
    source: inferWorkflowWithSource(project, options).source
  });

  return {
    replacement,
    steps: finalSteps,
    validation: {
      ...finalValidation,
      grounding,
      inferenceSource: inferWorkflowWithSource(project, options).source,
      issues: [
        ...(finalValidation.issues || []),
        ...(!renderedContent.ok ? ['Diagram content check failed; rebuilt from project method workflow.'] : []),
        ...grounding.issues
      ],
      renderedFlow,
      renderedContent
    }
  };
}

function replaceSectionFigure(latex, project, options = {}) {
  const pattern =
    /(\\section\*?\{Figure[^}]*\})([\s\S]*?)(?=\\section\*?\{|\\end\{document\})/i;

  if (!pattern.test(latex)) {
    return { latex, replaced: false, validations: [] };
  }

  const built = buildProjectWorkflowFigure(project, options);

  return {
    latex: latex.replace(pattern, (full, heading) => `${heading}\n${built.replacement}\n`),
    replaced: true,
    validations: [built.validation]
  };
}

function injectWorkflowFigureAfterMethod(latex, project, options = {}) {
  const built = buildProjectWorkflowFigure(project, { ...options, latex });
  const insertPatterns = [
    /(\\section\*?\{(?:Method|Approach|Training Workflow|Method and [^}]+)\}[\s\S]*?)(?=\\section\*?\{)/i,
    /(\\section\*?\{Project Goal\}[\s\S]*?)(?=\\section\*?\{)/i
  ];

  for (const pattern of insertPatterns) {
    if (pattern.test(latex)) {
      return {
        latex: latex.replace(pattern, `$1\n${built.replacement}\n`),
        replaced: 1,
        validations: [built.validation],
        injected: true
      };
    }
  }

  if (/\\end\{document\}/i.test(latex)) {
    return {
      latex: latex.replace(/\\end\{document\}/i, `${built.replacement}\n\\end{document}`),
      replaced: 1,
      validations: [built.validation],
      injected: true
    };
  }

  return {
    latex: `${latex}\n${built.replacement}\n`,
    replaced: 1,
    validations: [built.validation],
    injected: true
  };
}

export function appendDiagramValidationNote(report, figureEnforcement = {}) {
  const base = clean(report) || '# Evaluation Report\n\nNo evaluation report returned.';
  const validations = Array.isArray(figureEnforcement.validations)
    ? figureEnforcement.validations
    : [];
  const notes = [];

  if (figureEnforcement.injected) {
    notes.push('- Workflow diagram was inserted from project.method because the draft had no valid figure.');
  } else if (figureEnforcement.replaced > 0) {
    notes.push(
      `- Workflow diagram normalized to stay inside the figure bounds with ${figureEnforcement.replaced} figure block(s) rebuilt.`
    );
  }

  for (const validation of validations) {
    if (validation.inferenceSource && validation.inferenceSource !== 'generic-fallback') {
      notes.push(`- Workflow steps inferred from ${validation.inferenceSource.replace(/-/g, ' ')}.`);
    } else if (validation.inferenceSource === 'generic-fallback') {
      notes.push('- Warning: workflow diagram used generic template steps because project-specific steps could not be inferred.');
    }

    if (validation.grounding?.ok) {
      notes.push(
        `- Diagram grounding check passed (${validation.grounding.groundedCount}/${validation.grounding.stepCount} steps match proposal content).`
      );
    } else if (validation.grounding?.issues?.length) {
      for (const issue of validation.grounding.issues) {
        notes.push(`- Diagram grounding: ${issue}`);
      }
    }

    for (const issue of validation.issues || []) {
      if (/grounding|generic template|not grounded/i.test(issue)) continue;
      if (/label|markup|readable|caption|title|note/i.test(issue)) {
        notes.push(`- Diagram content: ${issue}`);
      } else {
        notes.push(`- Diagram flow: ${issue}`);
      }
    }

    if (validation.content?.corrected) {
      notes.push('- Diagram labels were sanitized to remove LaTeX markup before rendering.');
    }

    if (validation.renderedContent?.ok) {
      notes.push(
        `- Diagram content check passed for ${validation.renderedContent.nodeCount} node(s); no leaked LaTeX markup detected.`
      );
    } else if (validation.renderedContent?.issues?.length) {
      for (const issue of validation.renderedContent.issues) {
        notes.push(`- Diagram content check: ${issue}`);
      }
    }

    if (validation.renderedFlow?.ok) {
      notes.push(
        `- Diagram arrow check passed (${validation.renderedFlow.forwardArrows} forward, ${validation.renderedFlow.downwardArrows} downward).`
      );
    } else if (validation.renderedFlow?.issues?.length) {
      for (const issue of validation.renderedFlow.issues) {
        notes.push(`- Diagram arrow check: ${issue}`);
      }
    }
  }

  if (!notes.length) {
    return base;
  }

  return `${base}\n\n## Diagram Validation\n${notes.join('\n')}`;
}

export function enforceFiguresInProposalLatex(latex, project = {}) {
  const source = String(latex || '');
  const blocks = extractFigureBlocks(source);

  const diagramOptions = { latex: source };

  if (!blocks.length) {
    const sectionResult = replaceSectionFigure(source, project, diagramOptions);
    if (sectionResult.replaced) {
      return {
        latex: sectionResult.latex,
        replaced: 1,
        validations: sectionResult.validations || [],
        injected: false
      };
    }

    const injected = injectWorkflowFigureAfterMethod(sectionResult.latex || source, project, diagramOptions);
    return {
      latex: injected.latex,
      replaced: injected.replaced,
      validations: injected.validations || [],
      injected: Boolean(injected.injected)
    };
  }

  let cursor = 0;
  let rebuilt = '';
  let replaced = 0;
  const validations = [];

  for (const block of blocks) {
    rebuilt += source.slice(cursor, block.start);
    const next = replaceFigureBlock(block, project, diagramOptions);
    rebuilt += next.replacement;
    validations.push(next.validation);
    replaced += 1;
    cursor = block.end;
  }

  rebuilt += source.slice(cursor);

  return {
    latex: rebuilt,
    replaced,
    validations
  };
}
