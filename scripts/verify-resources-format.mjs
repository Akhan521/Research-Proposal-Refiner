import assert from 'node:assert/strict';
import {
  buildResourcesLatexSection,
  normalizeResourcesField,
  parseResourceGroups
} from '../server/resourceFormat.js';
import { ensureLayoutPreamble } from '../server/latexLayout.js';
import { compileLatexDocument } from '../server/pdfExport.js';

const commaBlob =
  'Open instruction-tuned language model checkpoint, math reasoning dataset, GPU compute for RL training, training codebase, experiment tracking, and course proposal materials.';

const normalized = normalizeResourcesField(commaBlob);
assert.ok(normalized.resources.includes('Computing and Infrastructure'), 'computing category present');
assert.ok(normalized.resources.includes('Software and Development Tools'), 'software category present');
assert.ok(normalized.resources.includes('Data and Model Artifacts'), 'data category present');

const grouped = parseResourceGroups(normalized.resources);
assert.ok(grouped.categories.length >= 3, 'multiple resource categories parsed');

const latexBody = buildResourcesLatexSection(normalized.resources);
assert.match(latexBody, /\\subsection\*\{Computing and Infrastructure\}/);
assert.match(latexBody, /\\subsection\*\{Software and Development Tools\}/);
assert.match(latexBody, /The following resources are required/);

const document = ensureLayoutPreamble(`\\PassOptionsToPackage{hyphens}{url}
\\documentclass[11pt]{article}
\\usepackage[margin=1in]{geometry}
\\usepackage[hidelinks]{hyperref}
\\urlstyle{same}
\\usepackage{enumitem}
\\begin{document}
\\section{Resources}
${latexBody}
\\end{document}`);

const result = await compileLatexDocument(document);
assert.equal(result.ok, true, result.error || 'resources PDF should compile');

console.log('PASS formal resources formatting');
