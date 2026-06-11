# Workflow trace — final proposal

Narrative evidence for Stage 2 grading: the proposal was produced through the agent, not pasted from a one-shot chat.

## 1. Project state assembly

1. Entered research topic: process-based RL for mathematical reasoning.
2. Ran **Literature** search; retrieved papers on process supervision (Lightman et al.), Math-Shepherd, and GSM8K verifiers.
3. Selected papers for Sources; synthesis informed the motivation paragraph.
4. Completed **Agent** clarifying questions for problem, method, evaluation, and timeline.
5. Used **Strengthen with AI** on evaluation and method fields to add GRPO, MCTS, PRM, and benchmark details.

## 2. Draft and critique

1. Clicked **Generate proposal** → received `proposalLatex`, compliance matrix, and evaluation report.
2. Compliance matrix flagged section coverage; evaluation report noted redundant sentences and citation format.
3. Revised project fields based on report; regenerated export.

## 3. Export hardening (server-side)

The export pipeline enforces, on every PDF download:

- Abstract rebuilt from project fields (`\section*{Abstract}`)
- Milestones and expected results from `timeline`
- Evaluation plan with labeled subsections
- Workflow diagram grounded in `method` text
- Top-five reference cap and natbib bibliography
- LaTeX structural repair and compile validation

## 4. Revision loops documented in git

Representative commits on `main`:

- Workflow diagram grounding and vertical layout
- Reference limit and LaTeX compile hardening
- Evaluation completeness (`e.g.` splitting fix)
- Abstract brace rendering fix

## 5. Final artifacts

| Artifact | Path |
| --- | --- |
| PDF | `deliverables/proposal.pdf` |
| LaTeX source | `deliverables/proposal.tex` |
| Usage report | `workflow_usage.md` |
| AI log | `AI_USAGE.md` |

## Screenshots (in this folder)

1. `start-workflow.png` — entered rough idea; workflow stages visible
2. `structure-agent-decisions.png` — accepted GRPO + MCTS structure suggestions
3. `literature-search.png` — retrieved 8 papers from OpenAlex
4. `literature-summary.png` — inserted related-work summary into Problem & Sources
5. `project-problem-editor.png` — edited motivation/gap text in Project tab
6. `project-problem-ai-refine.png` — used Strengthen with AI on Problem field
7. `compliance-matrix.png` + `compliance-matrix-continued.png` — 12/12 coverage after draft
8. `explain-tab-lay-summary.png` — generated lay summary via Explain tab
9. `output-run-log-pdf-preview.png` — run log (Draft → Review → Export → Explain) and PDF preview
