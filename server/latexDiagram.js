import { formatEntryForLatex } from './latexEscape.js';

const FORWARD_ARROW_SPLIT = /(?:\\rightarrow|\\Rightarrow|\$\\rightarrow\$|→|->)/;
const BACKWARD_ARROW_PATTERN = /(?:\\leftarrow|\\gets|\$\\leftarrow\$|←|<-|&lt;-)/;
const UP_ARROW_PATTERN = /(?:\\uparrow|\$\\uparrow\$|↑)/;
const MAX_HORIZONTAL_NODES = 3;
const MAX_HORIZONTAL_CHARS = 72;
const MAX_LABEL_CHARS = 34;
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

export function validateDiagramLabelContent(label, role = 'step') {
  const original = clean(label);
  const sanitized = sanitizeDiagramLabel(original);
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
    ? validateDiagramLabelContent(metadata.footnote, 'Diagram note')
    : { ok: true, issues: [], sanitized: '', original: '', corrected: false };
  const captionResult = metadata.caption
    ? validateDiagramLabelContent(metadata.caption, 'Figure caption')
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
  return `${value.slice(0, maxLength - 1).trim()}…`;
}

export function detectFlowIssues(source) {
  const text = String(source || '');
  const issues = [];

  if (BACKWARD_ARROW_PATTERN.test(text)) {
    issues.push('Backward arrows detected; workflow will be normalized to left-to-right / top-to-bottom flow.');
  }

  if (UP_ARROW_PATTERN.test(text)) {
    issues.push('Upward arrows detected; workflow will be normalized to top-to-bottom flow.');
  }

  return issues;
}

export function getCanonicalWorkflowOrder(project = {}) {
  const fromMethod = parseWorkflowSteps(project.method || '');
  if (fromMethod.length >= 2) return fromMethod;

  const numbered = String(project.method || '')
    .split(/\n+/)
    .map((line) => line.replace(/^\s*\d+[\).\]]\s+/, '').trim())
    .filter((line) => line.length >= 8)
    .map((line) => shortenLabel(stripLatexMarkup(line), 40));

  if (numbered.length >= 2) {
    return dedupeSteps(numbered).slice(0, 8);
  }

  return null;
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

  if (forwardMatches.length < expected.forward) {
    issues.push('Rendered diagram is missing forward arrows between workflow steps.');
  }

  if (layout !== 'horizontal' && downwardMatches.length < expected.downward) {
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

export function resolveWorkflowSteps(parsedSteps, source, project = {}) {
  const validParsed = (Array.isArray(parsedSteps) ? parsedSteps : []).filter((step) =>
    isValidWorkflowStep(step)
  );
  if (validParsed.length >= 2) {
    return compressWorkflowSteps(validParsed);
  }

  const fromRendered = extractStepsFromRenderedDiagram(source);
  if (fromRendered.length >= 2) {
    return compressWorkflowSteps(fromRendered);
  }

  return compressWorkflowSteps(inferWorkflowStepsFromProject(project));
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

export function inferWorkflowStepsFromProject(project = {}) {
  const fromMethod = parseWorkflowSteps(project.method || '');
  if (fromMethod.length >= 2) return fromMethod;

  const numbered = String(project.method || '')
    .split(/\n+/)
    .map((line) => line.replace(/^\s*\d+[\).\]]\s+/, '').trim())
    .filter((line) => line.length >= 8)
    .map((line) => shortenLabel(stripLatexMarkup(line), 40));

  if (numbered.length >= 2) {
    return dedupeSteps(numbered).slice(0, 6);
  }

  return [
    'Problem Input',
    'Step Generator',
    'Step Verifier',
    'Reward Aggregation',
    'Policy Update'
  ];
}

export function chooseDiagramLayout(steps) {
  const labels = (Array.isArray(steps) ? steps : []).map((step) => clean(step)).filter(Boolean);
  if (!labels.length) return 'vertical';

  const totalChars = labels.reduce((sum, label) => sum + label.length, 0);
  const longest = Math.max(...labels.map((label) => label.length));

  if (labels.length <= MAX_HORIZONTAL_NODES && totalChars <= MAX_HORIZONTAL_CHARS && longest <= 22) {
    return 'horizontal';
  }

  if (labels.length <= 6 && longest <= MAX_LABEL_CHARS) {
    return 'rows';
  }

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
  const bounds = validateDiagramBounds(sanitizedSteps, options.layout);
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
  const layout = options.layout || chooseDiagramLayout(labels);
  const title = sanitizeDiagramLabel(options.title || 'Agent Workflow Diagram', 80);
  const footnote = sanitizeDiagramLabel(options.footnote || '', 100);

  let body = '';
  if (!labels.length) {
    body = buildVerticalDiagram(inferWorkflowStepsFromProject(options.project || {}));
  } else if (layout === 'horizontal') {
    body = buildHorizontalDiagram(labels);
  } else if (layout === 'rows') {
    body = buildRowsDiagram(labels);
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

function replaceFigureBlock(block, project) {
  const bodyWithoutCaption = block.body.replace(/\\caption\{[\s\S]*?\}/, '');
  const caption = extractCaption(block.body) || 'Workflow diagram illustrating the proposed method.';
  const parsedSteps = resolveWorkflowSteps(
    parseWorkflowSteps(bodyWithoutCaption),
    bodyWithoutCaption,
    project
  );

  const title = extractDiagramTitle(bodyWithoutCaption) || 'Agent Workflow Diagram';
  const footnote = resolveDiagramFootnote(bodyWithoutCaption, parsedSteps);
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
    finalSteps = compressWorkflowSteps(inferWorkflowStepsFromProject(project));
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

  return {
    replacement,
    steps: finalSteps,
    validation: {
      ...finalValidation,
      issues: [
        ...(finalValidation.issues || []),
        ...(!renderedContent.ok ? ['Diagram content check failed; rebuilt from project method workflow.'] : [])
      ],
      renderedFlow,
      renderedContent
    }
  };
}

function replaceSectionFigure(latex, project) {
  const pattern =
    /(\\section\*?\{Figure[^}]*\})([\s\S]*?)(?=\\section\*?\{|\\end\{document\})/i;

  if (!pattern.test(latex)) {
    return { latex, replaced: false };
  }

  return {
    latex: latex.replace(pattern, (full, heading, body) => {
      const captionMatch = body.match(/\\caption\{([\s\S]*?)\}/);
      const caption = captionMatch ? stripLatexMarkup(captionMatch[1]) : 'Method workflow diagram.';
      const steps = resolveWorkflowSteps(parseWorkflowSteps(body), body, project);
      const title = extractDiagramTitle(body) || 'Agent Workflow Diagram';
      const stepsForFootnote = steps;
      const footnote = resolveDiagramFootnote(body, stepsForFootnote);
      const validation = validateDiagram(steps, { source: body, project, title, footnote, caption });
      const orderedSteps = validation.steps || steps;
      const figure = buildFigureEnvironment(orderedSteps, validation.content?.caption || caption, '[h]', {
        layout: validation.layout,
        title: validation.content?.title || title,
        footnote: validation.content?.footnote || footnote,
        project
      });

      return `${heading}\n${figure}\n`;
    }),
    replaced: true
  };
}

export function appendDiagramValidationNote(report, figureEnforcement = {}) {
  const base = clean(report) || '# Evaluation Report\n\nNo evaluation report returned.';
  const validations = Array.isArray(figureEnforcement.validations)
    ? figureEnforcement.validations
    : [];
  const notes = [];

  if (figureEnforcement.replaced > 0) {
    notes.push(
      `- Workflow diagram normalized to stay inside the figure bounds with ${figureEnforcement.replaced} figure block(s) rebuilt.`
    );
  }

  for (const validation of validations) {
    for (const issue of validation.issues || []) {
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

  if (!blocks.length) {
    const sectionResult = replaceSectionFigure(source, project);
    return {
      latex: sectionResult.latex,
      replaced: sectionResult.replaced ? 1 : 0,
      validations: []
    };
  }

  let cursor = 0;
  let rebuilt = '';
  let replaced = 0;
  const validations = [];

  for (const block of blocks) {
    rebuilt += source.slice(cursor, block.start);
    const next = replaceFigureBlock(block, project);
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
