# API Usage

## Local Fallback

The app runs without any external key. In that mode the server returns fallback clarifying questions, performs simple answer integration, and generates a template-based proposal, compliance matrix, and evaluation report.

## External API

Copy `.env.example` to `.env` and set:

```bash
LLM_PROVIDER=gemini
LLM_API_URL=https://generativelanguage.googleapis.com/v1beta
LLM_API_KEY=your_key_here
LLM_MODEL=gemini-2.5-flash
```

For an OpenAI-compatible chat completions endpoint, use:

```bash
LLM_PROVIDER=openai-compatible
LLM_API_URL=https://api.openai.com/v1/chat/completions
LLM_API_KEY=your_key_here
LLM_MODEL=your_model_here
```

### OpenRouter and Owl Alpha

Create an API key at [openrouter.ai](https://openrouter.ai/), copy `.env.example` to `.env`, and set:

```bash
LLM_PROVIDER=openai-compatible
LLM_API_URL=https://openrouter.ai/api/v1/chat/completions
LLM_API_KEY=sk-or-v1-your_key_here
LLM_MODEL=openrouter/owl-alpha
```

Restart the API server (`npm run dev` or `npm run dev:api`) after editing `.env`.

The sidebar **AI model** dropdown lists only models from your server config: `LLM_MODEL` (default) plus any extras in `LLM_ALLOWED_MODELS` (comma-separated). The UI does not show paid or unconfigured presets. The selected value is sent as `llmModel` on each API call.

Optional OpenRouter attribution headers:

```bash
OPENROUTER_HTTP_REFERER=http://127.0.0.1:5174
OPENROUTER_APP_TITLE=Research Proposal Agent
```

API keys stay on the server and are not sent to the browser.

## API Endpoints

- `POST /api/literature`: topic/problem in, retrieved papers and optional related-work paragraph out. Sources: `auto`, `semantic_scholar`, `openalex`, `arxiv`. If a source is rate-limited, the server falls back automatically (OpenAlex is the default for `auto`). Set `LITERATURE_SKIP_ENRICH=1` to skip Gemini ranking when quota is low; papers are still returned.
- `POST /api/explain`: project/proposal in, plain-language explanation at a chosen reading level out.
- `POST /api/agent/start`: rough topic in, project state and questions out.
- `POST /api/agent/answer`: current state plus student answer in, updated state and next questions out.
- `POST /api/proposal`: refined state in, `proposalLatex` and review artifacts out.
- `POST /api/export/pdf`: `proposalLatex` in, compiled `proposal.pdf` out.

## Logged Data

Each response includes a `transcript` object with:

- structured prompt payload
- raw model response or fallback note

For a real submission, save relevant transcripts separately and remove private data.
