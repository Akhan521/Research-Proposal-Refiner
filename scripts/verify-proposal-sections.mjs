import assert from 'node:assert/strict';
import { DEFAULT_PROJECT } from '../shared/mathlmDefaults.js';
import {
  buildAbstractLatexBody,
  buildEvaluationLatexSection,
  buildMilestonesLatexSection,
  buildNsfStyleAbstract,
  enforceAbstractInProposalLatex,
  enforceEvaluationInProposalLatex,
  enforceMilestonesInProposalLatex,
  extractResearchQuestionsAndHypotheses,
  normalizeEvaluationField,
  normalizeTimelineField,
  stripDuplicateEvaluationResearchQuestions,
  validateEvaluationContentCompleteness,
  validateMilestonePlan
} from '../server/proposalSections.js';
import { splitSentences } from '../server/textSegmentation.js';
import { ensureLayoutPreamble } from '../server/latexLayout.js';
import { compileLatexDocument } from '../server/pdfExport.js';

const project = { ...DEFAULT_PROJECT };

const abstract = buildNsfStyleAbstract(project);
assert.ok(abstract.length > 120, 'abstract should be substantive');
assert.ok(/objective/i.test(abstract), 'abstract mentions objective');
assert.ok(/accuracy|evaluat|assess/i.test(abstract), 'abstract mentions evaluation');

const normalizedTimeline = normalizeTimelineField(project.timeline, project);
assert.match(normalizedTimeline.timeline, /Milestone 1/i);
assert.ok(normalizedTimeline.validation.milestoneCount >= 3, 'timeline should include multiple milestones');
assert.ok(
  normalizedTimeline.validation.researchQuestionCount >= 1,
  'evaluation should include research questions or hypotheses'
);
assert.equal(normalizedTimeline.validation.ok, true, normalizedTimeline.validation.warnings.join('; '));

const normalizedEvaluation = normalizeEvaluationField(project.evaluation, project);
assert.match(normalizedEvaluation.evaluation, /Research Questions and Hypotheses/i);
assert.match(normalizedEvaluation.evaluation, /Success Criteria/i);

const milestonesLatex = buildMilestonesLatexSection(normalizedTimeline.timeline, project);
assert.match(milestonesLatex, /Expected Results/);
assert.match(milestonesLatex, /Research Milestones and Timeline/);
assert.match(milestonesLatex, /\\begin\{enumerate\}/);
assert.doesNotMatch(milestonesLatex, /\\item \\textbf\{Milestone \d+/);
assert.match(milestonesLatex, /\\textbf\{Weeks 1--3\.\}/);
assert.match(milestonesLatex, /Research Questions and Hypotheses Addressed/);

const evaluationLatex = buildEvaluationLatexSection(normalizedEvaluation.evaluation, project);
assert.doesNotMatch(
  evaluationLatex,
  /\\subsection\*\{Research Questions and Hypotheses\}/,
  'RQ subsection should appear only in milestones when milestone mapping exists'
);
assert.match(evaluationLatex, /mapped to milestones in the preceding section/i);
assert.match(evaluationLatex, /Metrics and Benchmarks/);
assert.match(evaluationLatex, /Comparative Baselines/);
assert.match(evaluationLatex, /Success Criteria/);

const egEvaluation =
  'Metrics and Benchmarks: Include evaluation on competition-level problems (e.g., AMC, AIME) to assess generalization beyond standard benchmarks like GSM8K and MATH.';
const egSentences = splitSentences(egEvaluation);
assert.equal(egSentences.length, 1, `e.g. must not split sentences: ${JSON.stringify(egSentences)}`);

const egLatex = buildEvaluationLatexSection(egEvaluation, project);
assert.match(egLatex, /\(e\.g\., AMC, AIME\)/);
assert.doesNotMatch(egLatex, /\\item[^\\]*\(e\./);
assert.doesNotMatch(egLatex, /\\item g\./);

const egCompleteness = validateEvaluationContentCompleteness(egEvaluation, project);
assert.equal(egCompleteness.ok, true, egCompleteness.issues.join('; '));

const messyTimeline =
  'Expected results: (1) A trained process reward model with >90% agreement with human annotators. (2) An LLM policy that improves by 10--20% absolute accuracy on GSM8K and MATH. Milestone 1 (Months 1--2): Literature review and dataset curation. Milestone 2 (Months 2--4): Process reward model development. Milestone 3 (Months 4--6): Search and planning integration with MCTS.';

const messyMilestonesLatex = buildMilestonesLatexSection(messyTimeline, project);
assert.match(messyMilestonesLatex, /\\begin\{enumerate\}/);
assert.ok(
  (messyMilestonesLatex.match(/\\item \\textbf\{Months/g) || []).length >= 2,
  'inline milestones should become separate enumerated items'
);
assert.ok(
  messyMilestonesLatex.split('\\item').length >= 5,
  'expected results and milestones should not collapse into one bullet'
);

const messyEvaluation =
  'Research Questions and Hypotheses: Does dense process reward improve exact-match accuracy? Metrics and Benchmarks: Evaluate on GSM8K, MATH, AMC, and AIME. Comparative Baselines: Compare against supervised fine-tuning and outcome-only RL.';

const messyEvalLatex = buildEvaluationLatexSection(messyEvaluation, { ...project, timeline: '' });
assert.match(messyEvalLatex, /dense process reward/i);
assert.match(messyEvalLatex, /\\subsection\*\{Research Questions and Hypotheses\}/);
assert.match(messyEvalLatex, /GSM8K|MATH/);
assert.doesNotMatch(
  messyEvalLatex,
  /Research Questions and Hypotheses:[\s\S]*Research Questions and Hypotheses:/
);

const grpoProject = {
  ...project,
  method:
    'We will use Group Relative Policy Optimization (GRPO) for policy updates and Monte Carlo Tree Search (MCTS) for reasoning path exploration, guided by a process reward model.'
};
const grpoAbstract = buildNsfStyleAbstract(grpoProject);
assert.doesNotMatch(grpoAbstract, /investigate whether we will/i, grpoAbstract);
assert.match(grpoAbstract, /GRPO|Group Relative Policy Optimization|MCTS/i);

const rqEvaluation =
  'Research Questions and Hypotheses: RQ1: Does process-based RL improve accuracy? RQ2: Metrics and Benchmarks: Evaluate on GSM8K. Metrics and Benchmarks: Exact-match on GSM8K and MATH.';
const rqItems = extractResearchQuestionsAndHypotheses(rqEvaluation, project);
assert.equal(rqItems.length, 1, `invalid evaluation labels should not become RQs: ${JSON.stringify(rqItems)}`);
assert.match(rqItems[0], /process-based RL/i);

const rqMilestonesLatex = buildMilestonesLatexSection(normalizedTimeline.timeline, {
  ...project,
  evaluation: rqEvaluation
});
assert.match(rqMilestonesLatex, /\\begin\{enumerate\}\[label=\\textbf\{RQ\\arabic\*\.\}/);
assert.doesNotMatch(rqMilestonesLatex, /\\item\[RQ1\.\]/);
assert.doesNotMatch(rqMilestonesLatex, /RQ1:\s*RQ1:/i);
assert.doesNotMatch(rqMilestonesLatex, /Metrics and\./i);

const duplicateRqLatex = String.raw`\section{Expected Results and Research Milestones}
\subsection*{Research Questions and Hypotheses Addressed}
\begin{enumerate}
\item Does process-based RL improve accuracy?
\end{enumerate}
\section{Evaluation Plan}
\subsection*{Research Questions and Hypotheses}
Does process-based RL improve accuracy?
\subsection*{Metrics and Benchmarks}
GSM8K accuracy.`;

const strippedRqLatex = stripDuplicateEvaluationResearchQuestions(duplicateRqLatex);
assert.doesNotMatch(strippedRqLatex, /\\subsection\*\{Research Questions and Hypotheses\}/);
assert.match(strippedRqLatex, /Metrics and Benchmarks/);

let document = `\\PassOptionsToPackage{hyphens}{url}
\\documentclass[11pt]{article}
\\usepackage[margin=1in]{geometry}
\\usepackage[hidelinks]{hyperref}
\\usepackage{enumitem}
\\begin{document}
\\begin{abstract}
Old abstract text.
\\end{abstract}
\\section{Expected Results and Research Milestones}
Old milestones.
\\section{Evaluation Plan}
Old evaluation.
\\end{document}`;

document = enforceAbstractInProposalLatex(document, project).latex;
document = enforceMilestonesInProposalLatex(document, normalizedTimeline.timeline, project).latex;
document = enforceEvaluationInProposalLatex(document, normalizedEvaluation.evaluation, project).latex;
document = ensureLayoutPreamble(document);

assert.doesNotMatch(document, /Old abstract text/);
assert.doesNotMatch(document, /Old milestones/);
assert.doesNotMatch(document, /Old evaluation/);
assert.ok(document.includes(buildAbstractLatexBody(project).slice(0, 40)), 'abstract body enforced');

const compiled = await compileLatexDocument(document);
assert.equal(compiled.ok, true, compiled.error || 'proposal sections PDF should compile');

console.log('PASS NSF-style abstract, milestones, and evaluation formatting');
