import assert from 'node:assert/strict';
import { DEFAULT_PROJECT } from '../shared/mathlmDefaults.js';
import {
  appendRedundancyNote,
  prepareProjectForProposal,
  validateLatexRedundancy,
  validateProjectRedundancy
} from '../server/proposalRedundancy.js';
import { generateProposal } from '../server/proposalGenerator.js';

const repeated =
  'Students often choose research directions that are too broad or underspecified for a semester project.';
const redundantProject = {
  ...DEFAULT_PROJECT,
  problem: `${repeated} ${repeated}`,
  method: `${DEFAULT_PROJECT.method} ${repeated}`
};

const scrubbed = prepareProjectForProposal(redundantProject);
assert.equal(scrubbed.scrubbed, true, 'intra-field duplicates should be scrubbed');
assert.equal(
  scrubbed.project.problem.split(repeated).length - 1,
  1,
  'problem field should keep one copy of the repeated sentence'
);

const crossCheck = validateProjectRedundancy({
  problem: repeated,
  method: repeated,
  evaluation: DEFAULT_PROJECT.evaluation
});
assert.ok(crossCheck.warnings.length >= 1, 'cross-field duplicates should be reported');

const latexDup = String.raw`\documentclass{article}
\begin{document}
\begin{abstract}
This proposal studies compact language models for multi-step math reasoning with process rewards.
\end{abstract}
\section{Motivation}
This proposal studies compact language models for multi-step math reasoning with process rewards.
\end{document}`;

const latexCheck = validateLatexRedundancy(latexDup);
assert.ok(latexCheck.warnings.length >= 1, 'duplicate paragraphs in LaTeX should be reported');

const note = appendRedundancyNote('# Report', {
  precheck: crossCheck,
  postcheck: latexCheck
});
assert.match(note, /## Redundancy Check/);

const proposal = await generateProposal({ project: redundantProject, literaturePapers: [] });
assert.match(proposal.evaluationReport, /Redundancy Check/);
assert.ok(proposal.proposalLatex.includes('\\downarrow'), 'exported diagram should be top-down');

console.log('PASS proposal redundancy precheck and vertical diagram export');
