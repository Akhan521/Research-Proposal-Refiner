import {
  findMatchingPaper,
  formatCanonicalCitation,
  parseReferenceEntries,
  validateReferenceLine
} from './citationValidate.js';
import { escapeUrlForLatex, formatEntryForLatex } from './latexEscape.js';
import { enforceReferencesInProposalLatex } from './latexLayout.js';

function clean(value) {
  return String(value ?? '').trim();
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractYearFromText(text) {
  const match = String(text || '').match(/\((\d{4})\)|\b(19|20)\d{2}\b/);
  return match ? match[1] || match[0] : '';
}

function formatAuthorList(authors = []) {
  const list = (Array.isArray(authors) ? authors : []).map(clean).filter(Boolean);
  if (!list.length) return 'Unknown authors';
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list[0]} et al.`;
}

function authorSurname(authorLabel) {
  const first = clean(authorLabel).split(/\s+and\s+|\s*,\s*|\s+et\s+al\.?/i)[0].trim();
  const parts = first.split(/\s+/).filter(Boolean);
  const candidate = parts[parts.length - 1] || parts[0] || 'ref';
  return candidate.replace(/[^a-z]/gi, '').toLowerCase() || 'ref';
}

function makeCitationKey(authorLabel, year, usedKeys) {
  const base = `${authorSurname(authorLabel)}${year || 'nd'}`;
  let key = base;
  let suffix = 0;

  while (usedKeys.has(key)) {
    suffix += 1;
    key = `${base}${String.fromCharCode(96 + suffix)}`;
  }

  usedKeys.add(key);
  return key;
}

function parseTitleFromCitationLine(citationLine) {
  const match = clean(citationLine).match(/\(\d{4}\)\.\s*(.+?)(?:\.\s*(?:https?:\/\/|\b(?:arXiv|NeurIPS|ICML|ACL|NAACL|EMNLP|CVPR|ICCV|AAAI|JMLR|Nature|Science)\b))/i);
  if (match) return match[1].replace(/\.$/, '').trim();

  const afterYear = clean(citationLine).split(/\(\d{4}\)\.\s*/)[1];
  if (!afterYear) return '';

  const withoutLink = afterYear.replace(/\s+https?:\/\/\S+/i, '').trim();
  const firstSentence = withoutLink.split(/\.\s+/)[0];
  return firstSentence.replace(/\.$/, '').trim();
}

function parseAuthorsFromCitationLine(citationLine) {
  const match = clean(citationLine).match(/^(.+?)\s*\(\d{4}\)/);
  return match ? match[1].trim() : 'Unknown authors';
}

function normalizeDoi(doi) {
  const raw = clean(doi);
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://doi.org/${raw.replace(/^doi:\s*/i, '')}`;
}

function extractLinkFromCitationLine(citationLine) {
  const urlMatch = String(citationLine || '').match(/https?:\/\/[^\s]+/i);
  return urlMatch ? urlMatch[0].replace(/[.,;)\]]+$/, '') : '';
}

function buildBibliographyBody(entry) {
  const authorPart = formatEntryForLatex(entry.authorLabel);
  const yearPart = entry.year || 'n.d.';
  const titlePart = formatEntryForLatex(entry.title || 'Untitled source');
  const venuePart = entry.venue ? ` \\emph{${formatEntryForLatex(entry.venue)}}.` : '.';
  const linkPart = entry.link ? ` \\url{${escapeUrlForLatex(entry.link)}}` : '';

  return `${authorPart} (${yearPart}). \\emph{${titlePart}}${venuePart}${linkPart}`;
}

function buildCitationEntry(citationLine, paper, usedKeys) {
  const canonical = paper ? formatCanonicalCitation(paper) : citationLine;
  const authorLabel = paper?.authors?.length ? formatAuthorList(paper.authors) : parseAuthorsFromCitationLine(canonical);
  const year = paper?.year || extractYearFromText(canonical);
  const title = clean(paper?.title) || parseTitleFromCitationLine(canonical);
  const venue = clean(paper?.venue) || '';
  const link =
    normalizeDoi(paper?.doi) || clean(paper?.url) || extractLinkFromCitationLine(canonical) || '';
  const key = makeCitationKey(authorLabel, year, usedKeys);

  return {
    key,
    authorLabel,
    year,
    title,
    venue,
    link,
    canonical,
    inTextNarrative: `${authorLabel} (${year || 'n.d.'})`,
    inTextParenthetical: `${authorLabel}, ${year || 'n.d.'}`,
    bibitemBody: buildBibliographyBody({ authorLabel, year, title, venue, link })
  };
}

export function buildCitationRegistry(referencesText, knownPapers = []) {
  const usedKeys = new Set();
  const entries = [];

  for (const line of parseReferenceEntries(referencesText)) {
    const match = findMatchingPaper(line, knownPapers);
    const validated = validateReferenceLine(line, match);
    if (!validated.valid || !validated.citation) continue;

    entries.push(buildCitationEntry(validated.citation, match, usedKeys));
  }

  return { entries };
}

export function buildBibliographyLatexSection(registry) {
  if (!registry?.entries?.length) {
    return `\n\\noindent ${formatEntryForLatex(
      'No verified references were provided. Unsupported claims should be labeled as assumptions.'
    )}\n`;
  }

  const width = Math.min(99, Math.max(9, registry.entries.length));
  const body = registry.entries
    .map(
      (entry) =>
        `  \\bibitem[${formatEntryForLatex(entry.inTextParenthetical)}]{${entry.key}} ${entry.bibitemBody}`
    )
    .join('\n');
  return `\n\\begin{thebibliography}{${width}}\n${body}\n\\end{thebibliography}\n`;
}

function ensureNatbibPreamble(latex) {
  const source = String(latex || '');
  if (!/\\documentclass\b/.test(source) || /\\usepackage(?:\[[^\]]*\])?\{natbib\}/.test(source)) {
    return source;
  }

  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const beginIndex = lines.findIndex((line) => /\\begin\{document\}/.test(line));
  if (beginIndex < 0) return source;

  let insertIndex = beginIndex;
  for (let index = beginIndex - 1; index >= 0; index -= 1) {
    if (/\\(usepackage|RequirePackage)\b/.test(lines[index])) {
      insertIndex = index + 1;
      break;
    }
  }

  lines.splice(insertIndex, 0, '\\usepackage[round,authoryear]{natbib}');
  return lines.join('\n');
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

function countInTextCitations(latex) {
  return (String(latex || '').match(/\\cite[tp]?\{[^}]+\}/g) || []).length;
}

export function formatProsePreservingCiteCommands(text) {
  const parts = String(text || '').split(/(\\cite[tp]?\{[^}]+\})/g);
  let result = '';

  for (const part of parts) {
    if (/^\\cite[tp]?\{/.test(part)) {
      if (result && !/\s$/.test(result)) {
        result += ' ';
      }
      result += part;
      continue;
    }

    result += formatEntryForLatex(part);
  }

  return result;
}

export function applyCitationFormattingToProse(text, registry, options = {}) {
  if (!registry?.entries?.length) {
    return String(text || '');
  }

  let result = replacePlainCitationsWithCitep(text, registry);

  if (options.injectIfMissing && !/\\cite[tp]?\{/.test(result)) {
    result = injectCitationsIfMissing(result, registry, {
      maxCites: options.maxCites || 3
    });
  }

  return result;
}

function findPlainCitationPatterns(text, registry) {
  const leftovers = [];

  for (const entry of registry.entries) {
    if (!entry.year) continue;

    const authorPattern = escapeRegex(entry.authorLabel).replace(/\s+et\s+al\\./i, '(?: et al\\.)?');
    const narrative = new RegExp(`${authorPattern}\\s*\\(\\s*${entry.year}\\s*\\)`);
    const parenthetical = new RegExp(`\\(\\s*${authorPattern}\\s*,\\s*${entry.year}\\s*\\)`);

    if ((narrative.test(text) || parenthetical.test(text)) && !text.includes(`\\citep{${entry.key}}`)) {
      leftovers.push(entry.inTextParenthetical);
    }
  }

  return leftovers;
}

export function validateInTextCitations(latex, registry) {
  const source = String(latex || '');
  const issues = [];
  const warnings = [];
  const keys = new Set((registry?.entries || []).map((entry) => entry.key));

  for (const match of source.matchAll(/\\cite[tp]?\{([^}]+)\}/g)) {
    for (const key of match[1].split(',').map((value) => value.trim()).filter(Boolean)) {
      if (keys.size && !keys.has(key)) {
        issues.push(`Unknown citation key "${key}" in the proposal.`);
      }
    }
  }

  if (registry?.entries?.length) {
    const leftovers = findPlainCitationPatterns(source, registry);
    for (const label of leftovers) {
      warnings.push(`Plain-text citation (${label}) should use \\citep{key} form.`);
    }

    const abstractBody = extractAbstractBody(source);
    if (abstractBody) {
      const abstractLeftovers = findPlainCitationPatterns(abstractBody, registry);
      for (const label of abstractLeftovers) {
        issues.push(`Abstract contains an unconverted plain-text citation (${label}).`);
      }
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    warnings,
    inTextCount: countInTextCitations(source)
  };
}

function extractAbstractBody(latex) {
  const source = String(latex || '');
  const sectionMatch = source.match(/\\section\*?\{Abstract\}([\s\S]*?)(?=\\section\*?\{|\\section\{|\\end\{document\})/i);
  if (sectionMatch) return sectionMatch[1];

  const envMatch = source.match(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/i);
  return envMatch ? envMatch[1] : '';
}

function enhanceAbstractCitationBody(body, registry) {
  let nextBody = scrubStandaloneCitationLeads(replacePlainCitationsWithCitep(body, registry));
  if (!/\\cite[tp]?\{/.test(nextBody)) {
    nextBody = injectCitationsIfMissing(nextBody, registry, {
      maxCites: Math.min(2, registry.entries.length)
    });
  }
  return nextBody.startsWith('\n') ? nextBody : `\n${nextBody}\n`;
}

function enhanceAbstractCitations(latex, registry) {
  if (!registry?.entries?.length) {
    return latex;
  }

  const sectionPattern = /(\\section\*?\{Abstract\})([\s\S]*?)(?=\\section\*?\{|\\section\{|\\end\{document\})/i;
  if (sectionPattern.test(latex)) {
    return latex.replace(sectionPattern, (full, heading, body) => `${heading}${enhanceAbstractCitationBody(body, registry)}`);
  }

  const envPattern = /(\\begin\{abstract\})([\s\S]*?)(\\end\{abstract\})/i;
  if (!envPattern.test(latex)) {
    return latex;
  }

  return latex.replace(envPattern, (full, open, body, close) => {
    const nextBody = enhanceAbstractCitationBody(body, registry);
    return `${open}${nextBody}${close}`;
  });
}

function replacePlainCitationsWithCitep(text, registry) {
  let result = String(text || '');

  for (const entry of registry.entries) {
    if (!entry.year) continue;

    const authorPattern = escapeRegex(entry.authorLabel).replace(/\s+et\s+al\\./i, '(?: et al\\.)?');
    const narrative = new RegExp(`${authorPattern}\\s*\\(\\s*${entry.year}\\s*\\)`, 'g');
    const parenthetical = new RegExp(`\\(\\s*${authorPattern}\\s*,\\s*${entry.year}\\s*\\)`, 'g');

    result = result.replace(narrative, `\\citep{${entry.key}}`);
    result = result.replace(parenthetical, `\\citep{${entry.key}}`);
  }

  return result;
}

export function scrubStandaloneCitationLeads(text) {
  return String(text || '')
    .replace(
      /^\s*This proposal builds on prior work, including \\citep\{[^}]+\}\.\s*$/gim,
      ''
    )
    .replace(
      /^\s*Prior work on this topic is grounded in \\citep\{[^}]+\}\.\s*$/gim,
      ''
    )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function injectCitationsIfMissing(sectionBody, registry, options = {}) {
  const maxCites = options.maxCites ?? 3;

  if (!registry.entries.length || /\\cite[tp]?\{/.test(sectionBody)) {
    return sectionBody;
  }

  const selected = registry.entries.slice(0, maxCites);
  const keys = selected.map((entry) => entry.key).join(', ');
  const sentences = sectionBody.match(/[^.!?]+[.!?]+/g) || [sectionBody];
  const first = sentences[0].trim();

  if (/prior work|\\cite[tp]?\{|building on prior work/i.test(sectionBody)) {
    return sectionBody;
  }

  const enhanced = first.replace(/[.!?]+\s*$/, '') + `, building on prior work \\citep{${keys}}.`;
  return [enhanced, ...sentences.slice(1)].join(' ');
}

function enhanceSectionCitations(latex, sectionPattern, registry, options = {}) {
  const pattern = new RegExp(
    `(\\\\section\\*?\\{${sectionPattern}[^}]*\\})([\\s\\S]*?)(?=\\\\section\\*?\\{|\\\\end\\{document\\})`,
    'i'
  );

  if (!pattern.test(latex)) {
    return latex;
  }

  return latex.replace(pattern, (full, heading, body) => {
    let nextBody = scrubStandaloneCitationLeads(replacePlainCitationsWithCitep(body, registry));
    if (options.injectIfMissing) {
      nextBody = injectCitationsIfMissing(nextBody, registry, {
        maxCites: options.maxCites ?? 3
      });
    }
    return `${heading}${nextBody.startsWith('\n') ? nextBody : `\n${nextBody}`}`;
  });
}

export function enforceCitationsInProposalLatex(latex, project = {}, registry, knownPapers = []) {
  const activeRegistry = registry?.entries?.length
    ? registry
    : buildCitationRegistry(project.references || '', knownPapers);

  if (!activeRegistry.entries.length) {
    const fallback = enforceReferencesInProposalLatex(latex, project.references || '');
    return {
      ...fallback,
      inTextCount: countInTextCitations(fallback.latex),
      bibliographyCount: 0,
      registry: activeRegistry
    };
  }

  let next = ensureNatbibPreamble(latex);
  next = enhanceSectionCitations(next, 'Motivation|Gap|Problem', activeRegistry, {
    injectIfMissing: true,
    maxCites: Math.min(3, activeRegistry.entries.length)
  });
  next = enhanceSectionCitations(next, 'Method|Workflow|Approach', activeRegistry, {
    injectIfMissing: true,
    maxCites: Math.min(2, activeRegistry.entries.length)
  });
  next = enhanceSectionCitations(next, 'Evaluation', activeRegistry, {
    injectIfMissing: false
  });
  next = enhanceAbstractCitations(next, activeRegistry);
  next = replacePlainCitationsWithCitep(next, activeRegistry);

  const bibliographyBody = buildBibliographyLatexSection(activeRegistry);
  const referencePatterns = ['References and Assumptions', 'References', 'Bibliography', 'Sources'];

  let referencesReplaced = false;
  for (const pattern of referencePatterns) {
    const result = replaceSectionBody(next, pattern, bibliographyBody);
    if (result.replaced) {
      next = result.latex;
      referencesReplaced = true;
      break;
    }
  }

  if (!referencesReplaced) {
    next = next.replace(/\\end\{document\}/i, `\n\\section{References}\n${bibliographyBody}\n\\end{document}`);
    referencesReplaced = true;
  }

  next = scrubStandaloneCitationLeads(next);

  return {
    latex: next,
    replaced: referencesReplaced,
    entryCount: activeRegistry.entries.length,
    inTextCount: countInTextCitations(next),
    bibliographyCount: activeRegistry.entries.length,
    registry: activeRegistry,
    validation: validateInTextCitations(next, activeRegistry)
  };
}

export function finalizeCitationValidation(latex, registry) {
  if (!registry?.entries?.length) {
    return {
      latex,
      validation: { ok: true, issues: [], warnings: [], inTextCount: countInTextCitations(latex) },
      inTextCount: countInTextCitations(latex)
    };
  }

  let next = enhanceAbstractCitations(latex, registry);
  next = replacePlainCitationsWithCitep(next, registry);
  const validation = validateInTextCitations(next, registry);

  return {
    latex: next,
    validation,
    inTextCount: countInTextCitations(next)
  };
}

export function appendInTextCitationNote(report, enforcement) {
  const base = clean(report) || '# Evaluation Report\n\nNo evaluation report returned.';
  if (!enforcement?.bibliographyCount) return base;

  const notes = [
    `- Bibliography rebuilt with ${enforcement.bibliographyCount} verified \\bibitem entr${enforcement.bibliographyCount === 1 ? 'y' : 'ies'}.`,
    `- In-text citations normalized to natbib \\citep{key} form (${enforcement.inTextCount || 0} in-text citation group(s) detected).`
  ];

  const validation = enforcement.validation;
  if (validation) {
    for (const issue of validation.issues || []) {
      notes.push(`- Citation issue: ${issue}`);
    }
    for (const warning of validation.warnings || []) {
      notes.push(`- Citation warning: ${warning}`);
    }
    if (validation.ok && !(validation.warnings || []).length) {
      notes.push('- Citation validation passed for in-text keys and abstract formatting.');
    }
  }

  return `${base}\n\n## In-Text Citations\n${notes.join('\n')}\n`;
}
