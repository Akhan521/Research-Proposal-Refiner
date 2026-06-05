const base = 'http://127.0.0.1:8787';

import { DEFAULT_PROJECT, DEFAULT_PROJECT_TOPIC } from '../shared/mathlmDefaults.js';

const payload = {
  topic: DEFAULT_PROJECT_TOPIC,
  title: DEFAULT_PROJECT.title,
  problem: DEFAULT_PROJECT.problem,
  method: DEFAULT_PROJECT.method,
  evaluation: DEFAULT_PROJECT.evaluation,
  timeline: DEFAULT_PROJECT.timeline,
  resources: DEFAULT_PROJECT.resources,
  references: DEFAULT_PROJECT.references,
  requirements: 'Title\nAbstract\nMethod\nEvaluation'
};

console.log('POST /api/proposal ...');
const t0 = Date.now();
const proposalRes = await fetch(`${base}/api/proposal`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
});
const proposalData = await proposalRes.json();
console.log('proposal status', proposalRes.status, `${Date.now() - t0}ms`);
if (!proposalRes.ok) {
  console.error(proposalData);
  process.exit(1);
}
console.log('mode', proposalData.mode, 'latex chars', proposalData.proposalLatex?.length || 0);

console.log('POST /api/export/pdf ...');
const t1 = Date.now();
const pdfRes = await fetch(`${base}/api/export/pdf`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: payload.title,
    proposalLatex: proposalData.proposalLatex
  })
});
console.log('pdf status', pdfRes.status, 'content-type', pdfRes.headers.get('content-type'), `${Date.now() - t1}ms`);
if (!pdfRes.ok) {
  const err = await pdfRes.json();
  console.error(err);
  process.exit(1);
}
const buf = await pdfRes.arrayBuffer();
console.log('pdf bytes', buf.byteLength);
console.log('OK');
