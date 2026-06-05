/**
 * Literature retriever smoke tests — run:
 *   LITERATURE_SKIP_ENRICH=1 node --import dotenv/config scripts/test-literature.mjs
 */
process.env.LITERATURE_SKIP_ENRICH = process.env.LITERATURE_SKIP_ENRICH || '1';

import { searchLiterature } from '../server/literature.js';

function isSortedByCitationCount(papers) {
  for (let index = 1; index < papers.length; index += 1) {
    const previous = papers[index - 1].citationCount || 0;
    const current = papers[index].citationCount || 0;
    if (previous < current) return false;
  }
  return true;
}

const CASES = [
  {
    name: 'semantic_scholar — ML agent',
    source: 'semantic_scholar',
    topic: 'citation-grounded literature review agents',
    problem: 'LLMs hallucinate citations in research workflows'
  },
  {
    name: 'openalex — ML agent',
    source: 'openalex',
    topic: 'citation-grounded literature review agents',
    problem: 'LLMs hallucinate citations in research workflows'
  },
  {
    name: 'arxiv — ML agent',
    source: 'arxiv',
    topic: 'citation-grounded literature review agents',
    problem: 'LLMs hallucinate citations in research workflows'
  },
  {
    name: 'auto — ML (expect arxiv)',
    source: 'auto',
    topic: 'deep learning transformer language models',
    problem: 'fine-tuning for scientific text'
  },
  {
    name: 'auto — biology (expect openalex)',
    source: 'auto',
    topic: 'climate change crop yield prediction',
    problem: 'smallholder farmers need better forecasts'
  },
  {
    name: 'auto — general CS (expect semantic_scholar)',
    source: 'auto',
    topic: 'software engineering code review automation',
    problem: 'pull requests lack consistent quality checks'
  },
  {
    name: 'openalex — short topic only',
    source: 'openalex',
    topic: 'federated learning privacy',
    problem: ''
  },
  {
    name: 'arxiv — cybersecurity',
    source: 'arxiv',
    topic: 'adversarial attacks on large language models',
    problem: 'jailbreak prompts bypass safety filters'
  }
];

async function runCase(testCase) {
  const start = Date.now();
  try {
    const result = await searchLiterature({
      topic: testCase.topic,
      problem: testCase.problem,
      source: testCase.source,
      limit: 5
    });
    const ms = Date.now() - start;
    const ok = result.papers?.length > 0 && result.mode !== 'error';
    const citationOrderOk =
      result.rankingMethod !== 'citations' ||
      isSortedByCitationCount(result.papers || []);
    return {
      name: testCase.name,
      ok: ok && citationOrderOk,
      ms,
      mode: result.mode,
      rankingMethod: result.rankingMethod,
      citationOrderOk,
      requested: testCase.source,
      resolved: result.resolvedSource,
      count: result.papers?.length ?? 0,
      firstTitle: result.papers?.[0]?.title?.slice(0, 60) ?? '',
      errors: result.transcript?.fetchErrors ?? [],
      runMessage: result.runMessage
    };
  } catch (error) {
    return {
      name: testCase.name,
      ok: false,
      ms: Date.now() - start,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

console.log('Literature retriever tests\n');
const results = [];
for (const testCase of CASES) {
  const row = await runCase(testCase);
  results.push(row);
  const status = row.ok ? 'PASS' : 'FAIL';
  console.log(
    `[${status}] ${row.name} (${row.ms}ms)` +
    (row.ok
      ? ` → ${row.count} papers via ${row.resolved} (${row.mode})`
      : ` → ${row.error || row.runMessage}`)
  );
  if (row.errors?.length) console.log(`       fallback notes: ${row.errors.join('; ')}`);
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);

process.exit(passed === results.length ? 0 : 1);
