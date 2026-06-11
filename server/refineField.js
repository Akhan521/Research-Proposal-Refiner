import { callModel, clean, getGenerationProviderLabel, parseJsonContent, resolveLlmModel } from './proposalGenerator.js';

const REFINABLE_FIELDS = new Set([
  'problem',
  'method',
  'evaluation',
  'timeline',
  'resources'
]);

const FIELD_CONFIG = {
  problem: {
    label: 'Problem',
    goal: 'Clarify the research gap, motivation, and why the problem matters for a formal NSF-style proposal.',
    rules:
      'Emphasize what is unknown or insufficient today, who is affected, and why existing approaches fall short. Keep claims grounded in the provided project context.'
  },
  method: {
    label: 'Method',
    goal: 'Strengthen the technical approach and workflow so it reads as credible, specific, and executable.',
    rules:
      'Name concrete components, data flow, training or analysis steps, and design choices. Prefer clear step order. Do not invent tools or datasets not implied by the project.'
  },
  evaluation: {
    label: 'Evaluation Plan',
    goal: 'Expand the evaluation plan with research questions, metrics, baselines, ablations, analysis, and success criteria.',
    rules:
      'Use labeled subsections when helpful. Be specific about what will be measured, compared, and reported. Do not claim results that have not been run.'
  },
  timeline: {
    label: 'Research Milestones',
    goal: 'Make milestones and expected results feasible, ordered, and explicitly tied to the research questions and hypotheses in the evaluation plan.',
    rules:
      'Use milestone lines with optional timing (e.g., "Milestone 1 (Weeks 1--3): deliverable") plus a short expected-results summary. Each milestone must name a verifiable deliverable and indicate which research question or hypothesis it supports when possible.'
  },
  resources: {
    label: 'Resources',
    goal: 'Present resources in a formal, feasibility-oriented list suitable for a grant proposal.',
    rules:
      'Group by category such as computing, software, data, and institutional support. One line per item in the form "Category: resource and brief justification."'
  }
};

function buildSystemPrompt(field) {
  const config = FIELD_CONFIG[field] || FIELD_CONFIG.method;

  return `You are refining one section of a research proposal project state before final proposal generation.

Target section: ${config.label}
Goal: ${config.goal}

Return strict JSON:
{
  "value": "the improved section text only",
  "note": "one short sentence describing what you improved"
}

Rules:
- ${config.rules}
- Preserve the project's topic and intent. Stay aligned with the other project fields provided for context.
- Write proposal-ready prose or structured lines, not meta commentary.
- Return only the JSON object.
- The "value" must be ready to paste directly into the project field.`;
}

function buildContextProject(project = {}, field) {
  return {
    title: clean(project.title),
    topic: clean(project.topic),
    problem: field === 'problem' ? undefined : clean(project.problem),
    method: field === 'method' ? undefined : clean(project.method),
    evaluation: field === 'evaluation' ? undefined : clean(project.evaluation),
    timeline: field === 'timeline' ? undefined : clean(project.timeline),
    resources: field === 'resources' ? undefined : clean(project.resources),
    references: field === 'references' ? undefined : clean(project.references)
  };
}

function ensureSentence(text) {
  const value = clean(text);
  if (!value) return '';
  if (/[.!?]$/.test(value)) return value;
  return `${value}.`;
}

function refineLocally({ field, value, guidance, project }) {
  const config = FIELD_CONFIG[field] || FIELD_CONFIG.method;
  const current = clean(value);
  const topic = clean(project.title) || clean(project.topic) || 'this research project';
  const hint = clean(guidance);

  if (field === 'evaluation' && current) {
    const strengthened = current.includes('Research Questions')
      ? current
      : [
        'Research Questions and Hypotheses: Does the proposed approach improve upon the current baseline for this problem?',
        'Metrics and Benchmarks: Define primary outcome metrics and stability or reproducibility measures.',
        'Comparative Baselines: Compare against the strongest credible baseline named in the method.',
        'Ablations and Sensitivity Analysis: Remove or vary key components to test necessity.',
        'Analysis Plan: Report protocols, logged settings, and error analysis.',
        'Success Criteria: Measurable improvement with stable execution and reproducible scripts.',
        current
      ].join('\n');

    return {
      value: strengthened,
      note: 'Expanded the evaluation plan with standard NSF-style subsections.',
      mode: 'local-fallback',
      provider: 'template'
    };
  }

  if (field === 'timeline' && current) {
    const lines = current
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) =>
        /^milestone\s+\d+/i.test(line) ? ensureSentence(line) : `Milestone ${index + 1}: ${ensureSentence(line)}`
      );

    return {
      value: [`Expected results: Deliverables that demonstrate feasibility for ${topic}.`, ...lines].join('\n'),
      note: 'Added expected results and normalized milestone formatting.',
      mode: 'local-fallback',
      provider: 'template'
    };
  }

  if (field === 'resources' && current) {
    return {
      value: current.includes(':')
        ? current
        : [
          'Computing and Infrastructure: GPU or cloud compute for experiments.',
          'Software and Development Tools: Version-controlled code, experiment tracking, and core libraries.',
          'Data and Model Artifacts: Datasets, checkpoints, and evaluation benchmarks required by the method.',
          'Budget and Institutional Support: Course or lab allocation needed to complete the work.',
          current
        ].join('\n'),
      note: 'Organized resources into formal proposal categories.',
      mode: 'local-fallback',
      provider: 'template'
    };
  }

  const lead = current || `This section will describe the ${config.label.toLowerCase()} for ${topic}.`;
  const guidanceSuffix = hint ? ` ${ensureSentence(hint)}` : '';
  const strengthened = `${lead}${guidanceSuffix} This revision adds clearer specificity, stronger proposal language, and tighter alignment with the stated research goal.`;

  return {
    value: strengthened,
    note: `Strengthened ${config.label.toLowerCase()} using the local template fallback.`,
    mode: 'local-fallback',
    provider: 'template'
  };
}

async function refineWithApi({ field, value, guidance, project, llmModel }) {
  const model = resolveLlmModel(llmModel);
  const systemPrompt = buildSystemPrompt(field);
  const payload = {
    field,
    currentValue: clean(value),
    userGuidance: clean(guidance),
    projectContext: buildContextProject(project, field)
  };

  const content = await callModel({
    systemPrompt,
    payload,
    model,
    temperature: 0.35
  });
  const parsed = parseJsonContent(content);
  const refinedValue = clean(parsed.value) || clean(parsed.text) || clean(parsed.content);

  if (!refinedValue) {
    throw new Error('Model did not return refined field content.');
  }

  return {
    value: refinedValue,
    note: clean(parsed.note) || `Strengthened ${FIELD_CONFIG[field]?.label || field}.`,
    mode: 'api',
    provider: getGenerationProviderLabel(model),
    transcript: {
      prompt: { systemPrompt, payload },
      rawResponse: content
    }
  };
}

export async function refineProjectField(payload = {}) {
  const field = clean(payload.field);
  const value = String(payload.value ?? '');
  const guidance = clean(payload.guidance);
  const project = payload.project || {};

  if (!REFINABLE_FIELDS.has(field)) {
    throw new Error(`Field "${field}" cannot be refined.`);
  }

  if (!clean(value) && !guidance) {
    throw new Error('Add some draft text or guidance before asking the model to strengthen this section.');
  }

  if (process.env.LLM_API_KEY && process.env.LLM_API_URL) {
    try {
      return await refineWithApi({
        field,
        value,
        guidance,
        project,
        llmModel: payload.llmModel
      });
    } catch (error) {
      const local = refineLocally({ field, value, guidance, project });
      return {
        ...local,
        warning: error instanceof Error ? error.message : String(error)
      };
    }
  }

  return refineLocally({ field, value, guidance, project });
}
