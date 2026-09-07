const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { expect } = require('@playwright/test');
const root = path.resolve(__dirname, '../..');

async function openFixture(page, fixture) {
  await page.goto(`/?case=${fixture}`);
  await page.evaluate(() => window.fixtureReady);
}

async function installScanner(page, budgets = null) {
  await page.evaluate(() => {
    const listeners = [];
    window.chrome = { runtime: {
      id: 'revelio-test-extension',
      getURL: file => `chrome-extension://revelio-test-extension/${file}`,
      onMessage: { addListener: listener => listeners.push(listener) },
    } };
    window.__scannerListeners = listeners;
    window.__sendScanner = (message, sender = {
      id: chrome.runtime.id, url: chrome.runtime.getURL('popup.html'),
    }) => new Promise(resolve => {
      for (const listener of listeners) {
        const accepted = listener(message, sender, resolve);
        if (!accepted) resolve(null);
      }
    });
  });
  for (const file of ['detection.js', 'retention.js']) await page.addScriptTag({ path: path.join(root, file) });
  if (budgets) {
    // Focused boundary tests replace private constants in this test copy only.
    // The real default-budget tests and installed smoke use untouched files.
    let source = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
    for (const [name, value] of Object.entries(budgets)) {
      assert(['nodes', 'roots', 'milliseconds', 'text', 'segment'].includes(name));
      assert(Number.isInteger(value) && value > 0);
      const pattern = new RegExp(`\\b${name}: \\d+`);
      assert(pattern.test(source), `Scanner budget ${name} declaration must exist`);
      source = source.replace(pattern, `${name}: ${value}`);
    }
    await page.addScriptTag({ content: source });
  } else await page.addScriptTag({ path: path.join(root, 'content.js') });
}

function send(page, message) {
  return page.evaluate(message => window.__sendScanner(message), message);
}

async function start(page, mode = 'default') {
  const current = await send(page, { type: 'GET_REPORT' });
  const response = await send(page, { type: 'START_SCAN', documentId: current.documentId, scanId: crypto.randomUUID(), tolerance: mode });
  expect(response.ok, response.error).toBe(true);
  return response;
}

async function finish(page) {
  let result;
  await expect.poll(async () => {
    result = await send(page, { type: 'GET_REPORT' });
    return result.report.status;
  }, { timeout: 30000 }).not.toBe('running');
  expect(result.report.status, result.report.error).toBe('complete');
  return result;
}

async function scan(page, mode = 'default') { await start(page, mode); return finish(page); }
async function clear(page) {
  const current = await send(page, { type: 'GET_REPORT' });
  return send(page, { type: 'CLEAR', documentId: current.documentId, scanId: current.scanId });
}
function finding(report, text) { return report.findings.find(item => item.snippet.includes(text)); }
module.exports = { root, openFixture, installScanner, send, start, finish, scan, clear, finding };
