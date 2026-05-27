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

API keys stay on the server and are not sent to the browser.

## API Endpoints

- `POST /api/agent/start`: rough topic in, project state and questions out.
- `POST /api/agent/answer`: current state plus student answer in, updated state and next questions out.
- `POST /api/proposal`: refined state in, `proposalLatex` and review artifacts out.
- `POST /api/export/pdf`: `proposalLatex` in, compiled `proposal.pdf` out.

## Logged Data

Each response includes a `transcript` object with:

- structured prompt payload
- raw model response or fallback note

For a real submission, save relevant transcripts separately and remove private data.
