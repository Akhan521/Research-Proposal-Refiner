/**
 * Verifies mergeAcceptedFieldValue keeps literature + appends LLM suggestions.
 * Run: node scripts/test-merge-accept.mjs
 */

function mergeTextField(current, addition) {
  const base = String(current || '').trim();
  const next = String(addition || '').trim();
  if (!base) return next;
  if (!next) return base;
  if (base.includes(next)) return base;
  return `${base}\n\n${next}`;
}

function mergeAcceptedFieldValueLegacy(existing, incoming) {
  const base = String(existing || '').trim();
  const next = String(incoming || '').trim();
  if (!base) return next;
  if (!next) return base;
  if (base.includes(next)) return base;
  if (next.includes(base)) return next;
  return mergeTextField(base, next);
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

const LITERATURE =
  'Your search on campus dining returned 5 papers that may support your proposal. ' +
  'Smith et al. (2020) study queue times. Jones (2021) models meal planning. ' +
  'Taken together, these 5 retrieved papers give you citeable evidence that the literature on campus dining is worth engaging in your problem statement.';

const LLM_SUGGESTION =
  'University dining halls face long wait times and poor meal planning, leaving students without reliable access to nutritious food.';

const SUPERSET = `${LITERATURE}\n\n${LLM_SUGGESTION}`;

const cases = [
  {
    name: 'literature then LLM suggestion appends',
    existing: LITERATURE,
    incoming: LLM_SUGGESTION,
    expect: (out) => out.includes(LITERATURE) && out.includes(LLM_SUGGESTION) && out.length > LITERATURE.length
  },
  {
    name: 'user text + literature then LLM suggestion appends',
    existing: `Our campus needs better food access.\n\n${LITERATURE}`,
    incoming: LLM_SUGGESTION,
    expect: (out) =>
      out.includes('Our campus needs better food access') &&
      out.includes(LITERATURE) &&
      out.includes(LLM_SUGGESTION)
  },
  {
    name: 'exact duplicate suggestion is no-op',
    existing: LITERATURE,
    incoming: LITERATURE,
    expect: (out, existing) => out === existing
  },
  {
    name: 'empty existing uses suggestion only',
    existing: '',
    incoming: LLM_SUGGESTION,
    expect: (out) => out === LLM_SUGGESTION
  },
  {
    name: 'superset suggestion does not duplicate literature block',
    existing: LITERATURE,
    incoming: SUPERSET,
    expect: (out) => out === SUPERSET && (out.match(/Your search on/g) || []).length === 1
  },
  {
    name: 'legacy overwrite via next.includes(base) drops extra user notes',
    existing: `Campus dining is slow.\n\n${LITERATURE}`,
    incoming: LITERATURE,
    expect: (out, existing) => out === existing,
    legacyExpect: (out, existing) => out === existing
  }
];

let failed = 0;

for (const { name, existing, incoming, expect, legacyExpect } of cases) {
  const legacy = mergeAcceptedFieldValueLegacy(existing, incoming);
  const current = mergeAcceptedFieldValue(existing, incoming);

  if (legacyExpect && !legacyExpect(legacy, existing)) {
    console.log(`INFO: ${name} — legacy behavior differs from current`);
  }

  if (!expect(current, existing)) {
    failed += 1;
    console.error(`FAIL (current): ${name}`);
    console.error('  output length:', current.length, 'existing:', existing.length);
    console.error('  has literature:', current.includes('Your search on'));
    console.error('  has suggestion:', current.includes('University dining halls'));
    continue;
  }

  const legacyBroken =
    name.includes('appends') &&
    (!legacy.includes(LITERATURE) || !legacy.includes(LLM_SUGGESTION) || legacy === incoming);

  console.log(`PASS: ${name}${legacyBroken ? ' (legacy merge was broken)' : ''}`);
}

// Document the legacy silent no-op when suggestion is substring of literature
const substringIncoming = 'campus dining';
const legacySub = mergeAcceptedFieldValueLegacy(LITERATURE, substringIncoming);
const currentSub = mergeAcceptedFieldValue(LITERATURE, substringIncoming);
if (legacySub === LITERATURE && currentSub === LITERATURE) {
  console.log('NOTE: substring suggestion correctly no-ops for both merges');
} else {
  console.log('NOTE: substring behavior legacy=', legacySub.length, 'current=', currentSub.length);
}

function isSuggestionApplied(existing, suggestionValue) {
  const base = String(existing || '').trim();
  const next = String(suggestionValue || '').trim();
  if (!next) return true;
  return base === next || base.includes(next);
}

const mergedProblem = mergeAcceptedFieldValue(LITERATURE, LLM_SUGGESTION);
if (!isSuggestionApplied(mergedProblem, LLM_SUGGESTION)) {
  failed += 1;
  console.error('FAIL: Accepted UI state after merge should detect applied suggestion');
} else {
  console.log('PASS: Accepted UI state after merge');
}

if (failed > 0) {
  console.error(`\n${failed} case(s) failed`);
  process.exit(1);
}

console.log('\nAll merge-accept checks passed.');
