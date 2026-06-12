import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCitationRegistry } from '../server/citationEnforce.js';
import { proposalLatexToPdf } from '../server/pdfExport.js';
import { buildComplianceMatrixFromDraft, rebuildEnforcedProposal } from '../server/proposalGenerator.js';
import {
  normalizeEvaluationField,
  normalizeTimelineField
} from '../server/proposalSections.js';
import { validateLatexRedundancy } from '../server/proposalRedundancy.js';
import { SUBMISSION_PROJECT } from '../shared/submissionProject.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const deliverablesDir = join(root, 'deliverables');

const normalizedTimeline = normalizeTimelineField(SUBMISSION_PROJECT.timeline, SUBMISSION_PROJECT);
const normalizedEvaluation = normalizeEvaluationField(
  SUBMISSION_PROJECT.evaluation,
  SUBMISSION_PROJECT
);
const project = {
  ...SUBMISSION_PROJECT,
  timeline: normalizedTimeline.timeline || SUBMISSION_PROJECT.timeline,
  evaluation: normalizedEvaluation.evaluation || SUBMISSION_PROJECT.evaluation
};

const citationRegistry = buildCitationRegistry(project.references || '', []);
const { latex } = rebuildEnforcedProposal(project, { citationRegistry });

const checklist = String(project.requirements || '')
  .split('\n')
  .map((line) => line.replace(/^[-*]\s*/, '').trim())
  .filter((line) => line.length > 4 && !/^proposal must include/i.test(line));
const matrix = buildComplianceMatrixFromDraft(checklist, project, latex, []);
const needsWork = matrix.filter((row) => row.status !== 'Covered');
const redundancy = validateLatexRedundancy(latex);

writeFileSync(join(deliverablesDir, 'proposal.tex'), latex, 'utf8');
const pdf = await proposalLatexToPdf(latex, 'proposal');
writeFileSync(join(deliverablesDir, 'proposal.pdf'), pdf);

console.log('Wrote deliverables/proposal.tex and deliverables/proposal.pdf');
console.log(`Compliance matrix: ${matrix.length - needsWork.length}/${matrix.length} Covered`);
if (needsWork.length) {
  for (const row of needsWork) {
    console.log(`  Needs work: ${row.requirement}`);
    console.log(`    Fix: ${row.fix}`);
  }
}
if (redundancy.issues.length) {
  console.log('Redundancy issues:');
  for (const issue of redundancy.issues) {
    console.log(`  - ${issue}`);
  }
}
