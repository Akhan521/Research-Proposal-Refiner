import { buildComplianceMatrixFromDraft } from '../server/proposalGenerator.js';
import { DEFAULT_PROJECT, DEFAULT_REQUIREMENTS } from '../shared/mathlmDefaults.js';

const checklist = DEFAULT_REQUIREMENTS.split('\n')
  .slice(1)
  .map((line) => line.replace(/^-\s*/, ''))
  .filter((line) => line.length > 4);

const latex = String.raw`\documentclass[11pt]{article}
\begin{document}
\title{Process-Reward RL}
\maketitle
\begin{abstract}Summary\end{abstract}
\section{Motivation and Gap}Gap text
\section{Project Goal}Goal text
\section{Method and Agent Workflow}Method text
\begin{figure}\caption{Workflow}\end{figure}
\section{Expected Results}Results
\section{Research Milestones and Timeline}Timeline
\section{Evaluation Plan}Metrics
\section{Risks and Mitigation}Risks
\section{Resources and Budget}Resources
\section{References and Assumptions}Refs
\end{document}`;

const matrix = buildComplianceMatrixFromDraft(checklist, DEFAULT_PROJECT, latex, []);
const covered = matrix.filter((row) => row.status === 'Covered').length;
const placeholders = matrix.filter((row) => /API did not provide/i.test(row.evidence)).length;

console.log('empty-api-matrix coverage', `${covered}/${matrix.length}`);
console.log('placeholders', placeholders);
if (covered < checklist.length) {
  matrix.filter((row) => row.status !== 'Covered').forEach((row) => console.log('missing:', row.requirement, row.evidence));
  process.exit(1);
}

console.log('OK');
