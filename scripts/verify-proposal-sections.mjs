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
  normalizeEvaluationField,
  normalizeTimelineField,
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
assert.match(evaluationLatex, /Research Questions and Hypotheses/);
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
