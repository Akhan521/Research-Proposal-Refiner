import { callModel, clean, parseJsonContent } from './proposalGenerator.js';

export const LITERATURE_SOURCES = {
  auto: { label: 'Auto (pick by topic)', id: 'auto' },
  semantic_scholar: { label: 'Semantic Scholar (CS)', id: 'semantic_scholar' },
  openalex: { label: 'OpenAlex (broad)', id: 'openalex' },
  arxiv: { label: 'arXiv (preprints)', id: 'arxiv' }
};

const DEFAULT_LIMIT = 8;

const ENRICH_SYSTEM_PROMPT = `You help ground a research proposal in real prior work.

Return strict JSON:
{
  "papers": [
    {
      "id": "stable id from input",
      "relevanceScore": 0-100,
      "relevanceNote": "one sentence on why this paper fits",
      "citation": "formatted citation string using only provided metadata"
    }
  ],
  "relatedWorkParagraph": "2-4 sentences describing prior work and the gap, citing only the provided papers",
  "gapNote": "one sentence on what gap remains"
}

Rules:
- Only use facts from the provided paper list. Do not invent papers or citations.
- Order papers by relevanceScore descending.
- citation must include title, authors, year, and URL or DOI when available.`;

export async function searchLiterature({ topic, problem, source = 'auto', limit = DEFAULT_LIMIT }) {
  const query = buildSearchQuery(topic, problem);
  const requested = normalizeSource(source);
  const resolvedSource = requested === 'auto' ? pickAutoSource(topic, problem) : requested;
  const cappedLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 3), 12);

  let { papers, resolvedSource: usedSource, fetchErrors } = await fetchWithFallback(resolvedSource, query, cappedLimit);

  if (!papers.length) {
    const fetchError = fetchErrors.join(' | ') || 'No papers returned.';
    return {
      mode: 'error',
      provider: usedSource,
      source: requested,
      resolvedSource: usedSource,
      query,
      papers: [],
      relatedWorkParagraph: '',
      gapNote: '',
      runMessage: `Literature search failed: ${fetchError}`,
      transcript: { query, resolvedSource: usedSource, fetchErrors }
    };
  }

  let relatedWorkParagraph = '';
  let gapNote = '';
  let mode = 'api';

  if (process.env.LLM_API_KEY && process.env.LLM_API_URL && papers.length) {
    const enriched = await enrichWithModel({ topic, problem, query, papers });
    papers = enriched.papers;
    relatedWorkParagraph = enriched.relatedWorkParagraph;
    gapNote = enriched.gapNote;
    mode = 'api';
  } else {
    papers = sortByCitationCount(papers).map((paper) => ({
      ...paper,
      relevanceScore: paper.citationCount || 0,
      relevanceNote: 'Ranked by citation count (local fallback).',
      citation: formatCitation(paper)
    }));
    relatedWorkParagraph = buildFallbackRelatedWork(topic, problem, papers);
    gapNote = 'Add more targeted search terms or enable the LLM API for a sharper gap analysis.';
    mode = papers.length ? 'local-fallback' : 'empty';
  }

  return {
    mode,
    provider: usedSource,
    source: requested,
    resolvedSource: usedSource,
    query,
    papers,
    relatedWorkParagraph,
    gapNote,
    runMessage: `Found ${papers.length} paper(s) via ${LITERATURE_SOURCES[usedSource]?.label || usedSource}.`,
    transcript: {
      query,
      resolvedSource: usedSource,
      paperCount: papers.length,
      fetchErrors
    }
  };
}

async function fetchWithFallback(primarySource, query, limit) {
  const fallbacks = {
    semantic_scholar: ['openalex', 'arxiv'],
    openalex: ['semantic_scholar', 'arxiv'],
    arxiv: ['openalex', 'semantic_scholar']
  };
  const chain = [primarySource, ...(fallbacks[primarySource] || ['openalex', 'arxiv'])];
  const fetchErrors = [];

  for (const source of chain) {
    try {
      const papers = await fetchFromSource(source, query, limit);
      if (papers.length) {
        return { papers, resolvedSource: source, fetchErrors };
      }
      fetchErrors.push(`${source}: no results`);
    } catch (error) {
      fetchErrors.push(`${source}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { papers: [], resolvedSource: primarySource, fetchErrors };
}

function buildSearchQuery(topic, problem) {
  const parts = [clean(topic), clean(problem)].filter(Boolean);
  const combined = parts.join(' ').replace(/\s+/g, ' ').trim();
  return combined.slice(0, 280) || 'research proposal agent';
}

function normalizeSource(source) {
  const key = clean(source).toLowerCase();
  return Object.hasOwn(LITERATURE_SOURCES, key) ? key : 'auto';
}

function pickAutoSource(topic, problem) {
  const text = `${topic} ${problem}`.toLowerCase();

  if (/\b(machine learning|deep learning|neural|llm|transformer|nlp|computer vision|reinforcement learning|arxiv|preprint)\b/.test(text)) {
    return 'arxiv';
  }

  if (/\b(biology|medicine|health|climate|social science|policy|education|psychology|economics|humanities)\b/.test(text)) {
    return 'openalex';
  }

  return 'semantic_scholar';
}

async function fetchFromSource(source, query, limit) {
  if (source === 'semantic_scholar') return searchSemanticScholar(query, limit);
  if (source === 'openalex') return searchOpenAlex(query, limit);
  if (source === 'arxiv') return searchArxiv(query, limit);
  throw new Error(`Unknown literature source: ${source}`);
}

async function searchSemanticScholar(query, limit) {
  const params = new URLSearchParams({
    query,
    limit: String(limit),
    fields: 'title,authors,year,venue,abstract,citationCount,externalIds,url'
  });

  const response = await fetch(`https://api.semanticscholar.org/graph/v1/paper/search?${params}`, {
    headers: { Accept: 'application/json' }
  });

  if (!response.ok) {
    throw new Error(`Semantic Scholar returned ${response.status}`);
  }

  const data = await response.json();
  const items = Array.isArray(data?.data) ? data.data : [];

  return items
    .map((item, index) =>
      normalizePaper({
    id: clean(item.paperId) || `s2-${index}`,
    title: item.title,
    authors: (item.authors || []).map((author) => clean(author.name)).filter(Boolean),
    year: item.year,
    venue: item.venue,
    abstract: item.abstract,
    citationCount: item.citationCount,
    url: item.url,
    doi: item.externalIds?.DOI,
    source: 'semantic_scholar'
      })
    )
    .filter(Boolean);
}

async function searchOpenAlex(query, limit) {
  const params = new URLSearchParams({
    search: query,
    per_page: String(limit)
  });

  const response = await fetch(`https://api.openalex.org/works?${params}`, {
    headers: { Accept: 'application/json' }
  });

  if (!response.ok) {
    throw new Error(`OpenAlex returned ${response.status}`);
  }

  const data = await response.json();
  const items = Array.isArray(data?.results) ? data.results : [];

  return items
    .map((item, index) => {
    const authors = (item.authorships || [])
      .map((authorship) => clean(authorship?.author?.display_name))
      .filter(Boolean);

    return normalizePaper({
      id: clean(item.id) || `openalex-${index}`,
      title: item.display_name || item.title,
      authors,
      year: item.publication_year,
      venue: item.host_venue?.display_name || item.primary_location?.source?.display_name,
      abstract: reconstructOpenAlexAbstract(item.abstract_inverted_index),
      citationCount: item.cited_by_count,
      url: item.doi ? `https://doi.org/${String(item.doi).replace(/^https?:\/\/doi\.org\//i, '')}` : item.id,
      doi: item.doi,
      source: 'openalex'
    });
  })
    .filter(Boolean);
}

async function searchArxiv(query, limit) {
  const params = new URLSearchParams({
    search_query: `all:${query}`,
    start: '0',
    max_results: String(limit)
  });

  const response = await fetch(`https://export.arxiv.org/api/query?${params}`);

  if (!response.ok) {
    throw new Error(`arXiv returned ${response.status}`);
  }

  const xml = await response.text();
  return parseArxivFeed(xml);
}

function parseArxivFeed(xml) {
  const entries = [];
  const entryBlocks = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];

  entryBlocks.forEach((block, index) => {
    const title = decodeXmlText(extractTag(block, 'title'));
    const summary = decodeXmlText(extractTag(block, 'summary'));
    const published = extractTag(block, 'published');
    const year = published ? Number(published.slice(0, 4)) : '';
    const idUrl = extractTag(block, 'id');
    const authors = [...block.matchAll(/<name>([^<]*)<\/name>/g)].map((match) => decodeXmlText(match[1]));

    const paper = normalizePaper({
        id: idUrl || `arxiv-${index}`,
        title,
        authors,
        year,
        venue: 'arXiv',
        abstract: summary,
        citationCount: 0,
        url: idUrl,
        doi: '',
        source: 'arxiv'
    });

    if (paper) entries.push(paper);
  });

  return entries;
}

function extractTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match?.[1]?.trim() || '';
}

function decodeXmlText(value) {
  return clean(value)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function reconstructOpenAlexAbstract(invertedIndex) {
  if (!invertedIndex || typeof invertedIndex !== 'object') return '';

  const words = [];

  Object.entries(invertedIndex).forEach(([word, positions]) => {
    if (!Array.isArray(positions)) return;
    positions.forEach((position) => {
      words[position] = word;
    });
  });

  return words.filter(Boolean).join(' ').trim();
}

function normalizePaper(paper) {
  const title = clean(paper.title);
  if (!title) return null;

  return {
    id: clean(paper.id) || title.slice(0, 40),
    title,
    authors: Array.isArray(paper.authors) ? paper.authors.map(clean).filter(Boolean) : [],
    year: paper.year || '',
    venue: clean(paper.venue),
    abstract: clean(paper.abstract).slice(0, 600),
    citationCount: Number(paper.citationCount) || 0,
    url: clean(paper.url),
    doi: clean(paper.doi),
    source: paper.source,
    citation: formatCitation({
      title,
      authors: paper.authors,
      year: paper.year,
      venue: paper.venue,
      url: paper.url,
      doi: paper.doi
    })
  };
}

function formatCitation(paper) {
  const authors = formatAuthors(paper.authors);
  const year = paper.year ? ` (${paper.year})` : '';
  const venue = paper.venue ? `. ${paper.venue}` : '';
  const link = paper.doi || paper.url;
  const linkPart = link ? `. ${link}` : '';

  return `${authors}${year}. ${paper.title}${venue}${linkPart}`.trim();
}

function formatAuthors(authors = []) {
  if (!authors.length) return 'Unknown authors';
  if (authors.length === 1) return authors[0];
  if (authors.length === 2) return `${authors[0]} and ${authors[1]}`;
  return `${authors[0]} et al.`;
}

async function enrichWithModel({ topic, problem, query, papers }) {
  const model = clean(process.env.LLM_MODEL);

  if (!model) {
    throw new Error('LLM_MODEL is required when LLM_API_KEY and LLM_API_URL are configured.');
  }

  const payload = {
    topic,
    problem,
    query,
    papers: papers.map((paper) => ({
      id: paper.id,
      title: paper.title,
      authors: paper.authors,
      year: paper.year,
      venue: paper.venue,
      abstract: paper.abstract,
      citationCount: paper.citationCount,
      url: paper.url,
      doi: paper.doi,
      source: paper.source
    }))
  };

  const content = await callModel({
    systemPrompt: ENRICH_SYSTEM_PROMPT,
    payload,
    model,
    temperature: 0.2
  });
  const parsed = parseJsonContent(content);
  const enrichedMap = new Map();

  if (Array.isArray(parsed.papers)) {
    parsed.papers.forEach((row) => {
      const id = clean(row.id);
      if (!id) return;
      enrichedMap.set(id, {
        relevanceScore: Number(row.relevanceScore) || 0,
        relevanceNote: clean(row.relevanceNote),
        citation: clean(row.citation)
      });
    });
  }

  const merged = papers
    .map((paper) => {
      const extra = enrichedMap.get(paper.id) || {};
      return {
        ...paper,
        relevanceScore: extra.relevanceScore ?? paper.citationCount ?? 0,
        relevanceNote: extra.relevanceNote || 'Relevant to the stated topic.',
        citation: extra.citation || paper.citation
      };
    })
    .sort((left, right) => (right.relevanceScore || 0) - (left.relevanceScore || 0));

  return {
    papers: merged,
    relatedWorkParagraph: clean(parsed.relatedWorkParagraph) || buildFallbackRelatedWork(topic, problem, merged),
    gapNote: clean(parsed.gapNote) || 'Review whether the gap matches your specific contribution.'
  };
}

function sortByCitationCount(papers) {
  return [...papers].sort((left, right) => (right.citationCount || 0) - (left.citationCount || 0));
}

function buildFallbackRelatedWork(topic, problem, papers) {
  if (!papers.length) {
    return 'No papers were retrieved. Try a different source or narrower search terms.';
  }

  const lead = papers.slice(0, 2).map((paper) => paper.title).join('; ');
  return `Prior work on ${topic || 'this topic'} includes studies such as ${lead}. ${problem || 'The proposal problem'} suggests there is still room to compare methods, evaluation, and scope against this literature base.`;
}
