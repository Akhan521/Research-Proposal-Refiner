import { formatEntryForLatex } from './latexEscape.js';

export { formatEntryForLatex } from './latexEscape.js';
export { buildResourcesLatexSection, enforceResourcesInProposalLatex } from './resourceFormat.js';

export function parseListEntries(text) {
  return String(text || '')
    .split(/\n+/)
    .map((line) => line.replace(/^\s*[-*•\d.)]+\s*/, '').trim())
    .filter(Boolean);
}

const ITEMIZE_OPTIONS = '[leftmargin=*,itemsep=0.35em,parsep=0pt,topsep=0.35em,partopsep=0pt]';

export function buildListLatexSection(entries, emptyMessage) {
  const items = (Array.isArray(entries) ? entries : []).filter(Boolean);
  if (!items.length) {
    return `\n${formatEntryForLatex(emptyMessage)}\n`;
  }

  const body = items.map((entry) => `  \\item ${formatEntryForLatex(entry)}`).join('\n');
  return `\n\\begin{itemize}${ITEMIZE_OPTIONS}\n${body}\n\\end{itemize}\n`;
}

export function buildReferencesLatexSection(referencesText) {
  return buildListLatexSection(
    parseListEntries(referencesText),
    'No verified references were provided. Unsupported claims should be labeled as assumptions.'
  );
}

export const LAYOUT_PREAMBLE_LINES = [
  '\\PassOptionsToPackage{hyphens}{url}',
  '\\urlstyle{same}',
  '\\setlength{\\emergencystretch}{3em}',
  '\\usepackage{enumitem}',
  '\\setlist[itemize]{leftmargin=*,itemsep=0.35em,parsep=0pt,topsep=0.35em,partopsep=0pt}',
  '\\setlist[enumerate]{leftmargin=*,itemsep=0.25em,parsep=0pt,topsep=0.35em,partopsep=0pt}'
];

export function ensureLayoutPreamble(latex) {
  const source = String(latex || '');
  if (!/\\documentclass\b/.test(source) || !/\\begin\{document\}/.test(source)) {
    return source;
  }

  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const beginIndex = lines.findIndex((line) => /\\begin\{document\}/.test(line));
  const classIndex = lines.findIndex((line) => /\\documentclass\b/.test(line));
  if (beginIndex < 0 || classIndex < 0) return source;

  const preamble = lines.slice(0, beginIndex).join('\n');
  const hasHyperref = /\\usepackage(?:\[[^\]]*\])?\{hyperref\}/.test(preamble);
  const required = [
    {
      test: /\\PassOptionsToPackage\{hyphens\}\{url\}/,
      line: '\\PassOptionsToPackage{hyphens}{url}',
      beforeDocumentClass: true
    },
    {
      test: /\\usepackage(?:\[[^\]]*\])?\{url\}/,
      line: '\\usepackage[hyphens]{url}',
      skip: hasHyperref
    },
    { test: /\\urlstyle\{same\}/, line: '\\urlstyle{same}' },
    { test: /\\emergencystretch/, line: '\\setlength{\\emergencystretch}{3em}' },
    {
      test: /\\usepackage(?:\[[^\]]*\])?\{enumitem\}/,
      line: '\\usepackage{enumitem}'
    },
    {
      test: /\\setlist\[itemize\]/,
      line: '\\setlist[itemize]{leftmargin=*,itemsep=0.35em,parsep=0pt,topsep=0.35em,partopsep=0pt}'
    }
  ];

  const beforeClass = required.filter(
    (entry) => entry.beforeDocumentClass && !entry.test.test(preamble) && !entry.skip
  );
  const afterClass = required.filter(
    (entry) => !entry.beforeDocumentClass && !entry.test.test(preamble) && !entry.skip
  );

  if (!beforeClass.length && !afterClass.length) return source;

  const nextLines = [...lines];

  if (beforeClass.length) {
    nextLines.splice(classIndex, 0, ...beforeClass.map((entry) => entry.line));
  }

  const shiftedBeginIndex = nextLines.findIndex((line) => /\\begin\{document\}/.test(line));
  const shiftedClassIndex = nextLines.findIndex((line) => /\\documentclass\b/.test(line));

  if (afterClass.length) {
    let insertIndex = shiftedBeginIndex;
    for (let index = shiftedBeginIndex - 1; index > shiftedClassIndex; index -= 1) {
      if (/\\(usepackage|RequirePackage|setlength|urlstyle|setlist|hypersetup)\b/.test(nextLines[index])) {
        insertIndex = index + 1;
        break;
      }
    }

    if (insertIndex <= shiftedClassIndex) {
      insertIndex = shiftedClassIndex + 1;
    }

    nextLines.splice(insertIndex, 0, ...afterClass.map((entry) => entry.line));
  }

  return nextLines.join('\n');
}

function replaceSectionBody(latex, sectionTitlePattern, replacementBody) {
  const pattern = new RegExp(
    `(\\\\section\\*?\\{${sectionTitlePattern}[^}]*\\})([\\s\\S]*?)(?=\\\\section\\*?\\{|\\\\end\\{document\\})`,
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

export function enforceReferencesInProposalLatex(latex, referencesText) {
  const replacementBody = buildReferencesLatexSection(referencesText);
  const result = replaceSectionBody(latex, 'References', replacementBody);
  const entries = parseListEntries(referencesText);

  return {
    ...result,
    entryCount: entries.length,
    usedOnlyVerifiedList: true
  };
}
