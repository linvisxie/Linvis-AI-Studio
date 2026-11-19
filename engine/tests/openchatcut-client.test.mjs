import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {McpClient} from '../adapters/openchatcut/client.mjs';

const SECRET = 'test-only-secret-never-use-a-real-token';
const json = (id, result, headers = {}) => new Response(JSON.stringify({jsonrpc: '2.0', id, result}), {
  headers: {'content-type': 'application/json', ...headers},
});

async function fixture(t, handler, options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'linvis-mcp-test-'));
  const tokenFile = path.join(dir, 'mcp-token');
  await writeFile(tokenFile, `${SECRET}\n`);
  t.after(() => rm(dir, {recursive: true, force: true}));
  const requests = [];
  const fetchImpl = async (url, init) => {
    const payload = init.body ? JSON.parse(init.body) : undefined;
    const request = {url, ...init, payload};
    requests.push(request);
    assert.equal(init.headers.Authorization, `Bearer ${SECRET}`);
    assert.equal(init.headers['x-openchatcut-mcp-client'], 'linvis');
    assert.equal(init.headers['x-openchatcut-mcp-surface'], 'external');
    assert.equal(init.redirect, 'manual');
    if (handler) {
      const response = await handler(request, requests);
      if (response !== undefined) return response;
    }
    if (init.method === 'DELETE') return new Response(null, {status: 204});
    if (payload.method === 'initialize') {
      assert.equal(init.headers['Mcp-Session-Id'], undefined);
      assert.equal(payload.params.protocolVersion, '2025-06-18');
      return json(payload.id, {protocolVersion: '2025-06-18'}, {'mcp-session-id': 'fixture-session'});
    }
    assert.equal(init.headers['Mcp-Session-Id'], 'fixture-session');
    if (payload.method === 'notifications/initialized') {
      assert.equal(payload.id, undefined);
      return new Response(null, {status: 202});
    }
    return json(payload.id, {structuredContent: {ok: true}});
  };
  const client = new McpClient({tokenFile, fetchImpl, ...options});
  t.after(() => client.close());
  return {client, requests, tokenFile, fetchImpl};
}

function safeError(error, code) {
  assert.equal(error.code, code);
  assert.ok(!error.message.includes(SECRET));
  assert.ok(!error.message.includes('Bearer'));
  assert.ok(!error.message.includes('remote-sensitive'));
  assert.equal(error.cause, undefined);
  return true;
}

test('JSON handshake, structured result, tool schema discovery and DELETE session', async t => {
  const tools = [{name: 'status', inputSchema: {type: 'object'}}];
  const {client, requests} = await fixture(t, request => {
    if (request.payload?.method === 'tools/list') return json(request.payload.id, {tools});
  });
  assert.deepEqual(await client.call('status', {brief: true}), {ok: true});
  assert.deepEqual(await client.listTools(), tools);
  assert.deepEqual(requests.slice(0, 4).map(r => r.payload.method), [
    'initialize', 'notifications/initialized', 'tools/call', 'tools/list',
  ]);
  assert.deepEqual(requests[2].payload.params, {name: 'status', arguments: {brief: true}});
  await client.close();
  assert.equal(requests.at(-1).method, 'DELETE');
  assert.equal(requests.at(-1).headers['Mcp-Session-Id'], 'fixture-session');
  await client.close();
  assert.equal(requests.filter(r => r.method === 'DELETE').length, 1);
  await assert.rejects(client.call('status'), error => safeError(error, 'CLOSED'));
});

test('bounded finite SSE handles events, multiline data, notifications and matching IDs', async t => {
  const {client} = await fixture(t, ({payload}) => {
    if (payload?.method !== 'tools/call') return;
    const body = ': heartbeat\r\n\r\nevent: message\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\r\n\r\n'
      + `data: {"jsonrpc":"2.0","id":999,"result":{}}\n\n`
      + `event: message\ndata: {"jsonrpc":"2.0","id":${payload.id},\ndata: "result":{"content":[{"type":"text","text":"{\\\"ok\\\":true,\\\"count\\\":2}"}]}}\n\n`;
    return new Response(body, {headers: {'content-type': 'text/event-stream; charset=utf-8'}});
  });
  assert.deepEqual(await client.call('status'), {ok: true, count: 2});
});

for (const [status, code] of [[401, 'AUTHENTICATION_FAILED'], [403, 'ACCESS_DENIED'], [404, 'NOT_FOUND']]) {
  test(`HTTP ${status} is classified, redacted and never replayed`, async t => {
    const {client, requests} = await fixture(t, ({payload}) => {
      if (payload?.method === 'tools/call') return new Response(`Bearer ${SECRET} remote-sensitive`, {status});
    });
    await assert.rejects(client.call('modify'), error => safeError(error, code));
    assert.equal(requests.filter(r => r.payload?.method === 'tools/call').length, 1);
    assert.equal(requests.filter(r => r.payload?.method === 'initialize').length, 1);
  });
}

for (const [result, code] of [
  [{isError: true, content: [{type: 'text', text: `Bearer ${SECRET}`} ]}, 'TOOL_ERROR'],
  [{structuredContent: {ok: false, message: SECRET}}, 'BUSINESS_ERROR'],
  [{structuredContent: {ok: false, outcome: 'stale', message: SECRET}}, 'STALE'],
  [{content: [{type: 'text', text: JSON.stringify({ok: false, message: SECRET})}]}, 'BUSINESS_ERROR'],
]) {
  test(`business/tool errors: ${code}`, async t => {
    const {client, requests} = await fixture(t, ({payload}) => {
      if (payload?.method === 'tools/call') return json(payload.id, result);
    });
    await assert.rejects(client.call('modify'), error => safeError(error, code));
    assert.equal(requests.filter(r => r.payload?.method === 'tools/call').length, 1);
  });
}

test('JSON-RPC error reports only its numeric code', async t => {
  const {client} = await fixture(t, ({payload}) => {
    if (payload?.method !== 'tools/call') return;
    return new Response(JSON.stringify({jsonrpc: '2.0', id: payload.id,
      error: {code: -32602, message: `Bearer ${SECRET}`, data: 'remote-sensitive'}}),
    {headers: {'content-type': 'application/json'}});
  });
  await assert.rejects(client.call('modify'), error => {
    safeError(error, 'JSONRPC_ERROR');
    assert.match(error.message, /-32602/);
    return true;
  });
});

test('timeout has unknown outcome, aborts and does not replay a mutation', async t => {
  const {client, requests} = await fixture(t, ({payload}) => {
    if (payload?.method === 'tools/call') return new Promise(() => {});
  }, {timeoutMs: 30});
  await assert.rejects(client.call('modify'), error => {
    safeError(error, 'TIMEOUT');
    assert.equal(error.outcome, 'unknown');
    assert.match(error.message, /outcome unknown/);
    return true;
  });
  const calls = requests.filter(r => r.payload?.method === 'tools/call');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].signal.aborted, true);
});

test('timeout also covers a response body that never finishes', async t => {
  const {client, requests} = await fixture(t, ({payload}) => {
    if (payload?.method === 'tools/call') return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('data: {')); },
    }), {headers: {'content-type': 'text/event-stream'}});
  }, {timeoutMs: 30});
  await assert.rejects(client.call('modify'), error => safeError(error, 'TIMEOUT'));
  assert.equal(requests.filter(r => r.payload?.method === 'tools/call').length, 1);
});

test('transport failures are redacted and not replayed', async t => {
  const {client, requests} = await fixture(t, ({payload}) => {
    if (payload?.method === 'tools/call') {
      const error = new Error(`Bearer ${SECRET} remote-sensitive`);
      error.code = 'HTTP_ERROR'; // External errors must not impersonate sanitized errors.
      throw error;
    }
  });
  await assert.rejects(client.call('modify'), error => safeError(error, 'TRANSPORT_ERROR'));
  assert.equal(requests.filter(r => r.payload?.method === 'tools/call').length, 1);
});

test('each new client initializes a fresh transport/session', async t => {
  let sessions = 0;
  const {client, requests, tokenFile, fetchImpl} = await fixture(t, request => {
    if (request.payload?.method === 'initialize') {
      assert.equal(request.headers['Mcp-Session-Id'], undefined);
      return json(request.payload.id, {protocolVersion: '2025-06-18'}, {'mcp-session-id': `new-${++sessions}`});
    }
    if (request.payload?.method === 'notifications/initialized') return new Response(null, {status: 202});
    if (request.payload?.method === 'tools/call') return json(request.payload.id, {structuredContent: {ok: true}});
  });
  await Promise.all([client.initialize(), client.initialize()]);
  const second = new McpClient({tokenFile, fetchImpl});
  t.after(() => second.close());
  await second.call('status');
  await client.call('status');
  assert.equal(sessions, 2);
  assert.deepEqual(requests.filter(r => r.payload?.method === 'tools/call').map(r => r.headers['Mcp-Session-Id']), ['new-2', 'new-1']);
});

test('only local HTTP endpoints are accepted; redirects are never followed', async t => {
  for (const endpoint of ['https://localhost/mcp', 'http://example.com/mcp', 'http://127.0.0.2/mcp',
    'http://localhost.example.com/mcp', 'http://user:password@localhost/mcp', 'http://localhost/mcp?token=secret']) {
    assert.throws(() => new McpClient({endpoint}), error => safeError(error, 'INVALID_ENDPOINT'));
  }
  const {client, requests} = await fixture(t, () => new Response(null, {status: 307, headers: {location: 'http://example.com'}}));
  await assert.rejects(client.initialize(), error => safeError(error, 'HTTP_ERROR'));
  assert.equal(requests.length, 1);
});

test('invalid responses and oversized SSE are rejected without sensitive content', async t => {
  for (const response of [
    new Response(SECRET, {headers: {'content-type': 'application/json'}}),
    new Response(`data: ${SECRET}\n\n`, {headers: {'content-type': 'text/event-stream'}}),
    new Response(SECRET, {headers: {'content-type': 'text/html'}}),
    json(999, {secret: SECRET}),
    new Response('x'.repeat(4 * 1024 * 1024 + 1), {headers: {'content-type': 'text/event-stream'}}),
  ]) {
    const {client} = await fixture(t, ({payload}) => payload?.method === 'tools/call' ? response : undefined);
    await assert.rejects(client.call('status'), error => {
      assert.ok(['INVALID_RESPONSE', 'RESPONSE_TOO_LARGE'].includes(error.code));
      return safeError(error, error.code);
    });
  }
});

test('DELETE failure is best effort', async t => {
  const {client} = await fixture(t, request => {
    if (request.method === 'DELETE') return new Response(SECRET, {status: 403});
  });
  await client.initialize();
  await assert.doesNotReject(client.close());
});

test('native fetch works against an isolated local HTTP server', async t => {
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${SECRET}`);
    if (req.method === 'DELETE') { res.writeHead(204).end(); return; }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    if (payload.method === 'notifications/initialized') { res.writeHead(202).end(); return; }
    const result = payload.method === 'initialize' ? {protocolVersion: '2025-06-18'} : {structuredContent: {ok: true}};
    res.writeHead(200, {'content-type': 'application/json', 'mcp-session-id': 'native-session'});
    res.end(JSON.stringify({jsonrpc: '2.0', id: payload.id, result}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const {client} = await fixture(t, undefined, {
    endpoint: `http://127.0.0.1:${server.address().port}/api/external-mcp/mcp`, fetchImpl: globalThis.fetch,
  });
  assert.deepEqual(await client.call('status'), {ok: true});
  await client.close();
});
