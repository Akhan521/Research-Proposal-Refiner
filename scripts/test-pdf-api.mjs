const latex = String.raw`\documentclass[11pt]{article}
\usepackage[margin=1in]{geometry}
\begin{document}
Hello from API
\end{document}`;

const res = await fetch('http://127.0.0.1:8787/api/export/pdf', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'Test', proposalLatex: latex })
});

console.log('status', res.status, res.headers.get('content-type'));
if (!res.ok) {
  console.error(await res.json());
  process.exit(1);
}
console.log('bytes', (await res.arrayBuffer()).byteLength);
