import { buildReferencesLatexSection, buildResourcesLatexSection, ensureLayoutPreamble } from '../server/latexLayout.js';
import { compileLatexDocument } from '../server/pdfExport.js';

const references = buildReferencesLatexSection(
  'Smith et al. (2023). Training Verifiers to Solve Math Word Problems. arXiv. https://doi.org/10.48550/arXiv.2110.14168'
);
const resources = buildResourcesLatexSection(
  'Computing and Infrastructure: GPU cluster with 4x A100 40GB for model training and hyperparameter sweeps.\nData and Model Artifacts: Open-source Llama-3-8B checkpoint https://huggingface.co/meta-llama/Meta-Llama-3-8B for supervised and RL fine-tuning.'
);

const document = ensureLayoutPreamble(`\\PassOptionsToPackage{hyphens}{url}
\\documentclass[11pt]{article}
\\usepackage[margin=1in]{geometry}
\\usepackage[hidelinks]{hyperref}
\\urlstyle{same}
\\begin{document}
\\section{Resources}
${resources}
\\section{References and Assumptions}
${references}
\\end{document}`);

const result = await compileLatexDocument(document);
if (!result.ok) {
  console.error('FAIL', result.error);
  process.exit(1);
}

console.log('PASS resources and references PDF layout compile');
