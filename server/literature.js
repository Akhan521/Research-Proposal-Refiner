import { callModel, clean, parseJsonContent, resolveLlmModel } from './proposalGenerator.js';

export const LITERATURE_SOURCES = {
  auto: { label: 'Default (auto-pick)', id: 'auto' },
  semantic_scholar: { label: 'Semantic Scholar (CS)', id: 'semantic_scholar' },
  openalex: { label: 'OpenAlex (broad)', id: 'openalex' },
  arxiv: { label: 'arXiv (preprints)', id: 'arxiv' }
};

const DEFAULT_LIMIT = 8;
const SUMMARY_MAX_SENTENCES = 12;

function getSummarySentenceLimit(paperCount) {
  if (paperCount <= 1) return 4;
  return Math.min(SUMMARY_MAX_SENTENCES, paperCount + 2);
}

const ENRICH_SYSTEM_PROMPT = `You help ground a research proposal in real prior work.

Return strict JSON:
{
  "papers": [
    {
      "id": "stable id from input",
      "relevanceScore": 0-100,
      "relevanceNote": "one sentence on why this paper fits the user's topic/problem (topical fit only—never mention citation counts or ranking)",
      "citation": "formatted citation string using only provided metadata"
    }
  ],
  "relatedWorkParagraph": "One flowing paragraph, typically 6-12 complete sentences (hard max 12). Use author-year citations (e.g., Smith et al. (2023)), never truncate with ellipses, and write complete ideas only—plain prose suitable for pasting into a problem statement. Give each retrieved paper a distinct mention.",
  "gapNote": "One brief sentence on what may still be open for the proposal"
}

Rules:
- Only use facts from the provided paper list. Do not invent papers or citations.
- Never use ellipses (...) or cut off mid-sentence. Every sentence must be grammatically complete.
- relatedWorkParagraph must read as a synthesis of retrieved papers that may be relevant—not a formal prior-work review.
- Order papers by relevanceScore descending.
- citation must include title, authors, year, and URL or DOI when available.`;

export async function searchLiterature({ topic, problem, source = 'auto', limit = DEFAULT_LIMIT, llmModel }) {
  const query = buildSearchQuery(topic, problem);
  const requested = normalizeSource(source);
  const intendedSource = requested === 'auto' ? pickAutoSource(topic, problem) : requested;
  const cappedLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 3), 12);

  let { papers, resolvedSource: usedSource, fetchErrors } = await fetchWithFallback(intendedSource, query, cappedLimit);
  const didFallback = usedSource !== intendedSource;
  const fallbackSummary = buildFallbackSummary({ requested, intendedSource, usedSource, didFallback, fetchErrors });

  papers = sortByCitationCount(papers);

  if (!papers.length) {
    const fetchError = fetchErrors.join(' | ') || 'No papers returned.';
    return {
      mode: 'error',
      provider: usedSource,
      source: requested,
      requestedSource: requested,
      intendedSource,
      resolvedSource: usedSource,
      didFallback,
      fallbackSummary,
      query,
      papers: [],
      relatedWorkParagraph: '',
      gapNote: '',
      runMessage: `Literature search failed: ${fetchError}`,
      transcript: { query, intendedSource, resolvedSource: usedSource, fetchErrors }
    };
  }

  let relatedWorkParagraph = '';
  let gapNote = '';
  let mode = 'local-fallback';
  let rankingMethod = 'citations';
  let enrichNote = '';

  const skipEnrich = /^1|true|yes$/i.test(clean(process.env.LITERATURE_SKIP_ENRICH));

  if (process.env.LLM_API_KEY && process.env.LLM_API_URL && papers.length && !skipEnrich) {
    try {
      const enriched = await enrichWithModel({ topic, problem, query, papers, llmModel });
      papers = enriched.papers;
      relatedWorkParagraph = enriched.relatedWorkParagraph;
      gapNote = enriched.gapNote;
      mode = 'api';
      rankingMethod = enriched.rankingMethod;
    } catch (error) {
      enrichNote = error instanceof Error ? error.message : String(error);
      papers = applyLocalRanking(papers, { topic, problem, query });
      relatedWorkParagraph = buildFallbackRelatedWork(topic, problem, papers);
      gapNote =
        'AI ranking was unavailable. Papers are ordered by citation count (highest first), then by year.';
      mode = 'local-fallback';
      rankingMethod = 'citations';
    }
  } else {
    papers = applyLocalRanking(papers, { topic, problem, query });
    relatedWorkParagraph = buildFallbackRelatedWork(topic, problem, papers);
    gapNote = skipEnrich
      ? 'Papers are ordered by citation count (highest first), then by year.'
      : 'Papers are ordered by citation count. Add an LLM API key for topic-specific ranking.';
    mode = papers.length ? 'local-fallback' : 'empty';
    rankingMethod = 'citations';
  }

  relatedWorkParagraph = finalizeRelatedWorkSummary(relatedWorkParagraph, topic, problem, papers);
  gapNote = isOperationalGapNote(gapNote) ? '' : clampSummarySentences(gapNote, 1);

  const enrichHint = enrichNote ? ` LLM ranking skipped (${enrichNote.slice(0, 120)}).` : '';
  const relevanceContext = { topic, problem, query };

  papers = papers.map((paper) => {
    const note = clean(paper.relevanceNote);
    if (!note || isCitationOnlyRelevanceNote(note)) {
      return { ...paper, relevanceNote: buildLocalRelevanceNote(paper, relevanceContext) };
    }
    return { ...paper, relevanceNote: note };
  });

  return {
    mode,
    rankingMethod,
    topic: clean(topic),
    problem: clean(problem),
    provider: usedSource,
    source: requested,
    requestedSource: requested,
    intendedSource,
    resolvedSource: usedSource,
    didFallback,
    fallbackSummary,
    query,
    papers,
    relatedWorkParagraph,
    gapNote,
    runMessage: didFallback
      ? `Found ${papers.length} paper(s). ${fallbackSummary}${enrichHint}`
      : `Found ${papers.length} paper(s) via ${LITERATURE_SOURCES[usedSource]?.label || usedSource}.${enrichHint}`,
    transcript: {
      query,
      intendedSource,
      resolvedSource: usedSource,
      paperCount: papers.length,
      fetchErrors,
      enrichNote
    }
  };
}

function buildFallbackSummary({ requested, intendedSource, usedSource, didFallback, fetchErrors }) {
  if (!didFallback) {
    return '';
  }

  const usedLabel = LITERATURE_SOURCES[usedSource]?.label || usedSource;
  const intendedLabel = LITERATURE_SOURCES[intendedSource]?.label || intendedSource;
  const requestedLabel = LITERATURE_SOURCES[requested]?.label || requested;
  const intendedReason = describeSourceFailure(fetchErrors, intendedSource);

  if (requested === 'auto') {
    return `We picked ${intendedLabel} for your topic, but ${intendedReason} Results are from ${usedLabel}.`;
  }

  return `You selected ${requestedLabel}, but ${intendedReason} Results below are from ${usedLabel}.`;
}

function describeSourceFailure(fetchErrors, sourceKey) {
  const line = (fetchErrors || []).find((entry) => entry.startsWith(`${sourceKey}:`));
  const detail = line ? line.slice(line.indexOf(':') + 1).trim().toLowerCase() : '';

  if (detail.includes('rate limited') || detail.includes('429')) {
    return 'it is temporarily rate-limited.';
  }

  if (detail.includes('no results')) {
    return 'it returned no matches for this topic.';
  }

  if (detail.includes('timeout')) {
    return 'the request timed out.';
  }

  return 'it was unavailable.';
}

function sanitizeSearchQuery(query) {
  return clean(query).replace(/\s+/g, ' ').trim();
}

function sanitizeArxivQuery(query) {
  return sanitizeSearchQuery(query)
    .replace(/[^\w\s.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const RELEVANCE_STOP_WORDS = new Set([
  'about',
  'after',
  'also',
  'among',
  'based',
  'been',
  'being',
  'between',
  'both',
  'could',
  'from',
  'have',
  'into',
  'more',
  'other',
  'over',
  'such',
  'than',
  'that',
  'their',
  'there',
  'these',
  'they',
  'this',
  'through',
  'using',
  'were',
  'what',
  'when',
  'where',
  'which',
  'while',
  'with',
  'within',
  'without',
  'your',
  'research',
  'study',
  'paper',
  'papers',
  'work',
  'proposal',
  'project'
]);

function applyLocalRanking(papers, context = {}) {
  return sortByCitationCount(papers).map((paper) => ({
    ...paper,
    relevanceScore: paper.citationCount || 0,
    relevanceNote: buildLocalRelevanceNote(paper, context),
    citation: paper.citation || formatCitation(paper)
  }));
}

function extractRelevanceKeywords(text) {
  const tokens = clean(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !RELEVANCE_STOP_WORDS.has(token));

  return [...new Set(tokens)].slice(0, 12);
}

function formatKeywordList(words) {
  if (!words.length) return '';
  if (words.length === 1) return words[0];
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words.slice(0, -1).join(', ')}, and ${words.at(-1)}`;
}

function trimAtWordBoundary(text, maxLength) {
  const value = clean(text);
  if (!value || value.length <= maxLength) return value;

  const slice = value.slice(0, maxLength);
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > maxLength * 0.55 ? slice.slice(0, lastSpace) : slice).trim();
}

function summarizeTopicLabel(topic, problem) {
  const topicText = clean(topic);
  if (topicText) {
    return trimAtWordBoundary(topicText, 100) || topicText;
  }

  return trimAtWordBoundary(shortenProblemSnippet(problem, 100), 100) || 'your topic';
}

function shortenProblemSnippet(problem, maxLength = 90) {
  const text = clean(problem);
  if (!text) return '';

  const firstSentence = (text.split(/(?<=[.!?])\s+/)[0] || text).trim();
  return trimAtWordBoundary(firstSentence, maxLength);
}

function summarizeResearchFocus(topic, problem) {
  const topicLabel = summarizeTopicLabel(topic, problem);
  const problemSnippet = shortenProblemSnippet(problem, 55);

  if (
    problemSnippet &&
    topicLabel &&
    !topicLabel.toLowerCase().includes(problemSnippet.slice(0, 24).toLowerCase())
  ) {
    return `${topicLabel}, with emphasis on ${problemSnippet}`;
  }

  return topicLabel;
}

function classifyPaperKind(paper) {
  const text = `${paper.title || ''} ${paper.abstract || ''}`.toLowerCase();

  if (/\b(systematic review|scoping review|literature review|meta-analysis|meta analysis)\b/.test(text)) {
    return 'review';
  }

  if (/\b(survey|state of the art|state-of-the-art)\b/.test(text)) {
    return 'survey';
  }

  if (/\b(framework|methodology|methods|algorithm|architecture|pipeline|model)\b/.test(text)) {
    return 'methods';
  }

  return 'study';
}

function firstAbstractSentence(abstract, maxLength = 150) {
  const trimmed = clean(abstract);
  if (!trimmed) return '';

  const sentence = trimmed.split(/(?<=[.!?])\s+/)[0] || trimmed;
  return sentence.length > maxLength ? `${sentence.slice(0, maxLength - 1).trim()}…` : sentence;
}

function buildLocalRelevanceNote(paper, { topic = '', problem = '', query = '' } = {}) {
  const focus = summarizeResearchFocus(topic, problem);
  const keywords = extractRelevanceKeywords(`${topic} ${problem} ${query}`);
  const corpus = `${paper.title || ''} ${paper.abstract || ''} ${paper.venue || ''}`.toLowerCase();
  const matched = keywords.filter((word) => corpus.includes(word));

  if (matched.length >= 2) {
    return `Connects to ${formatKeywordList(matched.slice(0, 3))}—core themes in ${focus}.`;
  }

  if (matched.length === 1) {
    return `Centers on ${matched[0]}, which directly overlaps with ${focus}.`;
  }

  const kind = classifyPaperKind(paper);
  const yearPrefix = paper.year ? ` (${paper.year})` : '';

  if (kind === 'review') {
    return `A${yearPrefix} review synthesizing prior work you can cite when framing ${focus}.`;
  }

  if (kind === 'survey') {
    return `A${yearPrefix} survey that maps existing approaches related to ${focus}.`;
  }

  if (kind === 'methods') {
    return `Introduces methods or tools that may inform how you tackle ${focus}.`;
  }

  const lead = firstAbstractSentence(paper.abstract);
  if (lead) {
    const normalized = lead.charAt(0).toLowerCase() + lead.slice(1);
    return `Investigates ${normalized}. Relevant background for ${focus}.`;
  }

  const shortTitle = clean(paper.title);
  if (shortTitle) {
    return `"${shortTitle.length > 90 ? `${shortTitle.slice(0, 87)}…` : shortTitle}" surfaced for your search and may inform ${focus}.`;
  }

  return `Returned for your literature search on ${focus}.`;
}

async function fetchWithFallback(primarySource, query, limit) {
  const fallbacks = {
    semantic_scholar: ['openalex', 'arxiv'],
    openalex: ['arxiv', 'semantic_scholar'],
    arxiv: ['openalex', 'semantic_scholar']
  };
  const chain = [primarySource, ...(fallbacks[primarySource] || ['openalex', 'arxiv'])];
  const fetchErrors = [];

  for (const source of chain) {
    try {
      const papers = await fetchPapersFromSource(source, query, limit);
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
  const parts = [clean(topic), shortenProblemSnippet(problem, 120)].filter(Boolean);
  const combined = parts.join(' ').replace(/\s+/g, ' ').trim();
  return combined.slice(0, 280) || 'research proposal agent';
}

function normalizeSource(source) {
  const key = clean(source).toLowerCase();
  return Object.hasOwn(LITERATURE_SOURCES, key) ? key : 'auto';
}

function pickAutoSource(topic, problem) {
  const text = `${topic} ${problem}`.toLowerCase();

  if (/\b(machine learning|deep learning|neural|llm|transformer|nlp|computer vision|reinforcement learning|preprint)\b/.test(text)) {
    return 'openalex';
  }

  if (/\b(biology|medicine|health|climate|social science|policy|education|psychology|economics|humanities)\b/.test(text)) {
    return 'openalex';
  }

  return 'openalex';
}

const FETCH_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Research-Proposal-Refiner/1.0 (educational; contact via course project)'
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(label, requestFn, retries = 2) {
  let lastError;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await requestFn();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const retryable = /429|503|502|timeout/i.test(message);

      if (!retryable || attempt === retries - 1) {
        throw error;
      }

      await sleep(1500 * (attempt + 1));
    }
  }

  throw lastError;
}

async function fetchPapersFromSource(source, query, limit) {
  let papers = await fetchFromSource(source, query, limit);

  if (papers.length) {
    return papers;
  }

  const shortened = shortenQuery(query);

  if (shortened && shortened !== query) {
    papers = await fetchFromSource(source, shortened, limit);
  }

  return papers;
}

function shortenQuery(query) {
  const words = sanitizeSearchQuery(query).split(' ').filter(Boolean);
  return words.slice(0, 6).join(' ');
}

async function fetchFromSource(source, query, limit) {
  if (source === 'semantic_scholar') return searchSemanticScholar(query, limit);
  if (source === 'openalex') return searchOpenAlex(query, limit);
  if (source === 'arxiv') return searchArxiv(query, limit);
  throw new Error(`Unknown literature source: ${source}`);
}

async function searchSemanticScholar(query, limit) {
  const params = new URLSearchParams({
    query: sanitizeSearchQuery(query),
    limit: String(limit),
    fields: 'title,authors,year,venue,abstract,citationCount,externalIds,url'
  });

  const apiKey = clean(process.env.SEMANTIC_SCHOLAR_API_KEY);
  const headers = { ...FETCH_HEADERS };

  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }

  const response = await fetchWithRetry('Semantic Scholar', () =>
    fetch(`https://api.semanticscholar.org/graph/v1/paper/search?${params}`, { headers })
  );

  if (!response.ok) {
    const detail = response.status === 429 ? 'rate limited' : `HTTP ${response.status}`;
    throw new Error(`Semantic Scholar ${detail}`);
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

  const response = await fetchWithRetry('OpenAlex', () =>
    fetch(`https://api.openalex.org/works?${params}`, { headers: FETCH_HEADERS })
  );

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
  const safeQuery = sanitizeArxivQuery(query);
  const params = new URLSearchParams({
    search_query: `all:${safeQuery}`,
    start: '0',
    max_results: String(limit)
  });

  const response = await fetchWithRetry('arXiv', () =>
    fetch(`https://export.arxiv.org/api/query?${params}`, { headers: FETCH_HEADERS })
  );

  if (!response.ok) {
    const detail = response.status === 429 ? 'rate limited' : `HTTP ${response.status}`;
    throw new Error(`arXiv ${detail}`);
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

  return sanitizeLiteratureAbstract(words.filter(Boolean).join(' ').trim());
}

function isLowQualityAbstract(text) {
  const value = clean(text);
  if (!value) return true;

  const lower = value.toLowerCase();
  if (/^(contents|table of contents)\b/.test(lower)) return true;
  if (/\bcontents\s+executive summary\b/.test(lower)) return true;

  const bulletCount = (value.match(/[●•▪◦]/g) || []).length;
  if (bulletCount >= 3) return true;

  const preview = value.slice(0, 420);
  const periodCount = (preview.match(/\./g) || []).length;
  const headingLike = (preview.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,4}\b/g) || []).length;
  if (headingLike >= 8 && periodCount <= 2) return true;

  const words = value.split(/\s+/).filter(Boolean);
  if (words.length < 25) return true;

  return false;
}

function sanitizeLiteratureAbstract(text) {
  let value = clean(text);
  if (!value || isLowQualityAbstract(value)) return '';

  value = value
    .replace(/[●•▪◦]\s*/g, '. ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,;:])(?=\S)/g, '$1 ')
    .replace(/\.{2,}/g, '.')
    .trim();

  if (value && !/[.!?]$/.test(value)) {
    value = `${value}.`;
  }

  return value.length > 600 ? `${value.slice(0, 597).trim()}…` : value;
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
    abstract: sanitizeLiteratureAbstract(paper.abstract),
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

async function enrichWithModel({ topic, problem, query, papers, llmModel }) {
  const model = resolveLlmModel(llmModel);

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

  const context = { topic, problem, query };

  const merged = papers.map((paper) => {
    const extra = enrichedMap.get(paper.id) || {};
    const relevanceNote = clean(extra.relevanceNote) || buildLocalRelevanceNote(paper, context);
    return {
      ...paper,
      relevanceScore: extra.relevanceScore ?? paper.citationCount ?? 0,
      relevanceNote: isCitationOnlyRelevanceNote(relevanceNote)
        ? buildLocalRelevanceNote(paper, context)
        : relevanceNote,
      citation: extra.citation || paper.citation
    };
  });

  const maxRelevance = merged.reduce((max, paper) => Math.max(max, paper.relevanceScore || 0), 0);
  const ordered =
    maxRelevance > 0 ? sortByRelevanceThenCitations(merged) : applyLocalRanking(merged, context);
  const rankingMethod = maxRelevance > 0 ? 'llm' : 'citations';

  return {
    papers: ordered,
    rankingMethod,
    relatedWorkParagraph: finalizeRelatedWorkSummary(
      clean(parsed.relatedWorkParagraph) || buildFallbackRelatedWork(topic, problem, ordered),
      topic,
      problem,
      ordered
    ),
    gapNote: isOperationalGapNote(clean(parsed.gapNote))
      ? ''
      : clampSummarySentences(clean(parsed.gapNote) || '', 1)
  };
}

function isCitationOnlyRelevanceNote(note) {
  const text = clean(note).toLowerCase();
  if (!text) return true;

  return (
    /^\d[\d,]*\s*citations?\b/.test(text) ||
    /^ranked by citation/i.test(text) ||
    /\b(ordered by impact|listed after papers with known counts|well cited relative to your search)\b/.test(
      text
    ) ||
    /^citation count unavailable\b/.test(text)
  );
}

function compareByCitationAndYear(left, right) {
  const citeDiff = (right.citationCount || 0) - (left.citationCount || 0);
  if (citeDiff !== 0) return citeDiff;

  const yearDiff = (Number(right.year) || 0) - (Number(left.year) || 0);
  if (yearDiff !== 0) return yearDiff;

  return (left.title || '').localeCompare(right.title || '');
}

function sortByCitationCount(papers) {
  return [...papers].sort(compareByCitationAndYear);
}

function sortByRelevanceThenCitations(papers) {
  return [...papers].sort((left, right) => {
    const relevanceDiff = (right.relevanceScore || 0) - (left.relevanceScore || 0);
    if (relevanceDiff !== 0) return relevanceDiff;
    return compareByCitationAndYear(left, right);
  });
}

function isSentenceBoundaryPeriod(value, index, current) {
  const trimmed = current.trim();
  if (/\b(?:al|vs|etc|e\.g|i\.e)\.$/i.test(trimmed)) {
    return false;
  }

  if (/\(\d{4}\)\.$/.test(trimmed)) {
    return false;
  }

  if (/\bet al\.$/i.test(trimmed)) {
    return false;
  }

  const nextChar = value[index + 1];
  if (nextChar && /[a-z('"0-9]/.test(nextChar)) {
    return false;
  }

  return !nextChar || /\s/.test(nextChar);
}

function splitSentences(text) {
  const value = clean(text);
  if (!value) return [];

  const sentences = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    current += char;

    if (char === '"') {
      inQuotes = !inQuotes;
    }

    if (!inQuotes && /[.!?]/.test(char) && isSentenceBoundaryPeriod(value, index, current)) {
      sentences.push(current.trim());
      current = '';
    }
  }

  if (current.trim()) {
    sentences.push(current.trim());
  }

  return sentences;
}

function clampSummarySentences(text, maxSentences = SUMMARY_MAX_SENTENCES) {
  if (Array.isArray(text)) {
    return text.filter(Boolean).slice(0, maxSentences).join(' ');
  }

  const sentences = splitSentences(text);
  if (!sentences.length) return clean(text);
  if (sentences.length <= maxSentences) return sentences.join(' ');
  return sentences.slice(0, maxSentences).join(' ');
}

function chunkEvenly(items, maxChunks) {
  if (!items.length || maxChunks <= 0) return [];

  const chunkSize = Math.max(1, Math.ceil(items.length / maxChunks));
  const chunks = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks.slice(0, maxChunks);
}

function formatTitleList(titles) {
  if (!titles.length) return '';
  if (titles.length === 1) return titles[0];
  if (titles.length === 2) return `${titles[0]} and ${titles[1]}`;
  return `${titles.slice(0, -1).join(', ')}, and ${titles.at(-1)}`;
}

function formatAuthorLastName(name) {
  const parts = clean(name).split(/\s+/).filter(Boolean);
  return parts.at(-1) || clean(name) || 'Unknown';
}

function formatAuthorsCitation(authors = []) {
  const names = (authors || []).map(formatAuthorLastName).filter(Boolean);
  if (!names.length) return 'Unknown authors';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]} et al.`;
}

function paperCitationLabel(paper) {
  const authors = formatAuthorsCitation(paper.authors);
  const year = paper.year || 'n.d.';
  return `${authors} (${year})`;
}

function kindLabel(kind) {
  if (kind === 'review') return 'literature review';
  if (kind === 'survey') return 'survey';
  if (kind === 'methods') return 'methods paper';
  return 'empirical study';
}

function withArticle(label) {
  return /^[aeiou]/i.test(label) ? `an ${label}` : `a ${label}`;
}

function paperReadableName(paper) {
  return paperCitationLabel(paper);
}

function buildLeadGroupSentence(group, topicLabel) {
  if (group.length === 1) {
    const paper = group[0];
    const kind = classifyPaperKind(paper);
    return `The strongest match is ${paperCitationLabel(paper)}, ${withArticle(kindLabel(kind))} on ${topicLabel}.`;
  }

  const names = group.map(paperCitationLabel);
  return `The strongest matches include ${formatTitleList(names)}, which align most closely with ${topicLabel}.`;
}

function buildPaperGroupSentence(group, topicLabel, groupIndex = 0) {
  if (group.length === 1) {
    const paper = group[0];
    const kind = classifyPaperKind(paper);
    return `${paperCitationLabel(paper)} is ${withArticle(kindLabel(kind))} worth citing for this topic.`;
  }

  const names = group.map(paperCitationLabel);
  const kinds = group.map((paper) => classifyPaperKind(paper));
  const hasReview = kinds.some((kind) => kind === 'review' || kind === 'survey');
  const hasMethods = kinds.includes('methods');

  const variedRoles = [
    'offer complementary perspectives on the topic',
    'extend the evidence base with additional findings',
    'highlight adjacent work worth comparing',
    'round out the retrieved set with broader context'
  ];

  let role = variedRoles[groupIndex % variedRoles.length];
  if (hasReview && hasMethods) role = 'combine synthesis and methods-oriented contributions';
  else if (hasReview) role = 'help establish what is already known';
  else if (hasMethods) role = 'suggest methods or frameworks to compare against';

  return `${formatTitleList(names)} ${role}.`;
}

function isRoboticSummary(text) {
  const value = clean(text).toLowerCase();
  if (!value) return true;

  const relateCount = (value.match(/\brelate to\b/g) || []).length;
  if (relateCount >= 2) return true;

  return /returned \d+ retrieved papers.*returned \d+ retrieved papers/.test(value);
}

function normalizeSummaryProse(text) {
  return clean(text).replace(/\s+/g, ' ').replace(/\s+([,.;!?])/g, '$1');
}

function hasTruncationArtifacts(text) {
  const value = clean(text);
  if (!value) return true;

  return /…|\.\.\./.test(value) || /\b(in|of|for|to|the|and|a)\.$/i.test(value);
}

function buildPaperDetailSentence(paper, topicLabel, rank) {
  const cite = paperCitationLabel(paper);
  const kind = classifyPaperKind(paper);
  const label = kindLabel(kind);

  if (rank === 1) {
    return `The strongest match is ${cite}, ${withArticle(label)} that aligns most closely with ${topicLabel}.`;
  }

  if (rank === 2) {
    return `A second key source is ${cite}, ${withArticle(label)} that supports the topic from a complementary angle.`;
  }

  if (kind === 'review' || kind === 'survey') {
    return `${cite} is ${withArticle(label)} that can help summarize what is already known in this area.`;
  }

  if (kind === 'methods') {
    return `${cite} is ${withArticle(label)} whose approach you could compare with your own proposal.`;
  }

  return `${cite} is ${withArticle(label)} that adds useful background for ${topicLabel}.`;
}

function finalizeRelatedWorkSummary(text, topic, problem, papers) {
  const limit = getSummarySentenceLimit(papers.length);
  let raw = normalizeSummaryProse(text);

  if (
    !raw ||
    isRoboticSummary(raw) ||
    hasTruncationArtifacts(raw) ||
    splitSentences(raw).length < Math.min(3, limit - 1)
  ) {
    raw = buildFallbackRelatedWork(topic, problem, papers);
  }

  return clampSummarySentences(raw, limit) || buildFallbackRelatedWork(topic, problem, papers);
}

function buildFallbackRelatedWork(topic, problem, papers) {
  if (!papers.length) {
    return 'No papers were retrieved. Try different search terms or another source.';
  }

  const topicLabel = summarizeTopicLabel(topic, problem);
  const count = papers.length;
  const limit = getSummarySentenceLimit(count);
  const bodyBudget = Math.max(1, limit - 2);
  const sentences = [
    count === 1
      ? `Your search on ${topicLabel} returned one paper that may support your proposal.`
      : `Your search on ${topicLabel} returned ${count} papers that may support your proposal.`
  ];

  if (count <= bodyBudget) {
    papers.forEach((paper, index) => {
      sentences.push(buildPaperDetailSentence(paper, topicLabel, index + 1));
    });
  } else {
    const groups = chunkEvenly(papers, bodyBudget);

    groups.forEach((group, index) => {
      if (index === 0) {
        sentences.push(buildLeadGroupSentence(group, topicLabel));
        return;
      }

      sentences.push(buildPaperGroupSentence(group, topicLabel, index));
    });
  }

  sentences.push(
    count === 1
      ? `This source is a practical starting point for citing relevant work in your problem statement.`
      : `Taken together, these ${count} retrieved papers give you citeable evidence that the literature on ${topicLabel} is worth engaging in your problem statement.`
  );

  return clampSummarySentences(sentences, limit);
}

function shortenPaperTitle(title, maxLength = 64) {
  const value = clean(title);
  if (!value) return 'Untitled paper';
  return value.length > maxLength ? `${value.slice(0, maxLength - 1).trim()}…` : value;
}

function isOperationalGapNote(note) {
  const text = clean(note).toLowerCase();
  if (!text) return true;

  return (
    /ordered by citation/.test(text) ||
    /ai ranking was unavailable/.test(text) ||
    /add an llm api key/.test(text) ||
    /llm enrichment disabled/.test(text)
  );
}
