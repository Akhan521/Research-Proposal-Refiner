# Submission artifacts

Quick index for graders and reviewers. Final proposal artifacts live in this folder.

| File | Description |
| --- | --- |
| [proposal.pdf](proposal.pdf) | Final research proposal (PDF export) |
| [proposal.tex](proposal.tex) | LaTeX source used to produce the PDF |
| [workflow_usage.md](../workflow_usage.md) | How the agent workflow was used to draft and revise the proposal |
| [AI_USAGE.md](../AI_USAGE.md) | Tools, models, prompts, and human review log |
| [evidence/](../evidence/) | Screenshots, run notes, and workflow trace |

## Application source

| Path | Role |
| --- | --- |
| `src/App.jsx` | React UI: literature, agent intake, proposal output, explain tab |
| `server/proposalGenerator.js` | Proposal generation, LaTeX enforcement, export pipeline |
| `server/latexDiagram.js` | Workflow diagram generation |
| `server/proposalSections.js` | Abstract, milestones, evaluation section builders |
| `server/literature.js` | Paper retrieval and related-work synthesis |
| `docs/API_USAGE.md` | API keys, OpenRouter setup, endpoints |
