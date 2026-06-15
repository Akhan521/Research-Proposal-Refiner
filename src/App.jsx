import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createBlankProject,
  DEFAULT_PROJECT,
  DEFAULT_PROJECT_TOPIC,
  DEFAULT_REQUIREMENTS,
  withDefaultProject
} from '../shared/mathlmDefaults.js';
import {
  PROPOSAL_PAGE_DEFAULT,
  PROPOSAL_PAGE_MAX,
  PROPOSAL_PAGE_MIN,
  PROPOSAL_PAGE_OPTIONS,
  normalizeProposalPageTarget
} from '../shared/proposalLength.js';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Download,
  ExternalLink,
  FileText,
  LayoutDashboard,
  ListChecks,
  Loader2,
  Play,
  RefreshCw,
  Send,
  Sparkles,
  X
} from 'lucide-react';

const EMPTY_PROJECT = createBlankProject();
const INITIAL_PROJECT = withDefaultProject();

const PROJECT_FIELDS = [
  ['problem', 'Problem'],
  ['method', 'Method'],
  ['evaluation', 'Evaluation'],
  ['timeline', 'Timeline'],
  ['resources', 'Resources'],
  ['references', 'Sources']
];

const AI_REFINABLE_PROJECT_FIELDS = new Set(
  PROJECT_FIELDS.filter(([field]) => field !== 'references').map(([field]) => field)
);

const STAGES = [
  ['1', 'Extract', 'LLM turns the rough idea into structured proposal data'],
  ['2', 'Decide', 'You choose or edit candidate framings'],
  ['3', 'Assemble', 'Accepted fields become project state'],
  ['4', 'Draft', 'LLM writes proposal artifacts'],
  ['5', 'Review', 'Matrix and critique check weak spots']
];

const TABS = [
  ['pdf', FileText, 'PDF'],
  ['latex', FileText, 'LaTeX'],
  ['matrix', ClipboardCheck, 'Matrix'],
  ['evaluation', ListChecks, 'Review'],
  ['explain', Sparkles, 'Explain']
];

const EXPLAIN_LEVELS = [
  ['kid', '5th grader'],
  ['highschool', 'High schooler'],
  ['undergrad', 'Undergrad'],
  ['expert', 'Expert / peer']
];

const LITERATURE_SOURCE_OPTIONS = [
  ['auto', 'Default (auto-pick)'],
  ['semantic_scholar', 'Semantic Scholar'],
  ['openalex', 'OpenAlex'],
  ['arxiv', 'arXiv']
];

const LITERATURE_PAPERS_PER_PAGE = 5;
const RUN_LOG_RECENT_COUNT = 4;

const MEMORY_KEY = 'proposal-agent-final-project-memory-v2';
const LEGACY_MEMORY_KEY = 'proposal-agent-final-project-memory-v1';
const MODEL_DISPLAY_NAMES = {
  'openrouter/owl-alpha': 'Owl Alpha (free)'
};

function buildLlmExtras(llmModel) {
  const trimmed = String(llmModel || '').trim();
  return trimmed ? { llmModel: trimmed } : {};
}

const WORKSPACE_FLOW_ORDER = ['start', 'structure', 'research', 'project', 'output'];

const WORKSPACE_VIEWS = [
  {
    id: 'start',
    label: 'Start',
    icon: LayoutDashboard,
    description: 'Enter your rough idea, save progress, and see where you are in the workflow.'
  },
  {
    id: 'structure',
    label: 'Structure',
    icon: ListChecks,
    description: 'Accept LLM field suggestions and resolve open decision cards.'
  },
  {
    id: 'research',
    label: 'Research',
    icon: BookOpen,
    description: 'Search scholarly sources and merge a relevant-information summary into Problem.'
  },
  {
    id: 'project',
    label: 'Project',
    icon: FileText,
    description: 'Edit accepted proposal fields and generate the draft.'
  },
  {
    id: 'output',
    label: 'Output',
    icon: ClipboardCheck,
    description: 'Review the run log, compliance matrix, exports, and Explain tab.'
  }
];

function workspaceViewBadge(viewId, context) {
  const { fieldSuggestions, acceptedSuggestionCount, decisions, literature, acceptedCount, result } = context;

  switch (viewId) {
    case 'structure':
      if (fieldSuggestions.length) return `${acceptedSuggestionCount}/${fieldSuggestions.length}`;
      if (decisions.length) {
        const open = decisions.filter((decision) => !isDecisionResolved(decision)).length;
        return open ? `${open} open` : `${decisions.length} resolved`;
      }
      return '';
    case 'research':
      return literature?.papers?.length ? `${literature.papers.length} papers` : '';
    case 'project':
      return `${acceptedCount}/${PROJECT_FIELDS.length}`;
    case 'output':
      return result?.proposalLatex ? 'Draft ready' : '';
    default:
      return '';
  }
}

function App() {
  const [topicInput, setTopicInput] = useState(DEFAULT_PROJECT_TOPIC);
  const [project, setProject] = useState(INITIAL_PROJECT);
  const [fieldSuggestions, setFieldSuggestions] = useState([]);
  const [decisions, setDecisions] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [customNote, setCustomNote] = useState('');
  const [result, setResult] = useState(null);
  const [pdfUrl, setPdfUrl] = useState('');
  const [pdfStatus, setPdfStatus] = useState('idle');
  const [pdfExportError, setPdfExportError] = useState('');
  const [runLog, setRunLog] = useState([]);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('pdf');
  const [activeWorkspaceView, setActiveWorkspaceView] = useState('start');
  const [focusedProjectField, setFocusedProjectField] = useState(null);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [decisionIndex, setDecisionIndex] = useState(0);
  const [memorySavedAt, setMemorySavedAt] = useState('');
  const [memoryReady, setMemoryReady] = useState(false);
  const [memoryHydrated, setMemoryHydrated] = useState(false);
  const [explain, setExplain] = useState(null);
  const [explainLevel, setExplainLevel] = useState('kid');
  const [explainStatus, setExplainStatus] = useState('idle');
  const [literature, setLiterature] = useState(null);
  const [literatureSource, setLiteratureSource] = useState('auto');
  const [literatureStatus, setLiteratureStatus] = useState('idle');
  const [literatureNotice, setLiteratureNotice] = useState('');
  const [selectedLiteraturePaperIds, setSelectedLiteraturePaperIds] = useState([]);
  const [activeLiteratureSummary, setActiveLiteratureSummary] = useState({
    relatedWorkParagraph: '',
    gapNote: ''
  });
  const [literatureSummaryStatus, setLiteratureSummaryStatus] = useState('idle');
  const [lastInsertedLiteratureSummary, setLastInsertedLiteratureSummary] = useState('');
  const [llmModel, setLlmModel] = useState('');
  const [proposalPageTarget, setProposalPageTarget] = useState(PROPOSAL_PAGE_DEFAULT);
  const [llmConfig, setLlmConfig] = useState(null);
  const [suggestionGuidance, setSuggestionGuidance] = useState('');
  const [decisionGuidance, setDecisionGuidance] = useState('');
  const [suggestionReviseOpen, setSuggestionReviseOpen] = useState(false);
  const [decisionReviseOpen, setDecisionReviseOpen] = useState(false);
  const [refiningScope, setRefiningScope] = useState(null);
  const [refiningProjectField, setRefiningProjectField] = useState(null);
  const problemFieldRef = useRef(null);
  const workspaceMainRef = useRef(null);
  const lastLiteratureSummaryRef = useRef('');
  const literatureInsertMetaRef = useRef(null);

  const matrixStats = useMemo(() => {
    const rows = result?.complianceMatrix || [];
    const covered = rows.filter((row) => /^covered$/i.test(row.status)).length;
    return { covered, total: rows.length };
  }, [result]);

  const selectedLiteraturePapers = useMemo(
    () => filterSelectedLiteraturePapers(literature?.papers ?? [], selectedLiteraturePaperIds),
    [literature?.papers, selectedLiteraturePaperIds]
  );

  const generationProvider = useMemo(() => formatGenerationProvider(result), [result]);

  const acceptedCount = PROJECT_FIELDS.filter(([field]) => Boolean(project[field])).length;
  const proposalLengthFill =
    ((proposalPageTarget - PROPOSAL_PAGE_MIN) / (PROPOSAL_PAGE_MAX - PROPOSAL_PAGE_MIN)) * 100;
  const acceptedSuggestionCount = fieldSuggestions.filter((suggestion) =>
    isSuggestionApplied(project[suggestion.field], suggestion.value)
  ).length;
  const openDecisionCount = decisions.filter((decision) => !isDecisionResolved(decision)).length;
  const resolvedDecisionCount = decisions.length - openDecisionCount;
  const currentSuggestion = fieldSuggestions[suggestionIndex] || null;
  const currentDecision = decisions[decisionIndex] || null;
  const currentQuestion = questions[0];

  useEffect(() => {
    let cancelled = false;

    (async () => {
      await loadSavedMemory({ silent: true });
      if (!cancelled) {
        setMemoryHydrated(true);
        setMemoryReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/llm-config')
      .then((response) => (response.ok ? response.json() : null))
      .then((config) => {
        if (cancelled || !config) return;
        setLlmConfig(config);
        setLlmModel((current) => {
          const available = getAvailableModelsFromConfig(config);
          const trimmed = current.trim();
          if (trimmed && available.includes(trimmed)) return trimmed;
          if (config.defaultModel && available.includes(config.defaultModel)) return config.defaultModel;
          return available[0] || '';
        });
      })
      .catch(() => { });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [pdfUrl]);

  useEffect(() => {
    if (activeWorkspaceView !== 'project' && focusedProjectField) {
      setFocusedProjectField(null);
    }
  }, [activeWorkspaceView, focusedProjectField]);

  useEffect(() => {
    setSuggestionReviseOpen(false);
    setSuggestionGuidance('');
  }, [suggestionIndex]);

  useEffect(() => {
    setDecisionReviseOpen(false);
    setDecisionGuidance('');
  }, [decisionIndex]);

  useEffect(() => {
    if (!memoryReady || !memoryHydrated) return;

    if (!topicInput && !fieldSuggestions.length && !decisions.length && !result) {
      return;
    }

    saveMemory({ silent: true });
  }, [
    memoryReady,
    memoryHydrated,
    topicInput,
    project,
    fieldSuggestions,
    decisions,
    questions,
    result,
    runLog,
    activeTab,
    activeWorkspaceView,
    suggestionIndex,
    decisionIndex,
    llmModel
  ]);

  useEffect(() => {
    if (!literature?.papers?.length) return undefined;

    const allIds = literature.papers.map((paper) => paper.id);
    const selected = filterSelectedLiteraturePapers(literature.papers, selectedLiteraturePaperIds);

    if (!selected.length) {
      setActiveLiteratureSummary({
        relatedWorkParagraph: '',
        gapNote: 'Select at least one paper to include in the summary and citations.'
      });
      setLiteratureSummaryStatus('idle');
      return undefined;
    }

    if (
      selected.length === allIds.length &&
      selectedLiteraturePaperIds.length === allIds.length &&
      literature.relatedWorkParagraph
    ) {
      setActiveLiteratureSummary({
        relatedWorkParagraph: literature.relatedWorkParagraph,
        gapNote: literature.gapNote || ''
      });
      setLiteratureSummaryStatus('idle');
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setLiteratureSummaryStatus('loading');

      try {
        const data = await postJson('/api/literature/synthesize', {
          topic: project.title || project.topic || topicInput,
          problem: project.problem,
          papers: selected,
          ...buildLlmExtras(llmModel)
        });

        if (!cancelled) {
          setActiveLiteratureSummary({
            relatedWorkParagraph: data.relatedWorkParagraph || '',
            gapNote: data.gapNote || ''
          });
          setLiteratureSummaryStatus('idle');
        }
      } catch {
        if (!cancelled) {
          setActiveLiteratureSummary({
            relatedWorkParagraph: '',
            gapNote: 'Could not rebuild the summary for the selected papers. Try again or select all papers.'
          });
          setLiteratureSummaryStatus('idle');
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    selectedLiteraturePaperIds,
    literature,
    project.title,
    project.topic,
    project.problem,
    topicInput,
    llmModel
  ]);

  async function startAgent() {
    return startAgentForTopic(topicInput);
  }

  async function startSampleAgent() {
    setTopicInput(DEFAULT_PROJECT_TOPIC);
    setProject(withDefaultProject());
    return startAgentForTopic(DEFAULT_PROJECT_TOPIC);
  }

  async function startAgentForTopic(nextTopic) {
    setStatus('starting');
    setError('');
    clearArtifacts();

    try {
      const data = await postJson('/api/agent/start', {
        topic: nextTopic,
        requirements: DEFAULT_REQUIREMENTS,
        ...buildLlmExtras(llmModel)
      });

      setProject(withDefaultProject(data.project));
      setFieldSuggestions(data.fieldSuggestions || []);
      setDecisions(data.decisions || []);
      setQuestions(data.questions || []);
      setSuggestionIndex(0);
      setDecisionIndex(0);
      setRunLog([
        logEntry('Extract', data.runMessage || 'LLM prepared structured suggestions.'),
        logEntry('Decide', `Review ${(data.fieldSuggestions || []).length} fields and ${(data.decisions || []).length} decision card(s).`)
      ]);
      setCustomNote('');
      setActiveWorkspaceView('structure');
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setStatus('idle');
    }
  }

  async function submitCustomNote() {
    const trimmed = customNote.trim();
    if (!trimmed) return;

    setStatus('answering');
    setError('');

    try {
      const data = await postJson('/api/agent/answer', {
        project,
        question: currentQuestion || {
          field: 'method',
          question: 'Integrate this user note into the project state.',
          reason: 'The user provided a custom refinement.',
          priority: 'Medium'
        },
        answer: trimmed,
        requirements: DEFAULT_REQUIREMENTS,
        ...buildLlmExtras(llmModel)
      });

      setProject(withDefaultProject(data.project));
      setFieldSuggestions(data.fieldSuggestions || []);
      setDecisions(data.decisions || []);
      setQuestions(data.questions || []);
      setSuggestionIndex(0);
      setDecisionIndex(0);
      setRunLog((current) => [
        ...current,
        logEntry('Update', data.runMessage || 'Integrated custom note.'),
        logEntry('Decide', `Refreshed ${(data.fieldSuggestions || []).length} suggested field(s).`)
      ]);
      setCustomNote('');
      clearArtifacts();
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setStatus('idle');
    }
  }

  async function refreshPdfPreview(proposalLatex = result?.proposalLatex) {
    const latex = String(proposalLatex || '').trim();
    if (!latex) return;

    setPdfStatus('loading');
    setPdfExportError('');

    try {
      const nextPdfUrl = await exportPdfUrl(latex, project.title || 'proposal', project);
      updatePdfUrl(nextPdfUrl);
      setPdfStatus('ready');
      setActiveTab('pdf');
    } catch (requestError) {
      updatePdfUrl('');
      setPdfStatus('error');
      setPdfExportError(readError(requestError));
      setActiveTab('latex');
    }
  }

  async function generateProposal() {
    setStatus('drafting');
    setError('');
    setPdfExportError('');
    setPdfStatus('idle');
    updatePdfUrl('');

    try {
      const data = await postJson('/api/proposal', {
        ...project,
        topic: project.topic || project.title,
        requirements: DEFAULT_REQUIREMENTS,
        proposalPageTarget,
        literaturePapers: selectedLiteraturePapers,
        ...buildLlmExtras(llmModel)
      });

      setResult(data);
      setActiveWorkspaceView('output');
      setActiveTab('latex');
      const pageNote = data.pageLength?.pageCount
        ? ` ${data.pageLength.pageCount} page(s) (target ${data.pageLength.targetPages}).`
        : '';
      setRunLog((current) => [
        ...current,
        logEntry('Draft', `Generated proposal using ${data.mode}.${pageNote}`),
        logEntry('Review', `Coverage ${countCovered(data.complianceMatrix)}/${data.complianceMatrix?.length || 0}.`)
      ]);

      setPdfStatus('loading');
      void refreshPdfPreview(data.proposalLatex);
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setStatus('idle');
    }
  }

  async function searchLiterature() {
    const topic = project.title || project.topic || topicInput;
    if (!topic.trim() && !project.problem.trim()) return;

    setLiteratureStatus('loading');
    setError('');

    try {
      const data = await postJson('/api/literature', {
        topic,
        problem: project.problem,
        source: literatureSource,
        limit: 8,
        ...buildLlmExtras(llmModel)
      });

      setLiterature(data);
      setSelectedLiteraturePaperIds((data.papers || []).map((paper) => paper.id));
      setActiveLiteratureSummary({
        relatedWorkParagraph: data.relatedWorkParagraph || '',
        gapNote: data.gapNote || ''
      });
      setLiteratureSummaryStatus('idle');
      setRunLog((current) => [
        ...current,
        logEntry('Literature', data.runMessage || `Retrieved ${data.papers?.length || 0} paper(s).`)
      ]);
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setLiteratureStatus('idle');
    }
  }

  function toggleLiteraturePaperSelection(paperId) {
    setSelectedLiteraturePaperIds((current) => {
      const next = new Set(current);
      if (next.has(paperId)) next.delete(paperId);
      else next.add(paperId);
      return (literature?.papers ?? []).map((paper) => paper.id).filter((id) => next.has(id));
    });
    setLiteratureNotice('');
  }

  function selectAllLiteraturePapers() {
    setSelectedLiteraturePaperIds((literature?.papers ?? []).map((paper) => paper.id));
    setLiteratureNotice('');
  }

  function clearLiteraturePaperSelection() {
    setSelectedLiteraturePaperIds([]);
    setLiteratureNotice('');
  }

  function addPaperToReferences(paper) {
    if (!paper?.citation) return;

    let added = false;

    setProject((current) => {
      const { references, addedCount } = mergeCitationsIntoReferences(current.references, [paper]);
      if (!addedCount) return current;
      added = true;
      return { ...current, references };
    });

    if (!added) return;

    clearArtifacts();
    setRunLog((current) => [...current, logEntry('Literature', `Added citation: ${paper.title}.`)]);
  }

  function insertRelatedWork(paragraph) {
    const papers = selectedLiteraturePapers;
    const text = String(
      paragraph ?? activeLiteratureSummary.relatedWorkParagraph ?? literature?.relatedWorkParagraph ?? ''
    ).trim();

    if (!papers.length) {
      setLiteratureNotice('Select at least one paper to include in Problem and Sources.');
      return;
    }

    if (!text) {
      setLiteratureNotice('No prior-research summary is available yet. Run a literature search first.');
      return;
    }

    literatureInsertMetaRef.current = null;

    setProject((current) => {
      const original = normalizeProblemText(current.problem);
      const previous = lastLiteratureSummaryRef.current;
      const hadPreviousBlock =
        Boolean(previous && original.includes(previous)) || hasAutoLiteratureSummary(original);
      const nextProblem = applyLiteratureSummaryToProblem(current.problem, text, previous);
      const { references: nextReferences, addedCount: citationsAdded } = mergeCitationsIntoReferences(
        current.references,
        papers
      );
      const problemChanged = nextProblem !== original;
      const referencesChanged = nextReferences !== String(current.references || '').trim();

      if (!problemChanged && !referencesChanged) {
        literatureInsertMetaRef.current = { type: 'unchanged' };
        return current;
      }

      if (problemChanged) {
        lastLiteratureSummaryRef.current = text;
      }

      literatureInsertMetaRef.current = {
        type: 'changed',
        replaced: hadPreviousBlock,
        problemChanged,
        citationsAdded
      };

      return {
        ...current,
        problem: problemChanged ? nextProblem : current.problem,
        references: referencesChanged ? nextReferences : current.references
      };
    });

    requestAnimationFrame(() => {
      const meta = literatureInsertMetaRef.current;

      if (meta?.type === 'changed') {
        if (meta.problemChanged) {
          setLastInsertedLiteratureSummary(text);
        }
        clearArtifacts();
        setLiteratureNotice(buildLiteratureInsertNotice(meta));
        setRunLog((current) => [
          ...current,
          logEntry('Literature', buildLiteratureInsertLogMessage(meta))
        ]);
      } else if (meta?.type === 'unchanged') {
        setLiteratureNotice('Problem statement and Sources already include the latest literature summary and citations.');
      }
    });
  }

  function focusProblemField() {
    setActiveWorkspaceView('project');
    openProjectField('problem');
  }

  function openProjectField(field) {
    setFocusedProjectField(field);
    requestAnimationFrame(() => {
      workspaceMainRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    });
  }

  function closeProjectField() {
    setFocusedProjectField(null);
  }

  function goToWorkspaceView(viewId) {
    setActiveWorkspaceView(viewId);
    requestAnimationFrame(() => {
      workspaceMainRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    });
  }

  async function runExplain(level) {
    if (!result?.proposalLatex && !project.title && !project.topic) return;

    setExplainStatus('loading');
    setError('');

    try {
      const data = await postJson('/api/explain', {
        project,
        proposalLatex: result?.proposalLatex || '',
        level,
        ...buildLlmExtras(llmModel)
      });

      setExplain(data);
      setRunLog((current) => [
        ...current,
        logEntry('Explain', `Explained the proposal for a ${data.levelLabel || level} reader using ${data.mode}.`)
      ]);
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setExplainStatus('idle');
    }
  }

  function changeExplainLevel(level) {
    setExplainLevel(level);
    if (explain) {
      runExplain(level);
    }
  }

  function startExplain() {
    runExplain(explainLevel);
  }

  function acceptSuggestion(suggestion, { mode = 'merge' } = {}) {
    const field = suggestion.field;
    const incoming = String(suggestion.value || '').trim();
    const existingBeforeAccept = String(project[field] || '').trim();
    const shouldAdvance = mode === 'merge' && !existingBeforeAccept;
    let merged = false;

    setProject((current) => {
      const existing = String(current[field] || '').trim();
      const value =
        mode === 'replace'
          ? incoming
          : !existing
            ? incoming
            : existing === incoming
              ? existing
              : mergeAcceptedFieldValue(existing, incoming);

      if (value === existing) {
        return current;
      }

      merged = true;
      return {
        ...current,
        [field]: value,
        topic: current.topic || current.title || topicInput
      };
    });

    if (merged) {
      clearArtifacts();
      setRunLog((current) => [
        ...current,
        logEntry(
          'Accept',
          mode === 'replace'
            ? `Replaced ${suggestion.label || suggestion.field} with the latest suggestion.`
            : `Merged ${suggestion.label || suggestion.field} into existing field content.`
        )
      ]);
    } else {
      setRunLog((current) => [
        ...current,
        logEntry('Accept', `${suggestion.label || suggestion.field} text is already in the field.`)
      ]);
    }

    if (shouldAdvance) {
      advanceSuggestion();
    }
  }

  function skipSuggestion() {
    if (!currentSuggestion) return;

    const label = currentSuggestion.label || currentSuggestion.field;
    const index = suggestionIndex;

    setFieldSuggestions((current) => {
      const next = current.filter((_, itemIndex) => itemIndex !== index);
      setSuggestionIndex((currentIndex) => Math.min(currentIndex, Math.max(next.length - 1, 0)));
      return next;
    });
    setSuggestionReviseOpen(false);
    setSuggestionGuidance('');
    setRunLog((current) => [...current, logEntry('Skip', `Skipped ${label}.`)]);
  }

  function advanceSuggestion() {
    setSuggestionIndex((current) => Math.min(current + 1, Math.max(fieldSuggestions.length - 1, 0)));
  }

  function chooseOption(decision, option) {
    const field = decision.field;
    const incoming = String(option.value || '').trim();
    const previousResolvedValue = String(decision.resolvedValue || '').trim();
    let merged = false;

    setProject((current) => {
      const existing = String(current[field] || '').trim();
      const value = applyDecisionOptionToProject(existing, incoming, previousResolvedValue);

      if (value === existing) {
        return current;
      }

      merged = true;
      return {
        ...current,
        [field]: value,
        topic: current.topic || current.title || topicInput
      };
    });

    if (merged) {
      clearArtifacts();
    }

    setDecisions((current) =>
      current.map((item) =>
        item.id === decision.id
          ? {
            ...item,
            resolvedOptionLabel: option.label,
            resolvedValue: option.value
          }
          : item
      )
    );

    setRunLog((current) => [
      ...current,
      logEntry(
        'Decision',
        previousResolvedValue
          ? `Updated ${decision.title} to ${option.label}.`
          : `Selected ${option.label} for ${decision.title}.`
      )
    ]);
  }

  function skipDecision() {
    if (!currentDecision) return;

    const title = currentDecision.title;
    const id = currentDecision.id;

    setDecisions((current) => {
      const next = current.filter((item) => item.id !== id);
      setDecisionIndex((index) => Math.min(index, Math.max(next.length - 1, 0)));
      return next;
    });
    setDecisionReviseOpen(false);
    setDecisionGuidance('');
    setRunLog((current) => [...current, logEntry('Skip', `Skipped ${title}.`)]);
  }

  function advanceDecision() {
    setDecisionIndex((current) => Math.min(current + 1, Math.max(decisions.length - 1, 0)));
  }

  async function regenerateStructure(scope) {
    const guidance = (scope === 'suggestion' ? suggestionGuidance : decisionGuidance).trim();
    const rejected =
      scope === 'suggestion' && currentSuggestion
        ? { type: 'suggestion', item: currentSuggestion }
        : scope === 'decision' && currentDecision
          ? { type: 'decision', item: currentDecision }
          : null;

    if (!rejected) {
      setError('Open a suggestion or decision card before regenerating.');
      return;
    }

    setStatus('refining');
    setRefiningScope(scope);
    setError('');

    const topic = String(project.topic || project.title || topicInput || '').trim();
    const projectPayload = {
      ...project,
      topic: topic || project.topic,
      title: project.title || topic
    };

    const rejectedId = rejected?.type === 'decision' ? rejected.item?.id : null;
    const rejectedField = rejected?.type === 'suggestion' ? rejected.item?.field : null;
    const currentSuggestionIndex = suggestionIndex;
    const currentDecisionIndex = decisionIndex;

    try {
      const data = await postJson('/api/agent/refine-structure', {
        project: projectPayload,
        topic,
        requirements: DEFAULT_REQUIREMENTS,
        guidance,
        scope,
        rejected,
        rejectedIndex: scope === 'suggestion' ? currentSuggestionIndex : undefined,
        fieldSuggestions,
        decisions,
        ...buildLlmExtras(llmModel)
      });

      const nextSuggestions = mergeSuggestionsPreservingOrder(
        fieldSuggestions,
        data.fieldSuggestions || [],
        currentSuggestionIndex,
        rejectedField
      );
      const nextDecisionsOrdered = mergeDecisionsPreservingOrder(decisions, data.decisions || [], rejectedId);
      const nextDecisions = mergeDecisionsAfterRegenerate(decisions, nextDecisionsOrdered, rejectedId);

      setFieldSuggestions(nextSuggestions);
      setDecisions(nextDecisions);
      if (Array.isArray(data.questions)) {
        setQuestions(data.questions);
      }
      setSuggestionIndex(Math.min(currentSuggestionIndex, Math.max(nextSuggestions.length - 1, 0)));
      setDecisionIndex(Math.min(currentDecisionIndex, Math.max(nextDecisions.length - 1, 0)));
      setSuggestionReviseOpen(false);
      setDecisionReviseOpen(false);
      setSuggestionGuidance('');
      setDecisionGuidance('');
      clearArtifacts();
      setRunLog((current) => [
        ...current,
        logEntry('Structure', data.runMessage || 'Regenerated structuring ideas from your guidance.'),
        logEntry(
          'Decide',
          `Review ${nextSuggestions.length} suggestion(s) and ${nextDecisions.length} decision card(s).`
        )
      ]);
    } catch (requestError) {
      const message = readError(requestError);
      if (/cannot post|404|not found/i.test(message)) {
        setError('Structure refine API is unavailable. Restart the dev server (npm run dev) and try again.');
      } else {
        setError(message);
      }
    } finally {
      setStatus('idle');
      setRefiningScope(null);
    }
  }

  function updateProjectField(field, value) {
    setProject((current) => ({
      ...current,
      [field]: value,
      topic: current.topic || current.title || topicInput
    }));
    clearArtifacts();
  }

  async function strengthenProjectField(field, guidance = '') {
    const label = labelForField(field);
    setRefiningProjectField(field);
    setError('');

    try {
      const response = await fetch('/api/agent/refine-field', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field,
          value: project[field] || '',
          guidance,
          project,
          topic: project.topic || project.title || topicInput,
          ...buildLlmExtras(llmModel)
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || data.error || 'Field refinement failed.');
      }

      updateProjectField(field, data.value || '');
      setRunLog((current) => [
        ...current,
        logEntry(
          'Project',
          data.note ||
          `Strengthened ${label}${data.mode === 'local-fallback' ? ' (local template)' : ''}.`
        )
      ]);

      if (data.warning) {
        setRunLog((current) => [
          ...current,
          logEntry('Project', `Model refine note for ${label}: ${data.warning}`)
        ]);
      }

      return data;
    } catch (requestError) {
      const message = readError(requestError);
      if (/cannot post|404|not found/i.test(message)) {
        setError('Field refine API is unavailable. Restart the dev server (npm run dev) and try again.');
      } else {
        setError(message);
      }
      throw requestError;
    } finally {
      setRefiningProjectField(null);
    }
  }

  function clearArtifacts() {
    setResult(null);
    updatePdfUrl('');
    setPdfStatus('idle');
    setPdfExportError('');
    setExplain(null);
  }

  function updatePdfUrl(nextUrl) {
    setPdfUrl((currentUrl) => {
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      return nextUrl;
    });
  }

  function reset() {
    setTopicInput('');
    setProject(EMPTY_PROJECT);
    setFieldSuggestions([]);
    setDecisions([]);
    setQuestions([]);
    setCustomNote('');
    clearArtifacts();
    setRunLog([]);
    setError('');
    setActiveTab('pdf');
    setActiveWorkspaceView('start');
    setSuggestionIndex(0);
    setDecisionIndex(0);
    setExplain(null);
    setExplainLevel('kid');
    setLiterature(null);
    setLiteratureSource('auto');
    setLiteratureNotice('');
    setSelectedLiteraturePaperIds([]);
    setActiveLiteratureSummary({ relatedWorkParagraph: '', gapNote: '' });
    setLiteratureSummaryStatus('idle');
    setLastInsertedLiteratureSummary('');
    lastLiteratureSummaryRef.current = '';
    setFocusedProjectField(null);
    setSuggestionReviseOpen(false);
    setDecisionReviseOpen(false);
    setSuggestionGuidance('');
    setDecisionGuidance('');
    setRefiningScope(null);
    setProposalPageTarget(PROPOSAL_PAGE_DEFAULT);
  }

  function downloadLatex() {
    const proposal = result?.proposalLatex || '';
    const blob = new Blob([proposal], { type: 'text/x-tex;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = 'proposal.tex';
    anchor.click();
    URL.revokeObjectURL(href);
  }

  async function downloadPdf() {
    if (!result?.proposalLatex) return;

    setStatus('exporting');
    setError('');

    try {
      const href = pdfUrl || (await exportPdfUrl(result.proposalLatex, project.title || 'proposal', project));
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = 'proposal.pdf';
      anchor.click();
      if (!pdfUrl) URL.revokeObjectURL(href);
      setRunLog((current) => [...current, logEntry('Export', 'Downloaded proposal.pdf.')]);
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setStatus('idle');
    }
  }

  function saveMemory({ silent = false } = {}) {
    const snapshot = {
      savedAt: new Date().toISOString(),
      topicInput,
      project,
      fieldSuggestions,
      decisions,
      questions,
      result: compactResult(result),
      runLog,
      activeTab,
      activeWorkspaceView,
      suggestionIndex,
      decisionIndex,
      llmModel,
      proposalPageTarget
    };

    localStorage.setItem(MEMORY_KEY, JSON.stringify(snapshot));
    setMemorySavedAt(snapshot.savedAt);

    if (!silent) {
      setRunLog((current) => [...current, logEntry('Memory', 'Saved workspace memory.')]);
    }
  }

  async function loadSavedMemory({ silent = false } = {}) {
    const raw = localStorage.getItem(MEMORY_KEY) || localStorage.getItem(LEGACY_MEMORY_KEY);

    if (!raw) {
      if (!silent) setError('No saved memory found.');
      return false;
    }

    let snapshot;

    try {
      snapshot = normalizeMemorySnapshot(JSON.parse(raw));
    } catch {
      localStorage.removeItem(MEMORY_KEY);
      localStorage.removeItem(LEGACY_MEMORY_KEY);
      setMemorySavedAt('');

      if (silent) {
        setError('');
        return false;
      }

      setError('Saved memory was corrupted and has been cleared. Save again when you are ready.');
      return false;
    }

    try {
      applyMemorySnapshot(snapshot);
      setError('');

      if (snapshot.result?.proposalLatex) {
        setPdfStatus('loading');
        setPdfExportError('');

        try {
          const url = await exportPdfUrl(
            snapshot.result.proposalLatex,
            snapshot.project?.title || 'proposal',
            snapshot.project
          );
          updatePdfUrl(url);
          setPdfStatus('ready');
        } catch (requestError) {
          updatePdfUrl('');
          setPdfStatus('error');
          setPdfExportError(readError(requestError));
        }
      } else {
        updatePdfUrl('');
        setPdfStatus('idle');
        setPdfExportError('');
      }

      localStorage.setItem(MEMORY_KEY, JSON.stringify(snapshot));
      localStorage.removeItem(LEGACY_MEMORY_KEY);

      if (!silent) {
        setRunLog((current) => [...current, logEntry('Memory', 'Reloaded saved workspace memory.')]);
      }

      return true;
    } catch (restoreError) {
      if (!silent) {
        setError(`Could not restore saved memory: ${readError(restoreError)}`);
      }
      return false;
    }
  }

  function applyMemorySnapshot(snapshot) {
    setTopicInput(snapshot.topicInput);
    setProject(snapshot.project);
    setFieldSuggestions(snapshot.fieldSuggestions);
    setDecisions(snapshot.decisions);
    setQuestions(snapshot.questions);

    const restoredResult = snapshot.result;
    setResult(
      restoredResult
        ? { ...restoredResult, provider: normalizeStoredProvider(restoredResult.provider) }
        : null
    );
    setRunLog(snapshot.runLog);
    setActiveTab(snapshot.activeTab);
    setActiveWorkspaceView(snapshot.activeWorkspaceView);
    setSuggestionIndex(snapshot.suggestionIndex);
    setDecisionIndex(snapshot.decisionIndex);
    setLlmModel(snapshot.llmModel);
    setProposalPageTarget(normalizeProposalPageTarget(snapshot.proposalPageTarget));
    setMemorySavedAt(snapshot.savedAt);
  }

  function clearSavedMemory() {
    localStorage.removeItem(MEMORY_KEY);
    localStorage.removeItem(LEGACY_MEMORY_KEY);
    setMemorySavedAt('');
    setError('');
  }

  const currentWorkspaceView = WORKSPACE_VIEWS.find((view) => view.id === activeWorkspaceView) || WORKSPACE_VIEWS[0];
  const hasTopicContext = Boolean(project.title || project.topic || topicInput.trim());
  return (
    <main className="app-shell">
      <header className="topbar">
        <h1>Research Proposal Agent</h1>
        <span className="status-pill" aria-live="polite" aria-label={`Current phase: ${currentWorkspaceView.label}`}>
          <Sparkles size={16} aria-hidden="true" />
          {currentWorkspaceView.label}
        </span>
      </header>

      <div className="workspace-layout">
        <WorkspaceSidebar
          activeViewId={activeWorkspaceView}
          hasTopicContext={hasTopicContext}
          onNavigate={goToWorkspaceView}
          llmConfig={llmConfig}
          llmModel={llmModel}
          onSelectModel={setLlmModel}
          badgeContext={{
            fieldSuggestions,
            acceptedSuggestionCount,
            decisions,
            literature,
            acceptedCount,
            result
          }}
        />

        <section className="workspace-main" ref={workspaceMainRef}>
          <header className="view-header">
            <div>
              <h2>{currentWorkspaceView.label}</h2>
              <p className="view-description">{currentWorkspaceView.description}</p>
            </div>
            {error ? <p className="error-banner view-error">{error}</p> : null}
          </header>

          {activeWorkspaceView === 'start' ? (
            <div className="view-page view-page--start">
              <div className="topic-launch">
                <label htmlFor="project-topic">
                  Rough Idea
                  <input
                    id="project-topic"
                    value={topicInput}
                    onChange={(event) => setTopicInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') startAgent();
                    }}
                    placeholder="Example: Process-based RL to improve math reasoning in language models"
                  />
                </label>
                <div className="actions framework-actions">
                  <button className="primary" disabled={!topicInput.trim() || status !== 'idle'} onClick={startAgent} type="button">
                    {status === 'starting' ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
                    Structure Idea
                  </button>
                  <button className="secondary" disabled={status !== 'idle'} onClick={startSampleAgent} type="button">
                    <Sparkles size={18} aria-hidden="true" />
                    Sample
                  </button>
                  <button className="secondary icon-button" onClick={reset} type="button" aria-label="Reset">
                    <RefreshCw size={18} aria-hidden="true" />
                  </button>
                </div>
              </div>

              <div className="memory-bar">
                <div>
                  <strong>Memory</strong>
                  <span>{memorySavedAt ? `Saved ${formatSavedAt(memorySavedAt)}` : 'No saved workspace yet'}</span>
                </div>
                <div className="memory-actions">
                  <button className="secondary" type="button" onClick={() => saveMemory()}>
                    Save
                  </button>
                  <button className="secondary" type="button" onClick={() => loadSavedMemory()}>
                    Reload
                  </button>
                  <button className="secondary" type="button" onClick={clearSavedMemory}>
                    Clear
                  </button>
                </div>
              </div>

              <div className="workflow-grid" aria-label="Workflow stages">
                {STAGES.map(([number, title, description], index) => (
                  <article className="stage-card" key={title}>
                    <div className="stage-topline">
                      <span className="stage-number">{number}</span>
                      <span className={`stage-status ${stageStatus(index, fieldSuggestions, decisions, project, result)}`}>
                        {stageLabel(index, fieldSuggestions, decisions, project, result)}
                      </span>
                    </div>
                    <h3>{title}</h3>
                    <p>{description}</p>
                  </article>
                ))}
              </div>

            </div>
          ) : null}

          {activeWorkspaceView === 'structure' ? (
            <div className="view-page view-page--structure">
              <div className="structure-layout">
                <section className="workspace-panel suggestions-panel">
                  <PanelHeader title="LLM Suggested Structure" meta={`${fieldSuggestions.length} fields`} />
                  {fieldSuggestions.length ? (
                    <div className="suggestion-deck">
                      <div className="deck-progress">
                        <span>{Math.min(suggestionIndex + 1, fieldSuggestions.length)} / {fieldSuggestions.length}</span>
                        <strong>{acceptedSuggestionCount} accepted</strong>
                      </div>
                      {currentSuggestion ? (
                        <article className="suggestion-card active-card" key={`${currentSuggestion.field}-${currentSuggestion.value}`}>
                          <div className="card-line">
                            <h3>{currentSuggestion.label || labelForField(currentSuggestion.field)}</h3>
                            <span className={`priority ${String(currentSuggestion.confidence || 'medium').toLowerCase()}`}>
                              {currentSuggestion.confidence || 'Medium'}
                            </span>
                          </div>
                          <p>{currentSuggestion.value}</p>
                          <small>{currentSuggestion.reason}</small>
                          <div className="deck-actions">
                            {(() => {
                              const fieldValue = project[currentSuggestion.field];
                              const applied = isSuggestionApplied(fieldValue, currentSuggestion.value);
                              const hasFieldContent = Boolean(String(fieldValue || '').trim());
                              const canReplace = hasFieldContent && !applied;

                              return (
                                <>
                                  <button
                                    className={applied ? 'secondary accepted' : 'primary'}
                                    type="button"
                                    disabled={status !== 'idle' || applied}
                                    onClick={() => acceptSuggestion(currentSuggestion)}
                                  >
                                    <CheckCircle2 size={16} aria-hidden="true" />
                                    {applied ? 'Accepted' : hasFieldContent ? 'Merge into field' : 'Accept and Next'}
                                  </button>
                                  {canReplace ? (
                                    <button
                                      className="secondary"
                                      type="button"
                                      disabled={status !== 'idle'}
                                      onClick={() => acceptSuggestion(currentSuggestion, { mode: 'replace' })}
                                    >
                                      Replace field
                                    </button>
                                  ) : null}
                                  <button className="secondary" type="button" onClick={skipSuggestion} disabled={status !== 'idle'}>
                                    Skip
                                  </button>
                                  {!suggestionReviseOpen ? (
                                    <button
                                      className="ghost-action"
                                      type="button"
                                      disabled={status !== 'idle'}
                                      onClick={() => setSuggestionReviseOpen(true)}
                                    >
                                      <RefreshCw size={15} aria-hidden="true" />
                                      Revise
                                    </button>
                                  ) : null}
                                </>
                              );
                            })()}
                          </div>
                          {suggestionReviseOpen ? (
                            <RevisePanel
                              value={suggestionGuidance}
                              onChange={setSuggestionGuidance}
                              onClose={() => {
                                setSuggestionReviseOpen(false);
                                setSuggestionGuidance('');
                              }}
                              onSubmit={() => regenerateStructure('suggestion')}
                              refining={status === 'refining' && refiningScope === 'suggestion'}
                              disabled={status !== 'idle'}
                              placeholder="Off-topic or wrong focus? Tell the model what to suggest instead."
                            />
                          ) : null}
                        </article>
                      ) : null}
                      <div className="deck-nav">
                        <button
                          className="secondary"
                          type="button"
                          disabled={suggestionIndex === 0}
                          onClick={() => setSuggestionIndex((current) => Math.max(current - 1, 0))}
                        >
                          Previous
                        </button>
                        <button
                          className="secondary"
                          type="button"
                          disabled={suggestionIndex >= fieldSuggestions.length - 1}
                          onClick={() => setSuggestionIndex((current) => Math.min(current + 1, fieldSuggestions.length - 1))}
                        >
                          Next
                        </button>
                      </div>
                      <div className="deck-strip" aria-label="Suggestion progress">
                        {fieldSuggestions.map((suggestion, index) => (
                          <button
                            key={`${suggestion.field}-${index}`}
                            className={[
                              'deck-dot',
                              index === suggestionIndex ? 'current' : '',
                              isSuggestionApplied(project[suggestion.field], suggestion.value) ? 'done' : ''
                            ].join(' ')}
                            type="button"
                            aria-label={`Open ${suggestion.label || labelForField(suggestion.field)}`}
                            onClick={() => setSuggestionIndex(index)}
                          />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <EmptyState text="Enter a rough idea, then let the model structure it." compact />
                  )}
                </section>

                <section className="workspace-panel decisions-panel">
                  <PanelHeader
                    title="Major Decisions"
                    meta={
                      decisions.length
                        ? resolvedDecisionCount
                          ? `${resolvedDecisionCount} resolved${openDecisionCount ? ` · ${openDecisionCount} open` : ''}`
                          : `${openDecisionCount} open`
                        : ''
                    }
                  />
                  {decisions.length ? (
                    <div className="decision-deck">
                      <div className="deck-progress">
                        <span>{Math.min(decisionIndex + 1, decisions.length)} / {decisions.length}</span>
                        <strong>
                          {resolvedDecisionCount ? `${resolvedDecisionCount} resolved` : `${openDecisionCount} open`}
                        </strong>
                      </div>
                      {currentDecision ? (
                        <article className="decision-card active-card" key={currentDecision.id}>
                          <div className="card-line">
                            <div className="card-title-group">
                              <h3>{currentDecision.title}</h3>
                              {isDecisionResolved(currentDecision) ? (
                                <span className="resolved-badge">Resolved · {currentDecision.resolvedOptionLabel}</span>
                              ) : null}
                            </div>
                            <button
                              className={['revise-chip', decisionReviseOpen ? 'active' : ''].join(' ')}
                              type="button"
                              disabled={status !== 'idle'}
                              aria-expanded={decisionReviseOpen}
                              onClick={() => setDecisionReviseOpen((open) => !open)}
                            >
                              <RefreshCw size={14} aria-hidden="true" />
                              Revise
                            </button>
                          </div>
                          <p>{currentDecision.question}</p>
                          <div className="option-stack">
                            {currentDecision.options.map((option) => (
                              <button
                                className={[
                                  'option-button',
                                  option.label === currentDecision.resolvedOptionLabel ? 'selected' : ''
                                ].join(' ')}
                                key={`${currentDecision.id}-${option.label}`}
                                type="button"
                                disabled={status !== 'idle'}
                                onClick={() => chooseOption(currentDecision, option)}
                              >
                                <strong>{option.label}</strong>
                                <span>{option.value}</span>
                                <small>{option.rationale}</small>
                              </button>
                            ))}
                          </div>
                          {decisionReviseOpen ? (
                            <RevisePanel
                              value={decisionGuidance}
                              onChange={setDecisionGuidance}
                              onClose={() => {
                                setDecisionReviseOpen(false);
                                setDecisionGuidance('');
                              }}
                              onSubmit={() => regenerateStructure('decision')}
                              refining={status === 'refining' && refiningScope === 'decision'}
                              disabled={status !== 'idle'}
                              placeholder="Options miss the point? Describe better choices for this decision."
                            />
                          ) : null}
                          <div className="deck-actions">
                            <button className="secondary" type="button" onClick={skipDecision} disabled={status !== 'idle'}>
                              Skip
                            </button>
                          </div>
                        </article>
                      ) : null}
                      <div className="deck-nav">
                        <button
                          className="secondary"
                          type="button"
                          disabled={decisionIndex === 0}
                          onClick={() => setDecisionIndex((current) => Math.max(current - 1, 0))}
                        >
                          Previous
                        </button>
                        <button
                          className="secondary"
                          type="button"
                          disabled={decisionIndex >= decisions.length - 1}
                          onClick={() => setDecisionIndex((current) => Math.min(current + 1, decisions.length - 1))}
                        >
                          Next
                        </button>
                      </div>
                      <div className="deck-strip" aria-label="Decision progress">
                        {decisions.map((decision, index) => (
                          <button
                            key={`${decision.id}-${index}`}
                            className={[
                              'deck-dot',
                              index === decisionIndex ? 'current' : '',
                              isDecisionResolved(decision) ? 'done' : ''
                            ].join(' ')}
                            type="button"
                            aria-label={`Open ${decision.title}`}
                            onClick={() => setDecisionIndex(index)}
                          />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <EmptyState text="No decision cards yet. Start from a rough idea or regenerate suggestions." compact />
                  )}

                  <section className="custom-note">
                    <h3>Extra Note</h3>
                    <textarea
                      value={customNote}
                      onChange={(event) => setCustomNote(event.target.value)}
                      placeholder={currentQuestion?.question || 'Add a detail the options missed.'}
                    />
                    <button className="primary" disabled={!customNote.trim() || status !== 'idle'} onClick={submitCustomNote} type="button">
                      {status === 'answering' ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
                      Let LLM Integrate
                    </button>
                  </section>
                </section>
              </div>

            </div>
          ) : null}

          {activeWorkspaceView === 'research' ? (
            <div className="view-page view-page--research">
              {hasTopicContext ? (
                <LiteraturePanel
                  literature={literature}
                  source={literatureSource}
                  status={literatureStatus}
                  summaryStatus={literatureSummaryStatus}
                  selectedPaperIds={selectedLiteraturePaperIds}
                  summaryText={activeLiteratureSummary.relatedWorkParagraph}
                  summaryGapNote={activeLiteratureSummary.gapNote}
                  references={project.references}
                  problemText={project.problem}
                  lastInsertedSummary={lastInsertedLiteratureSummary}
                  insertNotice={literatureNotice}
                  onSourceChange={setLiteratureSource}
                  onSearch={() => {
                    setLiteratureNotice('');
                    searchLiterature();
                  }}
                  onTogglePaperSelection={toggleLiteraturePaperSelection}
                  onSelectAllPapers={selectAllLiteraturePapers}
                  onClearPaperSelection={clearLiteraturePaperSelection}
                  onAddPaper={addPaperToReferences}
                  onInsertRelatedWork={insertRelatedWork}
                  onFocusProblem={focusProblemField}
                />
              ) : (
                <EmptyState text="Enter a rough idea on Start, then return here to search papers." />
              )}
            </div>
          ) : null}

          {activeWorkspaceView === 'project' ? (
            <div className="view-page view-page--project">
              <section className="workspace-panel state-panel project-fields-panel">
                <PanelHeader title="Accepted Project State" meta={`${acceptedCount}/${PROJECT_FIELDS.length} ready`} />
                <p className="project-fields-hint">
                  Title stays visible below. Click any section card to open a full-screen editor for that field.
                </p>
                <label className="project-title-field">
                  Project Title
                  <input value={project.title} onChange={(event) => updateProjectField('title', event.target.value)} />
                </label>
                <div className="project-field-cards">
                  {PROJECT_FIELDS.map(([field, label]) => (
                    <ProjectFieldCard
                      key={field}
                      field={field}
                      label={label}
                      value={project[field] || ''}
                      isOpen={focusedProjectField === field}
                      onOpen={() => openProjectField(field)}
                    />
                  ))}
                </div>
                <div className="project-generate-row">
                  <div className="proposal-length-panel">
                    <div className="proposal-length-control">
                      <div className="proposal-length-header">
                        <div className="proposal-length-heading">
                          <span className="proposal-length-label">Proposal length</span>
                          <span className="proposal-length-subtitle">Target page count for your export</span>
                        </div>
                        <span className="proposal-length-value-badge" aria-live="polite">
                          {proposalPageTarget} {proposalPageTarget === 1 ? 'page' : 'pages'}
                        </span>
                      </div>
                      <div className="proposal-length-slider-wrap">
                        <div className="proposal-length-slider-shell">
                          <div className="proposal-length-slider-rail" aria-hidden="true">
                            <div
                              className="proposal-length-slider-fill"
                              style={{ width: `${proposalLengthFill}%` }}
                            />
                          </div>
                          <input
                            type="range"
                            className="proposal-length-slider"
                            min={PROPOSAL_PAGE_MIN}
                            max={PROPOSAL_PAGE_MAX}
                            step={1}
                            value={proposalPageTarget}
                            onChange={(event) => setProposalPageTarget(normalizeProposalPageTarget(event.target.value))}
                            disabled={status !== 'idle'}
                            aria-valuemin={PROPOSAL_PAGE_MIN}
                            aria-valuemax={PROPOSAL_PAGE_MAX}
                            aria-valuenow={proposalPageTarget}
                            aria-describedby="proposal-length-hint"
                          />
                        </div>
                        <div className="proposal-length-ticks" aria-hidden="true">
                          {PROPOSAL_PAGE_OPTIONS.map((pages) => (
                            <span
                              key={pages}
                              className={pages === proposalPageTarget ? 'is-active' : undefined}
                            >
                              {pages}
                            </span>
                          ))}
                        </div>
                      </div>
                      <p id="proposal-length-hint" className="proposal-length-hint">
                        Slide between {PROPOSAL_PAGE_MIN} and {PROPOSAL_PAGE_MAX} pages. Your draft is trimmed to fit this target.
                      </p>
                    </div>
                    <div className="proposal-length-divider" aria-hidden="true" />
                    <div className="project-generate-action">
                      <button className="primary" disabled={!project.title || status !== 'idle'} onClick={generateProposal} type="button">
                        {status === 'drafting' ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <FileText size={16} aria-hidden="true" />}
                        {status === 'drafting' ? 'Generating draft…' : 'Generate Proposal'}
                      </button>
                    </div>
                  </div>
                  {status === 'drafting' ? (
                    <p className="project-generate-hint" role="status">
                      Owl Alpha and similar models often need 1–2 minutes for a full LaTeX draft. You will move to Output when the text is ready; PDF preview compiles afterward.
                    </p>
                  ) : null}
                </div>
              </section>
            </div>
          ) : null}

          {activeWorkspaceView === 'project' && focusedProjectField ? (
            <ProjectFieldEditor
              field={focusedProjectField}
              label={labelForField(focusedProjectField)}
              value={project[focusedProjectField] || ''}
              onChange={(value) => updateProjectField(focusedProjectField, value)}
              onClose={closeProjectField}
              onStrengthen={(guidance) => strengthenProjectField(focusedProjectField, guidance)}
              refining={refiningProjectField === focusedProjectField}
              llmConfigured={Boolean(llmConfig?.configured)}
              inputRef={focusedProjectField === 'problem' ? problemFieldRef : undefined}
            />
          ) : null}

          {activeWorkspaceView === 'output' ? (
            <div className="view-page view-page--output">
              <div className="workflow-columns workflow-columns--output">
                <RunLogPanel entries={runLog} />

                <div className="artifacts-column">
                  <div className="artifact-toolbar">
                    <nav className="tabs" aria-label="Generated artifacts">
                      {TABS.map(([id, Icon, label]) => (
                        <button
                          key={id}
                          className={activeTab === id ? 'tab active' : 'tab'}
                          type="button"
                          onClick={() => setActiveTab(id)}
                        >
                          <Icon size={17} aria-hidden="true" />
                          {label}
                        </button>
                      ))}
                    </nav>
                    <div className="artifact-downloads">
                      <button className="secondary" type="button" disabled={!result?.proposalLatex} onClick={downloadLatex}>
                        <Download size={17} aria-hidden="true" />
                        LaTeX
                      </button>
                      <button
                        className="primary"
                        type="button"
                        disabled={!result?.proposalLatex || status !== 'idle'}
                        onClick={downloadPdf}
                      >
                        {status === 'exporting' ? <Loader2 className="spin" size={17} aria-hidden="true" /> : <Download size={17} aria-hidden="true" />}
                        PDF
                      </button>
                    </div>
                  </div>

                  <div className="artifact-summary">
                    <div>
                      <span>Coverage</span>
                      <strong>{matrixStats.total ? `${matrixStats.covered}/${matrixStats.total}` : '0/0'}</strong>
                    </div>
                    <div>
                      <span>Accepted</span>
                      <strong>{acceptedCount}/{PROJECT_FIELDS.length}</strong>
                    </div>
                    <div className="artifact-summary-item artifact-summary-item--provider">
                      <span>Provider</span>
                      <div className="provider-display">
                        <strong className="provider-display-label">{generationProvider.label}</strong>
                        {generationProvider.meta ? (
                          <span className="provider-display-meta">{generationProvider.meta}</span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="artifact-content">
                    {pdfExportError && pdfStatus !== 'ready' && result?.proposalLatex ? (
                      <p className="artifact-pdf-notice" role="status">
                        {pdfExportError}
                      </p>
                    ) : null}

                    {activeTab === 'explain' ? (
                      <ExplainPanel
                        explain={explain}
                        level={explainLevel}
                        status={explainStatus}
                        hasProposal={Boolean(result?.proposalLatex)}
                        onChangeLevel={changeExplainLevel}
                        onExplain={startExplain}
                      />
                    ) : (
                      renderArtifact(activeTab, result, {
                        pdfUrl,
                        pdfStatus,
                        pdfExportError,
                        onRetryPdf: () => refreshPdfPreview(),
                        onViewLatex: () => setActiveTab('latex')
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

        </section>
      </div>
    </main>
  );
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail || data.error || 'Request failed.');
  }

  return data;
}

async function exportPdfUrl(proposalLatex, title, project = null) {
  const response = await fetch('/api/export/pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      proposalLatex,
      project
    })
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.detail || data.error || 'PDF export failed.');
  }

  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

function renderArtifact(activeTab, result, { pdfUrl, pdfStatus, pdfExportError, onRetryPdf, onViewLatex }) {
  if (!result) {
    return <EmptyState text="Proposal artifacts appear after Generate Proposal." />;
  }

  if (activeTab === 'pdf') {
    if (pdfStatus === 'loading') {
      return (
        <div className="artifact-status-card">
          <Loader2 className="spin" size={22} aria-hidden="true" />
          <p>Compiling PDF preview…</p>
          <small>LaTeX is already available in the LaTeX tab while this runs.</small>
        </div>
      );
    }

    if (pdfStatus === 'error') {
      return (
        <div className="artifact-status-card artifact-status-card--error">
          <AlertCircle size={22} aria-hidden="true" />
          <p>PDF preview could not be built.</p>
          <small>{pdfExportError}</small>
          <div className="artifact-status-actions">
            <button className="secondary" type="button" onClick={onRetryPdf}>
              Retry PDF
            </button>
            <button className="primary" type="button" onClick={onViewLatex}>
              View LaTeX
            </button>
          </div>
        </div>
      );
    }

    return pdfUrl ? (
      <iframe className="pdf-preview" src={pdfUrl} title="Compiled proposal PDF" />
    ) : (
      <EmptyState text="PDF preview is not ready yet. Open the LaTeX tab or retry PDF." />
    );
  }

  if (activeTab === 'matrix') {
    return (
      <div className="matrix-wrap">
        <table>
          <thead>
            <tr>
              <th>Requirement</th>
              <th>Status</th>
              <th>Evidence</th>
              <th>Fix</th>
            </tr>
          </thead>
          <tbody>
            {(result.complianceMatrix || []).map((row, index) => (
              <tr key={`${row.requirement}-${index}`}>
                <td>{row.requirement}</td>
                <td>
                  <span className={/^covered$/i.test(row.status) ? 'badge covered' : 'badge needs-work'}>{row.status}</span>
                </td>
                <td>{row.evidence}</td>
                <td>{row.fix}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (activeTab === 'evaluation') {
    return <pre>{result.evaluationReport}</pre>;
  }

  return <pre className="proposal-output">{result.proposalLatex}</pre>;
}

function ExplainPanel({ explain, level, status, hasProposal, onChangeLevel, onExplain }) {
  const levelIndex = Math.max(0, EXPLAIN_LEVELS.findIndex(([id]) => id === level));
  const isLoading = status === 'loading';

  return (
    <div className="explain-panel">
      <div className="explain-controls">
        <div className="explain-slider">
          <label htmlFor="explain-level">
            Reading level: <strong>{EXPLAIN_LEVELS[levelIndex]?.[1] || '5th grader'}</strong>
          </label>
          <input
            id="explain-level"
            type="range"
            min={0}
            max={EXPLAIN_LEVELS.length - 1}
            step={1}
            value={levelIndex}
            disabled={!hasProposal || isLoading}
            onChange={(event) => onChangeLevel(EXPLAIN_LEVELS[Number(event.target.value)][0])}
          />
          <div className="explain-ticks">
            {EXPLAIN_LEVELS.map(([id, label]) => (
              <span key={id} className={id === level ? 'tick active' : 'tick'}>
                {label}
              </span>
            ))}
          </div>
        </div>

        <div className="explain-action-row">
          {!hasProposal ? (
            <p className="explain-action-hint">Generate a proposal first, then explain it here at any reading level.</p>
          ) : (
            <button
              className="primary explain-action-btn"
              type="button"
              onClick={onExplain}
              disabled={isLoading}
            >
              {isLoading ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
              {isLoading ? 'Explaining…' : explain ? 'Re-explain' : 'Explain proposal'}
            </button>
          )}
        </div>
      </div>

      {isLoading && !explain ? (
        <EmptyState text="Generating a plain-language explanation for this reading level." compact />
      ) : explain ? (
        <div className="explain-content">
          <p className="explain-tagline">{explain.tagline}</p>

          <div className="explain-block">
            <h3>Like this&hellip;</h3>
            <p>{explain.analogy}</p>
          </div>
          <div className="explain-block">
            <h3>What it is</h3>
            <p>{explain.whatItIs}</p>
          </div>
          <div className="explain-block">
            <h3>Why it matters</h3>
            <p>{explain.whyItMatters}</p>
          </div>
          <div className="explain-block">
            <h3>How it works</h3>
            <p>{explain.howItWorks}</p>
          </div>

          {explain.glossary?.length ? (
            <div className="explain-block">
              <h3>Words to know</h3>
              <ul className="explain-glossary">
                {explain.glossary.map((entry) => (
                  <li key={entry.term}>
                    <strong>{entry.term}:</strong> {entry.plain}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {explain.layAbstract ? (
            <div className="explain-block">
              <h3>Plain-language summary</h3>
              <p>{explain.layAbstract}</p>
            </div>
          ) : null}
        </div>
      ) : hasProposal ? (
        <EmptyState text="Choose a reading level above, then click Explain proposal." compact />
      ) : null}
    </div>
  );
}

function filterSelectedLiteraturePapers(papers, selectedIds) {
  if (!Array.isArray(papers) || !papers.length) return [];
  const selected = new Set(selectedIds || []);
  return papers.filter((paper) => selected.has(paper.id));
}

function LiteraturePanel({
  literature,
  source,
  status,
  summaryStatus,
  selectedPaperIds,
  summaryText,
  summaryGapNote,
  references,
  problemText,
  lastInsertedSummary,
  insertNotice,
  onSourceChange,
  onSearch,
  onTogglePaperSelection,
  onSelectAllPapers,
  onClearPaperSelection,
  onAddPaper,
  onInsertRelatedWork,
  onFocusProblem
}) {
  const [expandedId, setExpandedId] = useState(null);
  const [paperPage, setPaperPage] = useState(0);
  const view = getLiteratureView(literature, status);
  const papers = literature?.papers ?? [];
  const selectedSet = useMemo(() => new Set(selectedPaperIds || []), [selectedPaperIds]);
  const selectedPapers = useMemo(
    () => filterSelectedLiteraturePapers(papers, selectedPaperIds),
    [papers, selectedPaperIds]
  );
  const selectedCount = selectedPapers.length;
  const totalPaperPages = Math.max(1, Math.ceil(papers.length / LITERATURE_PAPERS_PER_PAGE));
  const safePaperPage = Math.min(paperPage, totalPaperPages - 1);
  const pageStart = safePaperPage * LITERATURE_PAPERS_PER_PAGE;
  const visiblePapers = papers.slice(pageStart, pageStart + LITERATURE_PAPERS_PER_PAGE);
  const normalizedSummaryText = String(summaryText || '').trim();
  const normalizedProblem = normalizeProblemText(problemText);
  const citationsUpToDate = areLiteratureCitationsInReferences(references, selectedPapers);
  const summaryUpToDate = Boolean(normalizedSummaryText && normalizedProblem.includes(normalizedSummaryText) && citationsUpToDate);
  const hasStaleLiterature =
    Boolean(normalizedSummaryText && !summaryUpToDate) &&
    (hasAutoLiteratureSummary(normalizedProblem) ||
      Boolean(lastInsertedSummary && normalizedProblem.includes(lastInsertedSummary.trim())));
  const summaryLoading = summaryStatus === 'loading';

  useEffect(() => {
    if (status === 'loading') {
      setExpandedId(null);
      setPaperPage(0);
    }
  }, [status]);

  useEffect(() => {
    setPaperPage(0);
    setExpandedId(null);
  }, [literature]);

  return (
    <section className="literature-panel">
      <div className="panel-header">
        <h2>
          <BookOpen size={18} aria-hidden="true" />
          Literature
        </h2>
        <span className={`literature-status ${view.statusClass}`}>{view.statusLabel}</span>
      </div>

      <div className="literature-controls">
        <label htmlFor="literature-source">
          Source
          <select id="literature-source" value={source} onChange={(event) => onSourceChange(event.target.value)}>
            {LITERATURE_SOURCE_OPTIONS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button className="primary" type="button" onClick={onSearch} disabled={status === 'loading'}>
          {status === 'loading' ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <BookOpen size={16} aria-hidden="true" />}
          Search
        </button>
      </div>

      {view.fallbackNotice ? (
        <div className="literature-fallback-banner" role="status">
          <AlertCircle size={18} aria-hidden="true" />
          <p>{view.fallbackNotice}</p>
        </div>
      ) : null}

      {view.hint && !view.fallbackNotice ? <p className="literature-hint">{view.hint}</p> : null}

      <div className="literature-body">
        {view.kind === 'loading' ? (
          <div className="literature-loading">
            <Loader2 className="spin" size={22} aria-hidden="true" />
            <p>Searching scholarly databases…</p>
          </div>
        ) : null}

        {view.kind === 'error' ? (
          <div className="literature-alert" role="alert">
            <AlertCircle size={20} aria-hidden="true" />
            <div>
              <strong>{view.title}</strong>
              {view.errors.length ? (
                <ul>
                  {view.errors.map((item) => (
                    <li key={item.id}>
                      <span>{item.source}</span> — {item.message}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{view.summary}</p>
              )}
              <p className="literature-alert-tip">{view.tip}</p>
            </div>
          </div>
        ) : null}

        {view.kind === 'success' ? (
          <>
            <section className="literature-papers-section" aria-label="Retrieved papers">
              <div className="literature-section-header literature-section-header--stacked">
                <div className="literature-section-title-row">
                  <h3>Retrieved papers</h3>
                  {papers.length > LITERATURE_PAPERS_PER_PAGE ? (
                    <span className="literature-page-label">
                      {pageStart + 1}–{Math.min(pageStart + LITERATURE_PAPERS_PER_PAGE, papers.length)} of {papers.length}
                    </span>
                  ) : (
                    <span className="literature-page-label">{papers.length} total</span>
                  )}
                </div>
                <p className="literature-section-desc">
                  Toggle which papers feed the summary below and bulk insert into Problem &amp; Sources.
                </p>
              </div>

              <div className="literature-selection-bar">
                <div className="literature-selection-meta">
                  <span className="literature-selection-count">
                    {selectedCount} of {papers.length} selected for summary &amp; citations
                  </span>
                  <span className="literature-selection-hint">
                    Selected papers show a green number; deselected papers show a grey number. Click a number to toggle.
                  </span>
                </div>
                <div className="literature-selection-actions">
                  <button
                    className="literature-selection-link"
                    type="button"
                    disabled={selectedCount === papers.length}
                    onClick={onSelectAllPapers}
                  >
                    Select all
                  </button>
                  <button
                    className="literature-selection-link"
                    type="button"
                    disabled={selectedCount === 0}
                    onClick={onClearPaperSelection}
                  >
                    Clear all
                  </button>
                </div>
              </div>

              <div className="literature-results">
                {visiblePapers.map((paper, index) => (
                  <LiteraturePaperCard
                    key={paper.id}
                    rank={pageStart + index + 1}
                    paper={paper}
                    expanded={expandedId === paper.id}
                    selected={selectedSet.has(paper.id)}
                    added={String(references || '').includes(paper.citation)}
                    onToggleSelected={() => onTogglePaperSelection(paper.id)}
                    onToggle={() => setExpandedId((current) => (current === paper.id ? null : paper.id))}
                    onAdd={() => onAddPaper(paper)}
                  />
                ))}
              </div>

              {papers.length > LITERATURE_PAPERS_PER_PAGE ? (
                <div className="literature-pager">
                  <button
                    className="secondary"
                    type="button"
                    disabled={safePaperPage === 0}
                    onClick={() => {
                      setPaperPage((current) => Math.max(current - 1, 0));
                      setExpandedId(null);
                    }}
                  >
                    <ChevronLeft size={16} aria-hidden="true" />
                    Previous
                  </button>
                  <span>
                    Page {safePaperPage + 1} of {totalPaperPages}
                  </span>
                  <button
                    className="secondary"
                    type="button"
                    disabled={safePaperPage >= totalPaperPages - 1}
                    onClick={() => {
                      setPaperPage((current) => Math.min(current + 1, totalPaperPages - 1));
                      setExpandedId(null);
                    }}
                  >
                    Next
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                </div>
              ) : null}
            </section>

            {normalizedSummaryText || summaryLoading ? (
              <section className="literature-problem-snippet" aria-label="Relevant information summary from retrieved papers">
                <div className="literature-section-header literature-section-header--stacked">
                  <div className="literature-section-title-row">
                    <h3>Relevant information summary</h3>
                    <span className="literature-snippet-badge">
                      {selectedCount === papers.length
                        ? 'From all retrieved papers'
                        : `From ${selectedCount} selected paper${selectedCount === 1 ? '' : 's'}`}
                    </span>
                  </div>
                  <p className="literature-section-desc">
                    Inserts the summary into Problem and adds formatted citations for selected papers to Sources.
                  </p>
                </div>
                <div className="literature-snippet-body">
                  {summaryLoading ? (
                    <div className="literature-summary-loading">
                      <Loader2 className="spin" size={18} aria-hidden="true" />
                      <p>Updating summary for selected papers…</p>
                    </div>
                  ) : (
                    <>
                      <p>{normalizedSummaryText}</p>
                      {summaryGapNote ? <small className="literature-snippet-gap">{summaryGapNote}</small> : null}
                    </>
                  )}
                </div>
                {insertNotice ? (
                  <p className="literature-insert-notice" role="status">
                    {insertNotice}
                    {!summaryUpToDate ? (
                      <>
                        {' '}
                        <button className="literature-insert-link" type="button" onClick={onFocusProblem}>
                          Jump to Problem field
                        </button>
                      </>
                    ) : null}
                  </p>
                ) : null}
                <button
                  className={summaryUpToDate ? 'secondary accepted literature-insert-btn' : 'primary literature-insert-btn'}
                  type="button"
                  disabled={selectedCount === 0 || summaryLoading || !normalizedSummaryText}
                  onClick={() => onInsertRelatedWork(normalizedSummaryText)}
                >
                  <FileText size={16} aria-hidden="true" />
                  {selectedCount === 0
                    ? 'Select papers to insert'
                    : summaryUpToDate
                      ? 'Up to date in Problem & Sources'
                      : hasStaleLiterature
                        ? 'Update Problem & Sources'
                        : 'Insert into Problem & Sources'}
                </button>
              </section>
            ) : selectedCount === 0 && papers.length ? (
              <section className="literature-problem-snippet literature-problem-snippet--empty" aria-label="Relevant information summary">
                <div className="literature-section-header literature-section-header--stacked">
                  <div className="literature-section-title-row">
                    <h3>Relevant information summary</h3>
                  </div>
                  <p className="literature-section-desc">Select at least one paper above to build a summary.</p>
                </div>
              </section>
            ) : null}
          </>
        ) : null}

        {view.kind === 'idle' ? (
          <p className="literature-idle">Search for real papers to ground your references. Try <strong>OpenAlex</strong> if another source is slow.</p>
        ) : null}
      </div>
    </section>
  );
}

function formatLiteratureAuthors(authors = [], { collapsed = false } = {}) {
  if (!authors.length) return 'Unknown authors';
  if (collapsed) {
    const preview = authors.slice(0, 2).join(', ');
    return authors.length > 2 ? `${preview}, +${authors.length - 2} more` : preview;
  }
  if (authors.length <= 6) return authors.join(', ');
  return `${authors.slice(0, 6).join(', ')}, +${authors.length - 6} more`;
}

function LiteraturePaperCard({ rank, paper, expanded, selected, added, onToggleSelected, onToggle, onAdd }) {
  const authorPreview = formatLiteratureAuthors(paper.authors, { collapsed: true });
  const authorFull = formatLiteratureAuthors(paper.authors);
  const yearLabel = paper.year ? String(paper.year) : null;
  const citationCount = paper.citationCount || 0;
  const citationLabel = citationCount ? `${citationCount.toLocaleString()} citations` : null;
  const venueLabel = paper.venue ? paper.venue : null;

  return (
    <article className={`literature-card ${expanded ? 'is-expanded' : ''} ${selected ? 'is-selected' : 'is-deselected'}`}>
      <div className="literature-card-head">
        <button
          type="button"
          className={`literature-paper-rank ${selected ? 'is-selected' : 'is-deselected'}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleSelected();
          }}
          aria-pressed={selected}
          aria-label={`${selected ? 'Exclude' : 'Include'} "${paper.title}" in summary and citations`}
          title={selected ? 'Exclude from summary & citations' : 'Include in summary & citations'}
        >
          {rank}
        </button>
        <button className="literature-card-toggle" type="button" onClick={onToggle} aria-expanded={expanded}>
          <div className="literature-card-summary">
            <h3>{paper.title}</h3>
            <p className="literature-card-authors">{authorPreview}</p>
            {yearLabel || citationLabel ? (
              <p className="literature-card-meta-line">
                {[yearLabel, citationLabel].filter(Boolean).join(' · ')}
              </p>
            ) : null}
          </div>
          <div className="literature-card-meta">
            <span className="literature-badge">{formatSourceLabel(paper.source)}</span>
            <ChevronDown size={18} className={expanded ? 'chevron open' : 'chevron'} aria-hidden="true" />
          </div>
        </button>
      </div>

      {expanded ? (
        <div className="literature-card-details">
          <dl className="literature-card-facts">
            <div className="literature-fact-row">
              <dt>Authors</dt>
              <dd>{authorFull}</dd>
            </div>
            {yearLabel ? (
              <div className="literature-fact-row">
                <dt>Year</dt>
                <dd>{yearLabel}</dd>
              </div>
            ) : null}
            {venueLabel ? (
              <div className="literature-fact-row">
                <dt>Venue</dt>
                <dd>{venueLabel}</dd>
              </div>
            ) : null}
            {citationLabel ? (
              <div className="literature-fact-row">
                <dt>Cited</dt>
                <dd>{citationLabel}</dd>
              </div>
            ) : null}
          </dl>

          {paper.relevanceNote?.trim() ? (
            <section className="literature-detail-block literature-detail-relevance">
              <h4>Why it matters</h4>
              <p>{paper.relevanceNote.trim()}</p>
            </section>
          ) : null}

          {paper.abstract?.trim() ? (
            <section className="literature-detail-block">
              <h4>Abstract</h4>
              <div className="literature-abstract-scroll">
                <p className="literature-abstract-text">{paper.abstract}</p>
              </div>
            </section>
          ) : (
            <p className="literature-abstract-missing">No formal abstract is available for this record.</p>
          )}

          {paper.citation ? (
            <section className="literature-detail-block literature-detail-cite">
              <h4>Citation</h4>
              <p>{paper.citation}</p>
            </section>
          ) : null}

          <div className="literature-card-actions">
            <button className={added ? 'secondary accepted' : 'primary'} type="button" onClick={onAdd} disabled={added}>
              <CheckCircle2 size={16} aria-hidden="true" />
              {added ? 'Added' : 'Add citation'}
            </button>
            {paper.url ? (
              <a className="secondary literature-link" href={paper.url} target="_blank" rel="noreferrer">
                <ExternalLink size={16} aria-hidden="true" />
                Open paper
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function getLiteratureView(literature, status) {
  if (status === 'loading') {
    return {
      kind: 'loading',
      statusClass: 'is-loading',
      statusLabel: 'Searching…'
    };
  }

  if (!literature) {
    return {
      kind: 'idle',
      statusClass: 'is-idle',
      statusLabel: 'Ready',
      hint: null
    };
  }

  const paperCount = literature.papers?.length ?? 0;
  const hasPapers = paperCount > 0;
  const failed = literature.mode === 'error' || !hasPapers;

  if (failed) {
    const errors = parseLiteratureErrors(literature);
    const requestedLabel = formatSourceLabel(literature.source);

    return {
      kind: 'error',
      statusClass: 'is-error',
      statusLabel: 'No results',
      title: `No papers found${literature.source !== 'auto' ? ` for ${requestedLabel}` : ''}`,
      summary: 'Try a shorter or more specific topic, or choose OpenAlex as your source.',
      errors,
      tip: 'Tip: OpenAlex is the most reliable source right now.',
      fallbackNotice: null,
      hint: literature.fallbackSummary || null
    };
  }

  const usedLabel = formatSourceLabel(literature.resolvedSource);
  const requestedLabel = formatSourceLabel(literature.source);
  const didFallback = Boolean(
    literature.didFallback ?? (literature.source !== 'auto' && literature.source !== literature.resolvedSource)
  );
  const fallbackNotice =
    didFallback && (literature.fallbackSummary || buildFallbackNotice(literature));
  const rankedByCitations =
    literature.rankingMethod === 'citations' || literature.mode === 'local-fallback';
  const rankingHint = rankedByCitations
    ? 'Sorted by citation count (highest first), then year — #1 is usually the most influential paper here.'
    : 'Sorted by AI relevance to your topic. Citation counts still appear on each card when available.';

  return {
    kind: 'success',
    statusClass: didFallback ? 'is-fallback' : 'is-success',
    statusLabel: rankedByCitations
      ? `${paperCount} paper${paperCount === 1 ? '' : 's'} · by citations`
      : `${paperCount} paper${paperCount === 1 ? '' : 's'} · ${usedLabel}`,
    fallbackNotice,
    hint: didFallback ? null : literature.source === 'auto' ? `Results from ${usedLabel}.` : null,
    rankedByCitations,
    rankingHint
  };
}

function buildFallbackNotice(literature) {
  const requested = literature.source;
  const used = literature.resolvedSource;
  const intended = literature.intendedSource || (requested === 'auto' ? null : requested);

  if (!used || requested === used) {
    return '';
  }

  const usedLabel = formatSourceLabel(used);
  const requestedLabel = formatSourceLabel(requested);
  const intendedLabel = formatSourceLabel(intended || requested);
  const reason = getFailureReasonForSource(literature, intended || requested);

  if (requested === 'auto') {
    return `We picked ${intendedLabel} for your topic, but ${reason} The papers below are from ${usedLabel}, not ${intendedLabel}.`;
  }

  return `You selected ${requestedLabel}, but ${reason} The papers below are from ${usedLabel}, not ${requestedLabel}.`;
}

function getFailureReasonForSource(literature, sourceKey) {
  const raw = literature?.transcript?.fetchErrors;
  const line = Array.isArray(raw) ? raw.find((entry) => entry.startsWith(`${sourceKey}:`)) : null;
  const detail = line ? line.slice(line.indexOf(':') + 1).trim().toLowerCase() : '';

  if (detail.includes('rate limited') || detail.includes('429')) {
    return 'it is temporarily rate-limited.';
  }

  if (detail.includes('no results')) {
    return 'it returned no matches for this topic.';
  }

  if (detail.includes('timeout')) {
    return 'the request timed out.';
  }

  return 'it could not return results.';
}

function parseLiteratureErrors(literature) {
  const raw = literature?.transcript?.fetchErrors;

  if (Array.isArray(raw) && raw.length) {
    return raw.map((line, index) => {
      const colon = line.indexOf(':');
      const sourceKey = colon === -1 ? line : line.slice(0, colon).trim();
      const detail = colon === -1 ? '' : line.slice(colon + 1).trim();

      return {
        id: `${sourceKey}-${index}`,
        source: formatSourceLabel(sourceKey),
        message: humanizeLiteratureError(detail)
      };
    });
  }

  return [];
}

function humanizeLiteratureError(detail) {
  const text = String(detail || '').toLowerCase();

  if (text.includes('rate limited') || text.includes('429')) {
    return 'temporarily rate-limited — try again in a minute or use OpenAlex';
  }

  if (text.includes('no results')) {
    return 'no matches for this topic';
  }

  if (text.includes('timeout')) {
    return 'request timed out';
  }

  return detail || 'unavailable';
}

function formatSourceLabel(source) {
  const found = LITERATURE_SOURCE_OPTIONS.find(([id]) => id === source);
  return found?.[1] || source || 'Unknown';
}

function mergeTextField(current, addition) {
  const base = String(current || '').trim();
  const next = String(addition || '').trim();
  if (!base) return next;
  if (!next) return base;
  if (base.includes(next)) return base;
  return `${base}\n\n${next}`;
}

function normalizeProblemText(text) {
  return String(text || '').replace(/\r\n/g, '\n').trim();
}

function hasAutoLiteratureSummary(text) {
  const value = String(text || '');
  return (
    /Your search on[\s\S]*?problem statement\./i.test(value) ||
    /No papers were retrieved\. Try different search terms or another source\./.test(value)
  );
}

function stripPreviousLiteratureSummary(text, previousSummary) {
  const prev = String(previousSummary || '').trim();
  if (!prev) return normalizeProblemText(text);

  let result = String(text || '');
  if (!result.includes(prev)) return normalizeProblemText(result);

  result = result.replace(prev, '').replace(/\n{3,}/g, '\n\n').trim();
  return result;
}

function stripAutoLiteratureBlocks(text) {
  let result = String(text || '');
  let changed = true;

  while (changed) {
    changed = false;
    const next = result
      .replace(/Your search on[\s\S]*?problem statement\./gi, () => {
        changed = true;
        return '';
      })
      .replace(/No papers were retrieved\. Try different search terms or another source\./gi, () => {
        changed = true;
        return '';
      })
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    result = next;
  }

  return result;
}

function areLiteratureCitationsInReferences(existingReferences, papers) {
  const base = String(existingReferences || '').trim();
  if (!Array.isArray(papers) || !papers.length) return true;

  return papers.every((paper) => {
    const citation = String(paper?.citation || '').trim();
    return !citation || base.includes(citation);
  });
}

function mergeCitationsIntoReferences(existingReferences, papers) {
  const base = String(existingReferences || '').trim();
  const merged = base ? [base] : [];
  let addedCount = 0;

  for (const paper of papers || []) {
    const citation = String(paper?.citation || '').trim();
    if (!citation) continue;

    const alreadyIncluded = merged.some((entry) => entry.includes(citation));
    if (alreadyIncluded) continue;

    merged.push(citation);
    addedCount += 1;
  }

  return {
    references: merged.join('\n'),
    addedCount
  };
}

function buildLiteratureInsertNotice(meta) {
  const parts = [];

  if (meta.problemChanged) {
    parts.push(
      meta.replaced
        ? 'Updated Problem statement with the latest literature summary.'
        : 'Added literature summary to Problem statement.'
    );
  }

  if (meta.citationsAdded > 0) {
    parts.push(
      `Added ${meta.citationsAdded} citation${meta.citationsAdded === 1 ? '' : 's'} to Sources — check the Sources field on the Project tab.`
    );
  } else if (!meta.problemChanged) {
    parts.push('Sources already included these paper citations.');
  }

  return parts.join(' ');
}

function buildLiteratureInsertLogMessage(meta) {
  const parts = [];

  if (meta.problemChanged) {
    parts.push(
      meta.replaced
        ? 'Replaced prior literature summary in Problem statement.'
        : 'Inserted relevant-papers summary into Problem statement.'
    );
  }

  if (meta.citationsAdded > 0) {
    parts.push(`Added ${meta.citationsAdded} retrieved paper citation(s) to Sources.`);
  }

  return parts.join(' ') || 'Literature summary already integrated.';
}

function applyLiteratureSummaryToProblem(current, newSummary, previousSummary) {
  const next = String(newSummary || '').trim();
  if (!next) return normalizeProblemText(current);

  const original = normalizeProblemText(current);
  if (original === next) return original;

  let base = stripPreviousLiteratureSummary(original, previousSummary);
  base = stripAutoLiteratureBlocks(base);

  if (!base) return next;
  if (base === next || base.includes(next)) return original;

  return `${base}\n\n${next}`;
}

function isSuggestionApplied(existing, suggestionValue) {
  const base = String(existing || '').trim();
  const next = String(suggestionValue || '').trim();
  if (!next) return true;
  return base === next || base.includes(next);
}

function isDecisionResolved(decision) {
  return Boolean(cleanStructureText(decision?.resolvedOptionLabel) || cleanStructureText(decision?.resolvedValue));
}

function cleanStructureText(value) {
  return String(value || '').trim();
}

function applyDecisionOptionToProject(existing, incoming, previousResolvedValue) {
  const base = String(existing || '').trim();
  const next = String(incoming || '').trim();
  const previous = String(previousResolvedValue || '').trim();

  if (previous) {
    if (base === previous) return next;
    if (base.includes(previous)) return base.replace(previous, next);
  }

  if (!base) return next;
  if (base === next) return base;
  return mergeAcceptedFieldValue(base, next);
}

function mergeSuggestionsPreservingOrder(previousSuggestions, incomingSuggestions, targetIndex, rejectedField) {
  if (!Array.isArray(previousSuggestions) || !previousSuggestions.length) {
    return Array.isArray(incomingSuggestions) ? incomingSuggestions : [];
  }
  if (!Array.isArray(incomingSuggestions) || !incomingSuggestions.length) {
    return previousSuggestions;
  }

  const slotField = rejectedField || previousSuggestions[targetIndex]?.field;
  const replacement =
    incomingSuggestions.find((item) => item.field === slotField) ||
    incomingSuggestions.find((item) => item.field === previousSuggestions[targetIndex]?.field) ||
    incomingSuggestions[0];

  const replaceIndex =
    Number.isFinite(targetIndex) && targetIndex >= 0 && targetIndex < previousSuggestions.length
      ? targetIndex
      : previousSuggestions.findIndex((item) => item.field === slotField);

  if (replaceIndex < 0) {
    return previousSuggestions;
  }

  return previousSuggestions.map((item, index) =>
    index === replaceIndex
      ? {
        ...item,
        ...replacement,
        field: replacement.field || item.field,
        label: replacement.label || item.label,
        value: replacement.value || item.value,
        confidence: replacement.confidence || item.confidence,
        reason: replacement.reason || item.reason
      }
      : item
  );
}

function mergeDecisionsPreservingOrder(previousDecisions, incomingDecisions, rejectedId) {
  if (!Array.isArray(previousDecisions) || !previousDecisions.length) {
    return Array.isArray(incomingDecisions) ? incomingDecisions : [];
  }
  if (!rejectedId || !Array.isArray(incomingDecisions) || !incomingDecisions.length) {
    return previousDecisions;
  }

  const previousDecision = previousDecisions.find((decision) => decision.id === rejectedId);
  const replacement =
    incomingDecisions.find((decision) => decision.id === rejectedId) ||
    incomingDecisions.find((decision) => previousDecision && decision.field === previousDecision.field) ||
    incomingDecisions[0];

  return previousDecisions.map((decision) => (decision.id === rejectedId ? { ...replacement } : decision));
}

function mergeDecisionsAfterRegenerate(previousDecisions, incomingDecisions, rejectedId) {
  if (!Array.isArray(incomingDecisions) || !incomingDecisions.length) {
    return incomingDecisions;
  }

  const previousById = new Map(
    (Array.isArray(previousDecisions) ? previousDecisions : []).map((decision) => [decision.id, decision])
  );

  return incomingDecisions.map((decision) => {
    if (decision.id === rejectedId) {
      return decision;
    }

    const previous = previousById.get(decision.id);
    if (!previous || !isDecisionResolved(previous)) {
      return decision;
    }

    const selectedOption = decision.options?.find((option) => option.label === previous.resolvedOptionLabel);
    if (!selectedOption) {
      return decision;
    }

    return {
      ...decision,
      resolvedOptionLabel: previous.resolvedOptionLabel,
      resolvedValue: selectedOption.value
    };
  });
}

function mergeAcceptedFieldValue(existing, incoming) {
  const base = String(existing || '').trim();
  const next = String(incoming || '').trim();
  if (!base) return next;
  if (!next) return base;
  if (base === next) return base;
  if (base.includes(next)) return base;
  if (next.includes(base)) return next;
  return mergeTextField(base, next);
}

function RevisePanel({ value, onChange, onClose, onSubmit, placeholder, disabled, refining }) {
  return (
    <div className="revise-panel">
      <div className="revise-panel-head">
        <span>Guide the model</span>
        <button className="ghost-action ghost-action--compact" type="button" onClick={onClose} disabled={disabled || refining}>
          Close
        </button>
      </div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled || refining}
        rows={2}
      />
      <button className="secondary revise-panel-submit" type="button" disabled={disabled || refining} onClick={onSubmit}>
        {refining ? <Loader2 className="spin" size={15} aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />}
        Regenerate
      </button>
    </div>
  );
}

function RunLogPanel({ entries }) {
  const [showAll, setShowAll] = useState(false);
  const listRef = useRef(null);
  const total = entries.length;
  const recentEntries = useMemo(() => entries.slice(-RUN_LOG_RECENT_COUNT).reverse(), [entries]);
  const fullEntriesNewestFirst = useMemo(() => [...entries].reverse(), [entries]);
  const visibleEntries = showAll ? fullEntriesNewestFirst : recentEntries;
  const hiddenCount = Math.max(0, total - RUN_LOG_RECENT_COUNT);

  useEffect(() => {
    if (!showAll || !listRef.current) return;
    listRef.current.scrollTop = 0;
  }, [showAll, entries.length]);

  return (
    <div className="run-log-column">
      <div className="run-log-header">
        <div>
          <h2>Run Log</h2>
          <p className="run-log-subtitle">
            {total ? (showAll ? 'Full history, newest first' : `Latest ${Math.min(total, RUN_LOG_RECENT_COUNT)} events`) : 'Activity from this session'}
          </p>
        </div>
        {total ? <span className="run-log-count">{total} total</span> : null}
      </div>

      <section className="run-log-panel" aria-label="Run log">
        <div className="run-log-body">
          {total ? (
            <>
              <ol
                ref={listRef}
                className={['run-log', showAll ? 'run-log--scroll' : 'run-log--compact'].join(' ')}
              >
                {visibleEntries.map((entry) => (
                  <li key={entry.id} className="run-log-item">
                    <span className="run-log-stage">{entry.stage}</span>
                    <p>{entry.message}</p>
                  </li>
                ))}
              </ol>

              {hiddenCount > 0 ? (
                <button className="secondary run-log-toggle" type="button" onClick={() => setShowAll((current) => !current)}>
                  {showAll ? (
                    <>
                      <ChevronDown size={16} aria-hidden="true" />
                      Show recent only
                    </>
                  ) : (
                    <>
                      <ChevronDown size={16} className="run-log-toggle-icon" aria-hidden="true" />
                      View all {total} events ({hiddenCount} older)
                    </>
                  )}
                </button>
              ) : null}
            </>
          ) : (
            <EmptyState text="Run log appears after the idea is structured." compact />
          )}
        </div>
      </section>
    </div>
  );
}

function WorkspaceSidebar({ activeViewId, onNavigate, hasTopicContext, badgeContext, llmConfig, llmModel, onSelectModel }) {
  const currentIndex = WORKSPACE_FLOW_ORDER.indexOf(activeViewId);
  const prevId = currentIndex > 0 ? WORKSPACE_FLOW_ORDER[currentIndex - 1] : null;
  const nextId = currentIndex < WORKSPACE_FLOW_ORDER.length - 1 ? WORKSPACE_FLOW_ORDER[currentIndex + 1] : null;
  const prevView = WORKSPACE_VIEWS.find((view) => view.id === prevId);
  const nextView = WORKSPACE_VIEWS.find((view) => view.id === nextId);
  const nextDisabled =
    (activeViewId === 'start' && !hasTopicContext) || (activeViewId === 'research' && !hasTopicContext);

  return (
    <aside className="workspace-sidebar" aria-label="Workflow phases">
      <p className="workspace-sidebar-title">Phases</p>

      <ol className="phase-list">
        {WORKSPACE_FLOW_ORDER.map((viewId, index) => {
          const view = WORKSPACE_VIEWS.find((item) => item.id === viewId);
          const isActive = viewId === activeViewId;
          const isComplete = index < currentIndex;
          const badge = workspaceViewBadge(viewId, badgeContext);

          return (
            <li
              key={viewId}
              className={['phase-list-item', isActive ? 'active' : '', isComplete ? 'complete' : ''].filter(Boolean).join(' ')}
            >
              <button
                type="button"
                className="phase-list-btn"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => onNavigate(viewId)}
              >
                <span className="phase-list-marker" aria-hidden="true">
                  {isComplete ? <CheckCircle2 size={14} strokeWidth={2.5} /> : index + 1}
                </span>
                <span className="phase-list-label">{view?.label}</span>
                {badge ? <span className="phase-list-badge">{badge}</span> : null}
              </button>
            </li>
          );
        })}
      </ol>

      <ModelSelectorPanel llmConfig={llmConfig} llmModel={llmModel} onSelectModel={onSelectModel} />

      {prevView || nextView ? (
        <div className={['phase-nav', !prevView || !nextView ? 'phase-nav--single' : ''].filter(Boolean).join(' ')}>
          {prevView ? (
            <button className="phase-nav-btn phase-nav-btn--back secondary" type="button" onClick={() => onNavigate(prevView.id)}>
              <ChevronLeft size={16} aria-hidden="true" />
              {prevView.label}
            </button>
          ) : null}
          {nextView ? (
            <button
              className="phase-nav-btn phase-nav-btn--next primary"
              type="button"
              disabled={nextDisabled}
              onClick={() => onNavigate(nextView.id)}
            >
              {nextView.label}
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}

function getAvailableModelsFromConfig(config) {
  const models = config?.availableModels?.length
    ? config.availableModels
    : config?.suggestedModels?.length
      ? config.suggestedModels
      : config?.defaultModel
        ? [config.defaultModel]
        : [];

  return models.map((modelId) => String(modelId || '').trim()).filter(Boolean);
}

function ModelSelectorPanel({ llmConfig, llmModel, onSelectModel }) {
  const availableModels = getAvailableModelsFromConfig(llmConfig);
  const activeModel =
    llmModel.trim() && availableModels.includes(llmModel.trim())
      ? llmModel.trim()
      : llmConfig?.defaultModel && availableModels.includes(llmConfig.defaultModel)
        ? llmConfig.defaultModel
        : availableModels[0] || '';
  const providerLabel = llmConfig?.configured
    ? llmConfig.openRouter
      ? 'OpenRouter'
      : llmConfig.apiHost?.includes('google')
        ? 'Google Gemini'
        : 'Cloud API'
    : 'Local fallback';
  const providerHint = llmConfig?.configured
    ? availableModels.length > 1
      ? 'Only models listed in your server .env are shown.'
      : 'Add LLM_ALLOWED_MODELS in .env to offer more choices.'
    : 'Add LLM_API_KEY in server .env for cloud models';

  useEffect(() => {
    if (!availableModels.length) return;
    if (!llmModel.trim() || !availableModels.includes(llmModel.trim())) {
      onSelectModel(activeModel);
    }
  }, [activeModel, availableModels, llmModel, onSelectModel]);

  return (
    <section className="model-selector" aria-label="Generation model">
      <div className="model-selector-header">
        <span className="model-selector-eyebrow">AI model</span>
        <span className={`model-provider-badge ${llmConfig?.configured ? 'is-live' : 'is-local'}`}>{providerLabel}</span>
      </div>

      {llmConfig?.configured && availableModels.length ? (
        <label className="model-select-field" htmlFor="llm-model-select">
          Model
          <select
            id="llm-model-select"
            className="model-select"
            value={activeModel}
            onChange={(event) => onSelectModel(event.target.value)}
          >
            {availableModels.map((modelId) => (
              <option key={modelId} value={modelId}>
                {formatModelLabel(modelId)}
              </option>
            ))}
          </select>
          <span className="model-select-id">{activeModel}</span>
        </label>
      ) : (
        <p className="model-local-note">Generation uses the built-in template until an API key is configured.</p>
      )}

      <p className="model-selector-hint">{providerHint}</p>
    </section>
  );
}

function formatModelLabel(modelId) {
  const trimmed = String(modelId || '').trim();
  if (!trimmed) return 'Default model';
  if (MODEL_DISPLAY_NAMES[trimmed]) return MODEL_DISPLAY_NAMES[trimmed];

  const slashIndex = trimmed.lastIndexOf('/');
  if (slashIndex >= 0) {
    const tail = trimmed.slice(slashIndex + 1);
    return tail.replace(/[-_]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  }

  return trimmed;
}

function normalizeMemorySnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid memory snapshot.');
  }

  const snapshot = value;
  const project =
    snapshot.project && typeof snapshot.project === 'object' && !Array.isArray(snapshot.project)
      ? withDefaultProject(snapshot.project)
      : createBlankProject();

  const restoredResult = snapshot.result && typeof snapshot.result === 'object' ? snapshot.result : null;
  const validViews = new Set(WORKSPACE_FLOW_ORDER);
  const activeWorkspaceView = validViews.has(snapshot.activeWorkspaceView)
    ? snapshot.activeWorkspaceView
    : 'start';
  const validTabs = new Set(TABS.map(([id]) => id));
  const activeTab = validTabs.has(snapshot.activeTab) ? snapshot.activeTab : 'latex';

  return {
    savedAt: typeof snapshot.savedAt === 'string' ? snapshot.savedAt : '',
    topicInput: typeof snapshot.topicInput === 'string' ? snapshot.topicInput : '',
    project,
    fieldSuggestions: Array.isArray(snapshot.fieldSuggestions) ? snapshot.fieldSuggestions : [],
    decisions: Array.isArray(snapshot.decisions) ? snapshot.decisions : [],
    questions: Array.isArray(snapshot.questions) ? snapshot.questions : [],
    result: restoredResult
      ? {
        mode: typeof restoredResult.mode === 'string' ? restoredResult.mode : '',
        provider: typeof restoredResult.provider === 'string' ? restoredResult.provider : '',
        proposalLatex: typeof restoredResult.proposalLatex === 'string' ? restoredResult.proposalLatex : '',
        complianceMatrix: Array.isArray(restoredResult.complianceMatrix) ? restoredResult.complianceMatrix : [],
        evaluationReport: typeof restoredResult.evaluationReport === 'string' ? restoredResult.evaluationReport : '',
        questions: Array.isArray(restoredResult.questions) ? restoredResult.questions : []
      }
      : null,
    runLog: Array.isArray(snapshot.runLog) ? snapshot.runLog : [],
    activeTab,
    activeWorkspaceView,
    suggestionIndex: Number.isFinite(Number(snapshot.suggestionIndex)) ? Number(snapshot.suggestionIndex) : 0,
    decisionIndex: Number.isFinite(Number(snapshot.decisionIndex)) ? Number(snapshot.decisionIndex) : 0,
    llmModel: typeof snapshot.llmModel === 'string' ? snapshot.llmModel : '',
    proposalPageTarget: normalizeProposalPageTarget(snapshot.proposalPageTarget)
  };
}

function ProjectFieldCard({ field, label, value, isOpen, onOpen }) {
  const summary = summarizeFieldContent(value, field);
  const filled = Boolean(String(value || '').trim());

  return (
    <article className={['project-field-card', isOpen ? 'is-open' : '', filled ? 'has-content' : 'is-empty'].join(' ')}>
      <button
        type="button"
        className="project-field-card-header"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={onOpen}
      >
        <div className="project-field-card-heading">
          <h3>{label}</h3>
          <p className="project-field-summary">{summary}</p>
        </div>
        <span className="project-field-open-action" aria-hidden="true">
          <FileText size={16} />
          <span>Open editor</span>
          <ChevronRight size={16} />
        </span>
      </button>
    </article>
  );
}

function projectFieldPlaceholder(field, label) {
  if (field === 'resources') {
    return 'List formal proposal resources by category, one per line. Example:\nComputing and Infrastructure: GPU access for training runs.\nSoftware and Development Tools: PyTorch, experiment tracking, and version-controlled scripts.\nData and Model Artifacts: Model checkpoint and evaluation benchmark.\nBudget and Institutional Support: Course compute allocation and API access.';
  }

  if (field === 'timeline') {
    return 'Write NSF-style milestones with timing and deliverables. Example:\nExpected results: Reproducible codebase and experiment report.\nMilestone 1 (Weeks 1--3): Reproduce baseline with documented scores.\nMilestone 2 (Weeks 4--6): Implement core method and validate on a dev set.';
  }

  if (field === 'evaluation') {
    return 'Write a detailed evaluation plan with labeled subsections. Example:\nResearch Questions and Hypotheses: Does the proposed approach outperform the baseline?\nMetrics and Benchmarks: Primary accuracy metric and stability measures.\nComparative Baselines: Supervised-only and standard RL configurations.\nAblations and Sensitivity Analysis: Remove key components to test necessity.\nAnalysis Plan: Error analysis and reproducibility protocol.\nSuccess Criteria: Measurable improvement with stable training.';
  }

  return `Write or refine your ${label.toLowerCase()} here…`;
}

function ProjectFieldEditor({
  field,
  label,
  value,
  onChange,
  onClose,
  onStrengthen,
  refining,
  llmConfigured,
  inputRef
}) {
  const charCount = String(value || '').length;
  const canRefineWithAi = AI_REFINABLE_PROJECT_FIELDS.has(field);
  const [guidance, setGuidance] = useState('');
  const [refineOpen, setRefineOpen] = useState(false);
  const [refineNote, setRefineNote] = useState('');

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !refining) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, refining]);

  useEffect(() => {
    requestAnimationFrame(() => {
      inputRef?.current?.focus({ preventScroll: true });
    });
  }, [field, inputRef]);

  useEffect(() => {
    setGuidance('');
    setRefineOpen(false);
    setRefineNote('');
  }, [field]);

  async function handleStrengthen() {
    if (refining) return;

    try {
      const result = await onStrengthen(guidance);
      setRefineNote(result?.note || `Strengthened ${label.toLowerCase()}.`);
    } catch {
      setRefineNote('');
    }
  }

  return (
    <div
      className="project-field-focus"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`project-field-focus-title-${field}`}
    >
      <button
        type="button"
        className="project-field-focus-backdrop"
        aria-label="Close editor"
        onClick={onClose}
        disabled={refining}
      />

      <div className="project-field-focus-panel">
        <header className="project-field-focus-header">
          <div>
            <p className="project-field-focus-kicker">Editing section</p>
            <h2 id={`project-field-focus-title-${field}`}>{label}</h2>
          </div>
          <button className="secondary project-field-focus-close" type="button" onClick={onClose} disabled={refining}>
            <X size={18} aria-hidden="true" />
            Close
          </button>
        </header>

        <div className="project-field-focus-body">
          <div className="project-field-focus-editor">
            <textarea
              ref={inputRef}
              className="project-field-focus-textarea"
              value={value}
              onChange={(event) => onChange(event.target.value)}
              placeholder={projectFieldPlaceholder(field, label)}
              disabled={refining}
            />

            {canRefineWithAi && refineOpen ? (
              <div className="project-field-refine">
                <div className="project-field-refine-head">
                  <span>Guide the model</span>
                  <button
                    className="ghost-action ghost-action--compact"
                    type="button"
                    onClick={() => setRefineOpen(false)}
                    disabled={refining}
                  >
                    Hide
                  </button>
                </div>
                <textarea
                  className="project-field-refine-input"
                  value={guidance}
                  onChange={(event) => setGuidance(event.target.value)}
                  placeholder={`Tell the model how to strengthen this ${label.toLowerCase()} section. Example: add more detail on baselines, make milestones more concrete, or tighten the technical workflow.`}
                  rows={3}
                  disabled={refining}
                />
                {!llmConfigured ? (
                  <p className="project-field-refine-note">
                    No API key configured — the local template will strengthen this section until OpenRouter or another model is connected.
                  </p>
                ) : null}
                {refineNote ? <p className="project-field-refine-result">{refineNote}</p> : null}
              </div>
            ) : null}
          </div>
        </div>

        <footer className="project-field-focus-footer">
          <span className="project-field-focus-meta">{charCount} characters</span>
          <div className="project-field-focus-actions">
            {canRefineWithAi ? (
              <>
                <button
                  className={refineOpen ? 'secondary active' : 'secondary'}
                  type="button"
                  onClick={() => setRefineOpen((open) => !open)}
                  disabled={refining}
                >
                  <Sparkles size={16} aria-hidden="true" />
                  {refineOpen ? 'Hide AI refine' : 'Strengthen with AI'}
                </button>
                {refineOpen ? (
                  <button className="primary" type="button" onClick={handleStrengthen} disabled={refining}>
                    {refining ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
                    {refining ? 'Strengthening…' : 'Generate stronger text'}
                  </button>
                ) : null}
              </>
            ) : null}
            <button className="primary" type="button" onClick={onClose} disabled={refining}>
              Done editing
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function summarizeFieldContent(text, field = '', maxLength = 220) {
  const value = String(text || '').trim();
  if (!value) return 'No content yet — expand to add details.';

  if (field === 'references') {
    return summarizeReferencesPreview(value, maxLength);
  }

  if (field === 'resources') {
    return summarizeStructuredPreview(value, maxLength);
  }

  return summarizeProsePreview(value, maxLength);
}

function summarizeReferencesPreview(text, maxLength) {
  const lines = splitPreviewLines(text);

  for (const line of lines) {
    const cleaned = stripListMarker(line);
    if (isMeaningfulPreviewChunk(cleaned, 16)) {
      return truncatePreview(cleaned, maxLength);
    }
  }

  const flat = collapsePreviewWhitespace(text);
  const withoutMarkers = flat.replace(/(?:^|\s)\d+[\).\]]\s*/g, ' ').replace(/\s+/g, ' ').trim();
  return truncatePreview(withoutMarkers || flat, maxLength);
}

function summarizeStructuredPreview(text, maxLength) {
  const lines = splitPreviewLines(text);

  for (const line of lines) {
    const cleaned = stripListMarker(line);
    if (isMeaningfulPreviewChunk(cleaned, 12)) {
      return truncatePreview(cleaned, maxLength);
    }
  }

  return summarizeProsePreview(text, maxLength);
}

function summarizeProsePreview(text, maxLength) {
  const flat = collapsePreviewWhitespace(text);
  const start = flat.search(/[A-Za-z0-9]/);
  const meaningful = start >= 0 ? flat.slice(start) : flat;
  const firstSentence = meaningful.match(/^[^.!?]+[.!?]/)?.[0]?.trim() || meaningful;

  return truncatePreview(firstSentence.length >= 24 ? firstSentence : meaningful, maxLength);
}

function splitPreviewLines(text) {
  return String(text || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function stripListMarker(line) {
  return String(line || '')
    .replace(/^[-*•]\s+/, '')
    .replace(/^\d+[\).\]]\s+/, '')
    .trim();
}

function collapsePreviewWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function isMeaningfulPreviewChunk(text, minLength = 12) {
  const value = String(text || '').trim();
  if (value.length < minLength) return false;
  if (/^[,;:.)\]]+$/.test(value)) return false;
  if (/^et al\.?$/i.test(value)) return false;
  if (/^\d+[\).\]]?$/.test(value)) return false;
  if (/^[,;:.)\]]+\s*et al\.?/i.test(value)) return false;
  return /[A-Za-z]{3,}/.test(value);
}

function truncatePreview(text, maxLength) {
  const value = String(text || '').trim();
  if (!value) return 'No content yet — expand to add details.';
  if (value.length <= maxLength) return value;

  const slice = value.slice(0, maxLength);
  const lastSpace = slice.lastIndexOf(' ');
  const trimmed = (lastSpace > maxLength * 0.55 ? slice.slice(0, lastSpace) : slice).trim();

  return `${trimmed}…`;
}

function PanelHeader({ title, meta }) {
  return (
    <div className="panel-header">
      <h2>{title}</h2>
      <span>{meta}</span>
    </div>
  );
}

function EmptyState({ text, compact = false }) {
  return (
    <div className={compact ? 'empty-state compact' : 'empty-state'}>
      <FileText size={compact ? 24 : 32} aria-hidden="true" />
      <p>{text}</p>
    </div>
  );
}

function stageStatus(index, fieldSuggestions, decisions, project, result) {
  if (index === 0 && fieldSuggestions.length) return 'status-complete';
  if (index === 1 && decisions.length) return 'status-complete';
  if (index === 2 && PROJECT_FIELDS.some(([field]) => project[field])) return 'status-complete';
  if (index >= 3 && result) return 'status-complete';
  return 'status-waiting';
}

function stageLabel(index, fieldSuggestions, decisions, project, result) {
  if (index === 0 && fieldSuggestions.length) return 'Shown';
  if (index === 1 && decisions.length) return 'Shown';
  if (index === 2 && PROJECT_FIELDS.some(([field]) => project[field])) return 'Shown';
  if (index >= 3 && result) return 'Shown';
  return 'Ready';
}

function countCovered(rows = []) {
  return rows.filter((row) => /^covered$/i.test(row.status)).length;
}

function labelForField(field) {
  const found = PROJECT_FIELDS.find(([key]) => key === field);
  return found?.[1] || 'Field';
}

function logEntry(stage, message) {
  return {
    id: `${stage}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    stage,
    message
  };
}

function readError(error) {
  return error instanceof Error ? error.message : String(error);
}

function formatGenerationProvider(result) {
  if (!result) {
    return { label: 'Waiting', meta: '' };
  }

  const raw = String(result.provider || '').trim();
  const normalized = raw.toLowerCase();
  const mode = String(result.mode || '').trim().toLowerCase();

  if (normalized === 'local-template' || normalized === 'template' || mode === 'template') {
    return { label: 'Local template', meta: 'No API configured' };
  }

  if (normalized.startsWith('gemini:')) {
    return { label: 'Google Gemini', meta: raw.slice('gemini:'.length) };
  }

  if (normalized === 'gemini' || normalized.includes('generativelanguage')) {
    return { label: 'Google Gemini', meta: 'Cloud API' };
  }

  if (normalized.startsWith('openrouter:')) {
    const modelId = raw.slice('openrouter:'.length);
    return {
      label: 'OpenRouter',
      meta: modelId.includes('owl-alpha') ? 'Owl Alpha' : modelId
    };
  }

  if (normalized.startsWith('api:')) {
    return { label: 'LLM API', meta: raw.slice('api:'.length) };
  }

  if (normalized === 'openai-compatible') {
    return { label: 'OpenAI-compatible', meta: 'Remote API' };
  }

  if (/^https?:\/\//i.test(raw)) {
    try {
      const host = new URL(raw).hostname.replace(/^www\./, '');
      const label = host.includes('generativelanguage') || host.includes('google') ? 'Google Gemini' : 'LLM API';
      return { label, meta: host };
    } catch {
      return { label: 'LLM API', meta: '' };
    }
  }

  return {
    label: raw || (mode === 'api' ? 'LLM API' : 'Local'),
    meta: mode === 'api' ? 'API mode' : ''
  };
}

function compactResult(result) {
  if (!result) return null;

  return {
    mode: result.mode,
    provider: result.provider,
    proposalLatex: result.proposalLatex,
    complianceMatrix: result.complianceMatrix,
    evaluationReport: result.evaluationReport,
    questions: result.questions
  };
}

function formatSavedAt(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'recently';
  }

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
}

export default App;
