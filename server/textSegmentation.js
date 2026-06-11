const SEGMENT_DOT = '\uE000';
const SEGMENT_DECIMAL = '\uE001';

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function protectSegmentationMarkers(text) {
  return String(text || '')
    .replace(/(\d+)\.(\d+)/g, `$1${SEGMENT_DECIMAL}$2`)
    .replace(/\be\.g\./gi, `e${SEGMENT_DOT}g${SEGMENT_DOT}`)
    .replace(/\bi\.e\./gi, `i${SEGMENT_DOT}e${SEGMENT_DOT}`)
    .replace(/\betc\./gi, `etc${SEGMENT_DOT}`)
    .replace(/\bvs\./gi, `vs${SEGMENT_DOT}`)
    .replace(/\bet al\./gi, `et al${SEGMENT_DOT}`)
    .replace(/\b(?:Mr|Mrs|Ms|Dr|Prof)\./gi, (match) => match.replace('.', SEGMENT_DOT))
    .replace(/\bU\.S\./g, `U${SEGMENT_DOT}S${SEGMENT_DOT}`);
}

function restoreSegmentationMarkers(text) {
  return String(text || '')
    .replace(new RegExp(SEGMENT_DECIMAL, 'g'), '.')
    .replace(new RegExp(SEGMENT_DOT, 'g'), '.');
}

export function splitSentences(text) {
  const value = clean(text);
  if (!value) return [];

  const protectedText = protectSegmentationMarkers(value);
  const parts = protectedText.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [protectedText];

  return parts
    .map((part) => restoreSegmentationMarkers(part))
    .map((part) => clean(part))
    .filter(Boolean);
}

export function truncateToSentences(text, maxSentences = 2) {
  return splitSentences(text)
    .slice(0, maxSentences)
    .join(' ')
    .trim();
}

export function isIncompleteFragment(text) {
  const value = clean(text);
  if (!value) return true;
  if (value.length <= 2) return true;
  if (/^\w\.$/.test(value)) return true;
  if (/^[a-z]{1,2}\.$/i.test(value)) return true;
  if (/^[,;)]+/.test(value)) return true;
  if (/^[a-z]/.test(value) && value.length < 30) return true;
  if (/\be\.$/i.test(value)) return true;
  if (/\([^)]*$/.test(value)) return true;
  if (/,\s*$/.test(value)) return true;
  return false;
}

function shouldMergeWithPrevious(previous, next) {
  if (!previous) return false;
  if (isIncompleteFragment(next)) return true;
  if (isIncompleteFragment(previous)) return true;
  if (/\([^)]*$/.test(previous)) return true;
  if (/,\s*$/.test(previous)) return true;
  if (/\be\.$/i.test(previous)) return true;
  return false;
}

export function mergeFragmentItems(items) {
  const input = (Array.isArray(items) ? items : []).map(clean).filter(Boolean);
  const merged = [];

  for (const item of input) {
    if (!merged.length) {
      merged.push(item);
      continue;
    }

    const previous = merged[merged.length - 1];
    if (shouldMergeWithPrevious(previous, item)) {
      merged[merged.length - 1] = clean(`${previous} ${item}`);
    } else {
      merged.push(item);
    }
  }

  return merged.filter((entry) => clean(entry).length > 0);
}

export function validateCompleteProseItems(items, context = 'content') {
  const issues = [];
  const merged = mergeFragmentItems(items);

  for (const [index, item] of merged.entries()) {
    if (isIncompleteFragment(item)) {
      issues.push(`${context} item ${index + 1} looks incomplete: "${item.slice(0, 80)}".`);
    }
    if (item.length < 12) {
      issues.push(`${context} item ${index + 1} is too short to stand alone.`);
    }
  }

  return { ok: issues.length === 0, issues, items: merged };
}
