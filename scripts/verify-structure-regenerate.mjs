import { refineAgentStructure, startAgentSession } from '../server/proposalGenerator.js';

const API_BASE = process.env.API_BASE || 'http://127.0.0.1:8787';

function isDecisionResolved(decision) {
  return Boolean(String(decision?.resolvedOptionLabel || decision?.resolvedValue || '').trim());
}

function mergeDecisionsAfterRegenerate(previousDecisions, incomingDecisions, rejectedId) {
  const previousById = new Map(previousDecisions.map((decision) => [decision.id, decision]));

  return incomingDecisions.map((decision) => {
    if (decision.id === rejectedId) return decision;
    const previous = previousById.get(decision.id);
    if (!previous || !isDecisionResolved(previous)) return decision;
    const selectedOption = decision.options?.find((option) => option.label === previous.resolvedOptionLabel);
    if (!selectedOption) return decision;
    return {
      ...decision,
      resolvedOptionLabel: previous.resolvedOptionLabel,
      resolvedValue: selectedOption.value
    };
  });
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
  return `${base}\n\n${next}`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
        value: replacement.value || item.value
      }
      : item
  );
}

function testSuggestionOrderPreservation() {
  const previous = [
    { field: 'title', label: 'Title', value: 'A' },
    { field: 'problem', label: 'Problem', value: 'B' },
    { field: 'method', label: 'Method', value: 'C' },
    { field: 'evaluation', label: 'Evaluation', value: 'D' }
  ];
  const incoming = [
    { field: 'title', label: 'Title', value: 'new title' },
    { field: 'method', label: 'Method', value: 'revised method text' }
  ];

  const merged = mergeSuggestionsPreservingOrder(previous, incoming, 2, 'method');
  assert(merged.length === 4, 'merge should preserve suggestion count');
  assert(merged[0].value === 'A', 'earlier slots should stay untouched');
  assert(merged[2].value === 'revised method text', 'target slot should update in place');
  assert(merged[3].value === 'D', 'later slots should stay untouched');
}

function testDecisionPersistenceHelpers() {
  const resolved = [
    {
      id: 'problem-framing',
      resolvedOptionLabel: 'Rubric alignment',
      resolvedValue: 'old framing text'
    },
    {
      id: 'method-style',
      resolvedOptionLabel: 'Structured extraction',
      resolvedValue: 'old method text'
    }
  ];

  const incoming = [
    {
      id: 'problem-framing',
      title: 'Choose The Problem Framing',
      options: [
        { label: 'Rubric alignment', value: 'updated framing text' },
        { label: 'Revision quality', value: 'revision text' }
      ]
    },
    {
      id: 'method-style',
      title: 'Choose The Agent Method',
      options: [
        { label: 'Structured extraction', value: 'updated method text' },
        { label: 'Critique and revise', value: 'critique text' }
      ]
    }
  ];

  const merged = mergeDecisionsAfterRegenerate(resolved, incoming, 'problem-framing');
  assert(merged.length === 2, 'merged decisions should keep all cards');
  assert(!isDecisionResolved(merged[0]), 'regenerated decision should reset resolved state');
  assert(isDecisionResolved(merged[1]), 'other resolved decisions should stay resolved');
  assert(merged[1].resolvedValue === 'updated method text', 'resolved option should track refreshed option text');

  const replaced = applyDecisionOptionToProject('old framing text', 'new framing text', 'old framing text');
  assert(replaced === 'new framing text', 're-selecting a decision option should replace prior choice text');
}

async function testRefineModule() {
  const project = {
    title: 'RL for math reasoning',
    topic: 'RL for math reasoning',
    problem: 'Existing accepted problem text.',
    method: '',
    evaluation: '',
    timeline: '',
    resources: '',
    references: ''
  };

  const result = await refineAgentStructure({
    project,
    guidance: 'Keep suggestions focused on reinforcement learning for math.',
    scope: 'suggestion',
    rejected: {
      type: 'suggestion',
      item: { field: 'method', value: 'off-topic computer vision pipeline', label: 'Method' }
    },
    fieldSuggestions: [{ field: 'method', value: 'off-topic computer vision pipeline', label: 'Method' }],
    decisions: []
  });

  assert(Array.isArray(result.fieldSuggestions), 'refine should return fieldSuggestions');
  assert(result.fieldSuggestions.length > 0, 'refine should return at least one suggestion');
  assert(
    !result.fieldSuggestions.some((item) => /computer vision/i.test(item.value)),
    'refined suggestions should drop rejected off-topic content when using local fallback'
  );
}

async function testHttpRefineRoute() {
  const response = await fetch(`${API_BASE}/api/agent/refine-structure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project: {
        title: 'RL for math reasoning',
        topic: 'RL for math reasoning',
        problem: 'Students need stronger math reasoning agents.'
      },
      guidance: 'Regenerate method suggestions about GRPO and verifier-guided RL.',
      scope: 'suggestion',
      rejected: {
        type: 'suggestion',
        item: { field: 'method', value: 'Use a generic chatbot workflow.' }
      },
      fieldSuggestions: [{ field: 'method', value: 'Use a generic chatbot workflow.', label: 'Method' }],
      decisions: []
    })
  });

  const data = await response.json();
  assert(response.ok, `HTTP refine route failed: ${data.error || response.status}`);
  assert(Array.isArray(data.fieldSuggestions) && data.fieldSuggestions.length > 0, 'HTTP refine should return suggestions');
}

async function testStartThenRefineWithAcceptedProject() {
  const started = await startAgentSession({ topic: 'Verifier-guided RL for math word problems' });
  assert(started.fieldSuggestions.length > 0, 'start should produce suggestions');
  assert(started.decisions.length > 0, 'start should produce decisions');

  const acceptedProject = {
    ...started.project,
    problem: started.fieldSuggestions.find((item) => item.field === 'problem')?.value || started.project.problem
  };

  const refined = await refineAgentStructure({
    project: acceptedProject,
    guidance: 'Offer a different method emphasis using process rewards and code verification.',
    scope: 'decision',
    rejected: { type: 'decision', item: started.decisions[0] },
    fieldSuggestions: started.fieldSuggestions,
    decisions: started.decisions.map((decision, index) =>
      index === 1
        ? {
          ...decision,
          resolvedOptionLabel: decision.options[0].label,
          resolvedValue: decision.options[0].value
        }
        : decision
    )
  });

  assert(refined.decisions.length > 0, 'refine after accepted project should still return decision cards');
}

async function main() {
  const results = [];

  try {
    testSuggestionOrderPreservation();
    results.push('PASS suggestion order preservation');
  } catch (error) {
    results.push(`FAIL suggestion order preservation: ${error.message}`);
  }

  try {
    testDecisionPersistenceHelpers();
    results.push('PASS decision persistence helpers');
  } catch (error) {
    results.push(`FAIL decision persistence helpers: ${error.message}`);
  }

  try {
    await testRefineModule();
    results.push('PASS refineAgentStructure module');
  } catch (error) {
    results.push(`FAIL refineAgentStructure module: ${error.message}`);
  }

  try {
    await testStartThenRefineWithAcceptedProject();
    results.push('PASS start + refine with accepted project state');
  } catch (error) {
    results.push(`FAIL start + refine with accepted project state: ${error.message}`);
  }

  try {
    await testHttpRefineRoute();
    results.push('PASS HTTP /api/agent/refine-structure');
  } catch (error) {
    results.push(`FAIL HTTP /api/agent/refine-structure: ${error.message}`);
  }

  results.forEach((line) => console.log(line));

  if (results.some((line) => line.startsWith('FAIL'))) {
    process.exitCode = 1;
  }
}

main();
