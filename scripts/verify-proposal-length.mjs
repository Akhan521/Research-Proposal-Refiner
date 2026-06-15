import assert from 'node:assert/strict';
import {
  PROPOSAL_PAGE_MAX,
  PROPOSAL_PAGE_MIN,
  PROPOSAL_PAGE_OPTIONS,
  normalizeProposalPageTarget
} from '../shared/proposalLength.js';
import { SUBMISSION_PROJECT } from '../shared/submissionProject.js';
import { generateProposal } from '../server/proposalGenerator.js';
import { compileLatexDocument } from '../server/pdfExport.js';
import { countPdfPages } from '../server/proposalLength.js';

assert.equal(normalizeProposalPageTarget(0), PROPOSAL_PAGE_MIN);
assert.equal(normalizeProposalPageTarget(99), PROPOSAL_PAGE_MAX);
assert.equal(normalizeProposalPageTarget('3'), 3);
assert.equal(normalizeProposalPageTarget(undefined), 3);

const pageCounts = new Map();

for (const target of PROPOSAL_PAGE_OPTIONS) {
  const result = await generateProposal({
    ...SUBMISSION_PROJECT,
    proposalPageTarget: target,
    requirements: SUBMISSION_PROJECT.requirements
  });

  assert.equal(result.pageLength?.targetPages, target, `metadata target for ${target} pages`);

  const compile = await compileLatexDocument(result.proposalLatex);
  assert.equal(compile.ok, true, compile.error || `compile failed for target ${target}`);

  const pages = compile.pageCount || countPdfPages(compile.pdf, { pageCount: compile.pageCount });
  pageCounts.set(target, pages);

  assert.ok(pages > 0, `target ${target}: expected a positive page count`);
  assert.ok(
    pages <= target,
    `target ${target}: compiled ${pages} page(s), expected at most ${target}`
  );
  assert.ok(pages <= PROPOSAL_PAGE_MAX, `target ${target}: exceeded global max ${PROPOSAL_PAGE_MAX}`);

  if (!result.pageLength?.compilerUnavailable) {
    assert.equal(
      result.pageLength?.pageCount,
      pages,
      `target ${target}: API page count should match compiled PDF`
    );
  }

  console.log(`target ${target}: ${pages} compiled page(s)`);
}

const onePage = pageCounts.get(1);
const fivePages = pageCounts.get(5);
assert.ok(
  onePage <= fivePages,
  `shorter target should not produce more pages than longer target (${onePage} vs ${fivePages})`
);

console.log('PASS proposal page-length enforcement');
