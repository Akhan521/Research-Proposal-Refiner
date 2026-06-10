import assert from 'node:assert/strict';
import {
  buildFigureEnvironment,
  buildWorkflowDiagramLatex,
  chooseDiagramLayout,
  detectFlowIssues,
  enforceFiguresInProposalLatex,
  normalizeWorkflowOrder,
  parseWorkflowSteps,
  resolveWorkflowSteps,
  sanitizeDiagramLabel,
  validateDiagram,
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
assert.equal(layout, 'rows', 'five-node workflow should use multi-row layout');

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
assert.match(trainingFigure, /majority-vote answer/);

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

assert.match(bounded, /parbox\{0\.27\\linewidth\}/);
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

console.log('PASS NSF-style workflow diagram generation and validation');
