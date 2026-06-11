import assert from 'node:assert/strict';
import { DEFAULT_PROJECT, DEFAULT_REQUIREMENTS, PROPOSAL_AUTHOR } from '../shared/mathlmDefaults.js';
import { generateProposal } from '../server/proposalGenerator.js';
import { compileLatexDocument } from '../server/pdfExport.js';
import { proposalLatexToPdf } from '../server/pdfExport.js';
import { repairEmptyListEnvironments } from '../server/latexRepair.js';

const brokenLists = String.raw`\documentclass{article}
\begin{document}
\section{Test}
\begin{itemize}
\end{itemize}
\end{document}`;

const repairedLists = repairEmptyListEnvironments(brokenLists);
assert.match(repairedLists, /\\item Content to be specified/);
const repairedCompile = await compileLatexDocument(
  `\\documentclass{article}\\begin{document}\\section{T}\\begin{itemize}\\item x\\end{itemize}\\end{document}`
);
assert.equal(repairedCompile.ok, true, repairedCompile.error || 'list repair baseline should compile');

const flatProposal = await generateProposal({
  ...DEFAULT_PROJECT,
  topic: DEFAULT_PROJECT.title,
  requirements: DEFAULT_REQUIREMENTS
});
assert.equal(flatProposal.latexValidation?.validated, true, 'flat project proposal should compile-verify');
assert.match(flatProposal.proposalLatex, new RegExp(`\\\\author\\{${PROPOSAL_AUTHOR.replace(/ /g, ' ')}\\}`));
const flatCompile = await compileLatexDocument(flatProposal.proposalLatex);
assert.equal(flatCompile.ok, true, flatCompile.error || 'generated proposal should compile');

const sparseProposal = await generateProposal({
  topic: 'Sparse project',
  title: 'Sparse project',
  requirements: DEFAULT_REQUIREMENTS
});
assert.equal(sparseProposal.latexValidation?.validated, true, 'sparse project should still compile-verify');
const sparseCompile = await compileLatexDocument(sparseProposal.proposalLatex);
assert.equal(sparseCompile.ok, true, sparseCompile.error || 'sparse proposal should compile');

const pdf = await proposalLatexToPdf(flatProposal.proposalLatex, DEFAULT_PROJECT.title, {
  project: DEFAULT_PROJECT
});
assert.ok(pdf?.length > 100, 'proposalLatexToPdf should return PDF bytes');

import { validateProposalLatex } from '../server/latexValidate.js';
import { buildFallbackProposalLatex } from '../server/proposalGenerator.js';

const brokenLatex = String.raw`\documentclass{article}
\begin{document}
\section{Broken}
\begin{itemize}
\end{itemize}
Unescaped & percent 100% here.
\end{document}`;

const brokenValidation = await validateProposalLatex(brokenLatex, 'Broken', {
  fallbackLatex: buildFallbackProposalLatex(DEFAULT_PROJECT)
});
assert.equal(brokenValidation.validated, true, brokenValidation.attempts?.map((a) => a.error).join('; '));
assert.match(brokenValidation.latex, /\\author\{Aamir Khan\}/);

console.log('PASS final proposal LaTeX compile verification and PDF export');
