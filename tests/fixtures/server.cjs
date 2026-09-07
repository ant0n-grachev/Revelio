const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const filename = url.pathname === '/frame' ? 'frame.html' : 'index.html';
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(fs.readFileSync(path.join(__dirname, filename)));
});
server.listen(Number(process.env.PORT || 4179), '0.0.0.0');
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
