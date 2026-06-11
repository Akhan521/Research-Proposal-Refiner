import assert from 'node:assert/strict';
import { DEFAULT_PROJECT } from '../shared/mathlmDefaults.js';
import {
  mapMilestonesToResearchQuestions,
  normalizeTimelineField,
  repairTimelineIfNeeded,
  validateMilestonePlan
} from '../server/proposalSections.js';

const project = { ...DEFAULT_PROJECT };

const complete = validateMilestonePlan(project.timeline, project);
assert.equal(complete.ok, true, complete.issues.concat(complete.warnings).join('; '));
assert.ok(complete.milestoneCount >= 5);
assert.ok(complete.researchQuestionCount >= 1);
assert.equal(complete.uncoveredResearchQuestions, 0);

const mappings = mapMilestonesToResearchQuestions(complete.milestones, complete.researchQuestions);
assert.ok(mappings.every((mapping) => mapping.covered), 'each research question should map to a milestone');

const sparseTimeline = 'Milestone 1: Build prototype.';
const sparseValidation = validateMilestonePlan(sparseTimeline, project);
assert.ok(!sparseValidation.ok);
assert.ok(sparseValidation.issues.some((issue) => /Only 1 milestone/i.test(issue)));

const normalizedSparse = normalizeTimelineField(sparseTimeline, project);
assert.ok(normalizedSparse.timeline.split('\n').filter((line) => /^Milestone/i.test(line)).length >= 3);
assert.ok(normalizedSparse.validation.milestoneCount >= 3);

const repaired = repairTimelineIfNeeded('Week 1: setup only', project);
assert.ok(repaired.repaired);
assert.ok(repaired.validation.milestoneCount >= 3);

console.log('PASS milestone validation, repair, and research-question mapping');
