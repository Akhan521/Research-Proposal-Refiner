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

**Screenshot placeholders:** add PNGs to this folder before submission (literature tab, output tab with compliance matrix, PDF preview).
