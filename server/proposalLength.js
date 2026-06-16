import { PROPOSAL_AUTHOR } from '../shared/mathlmDefaults.js';
import {
  getProposalLengthProfile,
  getResourceItemCap,
  normalizeProposalPageTarget,
  PROPOSAL_PAGE_MAX,
  PROPOSAL_RESOURCES_MIN
} from '../shared/proposalLength.js';
import { enforceResourcesInProposalLatex, parseResourceGroups } from './resourceFormat.js';
import { truncateToSentences } from './textSegmentation.js';
import { compileLatexDocument, prepareLatexDocument } from './pdfExport.js';

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function countPdfPages(pdfBuffer, options = {}) {
  if (Number.isFinite(options.pageCount) && options.pageCount > 0) {
    return options.pageCount;
  }

  const latin = Buffer.isBuffer(pdfBuffer) ? pdfBuffer.toString('latin1') : String(pdfBuffer || '');
  const countMatch = latin.match(/\/Type\s*\/Pages[\s\S]{0,600}?\/Count\s+(\d+)/);
  if (countMatch) {
    return Number(countMatch[1]) || 0;
  }

  return (latin.match(/\/Type\s*\/Page(?![s])/g) || []).length;
}

function replaceSectionBody(latex, sectionPattern, replacementBody) {
  const pattern = new RegExp(
    `(\\\\section\\*?\\{${sectionPattern}[^}]*\\})([\\s\\S]*?)(?=\\\\section\\*?\\{|\\\\end\\{document\\})`,
    'i'
  );

  if (!pattern.test(latex)) {
    return latex;
  }

  if (typeof replacementBody === 'function') {
    return latex.replace(pattern, replacementBody);
  }

  const body = replacementBody ? `\n${replacementBody}\n` : '\n';
  return latex.replace(pattern, `$1${body}`);
}

function stripPlainLanguageSummary(latex) {
  return latex.replace(
    /\\section\*?\{Plain-Language Summary\}[\s\S]*?(?=\\section\*?\{|\\section\{|\\end\{document\})/i,
    ''
  );
}

function limitEnumerateBlocks(latex, maxItems) {
  if (!maxItems || maxItems < 1) return latex;

  return latex.replace(/\\begin\{enumerate\}(\[[^\]]*\])?([\s\S]*?)\\end\{enumerate\}/gi, (full, options = '', body = '') => {
    const items = body.split(/\\item\b/).map((entry) => entry.trim()).filter(Boolean);
    if (items.length <= maxItems) return full;
    const trimmed = items
      .slice(0, maxItems)
      .map((entry) => `  \\item ${entry}`)
      .join('\n');
    return `\\begin{enumerate}${options}\n${trimmed}\n\\end{enumerate}`;
  });
}

function limitItemizeBlocks(latex, maxItems) {
  if (!maxItems || maxItems < 1) return latex;

  return latex.replace(/\\begin\{itemize\}(\[[^\]]*\])?([\s\S]*?)\\end\{itemize\}/gi, (full, options = '', body = '') => {
    const items = body.split(/\\item\b/).map((entry) => entry.trim()).filter(Boolean);
    if (items.length <= maxItems) return full;
    const trimmed = items
      .slice(0, maxItems)
      .map((entry) => `  \\item ${entry}`)
      .join('\n');
    return `\\begin{itemize}${options}\n${trimmed}\n\\end{itemize}`;
  });
}

function capListItemsInSection(latex, sectionTitle, maxItems) {
  if (!maxItems || maxItems < 1) return latex;

  const pattern = new RegExp(
    `(\\\\section\\*?\\{${escapeRegExp(sectionTitle)}[^}]*\\})([\\s\\S]*?)(?=\\\\section\\*?\\{|\\\\section\\{|\\\\end\\{document\\})`,
    'i'
  );

  return latex.replace(pattern, (full, heading, body) => {
    const limited = limitItemizeBlocks(body, maxItems);
    return `${heading}${limited}`;
  });
}

function capListItemsInSubsection(latex, subsectionTitle, maxItems) {
  const pattern = new RegExp(
    `(\\\\subsection\\*\\{${escapeRegExp(subsectionTitle)}\\}[\\s\\S]*?)(?=\\\\subsection\\*\\{|\\\\section\\*?\\{|\\\\section\\{|\\\\end\\{document\\})`,
    'i'
  );

  return latex.replace(pattern, (block) => {
    if (!/\\begin\{itemize\}/i.test(block)) return block;
    return limitItemizeBlocks(block, maxItems);
  });
}

function stripSection(latex, sectionTitle) {
  const pattern = new RegExp(
    `\\\\section\\*?\\{${escapeRegExp(sectionTitle)}[^}]*\\}[\\s\\S]*?(?=\\\\section\\*?\\{|\\\\section\\{|\\\\end\\{document\\})`,
    'i'
  );
  return latex.replace(pattern, '');
}

function compactSectionProse(latex, sectionTitle, maxSentences) {
  if (!maxSentences || maxSentences < 1) return latex;

  return replaceSectionBody(latex, escapeRegExp(sectionTitle), (match, heading, body) => {
    const withoutLists = body.replace(/\\begin\{(?:itemize|enumerate)\}[\s\S]*?\\end\{(?:itemize|enumerate)\}/gi, ' ');
    const prose = truncateToSentences(stripLatexMarkup(withoutLists), maxSentences);
    return prose ? `${heading}\n${prose}\n` : `${heading}\n`;
  });
}

function limitBibliographyItems(latex, maxItems) {
  if (!maxItems || maxItems < 1) return latex;

  return latex.replace(
    /\\begin\{thebibliography\}\{(\d+)\}([\s\S]*?)\\end\{thebibliography\}/gi,
    (full, width, body) => {
      const items = [];
      const itemPattern = /\\bibitem(\[[^\]]*\])?\{([^}]*)\}([\s\S]*?)(?=\\bibitem|\\end\{thebibliography\})/gi;
      let match = itemPattern.exec(body);
      while (match) {
        items.push(match[0].trim());
        match = itemPattern.exec(body);
      }

      if (items.length <= maxItems) return full;

      const trimmed = items.slice(0, maxItems).map((entry) => `  ${entry}`).join('\n');
      const newWidth = String(Math.max(1, Math.min(9, maxItems)));
      return `\\begin{thebibliography}{${newWidth}}\n${trimmed}\n\\end{thebibliography}`;
    }
  );
}

function capResourcesSection(latex, maxItems) {
  const cap = getResourceItemCap(maxItems);

  return latex.replace(
    /(\\section\*?\{Resources\})([\s\S]*?)(?=\\section\*?\{|\\section\{|\\end\{document\})/i,
    (full, heading, body) => {
      const totalItems = (body.match(/\\item\b/g) || []).length;
      if (totalItems <= cap) return full;

      let remaining = cap;
      const newBody = body.replace(
        /\\begin\{itemize\}(\[[^\]]*\])?([\s\S]*?)\\end\{itemize\}/gi,
        (block, options = '', inner = '') => {
          if (remaining <= 0) return '';
          const items = inner.split(/\\item\b/).map((entry) => entry.trim()).filter(Boolean);
          if (!items.length) return block;
          const keepCount = Math.min(remaining, items.length);
          remaining -= keepCount;
          if (keepCount === items.length) return block;
          const trimmed = items
            .slice(0, keepCount)
            .map((entry) => `  \\item ${entry}`)
            .join('\n');
          return `\\begin{itemize}${options}\n${trimmed}\n\\end{itemize}`;
        }
      );

      const cleaned = newBody.replace(
        /\\subsection\*\{[^}]*\}\s*(?=(\\subsection\*|\\section|\\end\{document\}))/gi,
        ''
      );

      return `${heading}${cleaned}`;
    }
  );
}

export function countResourceItemsInLatex(latex) {
  const match = String(latex || '').match(
    /\\section\*?\{Resources\}([\s\S]*?)(?=\\section\*?\{|\\section\{|\\end\{document\})/i
  );
  if (!match) return 0;
  return (match[1].match(/\\item\b/g) || []).length;
}

function countAvailableResources(resourcesText) {
  const parsed = parseResourceGroups(resourcesText);
  let total = 0;
  for (const category of parsed.categories) {
    total += (parsed.groups.get(category.key) || []).filter(Boolean).length;
  }
  return total || (clean(resourcesText) ? 1 : 0);
}

function ensureMinimumResources(latex, resourcesText, minItems = PROPOSAL_RESOURCES_MIN) {
  const available = countAvailableResources(resourcesText);
  if (!available) return latex;

  const floor = Math.min(available, minItems);
  let next = String(latex || '');
  let count = countResourceItemsInLatex(next);

  if (count < floor) {
    const restored = enforceResourcesInProposalLatex(next, resourcesText);
    next = restored.latex;
    count = countResourceItemsInLatex(next);
  }

  if (count > available) {
    next = capResourcesSection(next, available);
  }

  return next;
}

function injectCompactGeometry(latex, margin = '0.85in') {
  if (/proposalcompactgeometrytrue/.test(latex)) return latex;
  const patch = `\\makeatletter\\@ifundefined{proposalcompactgeometry}{\\newif\\ifproposalcompactgeometry}{}\\proposalcompactgeometrytrue\\makeatother\n\\usepackage[margin=${margin}]{geometry}`;
  return latex.replace(/\\usepackage(?:\[[^\]]*\])?\{geometry\}/i, patch);
}

function injectSmallBodyFont(latex, size = 'small') {
  if (/proposalcompactfonttrue/.test(latex)) return latex;
  const patch = `\\makeatletter\\@ifundefined{proposalcompactfont}{\\newif\\ifproposalcompactfont}{}\\proposalcompactfonttrue\\makeatother\n\\AtBeginDocument{\\${size}}`;
  return latex.replace(/\\begin\{document\}/i, `${patch}\n\\begin{document}`);
}

function trimAbstractSection(latex, maxSentences) {
  if (!maxSentences || maxSentences < 1) return latex;

  return latex.replace(
    /(\\section\*\{Abstract\}\s*)([\s\S]*?)(?=\n\\section)/i,
    (_, heading, body) => {
      const trimmed = truncateToSentences(stripLatexMarkup(body), maxSentences);
      return trimmed ? `${heading}${trimmed}\n` : heading;
    }
  );
}

function injectTightSpacingPreamble(latex) {
  if (/\\proposallengthtighttrue/.test(latex)) return latex;

  const tighten = '\\makeatletter\\@ifundefined{proposallengthtight}{\\newif\\ifproposallengthtight}{}\\proposallengthtighttrue\\makeatother\n\\setlength{\\parskip}{0.35em}\n\\setlist{itemsep=0.2em,parsep=0pt,topsep=0.25em}';

  if (/\\begin\{document\}/.test(latex)) {
    return latex.replace(/\\begin\{document\}/i, `${tighten}\n\\begin{document}`);
  }

  return latex;
}

function proseForLatex(text, maxSentences) {
  const trimmed = truncateToSentences(clean(text), maxSentences);
  if (!trimmed) return '';
  return trimmed
    .split(/\n+/)
    .map((line) => clean(line))
    .filter(Boolean)
    .join('\n\n');
}

export function applyProposalLengthProfile(latex, project = {}, pageTarget = project.proposalPageTarget, options = {}) {
  const profile = getProposalLengthProfile(pageTarget);
  const resourcesText = trimResourcesText(options.resourcesText) || trimResourcesText(project.resources || '');
  let next = String(latex || '');

  if (!profile.includePlainSummary) {
    next = stripPlainLanguageSummary(next);
  }

  if (project.problem) {
    next = replaceSectionBody(next, 'Motivation and Gap', proseForLatex(project.problem, profile.motivationSentences));
  }

  if (project.method) {
    const methodProse = proseForLatex(project.method, profile.methodSentences);
    next = replaceSectionBody(next, 'Method and Training Workflow', (match, heading, body) => {
      const enumerateMatch = body.match(/\\begin\{enumerate\}[\s\S]*?\\end\{enumerate\}/i);
      const enumerateBlock = enumerateMatch
        ? limitEnumerateBlocks(enumerateMatch[0], profile.methodEnumerateItems)
        : '';
      const parts = [methodProse, enumerateBlock].filter(Boolean);
      return `${heading}\n${parts.join('\n\n')}\n`;
    });
  }

  next = limitEnumerateBlocks(next, profile.methodEnumerateItems);
  next = capListItemsInSubsection(next, 'Expected Results', profile.expectedResultCap);
  next = capListItemsInSubsection(next, 'Research Milestones and Timeline', profile.milestoneCap);
  next = capListItemsInSection(next, 'Risks and Mitigation', profile.riskItems);
  next = capResourcesSection(next, getResourceItemCap(profile.resourcesItems));
  next = limitBibliographyItems(next, profile.bibliographyCap);

  if (profile.dropFigure) {
    next = stripSection(next, 'Figure');
  }

  if (profile.dropRisks) {
    next = stripSection(next, 'Risks and Mitigation');
  }

  if (profile.dropProjectGoal) {
    next = stripSection(next, 'Project Goal');
  }

  if (profile.dropMotivation) {
    next = stripSection(next, 'Motivation and Gap');
  }

  if (profile.abstractSentences) {
    next = trimAbstractSection(next, profile.abstractSentences);
  }

  if (profile.evaluationSentences) {
    next = compactSectionProse(next, 'Evaluation Plan', profile.evaluationSentences);
  }

  if (profile.compactEvaluation) {
    next = next.replace(
      /\\subsection\*\{Metrics and Benchmarks\}[\s\S]*?\\begin\{itemize\}[\s\S]*?\\end\{itemize\}/i,
      (block) => block.replace(/\\begin\{itemize\}[\s\S]*?\\end\{itemize\}/i, (list) => {
        const plain = list
          .replace(/\\begin\{itemize\}(\[[^\]]*\])?/i, '')
          .replace(/\\end\{itemize\}/i, '')
          .replace(/\\item\s*/g, ' ')
          .replace(/\\[a-zA-Z@*]+(\[[^\]]*\])?(\{[^}]*\})?/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        return plain ? `\n${plain}\n` : list;
      })
    );
  }

  if (profile.pages <= 1) {
    const milestoneSummary = truncateToSentences(clean(project.timeline || ''), 1);
    if (milestoneSummary) {
      next = replaceSectionBody(next, 'Expected Results and Research Milestones', milestoneSummary);
    }
    next = limitBibliographyItems(next, 1);
  }

  next = ensureMinimumResources(next, resourcesText, PROPOSAL_RESOURCES_MIN);

  if (profile.tightenSpacing) {
    next = injectTightSpacingPreamble(next);
    next = injectCompactGeometry(next, profile.pages <= 1 ? '0.65in' : '0.85in');
    if (profile.pages <= 1) {
      next = injectSmallBodyFont(next, 'footnotesize');
    } else if (profile.pages <= 2) {
      next = injectSmallBodyFont(next, 'small');
    }
  }

  return next;
}

function tightenProposalLatex(latex, passIndex = 1, targetPages = PROPOSAL_PAGE_MAX) {
  let next = latex;

  if (passIndex >= 1) {
    next = stripPlainLanguageSummary(next);
    next = stripSection(next, 'Figure');
    next = limitEnumerateBlocks(next, Math.max(1, 5 - passIndex));
    next = capListItemsInSubsection(next, 'Expected Results', Math.max(1, 4 - passIndex));
    next = capListItemsInSubsection(next, 'Research Milestones and Timeline', Math.max(1, 6 - passIndex));
    next = limitBibliographyItems(next, Math.max(1, 5 - passIndex));

    if (targetPages <= 1) {
      next = stripSection(next, 'Project Goal');
      next = stripSection(next, 'Risks and Mitigation');
      next = injectSmallBodyFont(next);
    }
  }

  if (passIndex >= 2) {
    if (targetPages <= 3) {
      next = stripSection(next, 'Risks and Mitigation');
    }
    const motivation = latex.match(
      /\\section\*?\{Motivation and Gap\}([\s\S]*?)(?=\\section\*?\{|\\section\{|\\end\{document\})/i
    )?.[1];
    if (motivation) {
      const shortened = truncateToSentences(
        stripLatexMarkup(motivation),
        Math.max(1, 4 - passIndex)
      );
      next = replaceSectionBody(next, 'Motivation and Gap', shortened);
    }
    next = compactSectionProse(next, 'Evaluation Plan', Math.max(1, 5 - passIndex));
  }

  if (passIndex >= 3) {
    next = injectTightSpacingPreamble(next);
    next = injectCompactGeometry(next);
    next = capResourcesSection(next, getResourceItemCap(Math.max(PROPOSAL_RESOURCES_MIN, 4 - passIndex)));
  }

  if (passIndex >= 4) {
    next = injectSmallBodyFont(next);
    next = compactSectionProse(next, 'Expected Results and Research Milestones', targetPages <= 1 ? 1 : 2);
  }

  if (passIndex >= 5) {
    next = stripSection(next, 'Project Goal');
    next = limitBibliographyItems(next, targetPages <= 1 ? 1 : 2);
    if (targetPages <= 1) {
      next = trimAbstractSection(next, 1);
      next = compactSectionProse(next, 'Method and Training Workflow', 1);
    }
  }

  if (passIndex >= 6 && targetPages <= 1) {
    next = stripSection(next, 'Motivation and Gap');
    next = injectCompactGeometry(next, '0.6in');
    next = injectSmallBodyFont(next, 'footnotesize');
  }

  if (passIndex >= 7 && targetPages <= 1) {
    next = compactSectionProse(next, 'Evaluation Plan', 1);
    next = replaceSectionBody(next, 'Expected Results and Research Milestones', '');
  }

  return next;
}

function stripLatexMarkup(text) {
  return clean(
    String(text || '')
      .replace(/\\cite[tp]?\{[^}]*\}/g, ' ')
      .replace(/\\[a-zA-Z@*]+(\[[^\]]*\])?(\{[^}]*\})?/g, ' ')
  );
}

function trimResourcesText(value) {
  return String(value ?? '').trim();
}

export async function enforceProposalPageBudget(latex, project = {}, options = {}) {
  const targetPages = normalizeProposalPageTarget(project.proposalPageTarget);
  const title = project.title || project.topic || 'proposal';
  const author = options.author || PROPOSAL_AUTHOR;
  const resourcesText = trimResourcesText(options.resourcesText) || trimResourcesText(project.resources);
  const lengthOptions = { resourcesText };

  let current = applyProposalLengthProfile(latex, project, targetPages, lengthOptions);
  let pageCount = 0;
  let compilerUnavailable = false;
  const attempts = [];

  for (let pass = 0; pass < (targetPages <= 1 ? 8 : 6); pass += 1) {
    const document = prepareLatexDocument(current, title, { author });
    const compile = await compileLatexDocument(document);

    if (!compile.ok) {
      if (compile.compilerUnavailable) {
        compilerUnavailable = true;
      }
      attempts.push({ pass, error: compile.error || 'compile failed' });
      break;
    }

    pageCount = compile.pageCount || countPdfPages(compile.pdf, { pageCount: compile.pageCount });
    attempts.push({ pass, pageCount });

    if (pageCount > 0 && pageCount <= targetPages) {
      break;
    }

    current = tightenProposalLatex(current, pass + 1, targetPages);
  }

  current = ensureMinimumResources(current, resourcesText, PROPOSAL_RESOURCES_MIN);

  const finalCompile = await compileLatexDocument(prepareLatexDocument(current, title, { author }));
  if (finalCompile.ok) {
    pageCount = finalCompile.pageCount || countPdfPages(finalCompile.pdf, { pageCount: finalCompile.pageCount });
    attempts.push({ pass: 'resources-floor', pageCount });
  } else if (finalCompile.compilerUnavailable) {
    compilerUnavailable = true;
  } else {
    attempts.push({ pass: 'resources-floor', error: finalCompile.error || 'compile failed' });
  }

  return {
    latex: current,
    targetPages,
    pageCount,
    withinLimit: pageCount > 0 && pageCount <= PROPOSAL_PAGE_MAX && pageCount <= targetPages,
    compilerUnavailable,
    attempts
  };
}

export function formatPageLengthNote(result = {}) {
  if (result.compilerUnavailable) {
    return '- Page length could not be verified because the PDF compiler was unavailable.';
  }

  if (!result.pageCount) {
    return '- Page length verification did not produce a page count.';
  }

  const status = result.withinLimit ? 'within target' : 'above target after trimming';
  const resourceItems = countResourceItemsInLatex(result.latex);
  const resourceNote =
    resourceItems >= PROPOSAL_RESOURCES_MIN
      ? `- Resources: ${resourceItems} item(s) retained (minimum ${PROPOSAL_RESOURCES_MIN} when available).`
      : `- Resources: ${resourceItems} item(s) retained (fewer than ${PROPOSAL_RESOURCES_MIN} listed in project state).`;
  return `- Proposal length: ${result.pageCount} page(s) compiled (${status}; selected target ${result.targetPages}, maximum ${PROPOSAL_PAGE_MAX}).\n${resourceNote}`;
}
