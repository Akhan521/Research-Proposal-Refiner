export const DEFAULT_REQUIREMENTS = `Proposal must include:
- Project title
- Abstract
- Motivation and gap
- Project goal
- Method or agent workflow
- Figure or diagram with caption
- Expected results
- Research milestones with timeline estimates
- Evaluation plan
- Risks and mitigation
- Resources or budget
- References, assumptions, or source notes`;

export const DEFAULT_PROJECT_TOPIC =
  'Process-based reinforcement learning for mathematical reasoning in language models';

export const DEFAULT_PROJECT = {
  title: 'Process-Reward Reinforcement Learning for Mathematical Reasoning',
  topic: DEFAULT_PROJECT_TOPIC,
  problem:
    'Language models often fail on multi-step math word problems because final-answer supervision is sparse and outcome-only rewards give little signal about intermediate reasoning. Supervised fine-tuning alone frequently plateaus well below reliable accuracy on structured math benchmarks. The open question is whether reinforcement learning with dense, process-level feedback can improve reasoning quality in a compact model without requiring a much larger backbone.',
  method:
    'Train a small open language model with reinforcement learning that combines group-relative policy optimization, multiple sampled solutions per problem, and dense rewards for explicit reasoning steps, arithmetic checks, and optional executable code verification of the answer. Add curriculum scheduling over problem difficulty and self-consistency via majority vote across samples at inference time.',
  evaluation:
    'Measure exact-match accuracy on a standard grade-school math word-problem benchmark. Compare a supervised baseline, a classic PPO-style RL baseline, and the process-reward GRPO-style configuration. Report ablations on reward components, curriculum design, and self-consistency.',
  timeline:
    'Phase 1: Data pipeline and supervised baseline. Phase 2: Reward design and sandboxed code verification. Phase 3: RL training with curriculum and multi-sample rollouts. Phase 4: Self-consistency and hyperparameter sweeps. Phase 5: Final evaluation and error analysis.',
  resources:
    'Open instruction-tuned language model checkpoint, math reasoning dataset, GPU compute for RL training, training codebase, experiment tracking, and course proposal materials.',
  references:
    'Math word-problem benchmarks, reinforcement learning from human/process feedback, group-relative policy optimization, and open LLM fine-tuning literature. Numeric claims from unpublished runs are labeled assumptions.',
  layAbstract:
    'This project asks whether an AI can get better at math word problems by learning from step-by-step feedback and small programs that check its work—not only from whether the final number is right.',
  requirements: DEFAULT_REQUIREMENTS
};

/** @deprecated Use DEFAULT_PROJECT_TOPIC */
export const MATHLM_TOPIC = DEFAULT_PROJECT_TOPIC;

/** @deprecated Use DEFAULT_PROJECT */
export const MATHLM_DEFAULT_PROJECT = DEFAULT_PROJECT;

export function createBlankProject() {
  return {
    title: '',
    topic: '',
    problem: '',
    method: '',
    timeline: '',
    evaluation: '',
    resources: '',
    references: '',
    layAbstract: '',
    requirements: DEFAULT_REQUIREMENTS
  };
}

export function withMathlmDefaults(project = {}) {
  return withDefaultProject(project);
}

export function withDefaultProject(project = {}) {
  return {
    ...createBlankProject(),
    ...DEFAULT_PROJECT,
    ...project,
    requirements: project.requirements || DEFAULT_REQUIREMENTS
  };
}
