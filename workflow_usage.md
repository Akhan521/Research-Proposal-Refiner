# Workflow Usage Report

**Author:** Aamir Khan  
**Project:** Process-Based Reinforcement Learning with Step-Level Rewards for Mathematical Reasoning in Language Models

This document describes how the Research Proposal Refiner agent was used to produce, critique, and revise the final proposal (`deliverables/proposal.pdf` / `deliverables/proposal.tex`).

## Initial idea

Train language models for multi-step math reasoning using **dense process-level rewards** rather than sparse outcome-only RL signals. The workflow should combine **GRPO** for stable policy updates, a **process reward model** for step-level feedback, and **MCTS** for reasoning-path exploration at inference time.

## Workflow run summary

| Step | What happened | Artifact or evidence |
| --- | --- | --- |
| Literature intake | Searched Semantic Scholar / OpenAlex / arXiv for PRMs, process supervision, and math-reasoning RL papers; selected top sources for related work | `evidence/literature-search.png`, `evidence/literature-summary.png` |
| Clarifying questions | Agent asked about benchmarks, baselines, and evaluation metrics; answers updated project state | Agent Q&A tab transcripts |
| Field refinement | Used per-field **Strengthen with AI** on problem, method, evaluation, and timeline | Revised project fields before export |
| Literature synthesis | Selected papers fed into related-work paragraph for motivation | Motivation section in `deliverables/proposal.tex` |
| Draft generation | **Generate proposal** produced LaTeX draft + compliance matrix + evaluation report | `deliverables/proposal.tex` first pass |
| Critique | Compliance matrix flagged missing sections; evaluation report noted redundancy and citation issues | `evidence/compliance-matrix.png`, `evidence/compliance-matrix-continued.png` |
| Revision loop | Regenerated weak sections, limited references to top 5, fixed diagram labels and abstract formatting | Git history; `server/` enforcement pipeline |
| Export | **Download PDF** compiled final LaTeX through Tectonic with structural repair | `evidence/output-run-log-pdf-preview.png`, `deliverables/proposal.pdf` |

## Accepted and rejected suggestions

| Suggestion or decision | Accepted / rejected / edited | Reason |
| --- | --- | --- |
| Outcome-only PPO as main method | Rejected | Chose GRPO + process rewards for stability and finer credit assignment |
| More than five references in proposal | Rejected | Capped at five sources to keep the PDF focused and avoid citation noise |
| Generic workflow diagram steps | Rejected | Enforced grounded diagram from method text (GRPO, MCTS, PRM) |
| LLM-as-judge for step scoring | Accepted with edit | Kept as augmentation to PRM, not a replacement for human-annotated labels |
| Competition benchmarks (AMC, AIME) | Accepted | Added to evaluation plan for generalization beyond GSM8K/MATH |

## Revision evidence

**Weakness found:** Early PDF exports showed truncated workflow diagram labels (`...`), broken evaluation bullets (e.g. split at `e.g.`), and visible `{` / `Abstract}` braces from LaTeX repair.

**Changes made:**

- Diagram inference now uses phrase-based condensation instead of 26-character truncation.
- Sentence splitting respects abbreviations like `e.g.` and `i.e.`
- LaTeX parser correctly handles `\section*{Abstract}` during repair.

**Evidence of improvement:** Verification scripts (`scripts/verify-diagram-layout.mjs`, `scripts/verify-proposal-sections.mjs`, `scripts/verify-abstract-format.mjs`) pass; regenerated `deliverables/proposal.pdf` renders a complete diagram and abstract heading.

## Traceability

| Proposal section | Workflow step or state field | Notes |
| --- | --- | --- |
| Abstract | `problem` + `method` + `evaluation` → `buildNsfStyleAbstract()` | Rebuilt at export from project fields |
| Motivation / gap | Literature synthesis + `problem` field | Prior work woven from selected papers |
| Project goal | `method` + evaluation RQ1 | Template-enforced in export |
| Method | `method` field + diagram enforcement | Figure rebuilt from GRPO/MCTS/PRM phrases |
| Figure | `inferWorkflowWithSource()` | Top-down vertical workflow diagram |
| Evaluation | `evaluation` field → `buildEvaluationLatexSection()` | NSF-style subsections |
| Milestones | `timeline` field | Parsed into enumerated milestones |
| Risks | Method + evaluation ablations | Local template + field content |
| References | `references` field (max 5) | Rebuilt bibliography at export |

## Reflection

- **What worked well:** Separating *project state* from *export enforcement* made revision loops predictable—the UI edits fields, the server normalizes LaTeX on every PDF export.
- **What needed human judgment:** Choosing which papers to cite, tightening the research question, and deciding which automated evaluation warnings to fix vs. accept.
- **Future improvements:** Interactive diff view for section-level regenerations and automatic page-count guardrails before PDF export.
