import assert from 'node:assert/strict';
import { MAX_PROPOSAL_REFERENCES } from '../shared/mathlmDefaults.js';
import { buildCitationRegistry } from '../server/citationEnforce.js';
import { limitReferencesForProposal } from '../server/citationValidate.js';
import { generateProposal } from '../server/proposalGenerator.js';
import { DEFAULT_PROJECT, DEFAULT_REQUIREMENTS } from '../shared/mathlmDefaults.js';
import { compileLatexDocument } from '../server/pdfExport.js';

const papers = Array.from({ length: 8 }, (_, index) => ({
  id: `p${index + 1}`,
  title: `Paper ${index + 1} on reinforcement learning for math`,
  authors: [`Author ${index + 1}`],
  year: 2020 + index,
  venue: 'arXiv',
  url: `https://arxiv.org/abs/2110.1416${index}`
}));

const references = papers.map((paper) => `${paper.authors[0]} (${paper.year}). ${paper.title}. ${paper.venue}. ${paper.url}`).join('\n');

const limited = limitReferencesForProposal(references, papers);
assert.equal(limited.references.split('\n').filter(Boolean).length, MAX_PROPOSAL_REFERENCES);
assert.ok(limited.report.truncated >= 3);
assert.equal(limited.knownPapers.length, MAX_PROPOSAL_REFERENCES);

const registry = buildCitationRegistry(limited.references, limited.knownPapers);
assert.equal(registry.entries.length, MAX_PROPOSAL_REFERENCES);

const proposal = await generateProposal({
  ...DEFAULT_PROJECT,
  references,
  topic: DEFAULT_PROJECT.title,
  requirements: DEFAULT_REQUIREMENTS,
  literaturePapers: papers
});

const bibitemCount = (proposal.proposalLatex.match(/\\bibitem\[/g) || []).length;
assert.ok(bibitemCount <= MAX_PROPOSAL_REFERENCES, `expected at most ${MAX_PROPOSAL_REFERENCES} bibitems, got ${bibitemCount}`);
assert.match(proposal.evaluationReport, /capped at 5 references|Limited Sources to the top 5/i);

const compiled = await compileLatexDocument(proposal.proposalLatex);
assert.equal(compiled.ok, true, compiled.error || 'limited-reference proposal should compile');

console.log('PASS proposal reference limit and compile verification');
