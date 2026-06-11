import { PROPOSAL_AUTHOR } from '../shared/mathlmDefaults.js';
import { auditLatexStructure, repairProposalLatex, repairStructuralLatex } from './latexRepair.js';
import { compileLatexDocument, prepareLatexDocument } from './pdfExport.js';

const SPECIAL_CHAR_ESCAPES = {
  _: '\\_',
  '%': '\\%',
  '&': '\\&',
  '#': '\\#',
  $: '\\$',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
  '{': '\\{',
  '}': '\\}'
};

export function repairUnescapedSpecialChars(source) {
  const value = String(source || '');
  const beginToken = '\\begin{document}';
  const endToken = '\\end{document}';
  const beginIndex = value.indexOf(beginToken);
  const endIndex = value.lastIndexOf(endToken);

  if (beginIndex === -1) {
    return repairLatexSegment(value);
  }

  const preambleEnd = beginIndex + beginToken.length;
  const bodyEnd = endIndex === -1 ? value.length : endIndex;

  return `${value.slice(0, preambleEnd)}${repairLatexSegment(value.slice(preambleEnd, bodyEnd))}${value.slice(bodyEnd)}`;
}

function repairLatexSegment(segment) {
  let output = '';
  let index = 0;

  while (index < segment.length) {
    const char = segment[index];

    if (char === '%') {
      const lineEnd = segment.indexOf('\n', index);
      const end = lineEnd === -1 ? segment.length : lineEnd + 1;
      output += segment.slice(index, end);
      index = end;
      continue;
    }

    if (char === '\\') {
      const parsed = readLatexControlSequence(segment, index);
      output += parsed.text;
      index = parsed.end;
      continue;
    }

    if (char === '$') {
      const parsed = readDelimitedSegment(segment, index, '$', '$');
      output += parsed.text;
      index = parsed.end;
      continue;
    }

    if (SPECIAL_CHAR_ESCAPES[char] && segment[index - 1] !== '\\') {
      output += SPECIAL_CHAR_ESCAPES[char];
      index += 1;
      continue;
    }

    output += char;
    index += 1;
  }

  return output;
}

function readLatexControlSequence(source, startIndex) {
  let index = startIndex + 1;
  let text = '\\';

  if (index < source.length && source[index] === '@') {
    text += source[index];
    index += 1;
  }

  if (index < source.length && !/[a-zA-Z]/.test(source[index]) && source[index] !== '{') {
    text += source[index];
    index += 1;
    return { text, end: index };
  }

  while (index < source.length && /[a-zA-Z]/.test(source[index])) {
    text += source[index];
    index += 1;
  }

  const commandName = text.slice(1).replace(/^@/, '');

  if (commandName === 'begin' || commandName === 'end') {
    while (index < source.length && /\s/.test(source[index])) {
      text += source[index];
      index += 1;
    }

    if (source[index] === '{') {
      const group = readBalancedGroup(source, index, '{', '}');
      text += group.text;
      index = group.end;

      if (commandName === 'begin') {
        const envName = group.text.slice(1, -1);
        const envBody = readEnvironment(source, index, envName);
        text += envBody.text;
        index = envBody.end;
      }
    }

    return { text, end: index };
  }

  while (index < source.length && /\s/.test(source[index])) {
    text += source[index];
    index += 1;
  }

  if (index < source.length && source[index] === '*') {
    text += source[index];
    index += 1;
    while (index < source.length && /\s/.test(source[index])) {
      text += source[index];
      index += 1;
    }
  }

  while (index < source.length && (source[index] === '[' || source[index] === '{')) {
    const delimiter = source[index] === '[' ? [']', '['] : ['}', '{'];
    const group = readBalancedGroup(source, index, delimiter[1], delimiter[0]);
    text += group.text;
    index = group.end;
  }

  return { text, end: index };
}

function readEnvironment(source, startIndex, envName) {
  const endMarker = `\\end{${envName}}`;
  let index = startIndex;
  let text = '';

  while (index < source.length) {
    const nextBegin = source.indexOf('\\begin{', index);
    const nextEnd = source.indexOf('\\end{', index);

    if (nextEnd === -1) {
      text += source.slice(index);
      return { text, end: source.length };
    }

    if (nextBegin !== -1 && nextBegin < nextEnd) {
      const nestedBegin = readLatexControlSequence(source, nextBegin);
      text += source.slice(index, nestedBegin.end);
      index = nestedBegin.end;
      continue;
    }

    const endCommand = readLatexControlSequence(source, nextEnd);
    if (endCommand.text === endMarker) {
      text += source.slice(index, endCommand.end);
      return { text, end: endCommand.end };
    }

    text += source.slice(index, endCommand.end);
    index = endCommand.end;
  }

  return { text, end: index };
}

function readDelimitedSegment(source, startIndex, open, close) {
  let index = startIndex + 1;
  let text = open;

  while (index < source.length) {
    const char = source[index];

    if (char === '\\') {
      text += char;
      index += 1;
      if (index < source.length) {
        text += source[index];
        index += 1;
      }
      continue;
    }

    text += char;
    index += 1;

    if (char === close) {
      break;
    }
  }

  return { text, end: index };
}

function readBalancedGroup(source, startIndex, open, close) {
  let depth = 0;
  let index = startIndex;
  let text = '';

  while (index < source.length) {
    const char = source[index];

    if (char === '\\') {
      text += char;
      index += 1;
      if (index < source.length) {
        text += source[index];
        index += 1;
      }
      continue;
    }

    if (char === open) {
      depth += 1;
    }

    text += char;
    index += 1;

    if (char === close) {
      depth -= 1;
      if (depth === 0) {
        break;
      }
    }
  }

  return { text, end: index };
}

function buildPrepareOptions(title, options = {}) {
  return {
    title,
    author: options.author || PROPOSAL_AUTHOR
  };
}

function buildValidationCandidates(rawLatex, title, options = {}) {
  const fallbackLatex = String(options.fallbackLatex || '').trim();
  const prepareOptions = buildPrepareOptions(title, options);
  const candidates = [
    {
      label: 'prepared',
      source: rawLatex,
      transform: (value) => prepareLatexDocument(value, title, prepareOptions)
    },
    {
      label: 'structural-repair',
      source: rawLatex,
      transform: (value) =>
        prepareLatexDocument(repairStructuralLatex(value, prepareOptions), title, prepareOptions)
    },
    {
      label: 'repaired',
      source: rawLatex,
      transform: (value) =>
        prepareLatexDocument(
          repairProposalLatex(repairUnescapedSpecialChars(value), prepareOptions),
          title,
          prepareOptions
        )
    }
  ];

  if (fallbackLatex) {
    candidates.push({
      label: 'fallback',
      source: fallbackLatex,
      transform: (value) =>
        prepareLatexDocument(
          repairProposalLatex(repairUnescapedSpecialChars(value), prepareOptions),
          title,
          prepareOptions
        )
    });
  }

  if (typeof options.transform === 'function') {
    return candidates.map((candidate) => ({
      ...candidate,
      transform: (value) => candidate.transform(options.transform(value))
    }));
  }

  return candidates;
}

export async function validateProposalLatex(rawLatex, title = 'proposal', options = {}) {
  const attempts = [];
  const candidates = buildValidationCandidates(rawLatex, title, options);

  for (const candidate of candidates) {
    const source = String(candidate.source || '').trim();
    if (!source) continue;

    const document = candidate.transform(source);
    const structure = auditLatexStructure(document);
    const compile = await compileLatexDocument(document);

    attempts.push({
      label: candidate.label,
      error: compile.ok ? '' : compile.error || 'Compilation failed.',
      structureIssues: structure.issues
    });

    if (compile.ok) {
      return {
        latex: document,
        validated: true,
        repaired: candidate.label !== 'prepared',
        usedFallback: candidate.label === 'fallback',
        structureAudit: structure,
        attempts
      };
    }

    if (compile.compilerUnavailable) {
      return {
        latex: document,
        validated: false,
        repaired: candidate.label !== 'prepared',
        usedFallback: false,
        compilerUnavailable: true,
        warning: 'PDF compiler was unavailable, so compile-time LaTeX verification was skipped.',
        attempts
      };
    }
  }

  const lastCandidate = candidates.at(-1);
  const prepareOptions = buildPrepareOptions(title, options);
  const lastDocument = lastCandidate
    ? lastCandidate.transform(String(lastCandidate.source || '').trim())
    : prepareLatexDocument(repairProposalLatex(rawLatex, prepareOptions), title, prepareOptions);

  return {
    latex: lastDocument,
    validated: false,
    repaired: true,
    usedFallback: Boolean(options.fallbackLatex),
    structureAudit: auditLatexStructure(lastDocument),
    warning: 'LaTeX could not be compile-verified; returned the best-effort repaired draft.',
    attempts
  };
}
