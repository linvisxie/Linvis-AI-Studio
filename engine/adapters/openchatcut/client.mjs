import {readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const ENDPOINT = 'http://127.0.0.1:5199/api/external-mcp/mcp';
const PROTOCOL = '2025-06-18';
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

// Never incorporate remote messages, request headers, tokens or native errors.
class McpError extends Error {}

function failure(code, message, outcome) {
  const error = new McpError(message);
  error.code = code;
  if (outcome) error.outcome = outcome;
  return error;
}

function localEndpoint(value) {
  let url;
  try { url = new URL(value); } catch {
    throw failure('INVALID_ENDPOINT', 'Invalid local MCP endpoint.');
  }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash) {
    throw failure('INVALID_ENDPOINT', 'MCP endpoint must use local HTTP on 127.0.0.1 or localhost, without credentials or query parameters.');
  }
  return url.href;
}

async function responseText(response, signal) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, {once: true});
  if (signal.aborted) cancel();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        throw failure('RESPONSE_TOO_LARGE', 'MCP response exceeds the size limit.');
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    // Do not wait on a potentially uncooperative remote stream's cancellation.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}

function messages(text, contentType) {
  try {
    if (contentType.includes('application/json')) return [JSON.parse(text)];
    if (contentType.includes('text/event-stream')) {
      const events = text.replace(/\r\n?/g, '\n').split(/\n\n+/);
      return events.flatMap(event => {
        const data = event.split('\n')
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).replace(/^ /, '')).join('\n');
        return data.trim() ? [JSON.parse(data)] : [];
      });
    }
  } catch {
    throw failure('INVALID_RESPONSE', 'MCP returned invalid JSON or SSE data.');
  }
  throw failure('INVALID_RESPONSE', 'MCP returned an unsupported content type.');
}

export class McpClient {
  #endpoint;
  #tokenFile;
  #fetch;
  #timeoutMs;
  #token;
  #session;
  #nextId = 0;
  #initialization;
  #closed = false;

  constructor({endpoint = ENDPOINT,
    tokenFile = path.join(os.homedir(), '.openchatcut', 'mcp-token'),
    fetchImpl = globalThis.fetch, timeoutMs = 120_000} = {}) {
    this.#endpoint = localEndpoint(endpoint);
    if (typeof fetchImpl !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw failure('INVALID_OPTIONS', 'MCP requires fetch and a positive finite timeoutMs.');
    }
    this.#tokenFile = tokenFile;
    this.#fetch = fetchImpl;
    this.#timeoutMs = timeoutMs;
  }

  async #request(method, params, {notification = false, deleting = false} = {}) {
    const id = notification || deleting ? undefined : ++this.#nextId;
    const controller = new AbortController();
    let timer;
    const timedOut = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(failure('TIMEOUT', 'MCP request timed out; outcome unknown. Not retried. Verify status before another mutation.', 'unknown'));
      }, this.#timeoutMs);
    });
    const perform = async () => {
      const headers = {
        Authorization: `Bearer ${this.#token}`,
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'x-openchatcut-mcp-client': 'linvis',
        'x-openchatcut-mcp-surface': 'external',
        'MCP-Protocol-Version': PROTOCOL,
      };
      if (this.#session) headers['Mcp-Session-Id'] = this.#session;
      const response = await this.#fetch(this.#endpoint, {
        method: deleting ? 'DELETE' : 'POST', headers,
        redirect: 'manual', signal: controller.signal,
        ...(deleting ? {} : {body: JSON.stringify({jsonrpc: '2.0', ...(id === undefined ? {} : {id}), method, params})}),
      });
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => {});
        throw failure('TIMEOUT', 'MCP request timed out; outcome unknown. Not retried.', 'unknown');
      }
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        const classifications = {
          401: ['AUTHENTICATION_FAILED', 'MCP authentication failed (HTTP 401). Check the official local token file.'],
          403: ['ACCESS_DENIED', 'MCP access denied (HTTP 403). Check external MCP permissions.'],
          404: ['NOT_FOUND', 'MCP endpoint or session not found (HTTP 404). Create a new client; requests are not replayed.'],
        };
        const [code, message] = classifications[response.status]
          ?? ['HTTP_ERROR', `MCP HTTP error (${response.status}); request not retried.`];
        throw failure(code, message);
      }
      const session = response.headers.get('mcp-session-id');
      if (session) this.#session = session;
      if (notification || deleting) {
        void response.body?.cancel().catch(() => {});
        return;
      }
      const text = await responseText(response, controller.signal);
      const reply = messages(text, response.headers.get('content-type') ?? '')
        .find(item => item && item.jsonrpc === '2.0' && item.id === id);
      if (!reply) throw failure('INVALID_RESPONSE', 'MCP response has no matching JSON-RPC reply.');
      if (reply.error) {
        const code = Number.isSafeInteger(reply.error.code) ? ` (${reply.error.code})` : '';
        throw failure('JSONRPC_ERROR', `MCP JSON-RPC error${code}; remote details omitted.`);
      }
      if (!Object.hasOwn(reply, 'result')) throw failure('INVALID_RESPONSE', 'MCP response is missing its result.');
      return reply.result;
    };
    try {
      return await Promise.race([perform(), timedOut]);
    } catch (error) {
      if (controller.signal.aborted) {
        throw failure('TIMEOUT', 'MCP request timed out; outcome unknown. Not retried. Verify status before another mutation.', 'unknown');
      }
      if (error instanceof McpError) throw error;
      throw failure('TRANSPORT_ERROR', 'MCP transport failed; outcome unknown. Not retried. Verify status before another mutation.', 'unknown');
    } finally {
      clearTimeout(timer);
    }
  }

  async initialize() {
    if (this.#closed) throw failure('CLOSED', 'MCP client is closed; create a new client.');
    if (!this.#initialization) {
      this.#initialization = (async () => {
        try { this.#token = (await readFile(this.#tokenFile, 'utf8')).trim(); } catch {
          throw failure('TOKEN_UNAVAILABLE', 'Cannot read the official local MCP token file.');
        }
        if (!this.#token || /[\r\n]/.test(this.#token)) throw failure('TOKEN_UNAVAILABLE', 'The local MCP token file is empty or invalid.');
        const result = await this.#request('initialize', {
          protocolVersion: PROTOCOL, capabilities: {}, clientInfo: {name: 'linvis', version: '1.0'},
        });
        if (result?.protocolVersion !== PROTOCOL) {
          throw failure('PROTOCOL_MISMATCH', 'MCP server did not negotiate protocol 2025-06-18.');
        }
        await this.#request('notifications/initialized', {}, {notification: true});
        return result;
      })();
    }
    return this.#initialization;
  }

  async call(name, args = {}) {
    await this.initialize();
    const result = await this.#request('tools/call', {name, arguments: args});
    if (result?.isError) {
      const text = (result.content ?? []).filter((x) => x?.type === 'text').map((x) => x.text ?? '').join('\n');
      // Recognize a fixed public error signature, without echoing remote text or secrets.
      if (/changed ownership or revision|outcome["\s:]+stale/i.test(text)) throw failure('STALE', 'OpenChatCut 旧连接的工程版本已过期；请新建 MCP transport，不要重放保存操作。', 'stale');
      throw failure('TOOL_ERROR', 'MCP tool reported an error; remote details omitted.');
    }
    let business = result?.structuredContent;
    if (business === undefined) {
      if (!Array.isArray(result?.content)) throw failure('INVALID_TOOL_RESULT', 'MCP tool is missing JSON content.');
      const text = result.content.filter(item => item?.type === 'text' && typeof item.text === 'string').map(item => item.text).join('\n');
      try { business = JSON.parse(text); } catch {
        throw failure('INVALID_TOOL_RESULT', 'MCP tool did not return structuredContent or text JSON.');
      }
    }
    if (!business || typeof business !== 'object') throw failure('INVALID_TOOL_RESULT', 'MCP tool did not return a business object.');
    if (business.outcome === 'stale') throw failure('STALE', 'MCP business outcome is stale; refresh status before another mutation.', 'stale');
    if (business.ok === false || ['rejected', 'failed', 'cancelled'].includes(business.outcome)) throw failure('BUSINESS_ERROR', 'MCP business operation failed; remote details omitted.');
    return business;
  }

  async listTools() {
    await this.initialize();
    const result = await this.#request('tools/list', {});
    if (!Array.isArray(result?.tools)) throw failure('INVALID_RESPONSE', 'MCP tools/list response is missing tools.');
    return result.tools;
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    // Finish a pending handshake before deleting its session. Never initialize here.
    try { await this.#initialization; } catch { /* Best effort. */ }
    try {
      if (this.#session && this.#token) await this.#request(undefined, undefined, {deleting: true});
    } catch { /* Session deletion is best effort; never expose remote errors. */ }
    this.#session = undefined;
    this.#token = undefined;
  }
}
