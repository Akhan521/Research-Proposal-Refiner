import assert from 'node:assert/strict';
import {
  formatCanonicalCitation,
  normalizeReferencesField
} from '../server/citationValidate.js';
import {
  buildBibliographyLatexSection,
  buildCitationRegistry,
  enforceCitationsInProposalLatex,
  finalizeCitationValidation,
  validateInTextCitations
} from '../server/citationEnforce.js';
import { buildAbstractLatexBody, enforceAbstractInProposalLatex } from '../server/proposalSections.js';
import { DEFAULT_PROJECT } from '../shared/mathlmDefaults.js';
import { compileLatexDocument } from '../server/pdfExport.js';
import { ensureLayoutPreamble } from '../server/latexLayout.js';

const papers = [
  {
    id: 'p1',
    title: 'Training Verifiers to Solve Math Word Problems',
    authors: ['Cobbe et al.'],
    year: 2021,
    venue: 'arXiv',
    doi: '10.48550/arXiv.2110.14168',
    url: 'https://arxiv.org/abs/2110.14168'
  },
  {
    id: 'p2',
    title: "Let's Verify Step by Step",
    authors: ['Lightman et al.'],
    year: 2023,
    venue: 'ICLR',
    doi: '10.48550/arXiv.2305.20050',
    url: 'https://arxiv.org/abs/2305.20050'
  }
];

const canonical = formatCanonicalCitation(papers[0]);
assert.match(canonical, /Cobbe et al\./);
assert.match(canonical, /2021/);
assert.match(canonical, /Training Verifiers/);
assert.match(canonical, /doi\.org/);

const messy = normalizeReferencesField(
  'Fake citation without year or link\n' + papers[0].title + '\n' + papers[1].title,
  papers
);
assert.match(messy.references, /Training Verifiers/);
assert.match(messy.references, /Verify Step by Step/);
assert.ok(messy.report.dropped >= 1, 'invalid lines should be dropped');

const registry = buildCitationRegistry(messy.references, papers);
assert.equal(registry.entries.length, 2);
assert.match(registry.entries[0].key, /^cobbe2021/);
assert.equal(registry.entries[0].inTextParenthetical, 'Cobbe et al., 2021');

const bibliography = buildBibliographyLatexSection(registry);
assert.match(bibliography, /\\begin\{thebibliography\}/);
assert.match(bibliography, /\\bibitem\[Cobbe et al\., 2021\]\{cobbe2021\}/);
assert.match(bibliography, /\\emph\{Training Verifiers/);

let latex = String.raw`\documentclass{article}
\usepackage[hidelinks]{hyperref}
\begin{document}
\section{Motivation and Gap}
Prior work by Cobbe et al. (2021) shows that outcome-only supervision is weak for multi-step math reasoning.
\section{Method and Training Workflow}
We compare against process-supervision ideas discussed by Lightman et al. (2023).
\section{References and Assumptions}
Smith (2099). Invented paper. https://example.com/fake
\end{document}`;

const enforced = enforceCitationsInProposalLatex(
  latex,
  { references: messy.references },
  registry,
  papers
);

assert.ok(enforced.replaced, 'references section should be replaced');
assert.doesNotMatch(enforced.latex, /Invented paper/);
assert.match(enforced.latex, /\\usepackage\[round,authoryear\]\{natbib\}/);
assert.match(enforced.latex, /\\citep\{cobbe2021\}/);
assert.match(enforced.latex, /\\citep\{lightman2023\}/);
assert.match(enforced.latex, /\\begin\{thebibliography\}/);
assert.ok(enforced.inTextCount >= 2, 'should detect in-text cite commands');

latex = ensureLayoutPreamble(enforced.latex);
const compiled = await compileLatexDocument(latex);
assert.equal(compiled.ok, true, compiled.error || 'citation-enhanced proposal should compile');

const projectWithCitedProblem = {
  ...DEFAULT_PROJECT,
  problem: `${DEFAULT_PROJECT.problem} Prior work by Cobbe et al. (2021) motivates dense verification for math reasoning.`
};
const abstractRegistry = buildCitationRegistry(messy.references, papers);
const abstractBody = buildAbstractLatexBody(projectWithCitedProblem, abstractRegistry);
assert.match(abstractBody, /\\citep\{cobbe2021/);
assert.doesNotMatch(abstractBody, /Cobbe et al\. \(2021\)/);

let abstractDoc = String.raw`\documentclass{article}
\usepackage[round,authoryear]{natbib}
\begin{document}
\section*{Abstract}
Old abstract with Cobbe et al. (2021).
\section{References}
\end{document}`;
abstractDoc = enforceAbstractInProposalLatex(abstractDoc, projectWithCitedProblem, abstractRegistry).latex;
abstractDoc = finalizeCitationValidation(abstractDoc, abstractRegistry).latex;
assert.match(abstractDoc, /\\section\*\{Abstract\}[\s\S]*\\citep\{cobbe2021/);
assert.doesNotMatch(abstractDoc, /This proposal builds on prior work, including/i);
const abstractValidation = validateInTextCitations(abstractDoc, abstractRegistry);
assert.equal(abstractValidation.ok, true, abstractValidation.issues.join('; '));

console.log('PASS citation validation and in-text natbib enforcement');
