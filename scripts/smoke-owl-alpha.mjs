const base = 'http://127.0.0.1:8787';

const configRes = await fetch(`${base}/api/llm-config`);
const config = await configRes.json();
console.log('configured', config.configured, 'default', config.defaultModel, 'available', config.availableModels);

if (!config.configured) {
  console.error('FAIL: LLM not configured on server (.env not loaded?)');
  process.exit(1);
}

const model = config.defaultModel || 'openrouter/owl-alpha';
const payload = {
  topic: 'Quick Owl Alpha connectivity test',
  llmModel: model
};

console.log(`POST /api/agent/start with llmModel=${model} ...`);
const t0 = Date.now();
const res = await fetch(`${base}/api/agent/start`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
});
const data = await res.json();
const ms = Date.now() - t0;

console.log('status', res.status, `(${ms}ms)`);

if (!res.ok) {
  console.error('FAIL:', data.error || data.detail || data);
  process.exit(1);
}

const suggestions = data.fieldSuggestions?.length ?? 0;
const questions = data.questions?.length ?? 0;
console.log('mode', data.mode, 'provider', data.provider, 'suggestions', suggestions, 'questions', questions);

if (data.mode !== 'api') {
  console.error('FAIL: expected api mode, got', data.mode);
  process.exit(1);
}

if (!suggestions && !questions) {
  console.error('FAIL: empty response from model');
  process.exit(1);
}

console.log('OK: Owl Alpha responded successfully.');
