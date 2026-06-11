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

export function escapeUrlForLatex(url) {
  return String(url || '')
    .replace(/\\/g, '/')
    .replace(/%/g, '\\%')
    .replace(/#/g, '\\%23')
    .replace(/_/g, '\\_');
}

export function formatEntryForLatex(entry) {
  const raw = String(entry || '').trim();
  if (!raw) return '';

  const urlPattern = /(https?:\/\/[^\s]+)/gi;
  let result = '';
  let lastIndex = 0;
  let matched = false;

  for (const match of raw.matchAll(urlPattern)) {
    matched = true;
    result += escapeLatex(raw.slice(lastIndex, match.index));
    result += `\\url{${escapeUrlForLatex(match[0].replace(/[.,;)\]]+$/, ''))}}`;
    lastIndex = match.index + match[0].length;
  }

  result += escapeLatex(raw.slice(lastIndex));
  return matched ? result : escapeLatex(raw);
}
