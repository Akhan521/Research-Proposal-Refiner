# Three-Stage Final Project: Research Proposal Agent

## Goal

Build and evaluate a research proposal workflow. The project is not just about producing one polished PDF. It asks you to show that you understand how strong proposals are written, how an agent can support that process, and how the final proposal can be evaluated.

You will complete the final project in three stages:

1. **Stage 1: Initial Agent + Workflow Design**
   - Build an initial agent or prototype through vibe coding.
   - Research proposal-writing guides, examples, and agent workflow patterns.
   - Submit a 5-minute presentation video of your workflow design.
   - Attend the mandatory in-person presentation session to show your motivation, idea, and goal.
   - A polished proposal is not required in this stage.

2. **Stage 2: Refined Agent + Workflow Usage**
   - Refine the Stage 1 agent or workflow.
   - Show how the agent/workflow is used to generate, revise, and evaluate proposal content.
   - Submit usage evidence such as logs, transcripts, screenshots, and review artifacts.

3. **Stage 3: Final Proposal**
   - Submit the final `proposal.pdf`.
   - The proposal is graded separately for research proposal quality.
   - The proposal should not be framed as a short course implementation report; the course deadline and the proposed research timeline are separate.

If you use vibe coding only to directly produce a proposal, you can receive Stage 3 proposal credit. However, Stage 2 credit requires evidence that your own workflow or agent guided the proposal creation process.

## Deadlines And Submission Requirements

All deadlines use Pacific Time.

| Stage | Due Date | Submit | Notes |
| --- | --- | --- | --- |
| Stage 1: Initial Agent + Workflow Design | Friday, June 5, 2026, 11:59 PM | 5-minute presentation video, initial agent/prototype artifact, optional screenshots or interaction trace. | Stage 1 is graded from the video. The in-person presentation is mandatory but not separately graded; it is for showing motivation, ideas, goals, and peer feedback. Late submissions accepted until Sunday, June 7, 2026, 11:59 PM with a 20% penalty. |
| Stage 2: Refined Agent + Workflow Usage | Friday, June 12, 2026, 11:59 PM | Refined agent/workflow, `workflow_usage.md`, run evidence, `AI_USAGE.md`. | Late submissions accepted until Sunday, June 14, 2026, 11:59 PM with a 20% penalty. |
| Stage 3: Final Proposal | Friday, June 12, 2026, 11:59 PM | `proposal.pdf`, proposal source, references or source notes, figure/diagram source if applicable. | Late submissions accepted until Sunday, June 14, 2026, 11:59 PM with a 20% penalty. |

## Optional Starter App

This repository includes a small starter app to illustrate one possible proposal-agent workflow. It is optional: you may use it, replace it, or ignore it.

Example starter screens:

![Starter app workflow screen](docs/assets/starter-app-workflow.png)

![Starter app proposal preview screen](docs/assets/starter-app-proposal-preview.png)

To run the starter:

```bash
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:5174
```

We encourage students to start with the [Gemini API free tier](https://ai.google.dev/gemini-api/docs/pricing). If the free tier is not enough for your project, email the TA at <yfu093@ucr.edu> to request additional API access. Keep all API keys out of GitHub and document your setup.

## Resources

Vibe coding tools:

- [Cursor](https://cursor.com/en/students). Students can apply for a student account with their `.edu` email; contact Cursor through the official student page if you need help with the application.
- [GitHub Copilot](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/enable-copilot/set-up-for-students)
- [Google Gemini API](https://ai.google.dev/gemini-api/docs/pricing)
- [Google Gemini Code Assist](https://developers.google.com/gemini-code-assist/resources/faqs)
- [Claude / Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview)
- [Windsurf](https://windsurf.com/windsurf/students)
- [Cline](https://docs.cline.bot/introduction/overview) / [Roo Code](https://roocode.com/)
- [ChatGPT](https://chatgpt.com/)
- [v0 by Vercel](https://v0.dev/)

Tool availability, student plans, and free tiers can change. Check the official pages before relying on a specific plan.

Proposal-agent inspiration:

- [Civio](https://www.civio.ai/) shows how proposal and compliance workflows can become real products. A strong class project can be more than a demo; it can point toward a startup-style opportunity if it solves a real workflow pain.

## Stage 1 Deliverables

Stage 1 focuses on initial agent design and workflow thinking. A polished proposal is not required.

Submit:

- initial agent or prototype demo artifact;
- 5-minute presentation video or link;
- mandatory in-person presentation for demonstration and feedback;
- optional screenshots or interaction trace.

Details: [docs/stage_1_workflow_design.md](docs/stage_1_workflow_design.md)

## Stage 2 Deliverables

Stage 2 focuses on refined agent behavior and workflow usage evidence.

Submit:

- refined agent implementation or reproducible workflow artifact;
- `workflow_usage.md`;
- run transcript, screenshots, logs, or demo;
- `AI_USAGE.md`;

Details: [docs/stage_2_workflow_usage.md](docs/stage_2_workflow_usage.md)

## Stage 3 Deliverables

Stage 3 focuses on final proposal quality.

Submit:

- `proposal.pdf`;
- `proposal.tex` or equivalent proposal source;
- references or source notes;
- figure or diagram source if applicable.

Details: [docs/stage_3_final_proposal.md](docs/stage_3_final_proposal.md)

## Required Proposal Requirements

The final proposal requirements are in:

[docs/proposal_requirements.md](docs/proposal_requirements.md)

Detailed grading is in one file:

[docs/grading_rubric.md](docs/grading_rubric.md)

## Grading Overview

Total: 100 points.

Bonus: up to 5 subjective points for unusually impressive work.

| Stage | Points | What It Evaluates |
| --- | ---: | --- |
| Stage 1: Initial Agent + Workflow Design | 30 | Initial agent/prototype, vibe coding demo, proposal-writing research, workflow thinking, and presentation. |
| Stage 2: Refined Agent + Workflow Usage | 20 | Evidence that the refined agent/workflow was used to generate, revise, and evaluate proposal content. |
| Stage 3: Final Proposal | 50 | Quality of the submitted `proposal.pdf`, including format, figure, logic, novelty, method, evaluation, feasibility, and writing. |

Detailed grading: [docs/grading_rubric.md](docs/grading_rubric.md)

## Suggested Repo Layout

```text
.
├── README.md
├── workflow_usage.md
├── proposal.pdf
├── proposal.tex
├── AI_USAGE.md
├── evidence/
└── source-code-or-workflow/
```

## Bottom Line

Stage 1 asks: **What is your initial agent and proposal-writing workflow idea?**

Stage 2 asks: **Did you refine and actually use that agent/workflow to produce proposal artifacts?**

Stage 3 asks: **Is the final proposal itself strong?**
