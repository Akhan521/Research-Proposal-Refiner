import assert from 'node:assert/strict';
import { refineProjectField } from '../server/refineField.js';

const project = {
  title: 'Process-Reward RL for Math Reasoning',
  topic: 'Process-based RL for math reasoning',
  problem: 'Compact models struggle on multi-step math.',
  method: 'Train with GRPO and process rewards.',
  evaluation: 'Measure exact-match accuracy.',
  timeline: 'Phase 1 baseline. Phase 2 RL training.',
  resources: 'GPU access and PyTorch.',
  references: 'Math benchmarks and RL papers.'
};

const methodResult = await refineProjectField({
  field: 'method',
  value: project.method,
  guidance: 'Add more detail on reward design and verification.',
  project
});

assert.ok(methodResult.value.length > project.method.length);
assert.equal(methodResult.mode, 'local-fallback');

const evaluationResult = await refineProjectField({
  field: 'evaluation',
  value: project.evaluation,
  project
});

assert.match(evaluationResult.value, /Research Questions and Hypotheses/i);
assert.match(evaluationResult.value, /Success Criteria/i);

console.log('PASS project field refinement');
