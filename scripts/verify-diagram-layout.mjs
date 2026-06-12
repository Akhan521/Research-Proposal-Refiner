import assert from 'node:assert/strict';
import { DEFAULT_PROJECT } from '../shared/mathlmDefaults.js';
import {
  buildFigureEnvironment,
  buildProjectWorkflowFigure,
  buildWorkflowDiagramLatex,
  chooseDiagramLayout,
  detectFlowIssues,
  enforceFiguresInProposalLatex,
  inferWorkflowStepsFromProject,
  inferWorkflowWithSource,
  isGenericWorkflowStep,
  normalizeWorkflowOrder,
  parseWorkflowSteps,
  resolveWorkflowSteps,
  sanitizeDiagramLabel,
  validateDiagram,
  validateDiagramGrounding,
  validateDiagramLabelContent,
  verifyRenderedDiagramContent,
  verifyRenderedDiagramFlow
} from '../server/latexDiagram.js';
import { ensureLayoutPreamble } from '../server/latexLayout.js';
import { compileLatexDocument } from '../server/pdfExport.js';

const overflowFigure = String.raw`\begin{figure}[h]
\centering
\fbox{\begin{minipage}{0.9\linewidth}
\centering
\textbf{Agent Workflow Diagram}\\[0.5em]
Problem Input $\rightarrow$ Step Generator $\rightarrow$ Step Verifier $\rightarrow$ Reward Aggregation $\rightarrow$ Policy Update\\[0.5em]
\textit{(Iterative loop until convergence)}
\end{minipage}}
\caption{Agent workflow for process-based reinforcement learning.}
\end{figure}`;

const trainingProject = {
  method:
    'Math prompt $\\rightarrow$ multi-sample rollouts $\\rightarrow$ dense process rewards $\\rightarrow$ group-relative RL update $\\rightarrow$ curriculum schedule $\\rightarrow$ majority-vote answer'
};

const steps = parseWorkflowSteps(overflowFigure);
assert.equal(steps.length, 5);

const colSpecOnly = '@{}c@{\\hspace{0.35em}$\\rightarrow$\\hspace{0.35em}}c@{}';
assert.equal(parseWorkflowSteps(colSpecOnly).length, 0);

const layout = chooseDiagramLayout(steps);
assert.equal(layout, 'vertical', 'workflow diagrams should always use top-down vertical layout');

const project = {
  method: 'Problem Input -> Step Generator -> Step Verifier -> Reward Aggregation -> Policy Update'
};

const shuffled = normalizeWorkflowOrder(
  ['Policy Update', 'Problem Input', 'Step Verifier', 'Step Generator', 'Reward Aggregation'],
  project
);
assert.equal(shuffled.reordered, true);

const leakedLabel = validateDiagramLabelContent('\\textbf{Policy Update}');
assert.equal(leakedLabel.sanitized, 'Policy Update');

const escapedLabel = sanitizeDiagramLabel('\\textbackslash{}textbf\\{Step Generator\\}');
assert.equal(escapedLabel, 'Step Generator');

const trainingFigure = buildFigureEnvironment(
  resolveWorkflowSteps(parseWorkflowSteps(trainingProject.method), trainingProject.method, trainingProject),
  'Training workflow: process rewards, code verification, curriculum, and self-consistency.',
  '[h]',
  {
    title: 'Training Workflow Diagram',
    footnote: '(Iterative loop until convergence)',
    project: trainingProject
  }
);

assert.ok(trainingFigure.includes('Math prompt') || trainingFigure.includes('multi-sample'), 'training steps rendered');
assert.doesNotMatch(trainingFigure, /@\{\}c@\{[^}]*\\rightarrow/);
assert.match(trainingFigure, /Math prompt/);
assert.match(trainingFigure, /majority-vote answer/i);

const trainingEnforced = enforceFiguresInProposalLatex(
  `\\documentclass{article}\\begin{document}${trainingFigure}\\end{document}`,
  trainingProject
);
assert.equal(trainingEnforced.validations[0].renderedContent.ok, true);
assert.ok(trainingEnforced.validations[0].renderedContent.nodeCount >= 4);

const secondPass = enforceFiguresInProposalLatex(trainingEnforced.latex, trainingProject);
assert.equal(secondPass.validations[0].renderedContent.ok, true, 'double enforce must stay valid');
assert.ok(secondPass.validations[0].renderedContent.nodeCount >= 4);

const malformedFigure = String.raw`\begin{figure}[h]
\centering
\fbox{\begin{minipage}{0.9\linewidth}
\centering
\textbf{Agent Workflow Diagram}\\[0.5em]
\textbf{Problem Input} $\rightarrow$ \textit{Step Generator} $\rightarrow$ Step Verifier\\[0.5em]
\end{minipage}}
\caption{Agent workflow.}
\end{figure}`;

const malformedEnforced = enforceFiguresInProposalLatex(
  `\\documentclass{article}\\begin{document}${malformedFigure}\\end{document}`,
  project
);
assert.equal(malformedEnforced.validations[0].renderedContent.ok, true);

const validation = validateDiagram(steps, { layout, source: overflowFigure, project });
assert.equal(validation.ok, true, validation.issues.join('; '));

const bounded = buildWorkflowDiagramLatex(steps, {
  layout,
  title: 'Agent Workflow Diagram',
  footnote: '(Iterative loop until convergence)'
});

assert.match(bounded, /parbox\{0\.88\\linewidth\}/);
assert.match(bounded, /\\downarrow/);
assert.doesNotMatch(bounded, /@\{\}c@\{[^}]*\\rightarrow/);

const enforced = enforceFiguresInProposalLatex(
  `\\documentclass{article}\\begin{document}${overflowFigure}\\end{document}`,
  project
);

assert.equal(enforced.replaced, 1);
assert.equal(enforced.validations[0].renderedFlow.ok, true);
assert.equal(enforced.validations[0].renderedContent.ok, true);

const contentCheck = verifyRenderedDiagramContent(enforced.latex);
assert.equal(contentCheck.ok, true, contentCheck.issues.join('; '));
assert.ok(contentCheck.nodeCount >= 4);

const document = ensureLayoutPreamble(`\\PassOptionsToPackage{hyphens}{url}
\\documentclass[11pt]{article}
\\usepackage[margin=1in]{geometry}
\\usepackage[hidelinks]{hyperref}
\\usepackage{enumitem}
\\begin{document}
${trainingEnforced.latex.replace(/\\documentclass\{article\}/, '').replace(/\\begin\{document\}/, '').replace(/\\end\{document\}/, '')}
\\end{document}`);

const compiled = await compileLatexDocument(document);
assert.equal(compiled.ok, true, compiled.error || 'training workflow diagram should compile');

const defaultInference = inferWorkflowWithSource(DEFAULT_PROJECT);
assert.ok(defaultInference.steps.length >= 3, 'default project should yield meaningful workflow steps');
assert.notEqual(defaultInference.source, 'generic-fallback', 'default project should not use generic workflow template');
assert.ok(
  !defaultInference.steps.some((step) => isGenericWorkflowStep(step)),
  'default project steps should be grounded, not generic template labels'
);
assert.ok(
  defaultInference.steps.some((step) => /process reward|data pipeline|grpo|fine-tuning/i.test(step)),
  'default project diagram should reflect method or milestone content'
);
const defaultGrounding = validateDiagramGrounding(defaultInference.steps, DEFAULT_PROJECT, {
  source: defaultInference.source
});
assert.equal(defaultGrounding.ok, true, defaultGrounding.issues.join('; '));

const noFigureDoc = String.raw`\documentclass{article}
\begin{document}
\section{Method and Training Workflow}
Train a model with dense rewards and evaluate on benchmarks.
\section{Evaluation Plan}
Metrics and baselines.
\end{document}`;

const injected = enforceFiguresInProposalLatex(noFigureDoc, DEFAULT_PROJECT);
assert.equal(injected.injected, true, 'diagram should be injected when missing');
assert.match(injected.latex, /\\begin\{figure\}/);
assert.equal(injected.validations[0].renderedContent.ok, true, injected.validations[0].renderedContent.issues.join('; '));

const projectFigure = buildProjectWorkflowFigure(DEFAULT_PROJECT);
assert.match(projectFigure.replacement, /Process-Based RL Training Workflow|Training Workflow Diagram/);
assert.doesNotMatch(projectFigure.replacement, /\.\.\./);
assert.equal(projectFigure.validation.renderedContent.ok, true);

const processRlProject = {
  title: 'Process-Based RL for Mathematical Reasoning',
  method:
    'We will use GRPO (Group Relative Policy Optimization) for policy updates. Monte Carlo Tree Search will explore reasoning paths. A process reward model scores intermediate steps using synthetic step-level data.'
};

const processRlInference = inferWorkflowWithSource(processRlProject);
assert.ok(
  processRlInference.steps.length >= 3,
  `expected grounded steps, got: ${processRlInference.steps.join(' | ')}`
);
assert.ok(
  !processRlInference.steps.some((step) => step.endsWith('...')),
  'workflow steps should not be truncated with ellipsis'
);
assert.ok(
  processRlInference.steps.some((step) => /grpo/i.test(step)),
  'diagram should include GRPO step'
);
assert.ok(
  processRlInference.steps.some((step) => /monte carlo tree search/i.test(step)),
  'diagram should include MCTS step'
);
assert.ok(
  processRlInference.steps.some((step) => /step-level data/i.test(step)),
  'diagram should include step-level data step'
);

const processRlFigure = buildProjectWorkflowFigure(processRlProject);
assert.doesNotMatch(processRlFigure.replacement, /\.\.\./);
assert.match(processRlFigure.replacement, /GRPO/i);
assert.match(processRlFigure.replacement, /Monte Carlo Tree Search/i);
assert.match(
  processRlFigure.replacement,
  /process reward model|Process-Based RL/i,
  'caption or title should describe the process-based RL workflow'
);
assert.equal(processRlFigure.validation.renderedContent.ok, true);

const emptyFigureSectionDoc = String.raw`\documentclass{article}
\usepackage{float}
\begin{document}
\section{Method and Training Workflow}
Train a model with dense rewards and evaluate on benchmarks.
\begin{figure}[h]
\centering
\fbox{old diagram}
\caption{Old misplaced diagram}
\end{figure}
\section{Figure}

\section{Expected Results and Research Milestones}
Milestone content.
\end{document}`;

const consolidated = enforceFiguresInProposalLatex(emptyFigureSectionDoc, processRlProject);
assert.match(consolidated.latex, /\\section\{Figure\}[\s\S]*\\begin\{figure\}\[H\]/i);
const methodSectionBody =
  consolidated.latex.match(
    /\\section\{Method and Training Workflow\}([\s\S]*?)\\section\{Figure\}/i
  )?.[1] || '';
assert.doesNotMatch(methodSectionBody, /\\begin\{figure\}/, 'figure should not remain in the Method section');

console.log('PASS NSF-style workflow diagram generation and validation');
