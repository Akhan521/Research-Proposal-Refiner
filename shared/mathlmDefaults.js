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
    'Research Questions and Hypotheses: Does reinforcement learning with dense, process-level rewards improve exact-match accuracy on multi-step math word problems relative to supervised fine-tuning alone?\nMetrics and Benchmarks: Exact-match accuracy on a standard grade-school math word-problem benchmark; training stability via KL divergence and reward variance; sample efficiency measured by steps to convergence.\nComparative Baselines: (1) supervised fine-tuning only; (2) classic PPO-style RL with outcome-only rewards; (3) proposed GRPO configuration with process rewards and optional code verification.\nAblations and Sensitivity Analysis: Remove individual reward components, disable curriculum scheduling, and vary self-consistency sample counts.\nAnalysis Plan: Report learning curves, error categories, and reproducibility artifacts including logged hyperparameters and evaluation scripts.\nSuccess Criteria: Measurable accuracy gain over the supervised baseline with stable training and documented ablations isolating contributing design choices.',
  timeline:
    'Expected results: A reproducible training codebase, experiment logs, and ablation report documenting how reward design and curriculum choices affect math reasoning accuracy.\nMilestone 1 (Weeks 1--3): Reproduce the data pipeline and supervised fine-tuning baseline with documented exact-match scores.\nMilestone 2 (Weeks 4--6): Implement dense process rewards and sandboxed Python verification; validate reward signals on a held-out development set.\nMilestone 3 (Weeks 7--10): Train GRPO with curriculum scheduling and multi-sample rollouts; monitor stability via KL drift.\nMilestone 4 (Weeks 11--12): Run self-consistency inference and hyperparameter sweeps; compare against the PPO-style baseline.\nMilestone 5 (Weeks 13--14): Conduct final benchmark evaluation, error analysis, and write-up with assumptions clearly labeled.',
  resources:
    'Computing and Infrastructure: GPU access for reinforcement learning training (single A100 or equivalent cloud credits).\nSoftware and Development Tools: PyTorch, Hugging Face Transformers, version-controlled training scripts, and experiment tracking (Weights & Biases or equivalent).\nData and Model Artifacts: Open instruction-tuned language model checkpoint and a standard grade-school math word-problem benchmark.\nBudget and Institutional Support: Course compute allocation, API credentials when configured, and local fallback mode without live API access.',
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
