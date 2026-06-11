import { createRequire } from 'node:module';
import { PROPOSAL_AUTHOR } from '../shared/mathlmDefaults.js';
import { normalizeUnicodeForLatex, repairProposalLatex } from './latexRepair.js';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const require = createRequire(import.meta.url);
const { platformResolver } = require('node-latex-compiler');
const execFileAsync = promisify(execFile);

export function prepareLatexDocument(source, title = 'proposal', options = {}) {
  const trimmed = String(source || '').trim();
  const author = options.author || PROPOSAL_AUTHOR;

  if (!trimmed) {
    throw new Error('LaTeX source is empty.');
  }

  const complete = ensureCompleteLatexDocument(trimmed, title, author);
  return sanitizeLatexForExport(repairProposalLatex(complete, { title, author }), title, author);
}

export async function compileLatexDocument(document) {
  const source = String(document || '').trim();

  if (!source) {
    return { ok: false, error: 'LaTeX source is empty.' };
  }

  const workdir = await mkdtemp(path.join(tmpdir(), 'proposal-tex-'));
  const texPath = path.join(workdir, 'proposal.tex');
  const pdfPath = path.join(workdir, 'proposal.pdf');

  try {
    await writeFile(texPath, source, 'utf8');
    const tectonicPath = resolveBundledTectonic() || 'tectonic';
    await runTectonic(tectonicPath, workdir, texPath);
    const pdf = await readFile(pdfPath);
    return { ok: true, pdf };
  } catch (error) {
    if (isMissingTectonicError(error)) {
      return {
        ok: false,
        compilerUnavailable: true,
        error: 'PDF compiler is unavailable.'
      };
    }

    return {
      ok: false,
      error: cleanCompileError(extractCompileFailure(error)) || 'PDF compilation failed.'
    };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

export async function proposalLatexToPdf(latex, title = 'proposal', options = {}) {
  const { validateProposalLatex } = await import('./latexValidate.js');
  let fallbackLatex = options.fallbackLatex;

  if (!fallbackLatex && options.project) {
    const { buildFallbackProposalLatex } = await import('./proposalGenerator.js');
    fallbackLatex = buildFallbackProposalLatex(options.project);
  }

  const validation = await validateProposalLatex(latex, title, {
    fallbackLatex,
    author: options.author || PROPOSAL_AUTHOR
  });

  if (validation.compilerUnavailable) {
    throw new Error(
      'PDF compiler is unavailable. Run `npm install` in the project folder, then try again. LaTeX output remains available in the LaTeX tab.'
    );
  }

  const compile = await compileLatexDocument(validation.latex);

  if (compile.ok) {
    return compile.pdf;
  }

  throw new Error(
    compile.error ||
    validation.warning ||
    validation.attempts?.find((attempt) => attempt.error)?.error ||
    'PDF compilation failed.'
  );
}

function resolveBundledTectonic() {
  try {
    return platformResolver.resolveTectonicExecutable({});
  } catch {
    return null;
  }
}

async function runTectonic(tectonicPath, workdir, texPath) {
  const args = ['--outdir', workdir, texPath];

  try {
    await execFileAsync(tectonicPath, args, {
      cwd: workdir,
      timeout: 120000,
      maxBuffer: 1024 * 1024 * 8
    });
  } catch (error) {
    if (process.platform === 'win32' && isMissingTectonicError(error) && !tectonicPath.endsWith('.exe')) {
      await execFileAsync(`${tectonicPath}.exe`, args, {
        cwd: workdir,
        timeout: 120000,
        maxBuffer: 1024 * 1024 * 8
      });
      return;
    }

    throw error;
  }
}

function extractCompileFailure(error) {
  if (!error || typeof error !== 'object') {
    return error instanceof Error ? error.message : String(error);
  }

  const stderr = String(error.stderr || '');
  const stdout = String(error.stdout || '');
  const combined = `${stderr}\n${stdout}`.trim();
  const message = error instanceof Error ? error.message : String(error);

  const errorLine = combined
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^error:/i.test(line) || /^! /.test(line));

  if (errorLine) {
    return errorLine.replace(/^error:\s*/i, '');
  }

  if (/fontspec|fontconfig|unicode-math/i.test(combined)) {
    return 'This draft uses fonts or bibliography packages that the bundled PDF compiler cannot load. LaTeX output is still available; try Retry PDF after simplifying packages, or download the .tex file.';
  }

  if (/biblatex|biber/i.test(combined)) {
    return 'This draft references a bibliography setup that is not bundled for PDF export. LaTeX output is still available.';
  }

  const commandFailed = message.match(/Command failed:[^\n]+/);
  if (commandFailed && combined) {
    return combined.split(/\r?\n/).filter(Boolean).slice(-6).join(' ');
  }

  return message;
}

function cleanCompileError(text) {
  const value = String(text || '')
    .replace(/Command failed:[^\n]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!value) return '';
  return value.length > 280 ? `${value.slice(0, 277)}…` : value;
}

function isMissingTectonicError(error) {
  return error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}

const UNSUPPORTED_PACKAGE_PATTERN =
  /\\usepackage(?:\[[^\]]*\])?\{(?:fontspec|unicode-math|mathspec|minted|pygmentex|sagetex|pstricks|tikz-3dplot|biber|biblatex)\}/gi;

const UNSAFE_PDF_EXPORT_PATTERN =
  /\\usepackage(?:\[[^\]]*\])?\{(?:fontspec|unicode-math|mathspec|minted|pygmentex|sagetex|pstricks|tikz-3dplot|biblatex)\}|\\RequirePackage\{(?:fontspec|unicode-math)\}|%!\s*TEX\s+program\s*=\s*(?:xelatex|lualatex)/i;

function sanitizeLatexForExport(source, title = 'proposal', author = PROPOSAL_AUTHOR) {
  const normalized = normalizeUnicodeForLatex(source);

  if (UNSAFE_PDF_EXPORT_PATTERN.test(normalized)) {
    const body = stripUnsupportedConstructs(replaceExternalImageIncludes(extractDocumentBody(normalized)));
    return ensureCompleteLatexDocument(body, title, author);
  }

  return stripUnsupportedConstructs(replaceExternalImageIncludes(normalized));
}

function extractDocumentBody(source) {
  const lines = String(source || '').replace(/\r\n/g, '\n').split('\n');
  const beginIndex = lines.findIndex((line) => /\\begin\{document\}/.test(line));
  const endIndex = findLastIndex(lines, (line) => /\\end\{document\}/.test(line));

  if (beginIndex === -1) {
    return String(source || '');
  }

  return lines.slice(beginIndex + 1, endIndex === -1 ? lines.length : endIndex).join('\n').trim();
}

function stripUnsupportedConstructs(source) {
  let next = String(source || '');

  next = next.replace(UNSUPPORTED_PACKAGE_PATTERN, '');
  next = next.replace(/\\RequirePackage\{(?:fontspec|unicode-math|mathspec)\}/gi, '');
  next = next.replace(/\\addbibresource\{[^{}]+\}/g, '');
  next = next.replace(/\\printbibliography\b/g, '');
  next = next.replace(/\\bibliography\{[^{}]+\}/g, '');
  next = next.replace(/\\bibliographystyle\{[^{}]+\}/g, '');
  next = next.replace(/\\cite\{([^{}]+)\}/g, '[cite: $1]');

  return next;
}

function replaceExternalImageIncludes(source) {
  return String(source || '').replace(
    /\\includegraphics(?:\s*\[[^\]]*\])?\s*\{([^{}]+)\}/g,
    (_, filename) => imagePlaceholder(filename)
  );
}

function imagePlaceholder(filename) {
  return String.raw`\begin{center}
\fbox{\begin{minipage}{0.86\linewidth}
\centering
\textbf{Workflow diagram}\\[0.45em]
Rough idea $\rightarrow$ structured state $\rightarrow$ student decisions $\rightarrow$ proposal draft $\rightarrow$ compliance review $\rightarrow$ revised PDF\\[0.45em]
\footnotesize External image asset \texttt{${escapeLatex(filename)}} was not provided, so the exporter rendered this LaTeX-native placeholder.
\end{minipage}}
\end{center}`;
}

function ensureCompleteLatexDocument(source, title, author = PROPOSAL_AUTHOR) {
  if (/\\documentclass\b/.test(source) && /\\begin\{document\}/.test(source)) {
    return normalizeCompleteLatexDocument(source);
  }

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
\author{${escapeLatex(author)}}
\date{}
\begin{document}
\maketitle
${source}
\end{document}
`;
}

function normalizeCompleteLatexDocument(source) {
  const lines = String(source || '').replace(/\r\n/g, '\n').split('\n');
  const beginIndex = lines.findIndex((line) => /\\begin\{document\}/.test(line));
  const endIndex = findLastIndex(lines, (line) => /\\end\{document\}/.test(line));

  if (beginIndex === -1) {
    return source;
  }

  const preambleLines = lines.slice(0, beginIndex);
  const bodyLines = lines.slice(beginIndex + 1, endIndex === -1 ? lines.length : endIndex);
  const documentClass = preambleLines.find((line) => /\\documentclass\b/.test(line)) || '\\documentclass[11pt]{article}';
  const preamble = [];
  const movedPreamble = [];

  preambleLines.forEach((line) => {
    if (/\\documentclass\b/.test(line)) return;
    if (/\\begin\{document\}|\\end\{document\}/.test(line)) return;
    preamble.push(line);
  });

  const cleanBody = bodyLines.filter((line) => {
    if (/\\documentclass\b|\\begin\{document\}|\\end\{document\}/.test(line)) return false;
    if (/^\s*\\(?:usepackage|geometry)\b/.test(line)) {
      movedPreamble.push(line);
      return false;
    }
    return true;
  });

  const normalizedPreamble = ensureDefaultPreamble([documentClass, ...preamble, ...movedPreamble]);

  return `${dedupeLines(normalizedPreamble).join('\n')}\n\\begin{document}\n${cleanBody.join('\n').trim()}\n\\end{document}\n`;
}

function ensureDefaultPreamble(lines) {
  const source = lines.join('\n');
  const next = [...lines];

  if (!/\\usepackage(?:\[[^\]]*\])?\{geometry\}/.test(source)) {
    next.push('\\usepackage[margin=1in]{geometry}');
  }

  if (!/\\usepackage(?:\[[^\]]*\])?\{hyperref\}/.test(source)) {
    next.push('\\usepackage[hidelinks]{hyperref}');
  }

  if (!/\\usepackage(?:\[[^\]]*\])?\{enumitem\}/.test(source)) {
    next.push('\\usepackage{enumitem}');
  }

  if (!/\\PassOptionsToPackage\{hyphens\}\{url\}/.test(source)) {
    next.unshift('\\PassOptionsToPackage{hyphens}{url}');
  }

  if (!/\\usepackage(?:\[[^\]]*\])?\{hyperref\}/.test(source) && !/\\usepackage(?:\[[^\]]*\])?\{url\}/.test(source)) {
    next.push('\\usepackage[hyphens]{url}');
  }

  if (!/\\urlstyle\{same\}/.test(source)) {
    next.push('\\urlstyle{same}');
  }

  if (!/\\emergencystretch/.test(source)) {
    next.push('\\setlength{\\emergencystretch}{3em}');
  }

  if (!/\\setlist\[itemize\]/.test(source)) {
    next.push('\\setlist[itemize]{leftmargin=*,itemsep=0.35em,parsep=0pt,topsep=0.35em,partopsep=0pt}');
  }

  return next;
}

function dedupeLines(lines) {
  const seen = new Set();

  return lines.filter((line) => {
    const key = line.trim();
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findLastIndex(items, predicate) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index], index)) return index;
  }

  return -1;
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
