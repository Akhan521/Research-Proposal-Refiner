import { PROPOSAL_AUTHOR } from '../shared/mathlmDefaults.js';

const LIST_ENV_PATTERN =
  /\\begin\{(itemize|enumerate|description)\}(\[[^\]]*\])?([\s\S]*?)\\end\{\1\}/gi;

const BALANCE_ENVIRONMENTS = ['minipage', 'figure', 'table', 'tabular', 'itemize', 'enumerate', 'description'];

function clean(value) {
  return String(value ?? '').trim();
}

function escapeAuthorForLatex(author) {
  return String(author || PROPOSAL_AUTHOR)
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_');
}

export function normalizeUnicodeForLatex(source) {
  return String(source || '')
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\u2013|\u2014/g, '--')
    .replace(/\u2026/g, '...')
    .replace(/\u00a0/g, ' ');
}

export function ensureAuthorInLatex(latex, author = PROPOSAL_AUTHOR) {
  const safeAuthor = escapeAuthorForLatex(author);
  let next = String(latex || '');

  if (/\\author\{[^}]*\}/.test(next)) {
    return next.replace(/\\author\{[^}]*\}/, `\\author{${safeAuthor}}`);
  }

  if (/\\title\{/.test(next)) {
    return next.replace(/(\\title\{[^}]*\})/, `$1\n\\author{${safeAuthor}}`);
  }

  if (/\\begin\{document\}/.test(next)) {
    return next.replace(/\\begin\{document\}/i, `\\author{${safeAuthor}}\n\\begin{document}`);
  }

  return next;
}

export function repairEmptyListEnvironments(latex) {
  return String(latex || '').replace(LIST_ENV_PATTERN, (full, envName, options = '', body = '') => {
    if (/\\item\b/.test(body)) {
      return full;
    }

    const placeholder =
      envName === 'description'
        ? '\n  \\item[--] Content to be specified.\n'
        : '\n  \\item Content to be specified.\n';

    return `\\begin{${envName}}${options || ''}${placeholder}\\end{${envName}}`;
  });
}

export function repairUnbalancedEnvironments(latex) {
  let next = String(latex || '');

  for (const envName of BALANCE_ENVIRONMENTS) {
    const beginPattern = new RegExp(`\\\\begin\\{${envName}\\}`, 'g');
    const endPattern = new RegExp(`\\\\end\\{${envName}\\}`, 'g');
    const beginCount = (next.match(beginPattern) || []).length;
    const endCount = (next.match(endPattern) || []).length;
    const missing = beginCount - endCount;

    if (missing <= 0) continue;

    const closers = Array.from({ length: missing }, () => `\\end{${envName}}`).join('\n');
    if (/\\end\{document\}/i.test(next)) {
      next = next.replace(/\\end\{document\}/i, `${closers}\n\\end{document}`);
    } else {
      next += `\n${closers}\n`;
    }
  }

  return next;
}

export function repairEscapedStarSectionHeadings(latex) {
  return String(latex || '').replace(
    /\\(section|subsection|subsubsection|paragraph|chapter|part)\*\\{([^{}]+)\\}/gi,
    '\\$1*{$2}'
  );
}

export function repairOrphanDocumentFragments(latex) {
  let next = String(latex || '');

  next = next.replace(
    /(\\end\{abstract\}|\\section\*?\{Abstract\})\s*\n+([\s\S]*?)(\n\\section)/gi,
    (match, abstractEnd, middle, sectionStart) => {
      const prose = middle
        .replace(/\\[a-zA-Z@*]+(\[[^\]]*\])?(\{[^}]*\})?/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (!prose || /this proposal builds on prior work|prior work on this topic/i.test(prose) || prose.length < 700) {
        return `${abstractEnd}\n${sectionStart}`;
      }

      return match;
    }
  );

  next = next.replace(
    /\n\s*This proposal builds on prior work, including \\citep\{[^}]+\}\.\s*(?=\n)/gi,
    '\n'
  );
  next = next.replace(
    /\n\s*Prior work on this topic is grounded in \\citep\{[^}]+\}\.\s*(?=\n)/gi,
    '\n'
  );

  return next;
}

export function repairDuplicateBibliography(latex) {
  const pattern = /\\begin\{thebibliography\}[\s\S]*?\\end\{thebibliography\}/gi;
  const matches = [...String(latex || '').matchAll(pattern)];
  if (matches.length <= 1) return String(latex || '');

  let next = String(latex || '');
  for (let index = 0; index < matches.length - 1; index += 1) {
    next = next.replace(matches[index][0], '');
  }

  return next.replace(/\n{3,}/g, '\n\n');
}

export function repairStrayPreambleCommands(latex) {
  const lines = String(latex || '').replace(/\r\n/g, '\n').split('\n');
  const beginIndex = lines.findIndex((line) => /\\begin\{document\}/.test(line));
  if (beginIndex < 0) return String(latex || '');

  const kept = [...lines.slice(0, beginIndex + 1)];
  for (let index = beginIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\\usepackage\b|^\\RequirePackage\b|^\\documentclass\b/.test(line.trim())) {
      continue;
    }
    kept.push(line);
  }

  return kept.join('\n');
}

export function repairDuplicateDocumentMarkers(latex) {
  const lines = String(latex || '').replace(/\r\n/g, '\n').split('\n');
  const seen = new Set();
  const kept = [];

  for (const line of lines) {
    const key = line.trim();
    if (/^\\begin\{document\}$/.test(key) || /^\\end\{document\}$/.test(key)) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    kept.push(line);
  }

  return kept.join('\n');
}

export function ensureTitleBeforeMaketitle(latex, title = 'proposal') {
  const source = String(latex || '');
  if (!/\\maketitle/.test(source) || /\\title\{/.test(source)) {
    return source;
  }

  const safeTitle = String(title || 'proposal')
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_');

  return source.replace(/\\begin\{document\}/i, `\\begin{document}\n\\title{${safeTitle}}`);
}

export function auditLatexStructure(latex) {
  const source = String(latex || '');
  const issues = [];

  if (!/\\documentclass\b/.test(source)) {
    issues.push('Missing \\documentclass declaration.');
  }

  if (!/\\begin\{document\}/.test(source)) {
    issues.push('Missing \\begin{document}.');
  }

  if (!/\\end\{document\}/.test(source)) {
    issues.push('Missing \\end{document}.');
  }

  if (/\\maketitle/.test(source) && !/\\title\{/.test(source)) {
    issues.push('Missing \\title before \\maketitle.');
  }

  if (/\\maketitle/.test(source) && /\\author\{\s*\}/.test(source)) {
    issues.push('Author field is empty.');
  }

  for (const envName of BALANCE_ENVIRONMENTS) {
    const beginCount = (source.match(new RegExp(`\\\\begin\\{${envName}\\}`, 'g')) || []).length;
    const endCount = (source.match(new RegExp(`\\\\end\\{${envName}\\}`, 'g')) || []).length;
    if (beginCount !== endCount) {
      issues.push(`Unbalanced ${envName} environments (${beginCount} begin, ${endCount} end).`);
    }
  }

  if (/\\begin\{(itemize|enumerate|description)\}/.test(source)) {
    const listBlocks = source.match(
      /\\begin\{(itemize|enumerate|description)\}(\[[^\]]*\])?([\s\S]*?)\\end\{\1\}/gi
    );
    for (const block of listBlocks || []) {
      if (!/\\item\b/.test(block)) {
        issues.push(`List environment without \\item: ${block.slice(0, 60)}...`);
      }
    }
  }

  if (/\\cite[tp]?\{/.test(source) && !/\\usepackage(?:\[[^\]]*\])?\{natbib\}/.test(source)) {
    issues.push('In-text citations found without natbib package.');
  }

  const bibliographyCount = (source.match(/\\begin\{thebibliography\}/g) || []).length;
  if (bibliographyCount > 1) {
    issues.push(`Found ${bibliographyCount} bibliography blocks; only one is allowed.`);
  }

  const documentClassCount = (source.match(/\\documentclass\b/g) || []).length;
  if (documentClassCount > 1) {
    issues.push(`Found ${documentClassCount} \\documentclass declarations.`);
  }

  return {
    ok: issues.length === 0,
    issues
  };
}

export function repairMissingSectionBreaks(latex) {
  return String(latex || '').replace(/([.!?])(\\section\*?\{)/g, '$1\n\n$2');
}

export function repairStructuralLatex(latex, options = {}) {
  const author = options.author || PROPOSAL_AUTHOR;
  let next = normalizeUnicodeForLatex(latex);
  next = repairMissingSectionBreaks(next);
  next = repairEscapedStarSectionHeadings(next);
  next = repairDuplicateDocumentMarkers(next);
  next = repairStrayPreambleCommands(next);
  next = repairDuplicateBibliography(next);
  next = repairOrphanDocumentFragments(next);
  next = repairEmptyListEnvironments(next);
  next = repairUnbalancedEnvironments(next);
  next = ensureTitleBeforeMaketitle(next, options.title || 'proposal');
  next = ensureAuthorInLatex(next, author);
  return next;
}

export function repairProposalLatex(latex, options = {}) {
  return repairStructuralLatex(latex, options);
}
