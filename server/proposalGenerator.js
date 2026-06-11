import {
  createBlankProject,
  DEFAULT_PROJECT,
  DEFAULT_PROJECT_TOPIC,
  DEFAULT_REQUIREMENTS,
  PROPOSAL_AUTHOR
} from '../shared/mathlmDefaults.js';
import {
  appendReferenceValidationNote,
  limitReferencesForProposal,
  normalizeReferencesField
} from './citationValidate.js';
import {
  appendInTextCitationNote,
  buildCitationRegistry,
  enforceCitationsInProposalLatex,
  finalizeCitationValidation
} from './citationEnforce.js';
import {
  buildReferencesLatexSection,
  buildResourcesLatexSection,
  ensureLayoutPreamble,
  enforceReferencesInProposalLatex,
  enforceResourcesInProposalLatex
} from './latexLayout.js';
import { normalizeResourcesField } from './resourceFormat.js';
import {
  buildAbstractLatexBody,
  buildEvaluationLatexSection,
  buildMilestonesLatexSection,
  enforceAbstractInProposalLatex,
  enforceEvaluationInProposalLatex,
  enforceMilestonesInProposalLatex,
  formatMilestoneValidationNote,
  normalizeEvaluationField,
  normalizeTimelineField,
  validateMilestonePlan
} from './proposalSections.js';
import {
  appendDiagramValidationNote,
  buildProjectWorkflowFigure,
  enforceFiguresInProposalLatex,
  inferWorkflowStepsFromProject
} from './latexDiagram.js';
import { repairStructuralLatex } from './latexRepair.js';
import { repairUnescapedSpecialChars, validateProposalLatex } from './latexValidate.js';
import {
  appendRedundancyNote,
  prepareProjectForProposal,
  validateLatexRedundancy
} from './proposalRedundancy.js';

const EMPTY_PROJECT_FOR_SERVER = createBlankProject();
const PROJECT_FALLBACKS = DEFAULT_PROJECT;

const SYSTEM_PROMPT = `You are a research proposal agent for a CS research proposal.

Return strict JSON with this shape:
{
  "proposalLatex": "complete, compile-ready LaTeX source for proposal.tex",
  "complianceMatrix": [
    {
      "requirement": "requirement text",
      "status": "Covered | Needs work",
      "evidence": "short evidence",
      "fix": "short next action"
    }
  ],
  "evaluationReport": "plain text or Markdown report with missing items, weak claims, timeline risks, and revision priorities",
  "questions": ["short clarifying question"]
}

Rules:
- Output must be JSON only. No preamble, no markdown, no code fences.
- The payload includes a checklist array. The complianceMatrix must include exactly one row per checklist item, in the same order, and each "requirement" must match the checklist text exactly.
- The proposal artifact must be LaTeX, not Markdown.
- Return a complete LaTeX document with \\documentclass[11pt]{article}, 1-inch margins, title, sections, and bibliography/source notes.
- Use compile-safe LaTeX. Avoid minted, shell-escape, external images, custom fonts, or packages that require extra system tools.
- Do not use \\includegraphics or reference external image files. Build figures directly in LaTeX with text boxes, minipages, tabular layouts, lists, or simple arrows.
- Workflow diagrams are rebuilt at export time from grounded proposal content (project.method arrow chains, numbered method steps, LaTeX method items, and timeline milestones) as a top-down vertical flow with downward arrows between stacked nodes. Use 3--6 concise step names in execution order (e.g., "Problem Input -> Step Generator -> Policy Update" in method text); do not put LaTeX formatting commands inside node labels. If no figure is present, one is inserted after the Method section automatically. Generic template steps are replaced with project-specific steps when possible. Horizontal layouts, backward arrows, out-of-order steps, and leaked markup are corrected automatically.
- Avoid redundant or repetitive prose across sections. Do not repeat the same sentence in Motivation, Method, Evaluation, or Milestones; each section should add new detail.
- Ensure LaTeX compiles under Tectonic: escape special characters in text (\\&, \\%, \\#, \\_, \\{, \\}) and avoid stray $.
- Write the final artifact as a research proposal, not as a short course implementation report.
- Keep the proposed research plan credible, appropriately scoped, and supported by milestones, resources, risks, and evaluation criteria.
- Mark unsupported claims as assumptions.
- Include a concrete agent workflow when the method involves an agent.
- Include at least one LaTeX-native figure, diagram, workflow chart, or architecture sketch with a caption.
- Use only citation strings from project.references in the References section (at most five sources). Do not invent, rename, or add citations that are not listed in project.references.
- Include in-text citations with natbib: add \\usepackage[round,authoryear]{natbib} and cite sources using \\citep{key} in Motivation, Method, and Evaluation sections. Use only keys from citationKeys in the payload. The bibliography is rebuilt at export from verified Sources.
- The Resources section is rebuilt from project.resources at export time. Keep that field organized by category (computing, software, data, budget/support) with concrete, feasibility-oriented items. Do not invent resources that are not listed in project.resources.
- The abstract is rebuilt at export time from project fields. Write NSF-style prose: clear problem/gap, specific objective, credible approach, evaluation criteria, and expected outcomes (roughly 150--250 words). When citing prior work in the abstract, use \\citep{key} with keys from citationKeys only.
- Expected Results and Research Milestones are rebuilt from project.timeline. Use milestone lines with optional timing (e.g., "Milestone 1 (Weeks 1--3): deliverable") plus explicit expected results. Each milestone must name a verifiable deliverable and show how the work will address the research questions and hypotheses in project.evaluation.
- The Evaluation Plan is rebuilt from project.evaluation. Include research questions, metrics/benchmarks, baselines, ablations, analysis plan, and success criteria with enough detail for formal review. State hypotheses explicitly when applicable.
- Mark only unsupported claims as assumptions when references are missing or vague.
- If the project provides a "layAbstract", add a short "Plain-Language Summary" section near the top that uses that accessible text so non-expert readers can understand the work.`;

const QUESTION_SYSTEM_PROMPT = `You are running an interactive proposal-agent workflow.

Return strict JSON:
{
  "project": {
    "title": "",
    "problem": "",
    "method": "",
    "timeline": "",
    "evaluation": "",
    "resources": "",
    "references": ""
  },
  "fieldSuggestions": [
    {
      "field": "title | problem | method | timeline | evaluation | resources | references",
      "label": "human-readable label",
      "value": "specific suggested content",
      "confidence": "High | Medium | Low",
      "reason": "why this suggestion fits the rough idea"
    }
  ],
  "decisions": [
    {
      "id": "short-stable-id",
      "title": "decision title",
      "field": "problem | method | timeline | evaluation | resources | references",
      "question": "context-aware decision prompt",
      "options": [
        {
          "label": "short option label",
          "value": "content to write into the project state",
          "rationale": "when this option is a good fit"
        }
      ]
    }
  ],
  "questions": [
    {
      "field": "problem | method | evaluation | timeline | resources | references",
      "question": "one concise question",
      "reason": "why this answer matters",
      "priority": "High | Medium | Low"
    }
  ],
  "updates": ["short state update"]
}

First infer concrete proposal data from the rough idea. Give the user suggested data and selectable options before asking open-ended questions. Ask open-ended questions only for information that cannot be reasonably inferred.

When task is "refine-structure", the user skipped or rejected a suggestion or decision as off-topic or unhelpful. Honor their guidance exactly. Regenerate fresh fieldSuggestions and/or decisions aligned with project.title and project.topic. Do not repeat rejected content. Keep returned project fields identical to the input project unless guidance requires a small topic-alignment fix. Prefer concrete, on-topic suggestions over generic placeholders.

For the resources field, write formal proposal-ready entries grouped by category (Computing and Infrastructure, Software and Development Tools, Data and Model Artifacts, Budget and Institutional Support). Use one line per item in the form "Category: specific resource and brief justification."

For timeline, write milestone lines ("Milestone N (timing): deliverable") and a leading expected-results summary. Tie later milestones to evaluation of the stated research questions and hypotheses. For evaluation, write labeled lines for research questions, metrics, baselines, ablations, analysis plan, and success criteria.`;

export async function startAgentSession(payload) {
  const project = normalizePayload(payload);
  const checklist = extractChecklist(project.requirements || DEFAULT_REQUIREMENTS);

  if (process.env.LLM_API_KEY && process.env.LLM_API_URL) {
    const result = await refineProjectWithApi({
      task: 'start',
      project,
      checklist,
      activeQuestion: null,
      answer: '',
      llmModel: payload.llmModel
    });

    return {
      ...result,
      project: keepOnlyAcceptedStartFields(project, result.project),
      checklist,
      inputSummary: summarizeProjectInput(result.project),
      runMessage: `Initialized topic and prepared ${result.fieldSuggestions.length} suggested field(s) and ${result.decisions.length} decision card(s).`
    };
  }

  const questions = buildQuestionObjects(project);
  const fieldSuggestions = buildFieldSuggestions(project);
  const decisions = buildDecisionCards(project);

  return {
    mode: 'local-fallback',
    provider: 'template',
    project,
    checklist,
    suggestedProject: projectFromSuggestions(project, fieldSuggestions),
    fieldSuggestions,
    decisions,
    questions,
    inputSummary: summarizeProjectInput(project),
    updates: [`Initialized topic: ${project.title}.`],
    runMessage: `Initialized topic and prepared ${fieldSuggestions.length} fallback suggestion(s).`,
    transcript: {
      prompt: { task: 'start', project, checklist },
      rawResponse: 'Generated by local fallback because LLM_API_KEY or LLM_API_URL is not configured.'
    }
  };
}

export async function answerAgentQuestion(payload) {
  const project = normalizePayload(payload.project || payload);
  const checklist = extractChecklist(project.requirements || payload.requirements || DEFAULT_REQUIREMENTS);
  const activeQuestion = normalizeQuestion(payload.question);
  const answer = clean(payload.answer);

  if (process.env.LLM_API_KEY && process.env.LLM_API_URL) {
    const result = await refineProjectWithApi({
      task: 'integrate-answer',
      project,
      checklist,
      activeQuestion,
      answer,
      llmModel: payload.llmModel
    });

    return {
      ...result,
      checklist,
      inputSummary: summarizeProjectInput(result.project),
      runMessage: result.updates.join(' ') || 'Integrated answer with model reasoning.'
    };
  }

  const integration = integrateAnswerLocally(project, answer, activeQuestion);
  const questions = buildQuestionObjects(integration.project);

  return {
    mode: 'local-fallback',
    provider: 'template',
    project: integration.project,
    checklist,
    suggestedProject: projectFromSuggestions(integration.project, buildFieldSuggestions(integration.project)),
    fieldSuggestions: buildFieldSuggestions(integration.project),
    decisions: buildDecisionCards(integration.project),
    questions,
    inputSummary: summarizeProjectInput(integration.project),
    updates: integration.updates,
    runMessage: `${integration.updates.join(' ')} ${questions.length} follow-up question(s) remain.`.trim(),
    transcript: {
      prompt: { task: 'integrate-answer', project, activeQuestion, answer, checklist },
      rawResponse: 'Integrated by local fallback because LLM_API_KEY or LLM_API_URL is not configured.'
    }
  };
}

export async function refineAgentStructure(payload) {
  const project = normalizePayload(payload.project || payload);
  const checklist = extractChecklist(project.requirements || payload.requirements || DEFAULT_REQUIREMENTS);
  const guidance = clean(payload.guidance);
  const scope = clean(payload.scope) || 'both';
  const rejected = payload.rejected || null;
  const currentFieldSuggestions = Array.isArray(payload.fieldSuggestions) ? payload.fieldSuggestions : [];
  const currentDecisions = Array.isArray(payload.decisions) ? payload.decisions : [];

  if (process.env.LLM_API_KEY && process.env.LLM_API_URL) {
    try {
      const result = await refineProjectWithApi({
        task: 'refine-structure',
        project,
        checklist,
        activeQuestion: null,
        answer: '',
        guidance,
        scope,
        rejected,
        currentFieldSuggestions,
        currentDecisions,
        llmModel: payload.llmModel
      });

      return {
        ...result,
        project,
        checklist,
        runMessage:
          result.updates.join(' ') ||
          `Regenerated structuring ideas${guidance ? ' using your guidance' : ''}.`
      };
    } catch (error) {
      const rebuiltSuggestions = buildFieldSuggestions(project);
      const rebuiltDecisions = buildDecisionCards(project);
      const fieldSuggestions =
        payload.scope === 'suggestion' && currentFieldSuggestions.length
          ? mergeRegeneratedSuggestionsInOrder(
            currentFieldSuggestions,
            rebuiltSuggestions,
            rejected,
            payload.rejectedIndex
          )
          : filterRejectedStructureItem(
            rebuiltSuggestions,
            rejected?.type === 'suggestion' ? rejected.item : null,
            'suggestion'
          );
      const decisions =
        payload.scope === 'decision' && currentDecisions.length
          ? mergeRegeneratedDecisionsInOrder(currentDecisions, rebuiltDecisions, rejected?.item?.id)
          : filterRejectedStructureItem(
            rebuiltDecisions,
            rejected?.type === 'decision' ? rejected.item : null,
            'decision'
          );
      const detail = error instanceof Error ? error.message : String(error);

      return {
        mode: 'local-fallback',
        provider: 'template',
        project,
        checklist,
        suggestedProject: projectFromSuggestions(project, fieldSuggestions),
        fieldSuggestions,
        decisions,
        questions: buildQuestionObjects(project),
        updates: [
          guidance ? `Noted guidance: ${guidance}` : 'Regenerated structuring ideas locally.',
          `Model refine failed (${detail}). Used on-topic template suggestions instead.`
        ],
        runMessage: `Regenerated ${fieldSuggestions.length} suggestion(s) and ${decisions.length} decision card(s) locally after a model error.`,
        transcript: {
          prompt: { task: 'refine-structure', project, guidance, scope, rejected },
          rawResponse: detail
        }
      };
    }
  }

  const rebuiltSuggestions = buildFieldSuggestions(project);
  const rebuiltDecisions = buildDecisionCards(project);
  const fieldSuggestions =
    scope === 'suggestion' && currentFieldSuggestions.length
      ? mergeRegeneratedSuggestionsInOrder(
        currentFieldSuggestions,
        rebuiltSuggestions,
        rejected,
        payload.rejectedIndex
      )
      : filterRejectedStructureItem(
        rebuiltSuggestions,
        rejected?.type === 'suggestion' ? rejected.item : null,
        'suggestion'
      );
  const decisions =
    scope === 'decision' && currentDecisions.length
      ? mergeRegeneratedDecisionsInOrder(currentDecisions, rebuiltDecisions, rejected?.item?.id)
      : filterRejectedStructureItem(
        rebuiltDecisions,
        rejected?.type === 'decision' ? rejected.item : null,
        'decision'
      );

  return {
    mode: 'local-fallback',
    provider: 'template',
    project,
    checklist,
    suggestedProject: projectFromSuggestions(project, fieldSuggestions),
    fieldSuggestions,
    decisions,
    questions: buildQuestionObjects(project),
    updates: guidance
      ? [`Noted guidance: ${guidance}`, 'Regenerated structuring ideas from the current project state.']
      : ['Regenerated structuring ideas from the current project state.'],
    runMessage: `Regenerated ${fieldSuggestions.length} suggestion(s) and ${decisions.length} decision card(s) locally.`,
    transcript: {
      prompt: { task: 'refine-structure', project, guidance, scope, rejected },
      rawResponse: 'Generated by local fallback because LLM_API_KEY or LLM_API_URL is not configured.'
    }
  };
}

export async function generateProposal(payload) {
  const project = normalizePayload(payload.project || payload);
  const knownPapers = Array.isArray(payload.literaturePapers) ? payload.literaturePapers : [];
  const limitedReferences = limitReferencesForProposal(project.references, knownPapers);
  const limitedKnownPapers = limitedReferences.knownPapers;
  const normalizedResources = normalizeResourcesField(project.resources);
  const normalizedTimeline = normalizeTimelineField(project.timeline, project);
  const normalizedEvaluation = normalizeEvaluationField(project.evaluation, project);
  const normalizedProject = {
    ...project,
    references: limitedReferences.references || project.references,
    resources: normalizedResources.resources || project.resources,
    timeline: normalizedTimeline.timeline || project.timeline,
    evaluation: normalizedEvaluation.evaluation || project.evaluation
  };
  const preparedProject = prepareProjectForProposal(normalizedProject);
  const projectForDraft = preparedProject.project;
  const redundancyPrecheck = {
    ...preparedProject.validation,
    scrubbed: preparedProject.scrubbed
  };
  const citationRegistry = buildCitationRegistry(
    projectForDraft.references || '',
    limitedKnownPapers
  );
  const requirements = projectForDraft.requirements || DEFAULT_REQUIREMENTS;
  const checklist = extractChecklist(requirements);

  const result =
    process.env.LLM_API_KEY && process.env.LLM_API_URL
      ? await generateWithApi(projectForDraft, checklist, payload.llmModel)
      : generateLocally(projectForDraft, checklist);

  return finalizeProposalOutput(result, projectForDraft, checklist, {
    referenceReport: limitedReferences.report,
    knownPapers: limitedKnownPapers,
    milestoneValidation: normalizedTimeline.validation,
    citationRegistry,
    redundancyPrecheck
  });
}

export function resolveLlmModel(override) {
  const model = clean(override) || clean(process.env.LLM_MODEL);

  if (process.env.LLM_API_KEY && process.env.LLM_API_URL && !model) {
    throw new Error('LLM_MODEL is required (set LLM_MODEL in .env or pass llmModel in the request).');
  }

  return model;
}

export function getLlmPublicConfig() {
  const configured = Boolean(process.env.LLM_API_KEY && process.env.LLM_API_URL);
  const url = clean(process.env.LLM_API_URL);
  let apiHost = '';

  if (url) {
    try {
      apiHost = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      apiHost = '';
    }
  }

  const defaultModel = clean(process.env.LLM_MODEL);
  const openRouter = apiHost.includes('openrouter.ai');
  const availableModels = getConfiguredModelOptions(defaultModel);

  return {
    configured,
    provider: configured ? getProvider() : 'local-fallback',
    defaultModel,
    apiHost,
    openRouter,
    availableModels,
    suggestedModels: availableModels
  };
}

function getConfiguredModelOptions(defaultModel) {
  const allowed = clean(process.env.LLM_ALLOWED_MODELS);
  const models = allowed
    ? allowed
      .split(/[,;\n]+/)
      .map((entry) => clean(entry))
      .filter(Boolean)
    : [];

  if (defaultModel && !models.includes(defaultModel)) {
    models.unshift(defaultModel);
  }

  return [...new Set(models)];
}

async function refineProjectWithApi(payload) {
  const model = resolveLlmModel(payload.llmModel);

  const content = await callModel({
    systemPrompt: QUESTION_SYSTEM_PROMPT,
    payload,
    model,
    temperature: 0.2
  });
  const parsed = parseJsonContent(content);
  const nextProject =
    payload.task === 'refine-structure'
      ? payload.project
      : mergeProject(payload.project, normalizePayload(parsed.project || {}));
  let fieldSuggestions = normalizeFieldSuggestions(parsed.fieldSuggestions, nextProject);
  let decisions = normalizeDecisions(parsed.decisions, nextProject);

  if (payload.task === 'refine-structure') {
    const rejectedId = clean(payload.rejected?.item?.id);

    if (payload.scope === 'suggestion' && Array.isArray(payload.currentFieldSuggestions) && payload.currentFieldSuggestions.length) {
      fieldSuggestions = mergeRegeneratedSuggestionsInOrder(
        payload.currentFieldSuggestions,
        fieldSuggestions,
        payload.rejected,
        payload.rejectedIndex
      );
      if (Array.isArray(payload.currentDecisions) && payload.currentDecisions.length) {
        decisions = payload.currentDecisions;
      }
    } else if (payload.scope === 'decision' && Array.isArray(payload.currentDecisions) && payload.currentDecisions.length) {
      decisions = mergeRegeneratedDecisionsInOrder(payload.currentDecisions, decisions, rejectedId);
      if (Array.isArray(payload.currentFieldSuggestions) && payload.currentFieldSuggestions.length) {
        fieldSuggestions = payload.currentFieldSuggestions;
      }
    } else {
      if (Array.isArray(payload.currentFieldSuggestions) && payload.currentFieldSuggestions.length) {
        fieldSuggestions = mergeRegeneratedSuggestionsInOrder(
          payload.currentFieldSuggestions,
          fieldSuggestions,
          payload.rejected,
          payload.rejectedIndex
        );
      }
      if (Array.isArray(payload.currentDecisions) && payload.currentDecisions.length) {
        decisions = mergeRegeneratedDecisionsInOrder(payload.currentDecisions, decisions, rejectedId);
      }
    }
  }

  const questions = normalizeQuestions(parsed.questions, nextProject);

  return {
    mode: 'api',
    provider: getGenerationProviderLabel(model),
    project: nextProject,
    suggestedProject: nextProject,
    fieldSuggestions,
    decisions,
    questions,
    updates: Array.isArray(parsed.updates) ? parsed.updates.map(clean).filter(Boolean) : ['Updated project state.'],
    transcript: {
      prompt: payload,
      rawResponse: content
    }
  };
}

async function generateWithApi(project, checklist, llmModel) {
  const model = resolveLlmModel(llmModel);

  const promptPayload = {
    project,
    checklist,
    citationKeys: buildCitationRegistry(project.references || '', []).entries.slice(0, 5).map((entry) => ({
      key: entry.key,
      inText: entry.inTextParenthetical,
      title: entry.title
    })),
    workflowDiagramHint: inferWorkflowStepsFromProject(project).join(' -> '),
    outputContract: {
      proposalLatex: 'Complete compile-ready LaTeX source for proposal.tex',
      complianceMatrix: 'Array of requirement coverage rows',
      evaluationReport: 'Plain text or Markdown self-evaluation',
      questions: 'Remaining clarifying questions'
    }
  };

  const content = await callModel({
    systemPrompt: SYSTEM_PROMPT,
    payload: promptPayload,
    model,
    temperature: 0.2
  });
  const parsed = parseJsonContent(content);

  return {
    mode: 'api',
    provider: getGenerationProviderLabel(model),
    ...coerceResult(parsed, project, checklist),
    transcript: {
      prompt: promptPayload,
      rawResponse: content
    }
  };
}

export async function callModel({ systemPrompt, payload, model, temperature }) {
  if (getProvider() === 'gemini') {
    return callGemini({ systemPrompt, payload, model, temperature });
  }

  return callOpenAiCompatible({ systemPrompt, payload, model, temperature });
}

async function callGemini({ systemPrompt, payload, model, temperature }) {
  const baseUrl = clean(process.env.LLM_API_URL) || 'https://generativelanguage.googleapis.com/v1beta';
  const endpoint = `${baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.LLM_API_KEY
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: JSON.stringify(payload, null, 2) }]
        }
      ],
      generationConfig: {
        temperature,
        responseMimeType: 'application/json'
      }
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || `Gemini API returned ${response.status}`);
  }

  const content = data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text)
    .filter(Boolean)
    .join('\n');

  if (!content) {
    throw new Error('Gemini API returned no text content.');
  }

  return content;
}

async function callOpenAiCompatible({ systemPrompt, payload, model, temperature }) {
  const headers = {
    Authorization: `Bearer ${process.env.LLM_API_KEY}`,
    'Content-Type': 'application/json'
  };
  const apiUrl = clean(process.env.LLM_API_URL).toLowerCase();

  if (apiUrl.includes('openrouter.ai')) {
    headers['HTTP-Referer'] =
      clean(process.env.OPENROUTER_HTTP_REFERER) || 'http://127.0.0.1:5174';
    headers['X-Title'] = clean(process.env.OPENROUTER_APP_TITLE) || 'Research Proposal Agent';
  }

  const response = await fetch(process.env.LLM_API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: Number(process.env.LLM_MAX_TOKENS) || 16384,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify(payload, null, 2) }
      ]
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || `API returned ${response.status}`);
  }

  return readModelContent(data);
}

function buildEnforcedProposalLatex(baseLatex, project, options = {}) {
  const title = project.title || project.topic || 'proposal';
  const cleanedBase = repairUnescapedSpecialChars(
    repairStructuralLatex(String(baseLatex || ''), {
      title,
      author: PROPOSAL_AUTHOR
    })
  );
  const resourceEnforcement = enforceResourcesInProposalLatex(
    cleanedBase,
    project.resources || ''
  );
  const referenceEnforcement = enforceCitationsInProposalLatex(
    resourceEnforcement.latex,
    project,
    options.citationRegistry,
    options.knownPapers || []
  );
  const abstractEnforcement = enforceAbstractInProposalLatex(
    referenceEnforcement.latex,
    project,
    options.citationRegistry || referenceEnforcement.registry
  );
  const milestoneEnforcement = enforceMilestonesInProposalLatex(
    abstractEnforcement.latex,
    project.timeline || '',
    project
  );
  const evaluationEnforcement = enforceEvaluationInProposalLatex(
    milestoneEnforcement.latex,
    project.evaluation || '',
    project
  );
  const figureEnforcement = enforceFiguresInProposalLatex(evaluationEnforcement.latex, project);
  let layoutLatex = ensureLayoutPreamble(figureEnforcement.latex);
  const citationFinalize = finalizeCitationValidation(
    layoutLatex,
    options.citationRegistry || referenceEnforcement.registry
  );
  layoutLatex = repairStructuralLatex(citationFinalize.latex, {
    title: project.title || project.topic || 'proposal',
    author: PROPOSAL_AUTHOR
  });

  return {
    latex: layoutLatex,
    resourceEnforcement,
    referenceEnforcement,
    abstractEnforcement,
    milestoneEnforcement,
    evaluationEnforcement,
    figureEnforcement,
    citationFinalize
  };
}

async function finalizeProposalOutput(result, project, checklist, options = {}) {
  const title = project.title || project.topic || 'proposal';
  const draftSources = [
    { label: 'enforced-draft', source: result.proposalLatex },
    { label: 'repaired-draft', source: repairUnescapedSpecialChars(result.proposalLatex) },
    { label: 'local-fallback', source: buildLocalProposalLatex(project) }
  ];

  let validation = null;
  let enforced = null;

  for (const candidate of draftSources) {
    const source = String(candidate.source || '').trim();
    if (!source) continue;

    enforced = buildEnforcedProposalLatex(source, project, options);
    validation = await validateProposalLatex(enforced.latex, title, {
      fallbackLatex: buildLocalProposalLatex(project),
      author: PROPOSAL_AUTHOR
    });
    validation = {
      ...validation,
      usedFallback: candidate.label === 'local-fallback',
      repaired: candidate.label !== 'enforced-draft' || validation.repaired
    };

    if (validation.validated || validation.compilerUnavailable) {
      break;
    }
  }

  if (!validation?.validated && !validation?.compilerUnavailable) {
    enforced = buildEnforcedProposalLatex(buildLocalProposalLatex(project), project, options);
    validation = await validateProposalLatex(enforced.latex, title, {
      fallbackLatex: buildLocalProposalLatex(project),
      author: PROPOSAL_AUTHOR
    });
    validation = {
      ...validation,
      usedFallback: true,
      repaired: true,
      warning:
        validation.warning ||
        'LaTeX compile verification failed after export enforcement; substituted compile-safe fallback proposal.'
    };
  }

  let layoutLatex = validation.latex;
  const finalCheck = await validateProposalLatex(layoutLatex, title, {
    fallbackLatex: buildLocalProposalLatex(project),
    author: PROPOSAL_AUTHOR
  });
  if (finalCheck.validated) {
    layoutLatex = finalCheck.latex;
    validation = {
      ...validation,
      ...finalCheck,
      usedFallback: validation.usedFallback || finalCheck.usedFallback,
      repaired: validation.repaired || finalCheck.repaired
    };
  } else if (!validation.compilerUnavailable) {
    validation = {
      ...finalCheck,
      usedFallback: true,
      warning:
        finalCheck.warning ||
        'Final LaTeX compile verification failed; returned the best available compile-safe draft.'
    };
    layoutLatex = finalCheck.latex;
  }
  const resourceEnforcement = enforced.resourceEnforcement;
  const referenceEnforcement = enforced.referenceEnforcement;
  const figureEnforcement = enforced.figureEnforcement;
  const citationFinalize = enforced.citationFinalize;

  const complianceMatrix = buildComplianceMatrixFromDraft(
    checklist,
    project,
    layoutLatex,
    result.complianceMatrix
  );
  let evaluationReport = appendLatexValidationNote(result.evaluationReport, validation);
  evaluationReport = appendReferenceValidationNote(
    evaluationReport,
    options.referenceReport,
    referenceEnforcement
  );
  evaluationReport = appendInTextCitationNote(evaluationReport, {
    ...referenceEnforcement,
    inTextCount: citationFinalize.inTextCount,
    validation: citationFinalize.validation
  });
  evaluationReport = appendDiagramValidationNote(evaluationReport, figureEnforcement);
  evaluationReport = appendMilestoneValidationNote(
    evaluationReport,
    options.milestoneValidation || milestoneEnforcement.validation
  );
  const redundancyPostcheck = validateLatexRedundancy(layoutLatex);
  evaluationReport = appendRedundancyNote(evaluationReport, {
    precheck: options.redundancyPrecheck || {},
    postcheck: redundancyPostcheck
  });

  return {
    ...result,
    proposalLatex: layoutLatex,
    complianceMatrix,
    evaluationReport,
    latexValidation: {
      validated: validation.validated,
      repaired: validation.repaired,
      usedFallback: validation.usedFallback,
      warning: validation.warning || '',
      attempts: validation.attempts || []
    },
    referenceValidation: {
      entryCount: referenceEnforcement.entryCount,
      sectionReplaced: referenceEnforcement.replaced,
      inTextCount: citationFinalize.inTextCount || referenceEnforcement.inTextCount || 0,
      bibliographyCount: referenceEnforcement.bibliographyCount || 0,
      citationValidation: citationFinalize.validation,
      ...(options.referenceReport || {})
    },
    diagramValidation: {
      figuresRebuilt: figureEnforcement.replaced || 0,
      figureInjected: Boolean(figureEnforcement.injected),
      validations: figureEnforcement.validations || []
    }
  };
}

function appendMilestoneValidationNote(report, validation) {
  const base = clean(report) || '# Evaluation Report\n\nNo evaluation report returned.';
  const note = formatMilestoneValidationNote(validation);
  if (!note) return base;
  return `${base}${note}`;
}

function appendLatexValidationNote(report, validation) {
  const base = clean(report) || '# Evaluation Report\n\nNo evaluation report returned.';
  const notes = [];

  if (validation.usedFallback) {
    notes.push('- LaTeX compile verification failed for the model draft, so a compile-safe fallback proposal was substituted.');
  } else if (validation.repaired) {
    notes.push('- LaTeX compile verification repaired structural or escaping issues before export.');
  } else if (validation.validated) {
    notes.push('- LaTeX compile verification passed on the final enforced proposal.');
  }

  for (const issue of validation.structureAudit?.issues || []) {
    notes.push(`- Structure check: ${issue}`);
  }

  if (!validation.validated) {
    for (const attempt of validation.attempts || []) {
      if (attempt.error) {
        notes.push(`- Compile attempt (${attempt.label}) failed: ${attempt.error}`);
      }
    }
  }

  if (validation.warning) {
    notes.push(`- ${validation.warning}`);
  }

  if (!notes.length) {
    return base;
  }

  return `${base}\n\n## LaTeX Validation\n${notes.join('\n')}\n`;
}

function generateLocally(project, checklist) {
  const questions = buildQuestions(project);
  const proposalLatex = buildLocalProposalLatex(project);
  const complianceMatrix = checklist.map((requirement) => {
    const evidence = findRequirementEvidence(requirement, project);

    return {
      requirement,
      status: evidence ? 'Covered' : 'Needs work',
      evidence: evidence || 'No strong evidence in the current project state.',
      fix: evidence ? 'Keep this section specific.' : `Add concrete detail for: ${requirement}.`
    };
  });

  const needsWork = complianceMatrix.filter((row) => row.status === 'Needs work');
  const evaluationReport = `# Evaluation Report

## Summary
- Mode: local deterministic fallback.
- Covered requirements: ${complianceMatrix.length - needsWork.length}/${complianceMatrix.length}.
- Remaining questions: ${questions.length}.

## Weak Claims And Risks
${needsWork.length ? needsWork.map((row) => `- ${row.requirement}: ${row.fix}`).join('\n') : '- No missing checklist items detected by the fallback checker.'}

## Revision Priorities
${questions.length ? questions.map((question) => `- ${question}`).join('\n') : '- Draft is ready for API-backed review or human revision.'}
`;

  return {
    mode: 'local-fallback',
    provider: 'template',
    proposalLatex,
    complianceMatrix,
    evaluationReport,
    questions,
    transcript: {
      prompt: { project, checklist },
      rawResponse: 'Generated by local fallback because LLM_API_KEY or LLM_API_URL is not configured.'
    }
  };
}

export function buildFallbackProposalLatex(project) {
  return buildLocalProposalLatex(project);
}

function buildLocalProposalLatex(project) {
  const title = project.title || project.topic;
  const problem = project.problem || PROJECT_FALLBACKS.problem;
  const method = project.method || PROJECT_FALLBACKS.method;
  const evaluation = project.evaluation || PROJECT_FALLBACKS.evaluation;
  const timeline = project.timeline || PROJECT_FALLBACKS.timeline;
  const resources = project.resources || PROJECT_FALLBACKS.resources;
  const references = project.references || PROJECT_FALLBACKS.references;

  return String.raw`\PassOptionsToPackage{hyphens}{url}
\documentclass[11pt]{article}
\usepackage[margin=1in]{geometry}
\usepackage[hidelinks]{hyperref}
\urlstyle{same}
\setlength{\emergencystretch}{3em}
\usepackage{enumitem}
\setlist[itemize]{leftmargin=*,itemsep=0.35em,parsep=0pt,topsep=0.35em,partopsep=0pt}
\setlist{nosep}
\title{${escapeLatex(title)}}
\author{${escapeLatex(PROPOSAL_AUTHOR)}}
\date{}

\begin{document}
\maketitle

\section*{Abstract}
${buildAbstractLatexBody(project)}
${plainLanguageSummarySection(project)}
\section{Motivation and Gap}
${latexParagraph(problem)}

\section{Project Goal}
Show that a process-reward RL stack with curriculum learning and self-consistency can improve exact-match accuracy on math word problems relative to supervised fine-tuning alone, while remaining more stable than naive PPO training.

\section{Method and Training Workflow}
${latexParagraph(method)}

\begin{enumerate}
\item Prepare a math reasoning dataset and fine-tune an open instruction-tuned model with a supervised baseline.
\item Score rollouts with dense rewards for reasoning steps, arithmetic, and sandboxed Python verification.
\item Optimize with GRPO (KL-penalized, multiple generations per prompt) under a difficulty curriculum.
\item Aggregate predictions with self-consistency majority vote at inference time.
\item Evaluate exact-match accuracy and ablate reward components.
\end{enumerate}

\section{Figure}
${buildProjectWorkflowFigure(project).replacement}

\section{Expected Results and Research Milestones}
${buildMilestonesLatexSection(timeline, project)}

\section{Evaluation Plan}
${buildEvaluationLatexSection(evaluation, project)}

\section{Risks and Mitigation}
\begin{itemize}
\item PPO instability or collapse: prefer GRPO updates and monitor KL drift.
\item Reward hacking on format alone: require executable Python checks for answer verification.
\item Curriculum too aggressive: validate per difficulty bucket before full training.
\item Compute limits on 2B RL: checkpoint often and scope ablations.
\end{itemize}

\section{Resources}
${buildResourcesLatexSection(resources)}

\section{References and Assumptions}
${buildReferencesLatexSection(references)}

\end{document}
`;
}

function buildQuestions(project) {
  return buildQuestionObjects(project).map((question) => question.question);
}

function buildQuestionObjects(project) {
  const questions = [];
  const add = (field, question, reason, priority = 'High') => {
    questions.push({
      id: `${field}-${questions.length + 1}`,
      field,
      question,
      reason,
      priority
    });
  };

  if (!isSpecific(project.problem, 80)) {
    add(
      'problem',
      'What concrete problem does this proposal solve, and who experiences it?',
      'The proposal needs a specific motivation and user or stakeholder.'
    );
  }

  if (!isSpecific(project.method, 80)) {
    add(
      'method',
      'What exact workflow or technical method will the project implement?',
      'The method should describe stages, inputs, outputs, and the API-backed loop.'
    );
  }

  if (!isSpecific(project.evaluation, 60)) {
    add(
      'evaluation',
      'What measurable checks will prove the revised proposal is better than the first draft?',
      'The evaluation plan needs concrete tests or metrics.'
    );
  }

  if (!isSpecific(project.timeline, 40)) {
    add(
      'timeline',
      'What research milestones and timeline estimates make this proposal credible?',
      'The proposal needs scoped milestones, feasibility evidence, and realistic risks.'
    );
  }

  if (!isSpecific(project.resources, 30)) {
    add(
      'resources',
      'What tools, APIs, files, or fallback mode will make this reproducible?',
      'The proposal needs implementation resources and API-key handling.',
      'Medium'
    );
  }

  if (!isSpecific(project.references, 30)) {
    add(
      'references',
      'What sources or assumptions should ground the claims?',
      'Unsupported claims should be marked as assumptions or tied to source notes.',
      'Medium'
    );
  }

  if (!questions.length) {
    add(
      'next-step',
      'The project state looks draftable. Should I generate the proposal now?',
      'No required missing field remains in the basic checker.',
      'Low'
    );
  }

  return questions.slice(0, 5);
}

function integrateAnswerLocally(project, answer, question) {
  const targetField = question?.field && question.field !== 'next-step' ? question.field : firstMissingField(project);
  const nextProject = { ...project };
  const updates = [];

  if (targetField && Object.hasOwn(nextProject, targetField)) {
    nextProject[targetField] = mergeField(nextProject[targetField], answer);
    updates.push(`Updated ${targetField}.`);
  } else {
    nextProject.method = mergeField(nextProject.method, answer);
    updates.push('Updated method.');
  }

  return { project: nextProject, updates };
}

function filterRejectedStructureItem(items, rejected, type) {
  if (!Array.isArray(items) || !rejected) {
    return Array.isArray(items) ? items : [];
  }

  if (type === 'suggestion') {
    const field = clean(rejected.field);
    const value = clean(rejected.value);
    return items.filter((item) => !(clean(item.field) === field && clean(item.value) === value));
  }

  const rejectedId = clean(rejected.id);
  if (type === 'decision' && rejectedId) {
    return items.filter((item) => clean(item.id) !== rejectedId);
  }

  return items;
}

function pickReplacementSuggestion(incomingSuggestions, rejectedItem, slotItem) {
  if (!Array.isArray(incomingSuggestions) || !incomingSuggestions.length) {
    return null;
  }

  const field = clean(rejectedItem?.field) || clean(slotItem?.field);
  if (field) {
    const match = incomingSuggestions.find((item) => clean(item.field) === field);
    if (match) return match;
  }

  return incomingSuggestions[0];
}

function mergeRegeneratedSuggestionsInOrder(currentSuggestions, incomingSuggestions, rejected, rejectedIndex) {
  if (!Array.isArray(currentSuggestions) || !currentSuggestions.length) {
    return Array.isArray(incomingSuggestions) ? incomingSuggestions : [];
  }
  if (!Array.isArray(incomingSuggestions) || !incomingSuggestions.length) {
    return currentSuggestions;
  }

  const replaceIndex =
    Number.isFinite(Number(rejectedIndex)) &&
      Number(rejectedIndex) >= 0 &&
      Number(rejectedIndex) < currentSuggestions.length
      ? Number(rejectedIndex)
      : currentSuggestions.findIndex((item) => clean(item.field) === clean(rejected?.item?.field));

  if (replaceIndex < 0) {
    return currentSuggestions;
  }

  const replacement = pickReplacementSuggestion(
    incomingSuggestions,
    rejected?.item,
    currentSuggestions[replaceIndex]
  );

  if (!replacement) {
    return currentSuggestions;
  }

  return currentSuggestions.map((item, index) =>
    index === replaceIndex
      ? {
        ...item,
        ...replacement,
        field: clean(replacement.field) || clean(item.field),
        label: clean(replacement.label) || clean(item.label),
        value: clean(replacement.value) || clean(item.value),
        confidence: clean(replacement.confidence) || clean(item.confidence) || 'Medium',
        reason: clean(replacement.reason) || clean(item.reason)
      }
      : item
  );
}

function mergeRegeneratedDecisionsInOrder(currentDecisions, incomingDecisions, rejectedId) {
  if (!Array.isArray(currentDecisions) || !currentDecisions.length) {
    return Array.isArray(incomingDecisions) ? incomingDecisions : [];
  }
  if (!clean(rejectedId) || !Array.isArray(incomingDecisions) || !incomingDecisions.length) {
    return currentDecisions;
  }

  const previousDecision = currentDecisions.find((decision) => clean(decision.id) === clean(rejectedId));
  const replacement =
    incomingDecisions.find((decision) => clean(decision.id) === clean(rejectedId)) ||
    incomingDecisions.find(
      (decision) => previousDecision && clean(decision.field) === clean(previousDecision.field)
    ) ||
    incomingDecisions[0];

  return currentDecisions.map((decision) =>
    clean(decision.id) === clean(rejectedId)
      ? {
        id: clean(replacement.id) || clean(decision.id),
        title: clean(replacement.title) || clean(decision.title),
        field: clean(replacement.field) || clean(decision.field),
        question: clean(replacement.question) || clean(decision.question),
        options: Array.isArray(replacement.options) ? replacement.options : decision.options
      }
      : decision
  );
}

function buildFieldSuggestions(project) {
  const topic = project.title || project.topic || DEFAULT_PROJECT_TOPIC;
  const suggestions = [
    {
      field: 'title',
      label: 'Project Title',
      value: project.title || PROJECT_FALLBACKS.title || titleCase(topic),
      confidence: 'High',
      reason: 'Anchor the proposal to the math-reasoning RL research thread.'
    },
    {
      field: 'problem',
      label: 'Problem Framing',
      value: project.problem || PROJECT_FALLBACKS.problem,
      confidence: project.problem ? 'High' : 'Medium',
      reason: 'State the accuracy gap between compact models and reliable multi-step math reasoning.'
    },
    {
      field: 'method',
      label: 'Method / Training Workflow',
      value: project.method || PROJECT_FALLBACKS.method,
      confidence: project.method ? 'High' : 'Medium',
      reason: 'Describe GRPO, dense process rewards, code verification, curriculum, and self-consistency.'
    },
    {
      field: 'evaluation',
      label: 'Evaluation Plan',
      value: project.evaluation || PROJECT_FALLBACKS.evaluation,
      confidence: project.evaluation ? 'High' : 'Medium',
      reason: 'Specify research questions, metrics, baselines, ablations, analysis plan, and success criteria.'
    },
    {
      field: 'timeline',
      label: 'Research Milestones',
      value: project.timeline || PROJECT_FALLBACKS.timeline,
      confidence: project.timeline ? 'High' : 'Medium',
      reason: 'List expected results plus timed milestones with verifiable deliverables that address the research questions and hypotheses.'
    },
    {
      field: 'resources',
      label: 'Resources',
      value: project.resources || PROJECT_FALLBACKS.resources,
      confidence: project.resources ? 'High' : 'Medium',
      reason: 'Group computing, software, datasets or checkpoints, and course or budget support into formal category lines.'
    },
    {
      field: 'references',
      label: 'Sources / Assumptions',
      value: project.references || PROJECT_FALLBACKS.references,
      confidence: project.references ? 'High' : 'Medium',
      reason: 'Cite math benchmarks and RL literature; mark unsupported numeric claims as assumptions.'
    }
  ];

  return suggestions.filter((item) => clean(item.value));
}

function buildDecisionCards(project) {
  const topic = project.title || project.topic || 'this project';

  return [
    {
      id: 'problem-framing',
      title: 'Choose The Problem Framing',
      field: 'problem',
      question: 'Which problem framing should the proposal emphasize?',
      options: [
        {
          label: 'Rubric alignment',
          value: `Students have rough ideas for ${topic}, but struggle to translate them into proposal sections that satisfy the course rubric.`,
          rationale: 'Best when the project is mainly about proposal structure and grading requirements.'
        },
        {
          label: 'Revision quality',
          value: `Students can produce a first draft for ${topic}, but need help identifying weak claims, missing evidence, and unclear evaluation plans before submission.`,
          rationale: 'Best when the agent focuses on critique and revision.'
        },
        {
          label: 'Scope control',
          value: `Students often choose research directions that are too broad or underspecified, so they need a workflow that narrows the idea into a credible proposal with explicit milestones and evaluation criteria.`,
          rationale: 'Best when feasibility, milestones, and research scope are the main risks.'
        }
      ]
    },
    {
      id: 'method-style',
      title: 'Choose The Agent Method',
      field: 'method',
      question: 'What should the core agent workflow optimize for?',
      options: [
        {
          label: 'Structured extraction',
          value:
            'The agent extracts project fields from a rough idea, shows suggested data for user approval, and only asks clarifying questions when required fields remain uncertain.',
          rationale: 'Best for reducing manual prompting.'
        },
        {
          label: 'Rubric-first drafting',
          value:
            'The agent parses requirements into a checklist, maps each project field to required proposal sections, drafts the proposal, and produces a compliance matrix.',
          rationale: 'Best when grading coverage is the main concern.'
        },
        {
          label: 'Critique and revise',
          value:
            'The agent drafts quickly, judges the draft for missing sections and weak claims, proposes targeted revisions, and lets the user accept or edit changes.',
          rationale: 'Best for a visible revision loop.'
        }
      ]
    },
    {
      id: 'evaluation-choice',
      title: 'Choose Evaluation Evidence',
      field: 'evaluation',
      question: 'How should the demo prove the workflow is useful?',
      options: [
        {
          label: 'Before / after',
          value: 'Compare a rough initial draft with the revised proposal on required-section coverage, specificity, and unresolved assumptions.',
          rationale: 'Simple and convincing for a classroom demo.'
        },
        {
          label: 'Scenario tests',
          value: 'Run normal, missing-information, requirement-check, unsupported-claim, and revision scenarios, then report pass/fail outcomes.',
          rationale: 'Best for demonstrating agent behavior across cases.'
        },
        {
          label: 'Human review',
          value: 'Have the student review whether each suggested field is accurate, useful, and ready for the final proposal before export.',
          rationale: 'Best when student ownership is important.'
        }
      ]
    }
  ];
}

function normalizeFieldSuggestions(suggestions, project) {
  const parsed = Array.isArray(suggestions)
    ? suggestions
      .map((item) => ({
        field: clean(item.field),
        label: clean(item.label) || labelForField(item.field),
        value: clean(item.value),
        confidence: clean(item.confidence) || 'Medium',
        reason: clean(item.reason) || 'Suggested by the model from the rough idea.'
      }))
      .filter((item) => item.field && item.value)
    : [];

  const fallback = buildFieldSuggestions(project);
  const seen = new Set(parsed.map((item) => item.field));
  const merged = [...parsed, ...fallback.filter((item) => !seen.has(item.field))];

  return merged.length ? merged : fallback;
}

function normalizeDecisions(decisions, project) {
  const parsed = Array.isArray(decisions)
    ? decisions
      .map((decision, index) => ({
        id: clean(decision.id) || `decision-${index + 1}`,
        title: clean(decision.title) || 'Decision Needed',
        field: clean(decision.field) || 'problem',
        question: clean(decision.question) || 'Which option best fits the project?',
        options: Array.isArray(decision.options)
          ? decision.options
            .map((option) => ({
              label: clean(option.label),
              value: clean(option.value),
              rationale: clean(option.rationale)
            }))
            .filter((option) => option.label && option.value)
          : []
      }))
      .filter((decision) => decision.options.length)
    : [];

  return parsed.length ? parsed : buildDecisionCards(project);
}

function projectFromSuggestions(project, suggestions) {
  const next = { ...project };

  suggestions.forEach((suggestion) => {
    if (Object.hasOwn(next, suggestion.field) && suggestion.value) {
      next[suggestion.field] = suggestion.value;
    }
  });

  return next;
}

function keepOnlyAcceptedStartFields(originalProject, suggestedProject) {
  return {
    ...EMPTY_PROJECT_FOR_SERVER,
    ...originalProject,
    title: suggestedProject.title || originalProject.title,
    topic: originalProject.topic || originalProject.title,
    requirements: originalProject.requirements || DEFAULT_REQUIREMENTS
  };
}

function labelForField(field) {
  const labels = {
    title: 'Project Title',
    problem: 'Problem Framing',
    method: 'Method / Agent Workflow',
    timeline: 'Research Milestones',
    evaluation: 'Evaluation Plan',
    resources: 'Resources',
    references: 'Sources / Assumptions'
  };

  return labels[clean(field)] || titleCase(field);
}

function summarizeProjectInput(project) {
  const fields = [
    ['Topic', project.title || project.topic],
    ['Problem', project.problem],
    ['Method', project.method],
    ['Timeline', project.timeline],
    ['Evaluation', project.evaluation],
    ['Resources', project.resources],
    ['References', project.references]
  ];
  const missing = buildQuestionObjects(project)
    .filter((question) => question.field !== 'next-step')
    .map((question) => question.reason);

  return {
    fields,
    missing,
    markdown: `# Intake Summary

${fields.map(([label, value]) => `- ${label}: ${clean(value) || 'Missing'}`).join('\n')}

## Missing or Weak Inputs
${missing.length ? missing.map((item) => `- ${item}`).join('\n') : '- None detected by the basic checker.'}
`
  };
}

function normalizeQuestions(questions, project) {
  const parsed = Array.isArray(questions)
    ? questions.map(normalizeQuestion).filter((question) => question.question)
    : [];

  return (parsed.length ? parsed : buildQuestionObjects(project)).slice(0, 5);
}

function normalizeQuestion(question) {
  if (!question) return null;

  if (typeof question === 'string') {
    return {
      id: `question-${question.slice(0, 18)}`,
      field: 'method',
      question: clean(question),
      reason: 'The model requested this clarification.',
      priority: 'High'
    };
  }

  return {
    id: clean(question.id) || `${clean(question.field) || 'question'}-${clean(question.question).slice(0, 18)}`,
    field: clean(question.field) || 'method',
    question: clean(question.question),
    reason: clean(question.reason) || 'This detail will improve the proposal.',
    priority: clean(question.priority) || 'High'
  };
}

function firstMissingField(project) {
  const firstQuestion = buildQuestionObjects(project).find((question) => question.field !== 'next-step');
  return firstQuestion?.field || 'method';
}

function mergeProject(current, incoming) {
  const next = { ...current };

  Object.entries(incoming).forEach(([key, value]) => {
    const cleaned = clean(value);
    if (cleaned) next[key] = cleaned;
  });

  return next;
}

function mergeField(current, addition) {
  const base = clean(current);
  const next = clean(addition);

  if (!base) return next;
  if (!next) return base;
  if (base.toLowerCase().includes(next.toLowerCase())) return base;
  return `${base}\n${next}`;
}

function normalizePayload(payload) {
  return {
    topic: clean(payload.topic),
    title: clean(payload.title) || clean(payload.topic),
    problem: clean(payload.problem),
    method: clean(payload.method),
    timeline: clean(payload.timeline),
    evaluation: clean(payload.evaluation),
    resources: clean(payload.resources),
    references: clean(payload.references),
    layAbstract: clean(payload.layAbstract),
    requirements: clean(payload.requirements) || DEFAULT_REQUIREMENTS
  };
}

function extractChecklist(requirements) {
  const items = clean(requirements)
    .split(/\n|;/)
    .map((line) => line.replace(/^[-*]\s*/, '').replace(/^\d+\.\s*/, '').trim())
    .filter((line) => line.length > 4)
    .filter((line) => !/^proposal must include:?$/i.test(line));

  return [...new Set(items.length ? items : DEFAULT_REQUIREMENTS.split('\n').slice(1).map((line) => line.replace(/^-\s*/, '')))];
}

function findRequirementEvidence(requirement, project) {
  const text = requirement.toLowerCase();

  if (/title/.test(text) && project.title) return project.title;
  if (/abstract/.test(text)) return 'Draft includes an abstract section.';
  if (/motivation|gap|problem/.test(text) && project.problem) return project.problem;
  if (/goal/.test(text) && project.title) return 'Goal section is generated from the project topic.';
  if (/method|workflow|approach/.test(text) && project.method) return project.method;
  if (/expected|milestone|timeline/.test(text) && project.timeline) {
    const validation = validateMilestonePlan(project.timeline, project);
    if (validation.ok && validation.milestoneCount >= 3) {
      return `${validation.milestoneCount} phased milestones with expected results and research-question alignment.`;
    }
    return project.timeline;
  }
  if (/evaluation|metric|test/.test(text) && project.evaluation) return project.evaluation;
  if (/risk|mitigation/.test(text)) return 'Fallback draft includes risks and mitigations.';
  if (/resource|budget|tool/.test(text) && project.resources) return project.resources;
  if (/reference|assumption|source/.test(text) && project.references) {
    const registry = buildCitationRegistry(project.references, []);
    if (registry.entries.length) {
      return `${registry.entries.length} verified bibliography entries with author--year citation keys.`;
    }
    return project.references;
  }

  return '';
}

function readModelContent(data) {
  if (typeof data?.choices?.[0]?.message?.content === 'string') {
    return data.choices[0].message.content;
  }

  if (typeof data?.output_text === 'string') {
    return data.output_text;
  }

  const outputText = data?.output
    ?.flatMap((item) => item?.content || [])
    ?.map((item) => item?.text)
    ?.filter(Boolean)
    ?.join('\n');

  if (outputText) return outputText;

  return JSON.stringify(data);
}

export function parseJsonContent(content) {
  const trimmed = clean(content);
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] || trimmed).trim();

  try {
    return enrichParsedProposalPayload(JSON.parse(candidate), candidate);
  } catch {
    const extracted = extractLikelyJsonObject(candidate);
    if (extracted) {
      try {
        return enrichParsedProposalPayload(JSON.parse(extracted), candidate);
      } catch {
        // fall through
      }
    }

    return recoverPartialProposalPayload(candidate);
  }
}

function enrichParsedProposalPayload(parsed, rawText) {
  const next = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...parsed } : {};

  if (!Array.isArray(next.complianceMatrix) || !next.complianceMatrix.length) {
    const matrix =
      extractJsonArrayField(rawText, 'complianceMatrix') ||
      extractJsonArrayField(rawText, 'compliance_matrix');
    if (matrix?.length) {
      next.complianceMatrix = matrix;
    }
  }

  if (!clean(next.proposalLatex)) {
    const latex =
      extractJsonStringField(rawText, 'proposalLatex') ||
      extractNestedLatexString(rawText) ||
      clean(next.proposalTex) ||
      clean(next.latex);
    if (latex) {
      next.proposalLatex = latex;
    }
  }

  return next;
}

function recoverPartialProposalPayload(rawText) {
  const proposalLatex =
    extractJsonStringField(rawText, 'proposalLatex') ||
    extractNestedLatexString(rawText) ||
    (looksLikeLatex(rawText) ? rawText : '');
  const complianceMatrix =
    extractJsonArrayField(rawText, 'complianceMatrix') ||
    extractJsonArrayField(rawText, 'compliance_matrix') ||
    [];
  const evaluationReport =
    extractJsonStringField(rawText, 'evaluationReport') ||
    '# Evaluation Report\n\nThe API returned text that was not strict JSON. Coverage was rebuilt from the validated proposal draft.';
  const questions = extractJsonArrayField(rawText, 'questions') || [
    'Should the API prompt be tightened to return strict JSON?'
  ];

  return {
    proposalLatex,
    complianceMatrix,
    evaluationReport,
    questions
  };
}

function extractJsonArrayField(text, fieldName) {
  const marker = `"${fieldName}"`;
  const index = String(text || '').indexOf(marker);
  if (index === -1) return null;

  const start = text.indexOf('[', index + marker.length);
  if (start === -1) return null;

  const segment = readBalancedJsonSegment(text, start, '[', ']');
  if (!segment) return null;

  try {
    const parsed = JSON.parse(segment);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractJsonStringField(text, fieldName) {
  const marker = `"${fieldName}"`;
  const index = String(text || '').indexOf(marker);
  if (index === -1) return '';

  let cursor = index + marker.length;
  while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
  if (text[cursor] !== ':') return '';
  cursor += 1;
  while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
  if (text[cursor] !== '"') return '';

  let value = '';
  let escaped = false;

  for (cursor += 1; cursor < text.length; cursor += 1) {
    const char = text[cursor];

    if (escaped) {
      if (char === 'n') value += '\n';
      else if (char === 't') value += '\t';
      else if (char === 'r') value += '\r';
      else if (char === '"') value += '"';
      else if (char === '\\') value += '\\';
      else value += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"') {
      return value;
    }

    value += char;
  }

  return value;
}

function readBalancedJsonSegment(text, startIndex, open, close) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === open) {
      depth += 1;
    } else if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return '';
}

function extractLikelyJsonObject(text) {
  const value = String(text || '').trim();
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return '';

  const candidate = value.slice(start, end + 1).trim();
  if (!candidate.startsWith('{') || !candidate.endsWith('}')) return '';
  return candidate;
}

function normalizeRequirementKey(value) {
  return clean(value)
    .replace(/^[-*]\s*/, '')
    .replace(/^\d+[.)]\s*/, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCoverageStatus(value) {
  const status = clean(value);
  if (/^covered$/i.test(status)) return 'Covered';
  if (/^(?:met|pass|yes|complete|included)$/i.test(status)) return 'Covered';
  if (/^needs work$/i.test(status)) return 'Needs work';
  return status || 'Needs work';
}

function matchComplianceRow(requirement, normalizedRows, index, checklistLength) {
  const key = normalizeRequirementKey(requirement);
  const rowByKey = new Map();

  normalizedRows.forEach((row) => {
    const rowKey = normalizeRequirementKey(row.requirement);
    if (rowKey && !rowByKey.has(rowKey)) {
      rowByKey.set(rowKey, row);
    }
  });

  if (key && rowByKey.has(key)) {
    return rowByKey.get(key);
  }

  if (key) {
    for (const [rowKey, row] of rowByKey.entries()) {
      if (rowKey.includes(key) || key.includes(rowKey)) {
        return row;
      }
    }
  }

  if (normalizedRows.length === checklistLength && normalizedRows[index]) {
    return normalizedRows[index];
  }

  return null;
}

function normalizeComplianceRows(rows) {
  return Array.isArray(rows)
    ? rows
      .filter(Boolean)
      .map((row) => ({
        requirement: clean(row.requirement),
        status: normalizeCoverageStatus(row.status),
        evidence: clean(row.evidence),
        fix: clean(row.fix)
      }))
    : [];
}

function isMatrixPlaceholderEvidence(value) {
  return /api did not provide matrix evidence/i.test(clean(value));
}

export function buildComplianceMatrixFromDraft(checklist, project, proposalLatex, apiRows = []) {
  const normalizedRows = normalizeComplianceRows(apiRows);

  return checklist.map((requirement, index) => {
    const apiMatch = matchComplianceRow(requirement, normalizedRows, index, checklist.length);
    const draftEvidence =
      findRequirementEvidence(requirement, project) || findEvidenceInLatex(requirement, proposalLatex);
    const apiEvidence =
      apiMatch?.evidence && !isMatrixPlaceholderEvidence(apiMatch.evidence) ? apiMatch.evidence : '';

    if (draftEvidence) {
      return {
        requirement,
        status: 'Covered',
        evidence: apiEvidence || draftEvidence,
        fix: apiMatch?.fix || 'Verified in the validated proposal draft.'
      };
    }

    if (apiMatch && apiEvidence) {
      return {
        ...apiMatch,
        requirement,
        status: normalizeCoverageStatus(apiMatch.status)
      };
    }

    return {
      requirement,
      status: 'Needs work',
      evidence: 'No clear evidence found in the validated proposal draft.',
      fix: apiMatch?.fix || `Add concrete detail for: ${requirement}.`
    };
  });
}

function latexSectionMatches(latex, keywords) {
  const pattern = keywords
    .map((keyword) => keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');

  return new RegExp(`\\\\section\\*?\\{[^\\n}]*(?:${pattern})`, 'i').test(String(latex || ''));
}

function findEvidenceInLatex(requirement, proposalLatex) {
  const latex = String(proposalLatex || '');
  if (!latex) return '';

  const text = normalizeRequirementKey(requirement);

  if (/title/.test(text) && (latex.includes('\\title{') || latex.includes('\\maketitle'))) {
    return 'Proposal draft includes a title block.';
  }
  if (
    /abstract/.test(text) &&
    (latex.includes('\\begin{abstract}') ||
      /\\section\*?\{Abstract\}/i.test(latex) ||
      latexSectionMatches(latex, ['abstract']))
  ) {
    return 'Proposal draft includes an abstract section.';
  }
  if (/motivation|gap/.test(text) && (latexSectionMatches(latex, ['motivation', 'gap', 'problem']) || /research gap/i.test(latex))) {
    return 'Proposal draft discusses motivation or the research gap.';
  }
  if (/goal/.test(text) && latexSectionMatches(latex, ['goal', 'objective', 'aim'])) {
    return 'Proposal draft states a project goal or objective.';
  }
  if (/method|workflow/.test(text) && latexSectionMatches(latex, ['method', 'workflow', 'approach', 'agent'])) {
    return 'Proposal draft describes the method or workflow.';
  }
  if (/figure|diagram/.test(text) && (/\\begin{figure/.test(latex) || /\\caption{/.test(latex) || /tikzpicture/.test(latex))) {
    return 'Proposal draft includes a figure or diagram with caption.';
  }
  if (/expected|result/.test(text) && latexSectionMatches(latex, ['expected', 'result', 'outcome'])) {
    return 'Proposal draft includes expected results.';
  }
  if (/milestone|timeline/.test(text) && latexSectionMatches(latex, ['milestone', 'timeline', 'schedule'])) {
    return 'Proposal draft includes milestones or timeline content.';
  }
  if (/evaluation|metric/.test(text) && latexSectionMatches(latex, ['evaluation', 'metric', 'benchmark', 'test'])) {
    return 'Proposal draft includes an evaluation plan.';
  }
  if (/risk|mitigation/.test(text) && latexSectionMatches(latex, ['risk', 'mitigation'])) {
    return 'Proposal draft discusses risks and mitigation.';
  }
  if (/resource|budget/.test(text) && latexSectionMatches(latex, ['resource', 'budget', 'compute'])) {
    return 'Proposal draft includes resources or budget notes.';
  }
  if (/reference|assumption|source/.test(text) && (latexSectionMatches(latex, ['reference', 'bibliography', 'source', 'assumption']) || /\\begin\{thebibliography\}/.test(latex))) {
    if (/\\cite[tp]?\{/.test(latex)) {
      return 'Proposal draft includes a bibliography and natbib in-text citations.';
    }
    return 'Proposal draft includes references or source notes.';
  }

  return '';
}

function coerceResult(result, project, checklist) {
  const proposalLatex = extractProposalLatex(result, project);
  const complianceMatrix = buildComplianceMatrixFromDraft(
    checklist,
    project,
    proposalLatex,
    result.complianceMatrix
  );

  return {
    proposalLatex,
    complianceMatrix,
    evaluationReport: clean(result.evaluationReport) || '# Evaluation Report\n\nNo evaluation report returned.',
    questions: Array.isArray(result.questions) ? result.questions.map(clean).filter(Boolean).slice(0, 5) : []
  };
}

function extractProposalLatex(result, project) {
  const candidates = [
    result?.proposalLatex,
    result?.proposalTex,
    result?.latex,
    result?.tex
  ]
    .map(clean)
    .filter(Boolean);

  for (const candidate of candidates) {
    const unwrapped = unwrapLatexCandidate(candidate);
    if (looksLikeLatex(unwrapped)) {
      return unwrapped;
    }
  }

  return buildLocalProposalLatex(project);
}

function unwrapLatexCandidate(value) {
  let candidate = stripCodeFence(clean(value));

  for (let index = 0; index < 3; index += 1) {
    const trimmed = candidate.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('"')) break;

    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'string') {
        candidate = stripCodeFence(parsed);
        continue;
      }

      const nested = parsed?.proposalLatex || parsed?.proposalTex || parsed?.latex || parsed?.tex;
      if (nested) {
        candidate = stripCodeFence(String(nested));
        continue;
      }

      break;
    } catch {
      const extracted = extractNestedLatexString(trimmed);
      if (extracted) {
        candidate = stripCodeFence(extracted);
        continue;
      }
      break;
    }
  }

  return candidate;
}

function stripCodeFence(value) {
  const trimmed = clean(value);
  const fenced = trimmed.match(/```(?:latex|tex)?\s*([\s\S]*?)```/i);
  return fenced?.[1]?.trim() || trimmed;
}

function isSpecific(value, length) {
  return clean(value).length >= length;
}

export function clean(value) {
  return String(value || '').trim();
}

function looksLikeLatex(value) {
  return /^\\(?:documentclass\b|begin\{document\}|section\{)/.test(String(value || '').trim());
}

function extractNestedLatexString(value) {
  const match = String(value || '').match(/"proposalLatex"\s*:\s*"([\s\S]*?)"\s*,\s*"(?:complianceMatrix|evaluationReport|questions)"/);

  if (!match?.[1]) {
    return '';
  }

  return match[1]
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function plainLanguageSummarySection(project) {
  const layAbstract = clean(project.layAbstract);

  if (!layAbstract) return '';

  return `\n\\section*{Plain-Language Summary}\n${latexParagraph(layAbstract)}\n`;
}

function latexParagraph(value) {
  return escapeLatex(value)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n\n');
}

function escapeLatex(value) {
  return String(value || '')
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/\$/g, '\\$')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

function getProvider() {
  const provider = clean(process.env.LLM_PROVIDER).toLowerCase();
  const url = clean(process.env.LLM_API_URL).toLowerCase();

  if (provider === 'gemini' || url.includes('generativelanguage.googleapis.com')) {
    return 'gemini';
  }

  return 'openai-compatible';
}

export function getGenerationProviderLabel(modelOverride) {
  if (!process.env.LLM_API_KEY || !process.env.LLM_API_URL) {
    return 'local-template';
  }

  const provider = getProvider();
  const model = clean(modelOverride) || clean(process.env.LLM_MODEL);
  const url = clean(process.env.LLM_API_URL).toLowerCase();

  if (provider === 'gemini') {
    return model ? `gemini:${model}` : 'gemini';
  }

  if (url.includes('openrouter.ai')) {
    return model ? `openrouter:${model}` : 'openrouter';
  }

  return model ? `api:${model}` : 'openai-compatible';
}

function titleCase(value) {
  return clean(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}
