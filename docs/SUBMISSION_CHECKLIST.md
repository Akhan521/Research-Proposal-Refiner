# Stage 2 submission checklist

**Due:** Friday, June 12, 2026, 11:59 PM Pacific (late until Sunday, June 14 with 20% penalty)

Stage 1 is complete separately. This checklist covers the **merged Stage 2 + final proposal** submission described on Canvas.

## Canvas expectations → repository files

| Requirement | Status | Location |
| --- | --- | --- |
| Full source code | ✅ | `src/`, `server/`, `shared/`, `package.json` |
| Exclude `node_modules/` | ✅ | Listed in `.gitignore` |
| Exclude secrets / API keys | ✅ | `.env` gitignored; keys server-side only |
| Refined agent implementation | ✅ | Full-stack app with literature, agent, export pipeline |
| Use agent to draft proposal | ✅ | Documented in `workflow_usage.md` |
| Use agent to critique / revise | ✅ | Compliance matrix, evaluation report, revision loops in `workflow_usage.md` |
| `workflow_usage.md` | ✅ | Repository root |
| Run evidence (logs, screenshots, demo) | ✅ | `evidence/*.png` + `evidence/workflow-trace.md` |
| `AI_USAGE.md` | ✅ | Repository root |
| `proposal.pdf` | ✅ | `deliverables/proposal.pdf` |
| `proposal.tex` (or equivalent source) | ✅ | `deliverables/proposal.tex` |
| Figure / diagram source | ✅ | Generated in export from `server/latexDiagram.js`; figure in `deliverables/proposal.tex` |
| References / source notes | ✅ | References section in `deliverables/proposal.tex`; Sources field in app |

## Stage 2 rubric alignment (20 pts)

| Criterion | Evidence |
| --- | --- |
| Refined workflow (5) | Literature selection, field refinement, export enforcement pipeline vs. starter template |
| Used workflow (5) | `workflow_usage.md`, `evidence/workflow-trace.md`, app screenshots |
| Iterative refinement (4) | Revision table in `workflow_usage.md`; git history |
| Evaluation / critique (4) | Compliance matrix + evaluation report in Output tab; server validation scripts |
| AI usage log (2) | `AI_USAGE.md` |

## Stage 3 proposal rubric alignment (50 pts)

| Criterion | Notes |
| --- | --- |
| Format | 11pt article class, 1in margins — see `deliverables/proposal.tex` preamble |
| Figure | Process-based RL workflow diagram in `deliverables/proposal.tex` Figure section |
| Motivation / gap | Sparse outcome rewards vs. process supervision |
| Novelty | GRPO + PRM + MCTS integration for math reasoning |
| Method | GRPO, PRM, LLM-as-judge, MCTS, curriculum |
| Evaluation | GSM8K, MATH, AMC/AIME; baselines and ablations |
| Feasibility | Milestones, risks, resources sections |
| Writing | Human-reviewed; see `AI_USAGE.md` |

## Before you zip or push

- [x] Screenshots in `evidence/` (literature, structure, compliance matrix, explain, output/PDF)
- [ ] Confirm `npm run dev` works on a clean clone with your `.env` locally (do not upload `.env`)
- [ ] Open `deliverables/proposal.pdf` and verify title, abstract, diagram, and references
- [ ] Run `node scripts/verify-latex-compile.mjs` if you changed the pipeline

## What not to submit

- `node_modules/`
- `.env` or any file containing API keys
- `dist/` build output (optional to exclude)
