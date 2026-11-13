const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { validateEnvelope } = require('../../protocol.js');

function report(status = 'idle', scanId = null, documentId = 'doc-1') {
  return { ok: true, documentId, scanId, report: { status, mode: 'default', findings: [],
    coverage: { complete: status === 'complete', stopReason: null, visitedNodes: 10, elapsedMs: 3,
      skippedFrames: 0, omitted: 0, roots: [{ id: 'root-1', source: 'document', status: 'scanned' }] } } };
}

class Node {
  constructor(tag) {
    this.tag = tag; this.children = []; this.listeners = new Map(); this.dataset = {};
    this.classList = { toggle() {} }; this.value = 'default'; this._text = '';
  }
  set innerHTML(_) { throw new Error('Untrusted markup must never reach innerHTML'); }
  set textContent(text) { this._text = text; this.children = []; }
  get textContent() { return String(this._text) + this.children.map(child => child.textContent).join(''); }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; this._text = ''; }
  async click() { return this.listeners.get('click')?.(); }
}

function harness(initial = report()) {
  const nodes = Object.fromEntries(['scan', 'cancel', 'clear', 'copy', 'tolerance', 'status', 'coverage', 'results', 'roots', 'root-details', 'report-actions', 'coverage-note'].map(id => [id, new Node(id)]));
  const activated = new Set(); const updated = new Set(); const lifecycle = new Map();
  const event = listeners => ({ addListener: callback => listeners.add(callback), removeListener: callback => listeners.delete(callback) });
  let latest = initial; let active = { id: 1, url: 'https://example.test/', status: 'complete' };
  let handler; let timerId = 0; const timers = new Map(); const calls = []; const injected = []; const persisted = [];
  const context = vm.createContext({
    document: { getElementById: id => nodes[id], createElement: tag => new Node(tag) },
    window: { addEventListener: (name, callback) => lifecycle.set(name, callback) },
    RevelioProtocol: { validateEnvelope }, crypto: { randomUUID: () => 'new-scan' },
    localStorage: { getItem: () => null, setItem: (...args) => persisted.push(args) },
    navigator: { clipboard: { writeText: async text => persisted.push(['clipboard', text]) } },
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: id => timers.delete(id),
    chrome: {
      tabs: {
        query: async () => [active], onActivated: event(activated), onUpdated: event(updated),
        sendMessage: async (tabId, message, options) => {
          calls.push({ tabId, message, options });
          if (handler) return handler(message);
          if (message.type === 'START_SCAN') latest = report('running', message.scanId, message.documentId);
          if (message.type === 'CLEAR') latest = report();
          if (message.type === 'CANCEL_SCAN') latest = report('cancelled', message.scanId, message.documentId);
          return latest;
        },
      },
      scripting: { executeScript: async options => injected.push(options) },
    },
  });
  vm.runInContext(fs.readFileSync(require.resolve('../../popup.js'), 'utf8'), context);
  return {
    nodes, calls, injected, persisted, timers, activated, updated,
    setHandler: value => { handler = value; }, setReport: value => { latest = value; },
    navigate: (url = active.url) => { active = { ...active, url }; updated.forEach(callback => callback(1, { status: 'loading', url })); },
    switchTab: () => { active = { id: 2, url: 'https://other.test/', status: 'complete' }; activated.forEach(callback => callback({ tabId: 2 })); },
    close: () => lifecycle.get('pagehide')(),
    poll: async () => { const [id, callback] = timers.entries().next().value; timers.delete(id); await callback(); },
  };
}

async function flush() { for (let index = 0; index < 5; index++) await new Promise(resolve => setImmediate(resolve)); }

function addFinding(value, snippet = '<img src=x onerror="alert(1)">') {
  value.report.findings.push({ id: 'finding-1', rootId: 'root-1', source: 'document', selector: '#secret', snippet,
    reasons: ['A literal <script> reason'], evidence: [{ id: 'color-alpha', message: 'A literal <script> reason' }], score: 6 });
  return value;
}

test('renders report text literally and uses top-frame extension messages', async () => {
  const h = harness(addFinding(report('complete', 'scan-1')));
  await flush();
  assert.match(h.nodes.results.textContent, /<img src=x onerror="alert\(1\)">/);
  assert.equal(h.nodes.results.children[0].children[1].tag, 'pre');
  assert.ok(h.calls.every(call => call.tabId === 1 && call.options.frameId === 0));
  assert.equal(h.injected.length, 0, 'existing scanner is reused');
  assert.equal(h.persisted.length, 0, 'finding text is not stored');
});

test('uses singular count labels when one finding, frame, or node is reported', async () => {
  const complete = addFinding(report('complete', 'scan-1'));
  Object.assign(complete.report.coverage, { complete: false, skippedFrames: 1, visitedNodes: 1, omitted: 1 });
  complete.report.coverage.roots.push({ id: 'root-2', source: 'frame', status: 'unavailable' });
  const h = harness(complete);
  await flush();
  assert.match(h.nodes.status.textContent, /^1 finding in scanned content/);
  assert.match(h.nodes.coverage.textContent, /1 frame skipped/);
  assert.match(h.nodes.coverage.textContent, /1 node visited/);
  assert.match(h.nodes.coverage.textContent, /1 additional eligible finding omitted/);
});

test('stale poll cannot restore findings after Clear', async () => {
  const h = harness(addFinding(report('running', 'scan-1')));
  await flush();
  let resolvePoll;
  h.setHandler(() => new Promise(resolve => { resolvePoll = resolve; }));
  const polling = h.poll();
  await flush();
  h.setHandler(undefined);
  await h.nodes.clear.click();
  resolvePoll(addFinding(report('complete', 'scan-1')));
  await polling;
  assert.equal(h.nodes.results.children.length, 0);
  assert.match(h.nodes.status.textContent, /Ready/);
  assert.equal(h.timers.size, 0);
});

test('same-URL navigation invalidates an in-flight report', async () => {
  const h = harness(addFinding(report('running', 'scan-1')));
  await flush();
  let resolvePoll;
  h.setHandler(() => new Promise(resolve => { resolvePoll = resolve; }));
  const polling = h.poll();
  await flush();
  h.navigate();
  resolvePoll(addFinding(report('complete', 'scan-1')));
  await polling;
  assert.equal(h.nodes.results.children.length, 0);
  assert.match(h.nodes.status.textContent, /navigated or reloaded/);
});

test('previous tab results are removed when the active tab changes', async () => {
  const h = harness(addFinding(report('complete', 'scan-1')));
  await flush();
  h.switchTab();
  assert.equal(h.nodes.results.children.length, 0);
  assert.match(h.nodes.status.textContent, /Active tab changed/);
});

test('document mismatch after START_SCAN cannot become the authoritative report', async () => {
  const h = harness();
  await flush();
  let started = false;
  h.setHandler(message => {
    if (message.type === 'START_SCAN') { started = true; return report('running', message.scanId); }
    return started ? addFinding(report('complete', 'new-scan', 'new-document')) : report();
  });
  await h.nodes.scan.click();
  assert.equal(h.nodes.results.children.length, 0);
  assert.match(h.nodes.status.textContent, /different document or scan/);
});

test('popup closure clears polling and listeners without cancelling the scan', async () => {
  const h = harness(report('running', 'scan-1'));
  await flush();
  assert.equal(h.timers.size, 1);
  h.close();
  assert.equal(h.timers.size, 0);
  assert.equal(h.activated.size, 0);
  assert.equal(h.updated.size, 0);
  assert.equal(h.calls.some(call => call.message.type === 'CANCEL_SCAN'), false);
});

test('only missing receiver triggers the ordered injection path', async () => {
  const h = harness();
  h.setHandler(() => { throw new Error('Could not establish connection. Receiving end does not exist.'); });
  await flush();
  assert.equal(h.injected.length, 1);
  assert.deepEqual(Array.from(h.injected[0].files), ['detection.js', 'retention.js', 'content.js']);
  assert.deepEqual(Array.from(h.injected[0].target.frameIds), [0]);
  const failed = harness();
  failed.setHandler(() => { throw new Error('The message port closed before a response was received.'); });
  await flush();
  assert.equal(failed.injected.length, 0, 'navigation/lifecycle errors do not cause blind reinjection');
});
