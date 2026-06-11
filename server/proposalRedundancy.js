const FIELD_KEYS = ['problem', 'method', 'evaluation', 'timeline', 'resources'];
const MIN_SENTENCE_CHARS = 40;
const MIN_CROSS_FIELD_CHARS = 50;
const MIN_PARAGRAPH_CHARS = 60;

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeSentence(sentence) {
  return clean(sentence)
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function splitSentences(text) {
  const value = clean(text);
  if (!value) return [];

  const parts = value.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  return parts.map((part) => clean(part)).filter(Boolean);
}

export function dedupeSentencesAcrossBlocks(blocks) {
  const seen = new Set();
  const result = [];

  for (const block of blocks) {
    const sentences = splitSentences(block);
    const kept = [];

    for (const sentence of sentences) {
      const key = normalizeSentence(sentence);
      if (key.length >= MIN_SENTENCE_CHARS && seen.has(key)) continue;
      if (key.length >= MIN_SENTENCE_CHARS) seen.add(key);
      kept.push(sentence);
    }

    const next = kept.join(' ').trim();
    if (next) result.push(next);
  }

  return result;
}

function dedupeSentencesInText(text) {
  const sentences = splitSentences(text);
  if (!sentences.length) return text;

  const seen = new Set();
  const kept = [];

  for (const sentence of sentences) {
    const key = normalizeSentence(sentence);
    if (key.length < 20) {
      kept.push(sentence);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(sentence);
  }

  return kept.join(' ');
}

function findIntraFieldDuplicates(text, fieldName) {
  const sentences = splitSentences(text);
  const seen = new Map();
  const duplicates = [];

  for (const sentence of sentences) {
    const key = normalizeSentence(sentence);
    if (key.length < MIN_SENTENCE_CHARS) continue;

    if (seen.has(key)) {
      duplicates.push({
        field: fieldName,
        sentence: sentence.slice(0, 120),
        kind: 'intra-field'
      });
      continue;
    }

    seen.set(key, sentence);
  }

  return duplicates;
}

function findCrossFieldDuplicates(project = {}) {
  const bySentence = new Map();
  const duplicates = [];

  for (const field of FIELD_KEYS) {
    const text = clean(project[field]);
    if (!text) continue;

    for (const sentence of splitSentences(text)) {
      const key = normalizeSentence(sentence);
      if (key.length < MIN_CROSS_FIELD_CHARS) continue;

      const prior = bySentence.get(key);
      if (prior && prior.field !== field) {
        duplicates.push({
          fields: [prior.field, field],
          sentence: sentence.slice(0, 120),
          kind: 'cross-field'
        });
      } else if (!prior) {
        bySentence.set(key, { field, sentence });
      }
    }
  }

  return duplicates;
}

function stripLatexToPlain(text) {
  return clean(
    String(text || '')
      .replace(/\\cite[pt]?\{[^}]*\}/g, ' ')
      .replace(/\\textbf\{([^}]*)\}/g, '$1')
      .replace(/\\emph\{([^}]*)\}/g, '$1')
      .replace(/\\textit\{([^}]*)\}/g, '$1')
      .replace(/\\section\*?\{([^}]*)\}/g, '$1')
      .replace(/\\begin\{[^}]+\}/g, ' ')
      .replace(/\\end\{[^}]+\}/g, ' ')
      .replace(/\\[a-zA-Z@*]+\*?(\[[^\]]*\])?(\{[^}]*\})?/g, ' ')
      .replace(/[{}$\\]/g, ' ')
  );
}

function extractLatexParagraphs(latex) {
  const body = String(latex || '');
  const sections = body.split(/\\section\*?\{/i).slice(1);
  const paragraphs = [];

  for (const chunk of sections) {
    const content = chunk.replace(/^[^}]*\}/, '');
    const plain = stripLatexToPlain(content);
    const parts = plain.split(/\n{2,}|(?<=[.!?])\s{2,}/).map(clean).filter(Boolean);

    for (const part of parts) {
      if (part.length >= MIN_PARAGRAPH_CHARS) {
        paragraphs.push(part);
      }
    }
  }

  const abstractSectionMatch = body.match(
    /\\section\*?\{Abstract\}([\s\S]*?)(?=\\section\*?\{|\\section\{|\\end\{document\})/i
  );
  if (abstractSectionMatch) {
    const abstractPlain = stripLatexToPlain(abstractSectionMatch[1]);
    if (abstractPlain.length >= MIN_PARAGRAPH_CHARS) {
      paragraphs.push(abstractPlain);
    }
  } else {
    const abstractMatch = body.match(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/i);
    if (abstractMatch) {
      const abstractPlain = stripLatexToPlain(abstractMatch[1]);
      if (abstractPlain.length >= MIN_PARAGRAPH_CHARS) {
        paragraphs.push(abstractPlain);
      }
    }
  }

  return paragraphs;
}

function findLatexParagraphDuplicates(latex) {
  const paragraphs = extractLatexParagraphs(latex);
  const seen = new Map();
  const duplicates = [];

  for (const paragraph of paragraphs) {
    const key = normalizeSentence(paragraph);
    if (key.length < MIN_PARAGRAPH_CHARS) continue;

    const prior = seen.get(key);
    if (prior) {
      duplicates.push({
        kind: 'latex-paragraph',
        preview: paragraph.slice(0, 120)
      });
    } else {
      seen.set(key, paragraph);
    }
  }

  return duplicates;
}

export function validateProjectRedundancy(project = {}) {
  const issues = [];
  const warnings = [];
  const duplicates = [];

  for (const field of FIELD_KEYS) {
    const text = clean(project[field]);
    if (!text) continue;

    const intra = findIntraFieldDuplicates(text, field);
    duplicates.push(...intra);

    for (const item of intra) {
      warnings.push(`Repeated sentence in ${field}: "${item.sentence}"`);
    }
  }

  const cross = findCrossFieldDuplicates(project);
  duplicates.push(...cross);

  for (const item of cross) {
    warnings.push(
      `Same sentence appears in ${item.fields.join(' and ')}: "${item.sentence}"`
    );
  }

  return {
    ok: issues.length === 0,
    issues,
    warnings,
    duplicates,
    duplicateCount: duplicates.length
  };
}

export function validateLatexRedundancy(latex = '') {
  const duplicates = findLatexParagraphDuplicates(latex);
  const warnings = duplicates.map(
    (item) => `Repeated paragraph in final proposal: "${item.preview}"`
  );

  return {
    ok: warnings.length === 0,
    issues: [],
    warnings,
    duplicates,
    duplicateCount: duplicates.length
  };
}

export function prepareProjectForProposal(project = {}) {
  const cleaned = { ...project };

  for (const field of FIELD_KEYS) {
    const text = clean(project[field]);
    if (!text) continue;
    cleaned[field] = dedupeSentencesInText(text);
  }

  const validation = validateProjectRedundancy(cleaned);

  return {
    project: cleaned,
    validation,
    scrubbed: FIELD_KEYS.some((field) => clean(project[field]) !== clean(cleaned[field]))
  };
}

export function appendRedundancyNote(report = '', redundancy = {}) {
  const base = clean(report);
  const precheck = redundancy.precheck || {};
  const postcheck = redundancy.postcheck || {};
  const notes = [];

  if (precheck.scrubbed) {
    notes.push('- Duplicate sentences were removed from project fields before proposal generation.');
  }

  for (const warning of precheck.warnings || []) {
    notes.push(`- ${warning}`);
  }

  for (const issue of precheck.issues || []) {
    notes.push(`- ${issue}`);
  }

  for (const warning of postcheck.warnings || []) {
    notes.push(`- ${warning}`);
  }

  const checked = Boolean(redundancy.precheck) || Boolean(redundancy.postcheck);
  if (!notes.length && checked) {
    notes.push('- No redundant or repetitive sentences detected in project fields or final proposal.');
  }

  if (!notes.length) {
    return base;
  }

  return `${base}\n\n## Redundancy Check\n${notes.join('\n')}\n`;
}
