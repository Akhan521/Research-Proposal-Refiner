# Research Proposal Refiner

A full-stack **research proposal agent** that helps you move from a rough idea to a structured NSF-style proposal PDF. The app collects your research context, retrieves relevant literature, asks clarifying questions, drafts LaTeX, scores coverage with a compliance matrix, critiques weak sections, and exports a compiled PDF.

**Final proposal topic:** Process-based reinforcement learning with step-level rewards for mathematical reasoning in language models (GRPO, process reward models, and MCTS-guided search).

## What this project does

| Capability | Description |
| --- | --- |
| **Literature search** | Retrieves papers from Semantic Scholar, OpenAlex, and arXiv; synthesizes related work from your selections |
| **Agent intake** | Asks structured questions and merges your answers into a shared project state |
| **Field refinement** | AI-assisted rewriting per field (problem, method, evaluation, timeline, resources) |
| **Proposal generation** | Produces LaTeX with required sections, citations, workflow diagram, and milestones |
| **Quality checks** | Compliance matrix, redundancy scan, milestone–RQ mapping, evaluation report |
| **Explain** | Plain-language summary at an adjustable reading level |
| **PDF export** | Server-side LaTeX compile with enforcement, repair, and validation |

The server **rebuilds critical sections at export time** (abstract, milestones, evaluation plan, diagram, bibliography) from your project fields so the PDF stays aligned with your latest edits.

## Quick links

| Artifact | Path |
| --- | --- |
| Final proposal (PDF) | [deliverables/proposal.pdf](deliverables/proposal.pdf) |
| LaTeX source | [deliverables/proposal.tex](deliverables/proposal.tex) |
| Workflow usage report | [workflow_usage.md](workflow_usage.md) |
| AI usage log | [AI_USAGE.md](AI_USAGE.md) |
| Evidence folder | [evidence/](evidence/) |
| Submission index | [deliverables/README.md](deliverables/README.md) |
| Stage 2 checklist | [docs/SUBMISSION_CHECKLIST.md](docs/SUBMISSION_CHECKLIST.md) |
| API setup details | [docs/API_USAGE.md](docs/API_USAGE.md) |

## Requirements

- **Node.js** 20.19+ or 22.12+ (see `.nvmrc`)
- **npm** 9+
- Optional: **OpenRouter API key** for cloud LLM generation (local fallback works without a key)

## Setup

```bash
git clone https://github.com/Akhan521/Research-Proposal-Refiner.git
cd Research-Proposal-Refiner   # or your fork path
npm install
```

### Configure the LLM (recommended: OpenRouter)

1. Copy the environment template:

   ```bash
   cp .env.example .env
   ```

2. Create an API key at [openrouter.ai](https://openrouter.ai/).

3. Edit `.env`:

   ```bash
   PORT=8787
   LLM_PROVIDER=openai-compatible
   LLM_API_URL=https://openrouter.ai/api/v1/chat/completions
   LLM_API_KEY=sk-or-v1-your_key_here
   LLM_MODEL=openrouter/owl-alpha

   # Optional: extra models in the sidebar dropdown (comma-separated)
   # LLM_ALLOWED_MODELS=openrouter/owl-alpha,anthropic/claude-sonnet-4

   # Optional OpenRouter attribution
   OPENROUTER_HTTP_REFERER=http://127.0.0.1:5174
   OPENROUTER_APP_TITLE=Research Proposal Agent
   ```

4. **Never commit `.env`.** Keys stay on the server only.

### Local fallback (no API key)

If `LLM_API_KEY` or `LLM_API_URL` is missing, the app still runs with deterministic template-based questions, proposal text, and reports. Cloud models are required for the full agentic experience.

### Optional: Semantic Scholar

For higher literature rate limits, set `SEMANTIC_SCHOLAR_API_KEY` in `.env`. Set `LITERATURE_SKIP_ENRICH=1` to skip LLM ranking when quota is low.

## Run

Start the API and web UI together:

```bash
npm run dev
```

| Service | URL |
| --- | --- |
| Web UI | http://127.0.0.1:5174 |
| API | http://127.0.0.1:8787 |

Run only the API or only the frontend:

```bash
npm run dev:api   # Express on port 8787
npm run dev:web   # Vite on port 5174
```

Production-style API only:

```bash
npm start
```

After changing `.env`, restart the dev server.

## Typical workflow

1. **Literature** — search topic; select papers; copy synthesis into motivation or Sources.
2. **Project** — fill problem, method, evaluation, timeline, resources, references.
3. **Agent** — answer clarifying questions; merge suggestions into project state.
4. **Strengthen** — refine individual fields with AI guidance.
5. **Output** — generate proposal; read compliance matrix and evaluation report.
6. **Revise** — update fields; regenerate until reports are clean.
7. **Export** — download PDF (`proposal.tex` is enforced server-side before compile).

Document your run in [workflow_usage.md](workflow_usage.md) and [AI_USAGE.md](AI_USAGE.md). Add screenshots to [evidence/](evidence/).

## Repository layout

```text
.
├── deliverables/             # Final proposal.pdf, proposal.tex
├── workflow_usage.md         # How the agent workflow was used
├── AI_USAGE.md               # Tools, models, human review
├── evidence/                 # Screenshots and workflow trace
├── src/                      # React frontend (App.jsx)
├── server/                   # Express API and LaTeX pipeline
│   ├── proposalGenerator.js  # Generation + export enforcement
│   ├── proposalSections.js   # Abstract, milestones, evaluation
│   ├── latexDiagram.js       # Workflow figure generation
│   ├── citationEnforce.js    # Citations and bibliography
│   └── pdfExport.js          # PDF compile (Tectonic)
├── shared/mathlmDefaults.js  # Default project fields
├── scripts/                  # Verification and smoke tests
└── docs/                     # Requirements, rubric, API notes
```

## Verification scripts

```bash
node scripts/verify-proposal-sections.mjs
node scripts/verify-diagram-layout.mjs
node scripts/verify-abstract-format.mjs
node scripts/verify-latex-compile.mjs
node scripts/smoke-proposal.mjs
```

## Course submission (Stage 2 — merged final)

Stage 2 and the final proposal are submitted together. See [docs/SUBMISSION_CHECKLIST.md](docs/SUBMISSION_CHECKLIST.md) for the full mapping to Canvas expectations.

**Submit the repository** (or a zip) with:

- Full source code (`src/`, `server/`, etc.)
- `deliverables/proposal.pdf` and `deliverables/proposal.tex`
- `workflow_usage.md` and `AI_USAGE.md`
- Evidence in `evidence/` (screenshots recommended)

**Exclude:** `node_modules/`, `.env`, secrets, and API keys.

## Author

Aamir Khan — CS 222 Spring Final Project
