function clean(value) {
  return String(value ?? '').trim();
}

function normalizeDoi(doi) {
  const raw = clean(doi);
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://doi.org/${raw.replace(/^doi:\s*/i, '')}`;
}

function formatAuthorList(authors = []) {
  const list = authors.map(clean).filter(Boolean);
  if (!list.length) return 'Unknown authors';
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list[0]} et al.`;
}

export function formatCanonicalCitation(paper) {
  const title = clean(paper?.title);
  if (!title) return '';

  const authors = formatAuthorList(paper?.authors);
  const year = paper?.year ? ` (${paper.year}).` : '.';
  const venue = clean(paper?.venue) ? ` ${clean(paper.venue)}.` : '';
  const link = normalizeDoi(paper?.doi) || clean(paper?.url);
  const linkPart = link ? ` ${link}` : '';

  return `${authors}${year} ${title}.${venue}${linkPart}`.replace(/\s+/g, ' ').trim();
}

export function parseReferenceEntries(referencesText) {
  return String(referencesText || '')
    .split(/\n+/)
    .map((line) => line.replace(/^\s*[-*•\d.)]+\s*/, '').trim())
    .filter(Boolean);
}

function normalizeTitleKey(title) {
  return clean(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function extractDoiFromText(text) {
  const match = String(text || '').match(/(?:doi\.org\/|doi:\s*)(10\.\S+)/i);
  return match ? match[1].replace(/[.,;)\]]+$/, '') : '';
}

function extractYearFromText(text) {
  const match = String(text || '').match(/\((\d{4})\)|\b(19|20)\d{2}\b/);
  return match ? match[1] || match[0] : '';
}

export function findMatchingPaper(referenceLine, knownPapers = []) {
  const line = clean(referenceLine);
  if (!line || !Array.isArray(knownPapers) || !knownPapers.length) return null;

  const lineDoi = extractDoiFromText(line);
  if (lineDoi) {
    const doiMatch = knownPapers.find((paper) => {
      const paperDoi = clean(paper?.doi).replace(/^https?:\/\/doi.org\//i, '');
      return paperDoi && paperDoi.toLowerCase() === lineDoi.toLowerCase();
    });
    if (doiMatch) return doiMatch;
  }

  const exactCitation = knownPapers.find((paper) => {
    const citation = clean(paper?.citation);
    return citation && (line === citation || line.includes(citation) || citation.includes(line));
  });
  if (exactCitation) return exactCitation;

  const lineKey = normalizeTitleKey(line);
  let best = null;
  let bestScore = 0;

  for (const paper of knownPapers) {
    const titleKey = normalizeTitleKey(paper?.title);
    if (!titleKey) continue;

    if (lineKey.includes(titleKey) || titleKey.includes(lineKey)) {
      const score = Math.min(lineKey.length, titleKey.length);
      if (score > bestScore) {
        best = paper;
        bestScore = score;
      }
    }
  }

  return best;
}

export function validateReferenceLine(referenceLine, knownPaper = null) {
  const text = clean(referenceLine);
  if (!text) {
    return { valid: false, reason: 'empty' };
  }

  if (knownPaper) {
    const canonical = formatCanonicalCitation(knownPaper);
    return {
      valid: Boolean(canonical),
      citation: canonical,
      matched: true,
      reason: canonical ? 'matched retrieved source' : 'missing metadata'
    };
  }

  if (text.length < 24) {
    return { valid: false, reason: 'too short' };
  }

  const year = extractYearFromText(text);
  if (!year) {
    return { valid: false, reason: 'missing publication year' };
  }

  const hasIdentifier = /(https?:\/\/|doi\.org|10\.\d{4,}\/)/i.test(text);
  const hasTitleLikeContent = text.split(/\s+/).length >= 6;

  if (!hasIdentifier && !hasTitleLikeContent) {
    return { valid: false, reason: 'missing URL/DOI or sufficient source detail' };
  }

  return {
    valid: true,
    citation: text,
    matched: false,
    reason: 'manual entry passed structural checks'
  };
}

export function normalizeReferencesField(referencesText, knownPapers = []) {
  const entries = parseReferenceEntries(referencesText);
  const normalized = [];
  const seen = new Set();
  const report = {
    kept: 0,
    replaced: 0,
    dropped: 0,
    warnings: []
  };

  for (const entry of entries) {
    const match = findMatchingPaper(entry, knownPapers);
    const validated = validateReferenceLine(entry, match);

    if (!validated.valid || !validated.citation) {
      report.dropped += 1;
      report.warnings.push(`Dropped unverified reference: ${entry.slice(0, 96)}${entry.length > 96 ? '…' : ''}`);
      continue;
    }

    if (validated.matched && validated.citation !== entry) {
      report.replaced += 1;
    } else {
      report.kept += 1;
    }

    const key = normalizeTitleKey(validated.citation);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);

    normalized.push(validated.citation);
  }

  return {
    references: normalized.join('\n'),
    report
  };
}

export { buildReferencesLatexSection, enforceReferencesInProposalLatex } from './latexLayout.js';

export function appendReferenceValidationNote(report, validationReport, enforcement) {
  const base = clean(report) || '# Evaluation Report\n\nNo evaluation report returned.';
  const notes = [];

  if (validationReport) {
    if (validationReport.replaced > 0) {
      notes.push(
        `- Replaced ${validationReport.replaced} reference line(s) with canonical citations cross-checked against retrieved paper metadata.`
      );
    }
    if (validationReport.dropped > 0) {
      notes.push(`- Removed ${validationReport.dropped} unverified reference line(s) that could not be validated.`);
    }
    if (validationReport.warnings.length) {
      notes.push(...validationReport.warnings.slice(0, 4).map((warning) => `- ${warning}`));
    }
  }

  if (enforcement?.replaced) {
    notes.push(
      `- References section in the proposal was rebuilt from verified Sources only (${enforcement.entryCount} entr${enforcement.entryCount === 1 ? 'y' : 'ies'}).`
    );
  }

  if (!notes.length) {
    return base;
  }

  return `${base}\n\n## Reference Validation\n${notes.join('\n')}\n`;
}
