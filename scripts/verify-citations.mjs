import {
  formatCanonicalCitation,
  normalizeReferencesField
} from '../server/citationValidate.js';
import { enforceReferencesInProposalLatex } from '../server/latexLayout.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const papers = [
  {
    id: 'p1',
    title: 'Training Verifiers to Solve Math Word Problems',
    authors: ['Cobbe et al.'],
    year: 2021,
    venue: 'arXiv',
    doi: '10.48550/arXiv.2110.14168',
    url: 'https://arxiv.org/abs/2110.14168'
  }
];

const canonical = formatCanonicalCitation(papers[0]);
assert(canonical.includes('Cobbe et al.'), 'canonical citation should include authors');
assert(canonical.includes('2021'), 'canonical citation should include year');
assert(canonical.includes('Training Verifiers'), 'canonical citation should include title');
assert(canonical.includes('doi.org'), 'canonical citation should include DOI link');

const messy = normalizeReferencesField(
  'Fake citation without year or link\n' + papers[0].title,
  papers
);
assert(messy.references.includes('Training Verifiers'), 'matched paper should normalize to canonical metadata');
assert(messy.report.dropped >= 1, 'invalid lines should be dropped');

const latex = String.raw`\documentclass{article}
\begin{document}
\section{References and Assumptions}
Smith (2099). Invented paper. https://example.com/fake
\end{document}`;

const enforced = enforceReferencesInProposalLatex(latex, messy.references);
assert(enforced.replaced, 'references section should be replaced');
assert(!enforced.latex.includes('Invented paper'), 'hallucinated reference should be removed');
assert(enforced.latex.includes('Training Verifiers'), 'verified reference should appear');

console.log('PASS citation validation');
