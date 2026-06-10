import { formatEntryForLatex } from './latexEscape.js';

const ITEMIZE_OPTIONS =
  '[leftmargin=*,itemsep=0.35em,parsep=0pt,topsep=0.35em,partopsep=0pt]';

export const RESOURCE_CATEGORIES = [
  {
    key: 'computing',
    label: 'Computing and Infrastructure',
    aliases: ['computing', 'compute', 'infrastructure', 'hardware'],
    keywords: [
      'gpu',
      'gpus',
      'cpu',
      'cluster',
      'hpc',
      'cloud',
      'a100',
      'v100',
      'cuda',
      'tectonic',
      'server',
      'workstation',
      'compute'
    ]
  },
  {
    key: 'software',
    label: 'Software and Development Tools',
    aliases: ['software', 'tools', 'tooling', 'development'],
    keywords: [
      'pytorch',
      'tensorflow',
      'huggingface',
      'transformers',
      'github',
      'codebase',
      'library',
      'framework',
      'python',
      'api',
      'sdk',
      'wandb',
      'weights',
      'tracking',
      'repository',
      'script'
    ]
  },
  {
    key: 'data',
    label: 'Data and Model Artifacts',
    aliases: ['data', 'datasets', 'dataset', 'models', 'artifacts'],
    keywords: [
      'dataset',
      'data',
      'checkpoint',
      'model',
      'corpus',
      'benchmark',
      'weights',
      'corpus',
      'corpora',
      'tokenizer',
      'annotation'
    ]
  },
  {
    key: 'personnel',
    label: 'Personnel and Expertise',
    aliases: ['personnel', 'staff', 'team', 'expertise'],
    keywords: [
      'advisor',
      'student',
      'collaborator',
      'mentor',
      'instructor',
      'researcher',
      'expertise',
      'supervision'
    ]
  },
  {
    key: 'budget',
    label: 'Budget and Institutional Support',
    aliases: ['budget', 'funding', 'support', 'institutional'],
    keywords: [
      'budget',
      'funding',
      'cost',
      'license',
      'subscription',
      'allocation',
      'institutional',
      'course',
      'credits',
      'stipend'
    ]
  },
  {
    key: 'other',
    label: 'Other Required Resources',
    aliases: ['other', 'misc', 'additional'],
    keywords: []
  }
];

const ALIAS_TO_KEY = new Map();
for (const category of RESOURCE_CATEGORIES) {
  ALIAS_TO_KEY.set(category.key, category.key);
  for (const alias of category.aliases) {
    ALIAS_TO_KEY.set(normalizeCategoryToken(alias), category.key);
  }
  ALIAS_TO_KEY.set(normalizeCategoryToken(category.label), category.key);
}

const INTRO_SENTENCE =
  'The following resources are required to execute the proposed research. The project scope is designed to remain feasible within available course and institutional support.';

const EMPTY_MESSAGE =
  'No resources have been specified. Identify computing infrastructure, software tooling, data or model artifacts, and any budget or institutional support needed to complete the work.';

function normalizeCategoryToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function stripListMarker(line) {
  return String(line || '')
    .replace(/^\s*[-*•]\s+/, '')
    .replace(/^\s*\d+[\).\]]\s+/, '')
    .trim();
}

function splitResourceLines(text) {
  return String(text || '')
    .split(/\n+/)
    .map((line) => stripListMarker(line))
    .filter(Boolean);
}

function detectCategoryHeader(line) {
  const raw = String(line || '').trim();
  if (!raw) return null;

  const patterns = [
    /^#{1,6}\s*(.+?)\s*:?\s*$/i,
    /^\[(.+?)\]\s*:?\s*$/i,
    /^(.+?)\s*:\s*$/i
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (!match?.[1]) continue;

    const token = normalizeCategoryToken(match[1]);
    const key = ALIAS_TO_KEY.get(token);
    if (key) return key;

    for (const category of RESOURCE_CATEGORIES) {
      const labelToken = normalizeCategoryToken(category.label);
      if (token === labelToken || token.startsWith(labelToken) || labelToken.startsWith(token)) {
        return category.key;
      }
    }
  }

  return null;
}

function detectInlineCategoryHeader(line) {
  const raw = String(line || '').trim();
  const match = raw.match(/^([^:]{2,80}):\s+(.+)$/);
  if (!match) return null;

  const token = normalizeCategoryToken(match[1]);
  const key = ALIAS_TO_KEY.get(token);
  if (!key) {
    for (const category of RESOURCE_CATEGORIES) {
      const labelToken = normalizeCategoryToken(category.label);
      if (token === labelToken || labelToken.includes(token) || token.includes(labelToken)) {
        return { key: category.key, item: match[2].trim() };
      }
    }
    return null;
  }

  return { key, item: match[2].trim() };
}

export function categorizeResourceEntry(entry) {
  const text = String(entry || '').trim();
  if (!text) return 'other';

  const haystack = normalizeCategoryToken(text);
  let bestKey = 'other';
  let bestScore = 0;

  for (const category of RESOURCE_CATEGORIES) {
    if (!category.keywords.length) continue;

    let score = 0;
    for (const keyword of category.keywords) {
      if (haystack.includes(keyword)) {
        score += keyword.length > 4 ? 2 : 1;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestKey = category.key;
    }
  }

  return bestKey;
}

function splitCommaSeparatedResources(text) {
  const raw = String(text || '').trim();
  if (!raw || !raw.includes(',')) return [];

  const parts = [];
  let current = '';
  let depth = 0;

  for (const char of raw) {
    if (char === '(') depth += 1;
    if (char === ')' && depth > 0) depth -= 1;

    if (char === ',' && depth === 0) {
      const piece = current.trim().replace(/^and\s+/i, '');
      if (piece) parts.push(piece);
      current = '';
      continue;
    }

    current += char;
  }

  const tail = current.trim().replace(/^and\s+/i, '');
  if (tail) parts.push(tail);
  return parts;
}

export function parseResourceGroups(text) {
  const groups = new Map(RESOURCE_CATEGORIES.map((category) => [category.key, []]));
  const lines = splitResourceLines(text);
  let explicitCategories = false;
  let currentCategory = null;

  for (const line of lines) {
    const trimmed = String(line || '').trim();
    if (!trimmed) continue;

    if (/:\s*$/.test(trimmed)) {
      const headerKey = detectCategoryHeader(trimmed);
      if (headerKey) {
        currentCategory = headerKey;
        explicitCategories = true;
        continue;
      }
    }

    const inlineHeader = detectInlineCategoryHeader(trimmed);
    if (inlineHeader) {
      explicitCategories = true;
      groups.get(inlineHeader.key).push(inlineHeader.item);
      currentCategory = inlineHeader.key;
      continue;
    }

    const markdownHeader = trimmed.match(/^#{1,6}\s+(.+)$/);
    if (markdownHeader) {
      const headerKey = detectCategoryHeader(markdownHeader[1]);
      if (headerKey) {
        currentCategory = headerKey;
        explicitCategories = true;
        continue;
      }
    }

    const item = stripListMarker(trimmed);
    if (!item) continue;

    const itemParts =
      !currentCategory && !detectInlineCategoryHeader(item) && item.includes(',')
        ? splitCommaSeparatedResources(item)
        : [item];

    for (const part of itemParts) {
      const cleaned = String(part || '').trim();
      if (!cleaned) continue;
      const category = currentCategory || categorizeResourceEntry(cleaned);
      groups.get(category).push(cleaned);
    }
  }

  if (!lines.length) {
    const paragraph = String(text || '').trim();
    if (paragraph) {
      const parts = splitCommaSeparatedResources(paragraph);
      const entries = parts.length ? parts : [paragraph];
      for (const entry of entries) {
        const category = categorizeResourceEntry(entry);
        groups.get(category).push(entry);
      }
    }
  }

  const nonEmpty = RESOURCE_CATEGORIES.filter((category) => groups.get(category.key).length);
  return { groups, categories: nonEmpty, explicitCategories };
}

export function normalizeResourcesField(resourcesText) {
  const original = String(resourcesText || '').trim();
  if (!original) {
    return { resources: '', categories: [], normalized: false };
  }

  const parsed = parseResourceGroups(original);
  const lines = [];

  for (const category of parsed.categories) {
    const items = parsed.groups.get(category.key) || [];
    if (!items.length) continue;

    for (const item of items) {
      lines.push(`${category.label}: ${ensureSentence(item)}`);
    }
  }

  if (!lines.length) {
    return { resources: original, categories: [], normalized: false };
  }

  const normalizedText = lines.join('\n');
  const changed = normalizeWhitespace(normalizedText) !== normalizeWhitespace(original);

  return {
    resources: normalizedText,
    categories: parsed.categories.map((category) => category.label),
    normalized: changed || parsed.explicitCategories
  };
}

function normalizeWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function ensureSentence(text) {
  const value = String(text || '').trim();
  if (!value) return '';
  if (/[.!?]$/.test(value)) return value;
  return `${value}.`;
}

function formatResourceLabelAndBody(entry) {
  const raw = String(entry || '').trim();
  if (!raw) return '';

  const colonMatch = raw.match(/^([^:]{2,80}):\s+(.+)$/);
  if (colonMatch && !detectCategoryHeader(`${colonMatch[1]}:`)) {
    const label = colonMatch[1].trim().replace(/\.$/, '');
    const body = ensureSentence(colonMatch[2].trim());
    return `\\textbf{${formatEntryForLatex(label)}.} ${formatEntryForLatex(body)}`;
  }

  const dashMatch = raw.match(/^([^—–-]{2,80})\s*[—–-]\s+(.+)$/);
  if (dashMatch) {
    const label = dashMatch[1].trim().replace(/\.$/, '');
    const body = ensureSentence(dashMatch[2].trim());
    return `\\textbf{${formatEntryForLatex(label)}.} ${formatEntryForLatex(body)}`;
  }

  return formatEntryForLatex(ensureSentence(raw));
}

export function buildResourcesLatexSection(resourcesText) {
  const parsed = parseResourceGroups(resourcesText);
  const sections = [];

  for (const category of parsed.categories) {
    const items = (parsed.groups.get(category.key) || []).filter(Boolean);
    if (!items.length) continue;

    const body = items
      .map((item) => `  \\item ${formatResourceLabelAndBody(item)}`)
      .join('\n');

    sections.push(
      `\\subsection*{${formatEntryForLatex(category.label)}}\n\\begin{itemize}${ITEMIZE_OPTIONS}\n${body}\n\\end{itemize}`
    );
  }

  if (!sections.length) {
    const paragraph = String(resourcesText || '').trim();
    if (!paragraph) {
      return `\n\\noindent ${formatEntryForLatex(EMPTY_MESSAGE)}\n`;
    }

    return `\n\\noindent ${formatEntryForLatex(INTRO_SENTENCE)}\\par\\vspace{0.6em}\n\\begin{itemize}${ITEMIZE_OPTIONS}\n  \\item ${formatResourceLabelAndBody(paragraph)}\n\\end{itemize}\n`;
  }

  return `\n\\noindent ${formatEntryForLatex(INTRO_SENTENCE)}\\par\\vspace{0.6em}\n${sections.join('\n\n')}\n`;
}

export function enforceResourcesInProposalLatex(latex, resourcesText) {
  const replacementBody = buildResourcesLatexSection(resourcesText);
  const pattern = new RegExp(
    '(\\\\section\\*?\\{Resources[^}]*\\})([\\s\\S]*?)(?=\\\\section\\*?\\{|\\\\end\\{document\\})',
    'i'
  );

  if (!pattern.test(latex)) {
    return { latex, replaced: false, entryCount: 0, categoryCount: 0 };
  }

  const parsed = parseResourceGroups(resourcesText);
  const entryCount = RESOURCE_CATEGORIES.reduce(
    (total, category) => total + (parsed.groups.get(category.key)?.length || 0),
    0
  );

  return {
    latex: latex.replace(pattern, `$1${replacementBody}`),
    replaced: true,
    entryCount: entryCount || (resourcesText ? 1 : 0),
    categoryCount: parsed.categories.length
  };
}
