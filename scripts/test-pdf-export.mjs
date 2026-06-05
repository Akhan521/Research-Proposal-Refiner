import { proposalLatexToPdf } from '../server/pdfExport.js';

const minimal = String.raw`\documentclass[11pt]{article}
\usepackage[margin=1in]{geometry}
\begin{document}
Hello PDF
\end{document}`;

try {
  const buf = await proposalLatexToPdf(minimal, 'Test');
  console.log('OK bytes', buf.length);
} catch (e) {
  console.error('FAIL:', e.message);
  process.exit(1);
}
