# AI Usage Log

**Author:** Aamir Khan

## Tools used

- **Cursor** — primary IDE and vibe-coding environment for the agent app and server pipeline
- **OpenRouter** — hosted LLM API for proposal generation, field refinement, and literature enrichment
- **Research Proposal Refiner app** — custom Node/React agent built for this project

## Models or APIs

| Setting | Value |
| --- | --- |
| Provider | OpenRouter (`LLM_PROVIDER=openai-compatible`) |
| Endpoint | `https://openrouter.ai/api/v1/chat/completions` |
| Model | `openrouter/owl-alpha` (configurable via `LLM_MODEL`) |
| Local fallback | Yes — deterministic templates when `.env` keys are absent |

API keys are stored only in `.env` (gitignored). They are read by the Express server, never sent to the browser.

## What AI helped with

| Area | How |
| --- | --- |
| Planning | Structured proposal sections, milestone format, evaluation subsections |
| Coding | React UI, LaTeX enforcement pipeline, diagram generation, citation validation |
| Debugging | LaTeX compile failures, truncated labels, abstract brace rendering |
| Writing proposal | Draft paragraphs for motivation, method, and evaluation from project fields |
| Evaluating proposal | Compliance matrix, redundancy report, milestone–RQ mapping |

## Key prompts or request payloads

Proposal generation uses a structured system prompt requiring NSF-style sections, natbib citations, workflow figures, and export-time rebuilding. Example payload shape:

```json
{
  "project": {
    "title": "...",
    "problem": "...",
    "method": "...",
    "evaluation": "...",
    "timeline": "...",
    "resources": "...",
    "references": "..."
  },
  "checklist": ["Abstract", "Method", "Figure", "Evaluation", "..."],
  "citationKeys": [{ "key": "...", "title": "..." }]
}
```

Field refinement sends the current field text plus optional guidance (for example “add GRPO and MCTS details”).

## Workflow calls

| Stage | Tool / model | Input summary | Output summary | Human decision |
| --- | --- | --- | --- | --- |
| Literature | Owl Alpha + OpenAlex | Math reasoning RL topic | Ranked paper list | Selected top 5 for Sources |
| Agent intake | Owl Alpha | Rough topic | Clarifying questions | Answered in UI |
| Proposal draft | Owl Alpha | Full project state | LaTeX + reports | Reviewed compliance matrix |
| Field refine | Owl Alpha | Evaluation field | Expanded metrics/baselines | Accepted with edits |
| Explain tab | Owl Alpha | Proposal at reading level 6 | Plain-language summary | Used for lay abstract |
| Export | Local pipeline | `proposalLatex` | `proposal.pdf` | Verified PDF visually |

## Human review

- **Code changes:** Reviewed all server enforcement modules; ran verify scripts before commit.
- **Proposal claims:** Checked that GRPO/MCTS/PRM claims match cited literature; marked unsupported numeric targets as targets, not results.
- **Figure quality:** Confirmed diagram shows GRPO, MCTS, and process reward model—not generic placeholders.
- **Evaluation scores:** Read automated evaluation report; fixed fragmented bullets and reference cap.
- **Security:** Confirmed `.env` and `node_modules/` are gitignored; no keys in `deliverables/proposal.tex` or transcripts.

## Failures and fixes

| Issue | What happened | How I fixed it |
| --- | --- | --- |
| Truncated diagram labels | Nodes showed `...` mid-phrase | Raised label limits; phrase-based condensation in `latexDiagram.js` |
| `e.g.` split across bullets | Evaluation list broke at periods | Abbreviation-aware `splitSentences()` in `textSegmentation.js` |
| Visible `{` and `Abstract}` in PDF | `\section*{Abstract}` braces escaped by repair | Fixed starred-command parsing in `latexValidate.js` |
| Too many references | PDF quality degraded | Capped Sources at five in export pipeline |

## Final ownership statement

I reviewed the generated code and proposal artifacts. I am responsible for the final submission.
