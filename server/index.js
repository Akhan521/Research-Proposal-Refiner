import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { explainProposal } from './explain.js';
import { searchLiterature } from './literature.js';
import { proposalLatexToPdf } from './pdfExport.js';
import {
  answerAgentQuestion,
  generateProposal,
  getLlmPublicConfig,
  refineAgentStructure,
  startAgentSession
} from './proposalGenerator.js';

const app = express();
const port = Number(process.env.PORT || 8787);

app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_request, response) => {
  const llm = getLlmPublicConfig();

  response.json({
    ok: true,
    mode: llm.configured ? 'api-ready' : 'local-fallback',
    llm
  });
});

app.get('/api/llm-config', (_request, response) => {
  response.json(getLlmPublicConfig());
});

app.post('/api/agent/start', async (request, response) => {
  try {
    const payload = request.body || {};

    if (!String(payload.topic || '').trim()) {
      response.status(400).json({ error: 'Topic is required.' });
      return;
    }

    response.json(await startAgentSession(payload));
  } catch (error) {
    response.status(500).json({
      error: 'Agent start failed.',
      detail: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post('/api/agent/answer', async (request, response) => {
  try {
    const payload = request.body || {};

    if (!String(payload.answer || '').trim()) {
      response.status(400).json({ error: 'Answer is required.' });
      return;
    }

    response.json(await answerAgentQuestion(payload));
  } catch (error) {
    response.status(500).json({
      error: 'Answer integration failed.',
      detail: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post('/api/agent/refine-structure', async (request, response) => {
  try {
    const payload = request.body || {};
    const project = payload.project || {};
    const topic = String(project.topic || project.title || payload.topic || '').trim();

    if (!topic) {
      response.status(400).json({ error: 'Project topic or title is required.' });
      return;
    }

    response.json(await refineAgentStructure(payload));
  } catch (error) {
    response.status(500).json({
      error: 'Structure refinement failed.',
      detail: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post('/api/proposal', async (request, response) => {
  try {
    const payload = request.body || {};

    if (!String(payload.topic || '').trim()) {
      response.status(400).json({ error: 'Topic is required.' });
      return;
    }

    const result = await generateProposal(payload);
    response.json(result);
  } catch (error) {
    response.status(500).json({
      error: 'Proposal generation failed.',
      detail: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post('/api/literature', async (request, response) => {
  try {
    const payload = request.body || {};
    const topic = String(payload.topic || payload.project?.topic || payload.project?.title || '').trim();

    if (!topic && !String(payload.problem || payload.project?.problem || '').trim()) {
      response.status(400).json({ error: 'Topic or problem text is required for literature search.' });
      return;
    }

    response.json(
      await searchLiterature({
        topic,
        problem: payload.problem || payload.project?.problem,
        source: payload.source,
        limit: payload.limit,
        llmModel: payload.llmModel
      })
    );
  } catch (error) {
    response.status(500).json({
      error: 'Literature search failed.',
      detail: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post('/api/explain', async (request, response) => {
  try {
    const payload = request.body || {};
    const project = payload.project || {};

    if (!String(project.title || project.topic || '').trim() && !String(payload.proposalLatex || '').trim()) {
      response.status(400).json({ error: 'A project (with a topic/title) or proposalLatex is required.' });
      return;
    }

    response.json(
      await explainProposal({
        project,
        proposalLatex: payload.proposalLatex,
        level: payload.level,
        llmModel: payload.llmModel
      })
    );
  } catch (error) {
    response.status(500).json({
      error: 'Explanation failed.',
      detail: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post('/api/export/pdf', async (request, response) => {
  try {
    const payload = request.body || {};
    const latex = String(payload.proposalLatex || '').trim();

    if (!latex) {
      response.status(400).json({ error: 'proposalLatex is required.' });
      return;
    }

    const title = String(payload.title || 'proposal').trim();
    const pdf = await proposalLatexToPdf(latex, title);

    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', 'attachment; filename="proposal.pdf"');
    response.send(pdf);
  } catch (error) {
    response.status(500).json({
      error: 'PDF export failed.',
      detail: error instanceof Error ? error.message : String(error)
    });
  }
});

app.listen(port, () => {
  console.log(`Proposal API listening on http://127.0.0.1:${port}`);
});
