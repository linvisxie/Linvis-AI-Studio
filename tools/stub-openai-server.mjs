#!/usr/bin/env node
/**
 * 最小 OpenAI 兼容 stub 服务（支持 SSE 流式），仅用于验证 Pi 启动与 Skill 发现。
 * 不产生任何真实推理，不联网，不消耗任何额度。
 *
 * 用法: node tools/stub-openai-server.mjs [port]
 */
import http from 'node:http';

const port = Number(process.argv[2] ?? 8799);
const MODEL = 'linvis-stub';

function sseChunk(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

const srv = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    if (req.url?.includes('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: MODEL, object: 'model' }] }));
      return;
    }

    let streaming = false;
    try { streaming = JSON.parse(body || '{}').stream === true; } catch { /* ignore */ }

    const id = 'chatcmpl-stub-' + Date.now();
    const created = Math.floor(Date.now() / 1000);
    const text = 'OK';

    if (!streaming) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id, object: 'chat.completion', created, model: MODEL,
        choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
      }));
      return;
    }

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });

    const base = { id, object: 'chat.completion.chunk', created, model: MODEL };

    res.write(sseChunk({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] }));
    for (const ch of text) {
      res.write(sseChunk({ ...base, choices: [{ index: 0, delta: { content: ch }, finish_reason: null }] }));
    }
    res.write(sseChunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));
    res.write(sseChunk({ ...base, choices: [], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } }));
    res.write('data: [DONE]\n\n');
    res.end();
  });
});

srv.listen(port, '127.0.0.1', () => {
  console.log(`stub OpenAI server (SSE) on http://127.0.0.1:${port}`);
});
