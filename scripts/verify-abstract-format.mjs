import assert from 'node:assert/strict';
import { DEFAULT_PROJECT } from '../shared/mathlmDefaults.js';
import {
  buildCitationRegistry,
  enforceCitationsInProposalLatex,
  scrubStandaloneCitationLeads
} from '../server/citationEnforce.js';
import {
  ABSTRACT_SECTION_HEADING,
  buildAbstractLatexBody,
  buildNsfStyleAbstract,
  enforceAbstractInProposalLatex
} from '../server/proposalSections.js';
import { generateProposal } from '../server/proposalGenerator.js';
import { ensureLayoutPreamble } from '../server/latexLayout.js';
import { compileLatexDocument } from '../server/pdfExport.js';
import { repairUnescapedSpecialChars } from '../server/latexValidate.js';
import { dedupeSentencesAcrossBlocks, splitSentences } from '../server/proposalRedundancy.js';

const problemSentence =
  'Existing RL methods for math reasoning rely on sparse outcome rewards, which limit learning efficiency and provide little insight into model failures.';

const project = {
  ...DEFAULT_PROJECT,
  problem: problemSentence,
  method:
    'Investigate whether GRPO for policy updates and MCTS for reasoning path exploration, guided by a process reward model, can improve multi-step math reasoning.',
  evaluation:
    'Research Questions and Hypotheses derived from this evaluation plan for the problem stated in this proposal: Existing RL methods for math reasoning rely on sparse outcome rewards, which limit learning efficiency and provide little insight into model failures. Metrics: exact-match accuracy on GSM8K and MATH-500.'
};

const abstract = buildNsfStyleAbstract(project);
const abstractSentences = splitSentences(abstract);
const duplicateProblem = abstractSentences.filter((sentence) =>
  sentence.toLowerCase().includes('sparse outcome rewards')
);
assert.ok(
  duplicateProblem.length <= 1,
  `abstract should not repeat the problem sentence (${duplicateProblem.length} occurrences)`
);
assert.doesNotMatch(
  abstract,
  /for the problem stated in this proposal/i,
  'abstract should not include evaluation boilerplate'
);

const papers = [
  {
    id: 'p1',
    title: "Let's Verify Step by Step",
    authors: ['Lightman et al.'],
    year: 2023,
    venue: 'ICLR',
    url: 'https://arxiv.org/abs/2305.20050'
  }
];
const registry = buildCitationRegistry(`${papers[0].title}`, papers);
const abstractBody = buildAbstractLatexBody(project, registry);
assert.doesNotMatch(
  abstractBody,
  /^This proposal builds on prior work/i,
  'citations should be integrated into the first sentence, not a standalone lead'
);
assert.match(abstractBody, /building on prior work \\citep\{/i, 'abstract should weave citations into prose');

let latex = String.raw`\documentclass[11pt]{article}
\usepackage[margin=1in]{geometry}
\begin{document}
\title{Test Proposal}
\maketitle
\begin{abstract}
Old abstract content that should be replaced.
\end{abstract}
This proposal builds on prior work, including (Lightman et al., 2023).
\section{Motivation and Gap}
Body text.
\end{document}`;

const repairedAbstractHeading = repairUnescapedSpecialChars(
  '\\begin{document}\\maketitle\\n\\section*{Abstract}\\nBody text.\\end{document}'
);
assert.match(repairedAbstractHeading, /\\section\*\{Abstract\}/);
assert.doesNotMatch(repairedAbstractHeading, /\\section\*\\\{Abstract\\\}/);

const enforced = enforceAbstractInProposalLatex(latex, project, registry);
assert.equal(enforced.replaced, true);
assert.match(enforced.latex, /\\section\*\{Abstract\}/);
assert.doesNotMatch(enforced.latex, /\\begin\{abstract\}/, 'legacy abstract environment should be removed');
assert.doesNotMatch(
  enforced.latex,
  /This proposal builds on prior work, including/i,
  'standalone citation lead sentences should be removed'
);

let motivationDoc = String.raw`\documentclass{article}
\usepackage[round,authoryear]{natbib}
\begin{document}
\section{Motivation and Gap}
Compact language models still lag on multi-step math reasoning.
\section{References}
\end{document}`;

const citedMotivation = enforceCitationsInProposalLatex(
  motivationDoc,
  { references: papers[0].title },
  registry,
  papers
);
assert.doesNotMatch(
  citedMotivation.latex,
  /This proposal builds on prior work, including/i,
  'motivation citations should be integrated, not standalone leads'
);
assert.match(citedMotivation.latex, /building on prior work \\citep\{/i);

const scrubbed = scrubStandaloneCitationLeads(
  'This proposal builds on prior work, including \\citep{foo2023}.\n\nReal paragraph text.'
);
assert.doesNotMatch(scrubbed, /This proposal builds on prior work/i);

const document = ensureLayoutPreamble(
  enforced.latex.replace(/\\begin\{document\}/, '\\usepackage[round,authoryear]{natbib}\n\\begin{document}')
);
assert.equal(document.includes(ABSTRACT_SECTION_HEADING), true);

const compiled = await compileLatexDocument(document);
assert.equal(compiled.ok, true, compiled.error || 'abstract section formatting should compile');

const proposal = await generateProposal({ project, literaturePapers: [] });
assert.match(proposal.proposalLatex, /\\section\*\{Abstract\}/);
assert.doesNotMatch(proposal.proposalLatex, /\\section\*\\\{Abstract\\\}/);
assert.doesNotMatch(proposal.proposalLatex, /\\begin\{abstract\}/);
assert.doesNotMatch(proposal.proposalLatex, /This proposal builds on prior work, including/i);

assert.equal(
  dedupeSentencesAcrossBlocks([problemSentence, problemSentence]).length,
  1,
  'dedupe should collapse repeated sentences across blocks'
);

console.log('PASS abstract section formatting and citation lead cleanup');
