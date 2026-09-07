const { test, expect } = require('@playwright/test');
const { openFixture, installScanner, send, start, finish, scan, clear, finding, root } = require('../helpers/scanner.cjs');
const path = require('node:path');

for (const count of [799, 800, 1200]) {
  test(`Default finds transparent text after ${count} hidden labels`, async ({ page }) => {
    await openFixture(page, `starvation&count=${count}`); await installScanner(page);
    const { report } = await scan(page);
    expect(finding(report, 'Late transparent priority finding')).toBeTruthy();
    expect(report.coverage.complete).toBe(true);
    expect(report.coverage.stopReason).toBeNull();
    expect(report.coverage.omitted).toBe(0);
  });
}

test('retained capacity does not stop traversal; late priority displaces early candidates', async ({ page }) => {
  await openFixture(page, 'retention'); await installScanner(page);
  const { report } = await scan(page, 'everything');
  expect(report.findings).toHaveLength(800);
  expect(report.findings[0].snippet).toContain('Late highest priority finding');
  expect(report.coverage.omitted).toBeGreaterThan(0);
  expect(report.coverage.complete).toBe(true);
  expect(report.coverage.stopReason).toBeNull();
});

test('identical selectors retain each nested document and shadow target; clear owns every mutation', async ({ page }) => {
  await openFixture(page, 'roots'); await installScanner(page);
  for (let cycle = 0; cycle < 3; cycle++) {
    const { report } = await scan(page, cycle === 1 ? 'everything' : 'default');
    expect(report.findings).toHaveLength(11);
    expect(finding(report, 'Shadow one secret')).toBeTruthy();
    expect(finding(report, 'Shadow two secret')).toBeTruthy();
    expect(finding(report, 'Frame frame-one secret')).toBeTruthy();
    expect(finding(report, 'Frame frame-two secret')).toBeTruthy();
    expect(new Set(report.findings.map(item => item.rootId)).size).toBe(11);
    expect(report.coverage.roots.every(item => item.status === 'scanned')).toBe(true);
    expect(report.coverage.complete).toBe(true);
    const highlighted = await page.evaluate(() => {
      const found = [];
      function walk(root) {
        for (const el of root.querySelectorAll('*')) {
          if (el.id === 'secret') found.push(el.ownerDocument.defaultView.getComputedStyle(el).outlineColor);
          if (el.shadowRoot) walk(el.shadowRoot);
          if (el.localName === 'iframe' && el.contentDocument) walk(el.contentDocument);
        }
      }
      walk(document); return found;
    });
    expect(highlighted).toHaveLength(11);
    expect(highlighted.every(color => color === 'rgb(255, 59, 48)')).toBe(true);
    expect((await clear(page)).ok).toBe(true);
    expect(await page.evaluate(() => {
      let leftovers = 0;
      function walk(root) { for (const el of root.querySelectorAll('*')) {
        if ([...el.classList].some(value => value.startsWith('revelio-'))) leftovers++;
        if (el.localName === 'style' && el.textContent.includes('revelio-')) leftovers++;
        if (el.shadowRoot) walk(el.shadowRoot);
        if (el.localName === 'iframe' && el.contentDocument) walk(el.contentDocument);
      } }
      walk(document); return leftovers;
    })).toBe(0);
  }
  await page.addScriptTag({ path: path.join(root, 'content.js') });
  expect(await page.evaluate(() => window.__scannerListeners.length)).toBe(1);
});

test('page-owned report ID, classes, and attributes survive scan and clear', async ({ page }) => {
  await openFixture(page, 'collision'); await installScanner(page);
  const original = await page.locator('#htd-panel').evaluate(el => el.outerHTML);
  const marker = await page.locator('#page-mark').evaluate(el => el.outerHTML);
  const { report } = await scan(page, 'everything');
  expect(finding(report, '<img src=x onerror=')).toBeTruthy();
  await clear(page);
  expect(await page.locator('#htd-panel').evaluate(el => el.outerHTML)).toBe(original);
  expect(await page.locator('#page-mark').evaluate(el => el.outerHTML)).toBe(marker);
  expect(await page.evaluate(() => window.__executed)).toBeUndefined();
});

test('same-document duplicate IDs stay distinct, repeated target evidence merges, and generated text is scanned', async ({ page }) => {
  await openFixture(page, 'ordinary');
  await page.evaluate(() => {
    document.querySelector('#fixture').innerHTML = '<p id="duplicate" style="color:transparent">First duplicate identity</p><p id="duplicate" style="color:transparent">Second duplicate identity</p><p id="merged" style="color:transparent"></p><div id="generated"></div><style>body::before{content:"Body pseudo secret";color:transparent}#generated::before{content:"Before pseudo secret";color:transparent}#generated::after{content:"After pseudo secret";font-size:1px}</style>';
    document.querySelector('#merged').append(document.createTextNode('Split text first\u202E'), document.createTextNode(' then suspicious\u202Ccontrol'));
  });
  await installScanner(page);
  const { report } = await scan(page, 'everything');
  const duplicates = report.findings.filter(item => item.selector === 'p#duplicate');
  expect(duplicates).toHaveLength(2);
  expect(new Set(duplicates.map(item => item.id)).size).toBe(2);
  const merged = report.findings.filter(item => item.selector === 'p#merged');
  expect(merged).toHaveLength(1);
  expect(merged[0].evidence.map(reason => reason.id)).toEqual(expect.arrayContaining(['color-alpha', 'unicode-bidi']));
  const bidi = merged[0].evidence.find(reason => reason.id === 'unicode-bidi');
  expect(bidi.codePoints).toEqual(['U+202E', 'U+202C']);
  expect(bidi.count).toBe(2);
  expect(bidi.message).toContain('x2');
  expect(finding(report, 'Body pseudo secret')).toBeTruthy();
  expect(finding(report, 'Before pseudo secret')).toBeTruthy();
  expect(finding(report, 'After pseudo secret')).toBeTruthy();
});

test('direct shadow-root text and host light-DOM text have separate root identities', async ({ page }) => {
  await openFixture(page, 'ordinary');
  await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'direct-root'; host.style.color = 'transparent';
    host.append(document.createTextNode('Host light DOM secret'));
    host.attachShadow({ mode: 'open' }).append(document.createTextNode('Direct shadow root secret'));
    document.querySelector('#fixture').replaceChildren(host);
  });
  await installScanner(page);
  const { report } = await scan(page, 'everything');
  const light = finding(report, 'Host light DOM secret'), shadow = finding(report, 'Direct shadow root secret');
  expect(light).toBeTruthy(); expect(shadow).toBeTruthy();
  expect(shadow.rootId).not.toBe(light.rootId);
  expect(shadow.id).not.toBe(light.id);
  await clear(page);
});

test('same colors at 16px, modern colors, alpha and inherited backgrounds', async ({ page }) => {
  await openFixture(page, 'colors'); await installScanner(page);
  const { report } = await scan(page, 'everything');
  for (const text of ['Same color ordinary size', 'Modern same color ordinary size', 'Same color ancestor background', 'Transparent alpha text']) expect(finding(report, text), text).toBeTruthy();
  for (const text of ['Readable RGB white black', 'Readable modern white black']) expect(finding(report, text), text).toBeFalsy();
  const uncertain = finding(report, 'Unknown effective gradient background');
  expect(uncertain?.evidence.some(reason => 'ratio' in reason)).toBeFalsy();
  const parsed = await page.evaluate(() => {
    const color = RevelioDetection.createColorResolver(document);
    return { invalid: color('not-a-color'), rgb: color('rgb(255 255 255)'), modern: color('oklch(100% 0 0)') };
  });
  expect(parsed.invalid).toBeNull();
  expect(parsed.modern).toEqual(parsed.rgb);
});

test('vertical displacement is detected and ordinary below-fold text stays ordinary after scrolling', async ({ page }) => {
  await openFixture(page, 'vertical'); await installScanner(page);
  for (const scrolled of [false, true]) {
    if (scrolled) await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    const { report } = await scan(page, 'everything');
    expect(finding(report, 'Extreme vertical displacement')).toBeTruthy();
    expect(finding(report, 'Extreme horizontal displacement')).toBeTruthy();
    expect(finding(report, 'Ordinary below fold text')).toBeFalsy();
  }
});

test('relative and ancestor displacement and pseudo host opacity remain detectable', async ({ page }) => {
  await openFixture(page, 'positioned-ancestors'); await installScanner(page);
  const { report } = await scan(page, 'everything');
  for (const text of ['Relative vertical displacement', 'Ancestor vertical displacement', 'Host opacity pseudo secret']) expect(finding(report, text), text).toBeTruthy();
});

for (const mode of ['everything', 'sweep', 'default', 'precise']) {
  test(`Unicode diagnostics are calibrated in ${mode} mode`, async ({ page }) => {
    await openFixture(page, 'unicode'); await installScanner(page);
    const { report } = await scan(page, mode);
    if (mode === 'default' || mode === 'precise') {
      for (const text of ['👩‍💻', 'من می‌روم خانه', 'क्‍ष', 'ب‍ب']) expect(finding(report, text), text).toBeFalsy();
    }
    if (mode === 'everything' || mode === 'sweep') {
      expect(finding(report, 'Surprise')).toBeTruthy();
      expect(finding(report, 'File')).toBeTruthy();
    }
    for (const item of report.findings.filter(item => /👩|من |क्|ب‍/.test(item.snippet))) expect(item.score).toBeLessThan(6);
  });
}

test('opaque sandbox and real cross-origin frames are reported as skipped', async ({ page }) => {
  await openFixture(page, 'frames'); await installScanner(page);
  const { report } = await scan(page, 'everything');
  expect(finding(report, 'Frame accessible secret')).toBeTruthy();
  expect(report.coverage.skippedFrames).toBe(2);
  expect(report.coverage.complete).toBe(false);
  expect(report.coverage.roots.filter(root => ['unavailable', 'inaccessible'].includes(root.status))).toHaveLength(2);
});

test('removed frames and shadow roots during a cooperative scan do not crash', async ({ page }) => {
  await openFixture(page, 'roots'); await installScanner(page);
  await page.evaluate(() => {
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < 3000; i++) fragment.append(document.createElement('span'));
    document.querySelector('#fixture').append(fragment);
  });
  await start(page);
  await page.evaluate(() => document.querySelector('#fixture').replaceChildren());
  const { report } = await finish(page);
  expect(report.coverage.complete).toBe(false);
  expect(report.coverage.roots.some(root => root.status === 'interrupted')).toBe(true);
  await clear(page);
});

test('a frame navigating during scanning is interrupted and a pagehide discards retained text', async ({ page }) => {
  await openFixture(page, 'roots');
  await page.evaluate(() => {
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < 3000; i++) fragment.append(document.createElement('span'));
    document.querySelector('#fixture').append(fragment);
  });
  await installScanner(page);
  await start(page);
  await page.evaluate(() => new Promise(resolve => {
    const frame = document.querySelector('iframe');
    frame.addEventListener('load', resolve, { once: true });
    frame.src = '/frame?name=navigated';
  }));
  const { report } = await finish(page);
  expect(report.coverage.roots.some(root => root.status === 'interrupted')).toBe(true);
  expect(report.coverage.complete).toBe(false);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  const discarded = await send(page, { type: 'GET_REPORT' });
  expect(discarded.scanId).toBeNull();
  expect(discarded.report.status).toBe('idle');
  expect(discarded.report.findings).toHaveLength(0);
});

for (const [budget, value, fixture, reason] of [
  ['nodes', 10, 'starvation&count=30', 'node-budget'],
  ['milliseconds', 1, 'large&count=1000', 'time-budget'],
  ['roots', 1, 'roots', 'root-budget'],
  ['text', 20, 'starvation&count=30', 'text-budget'],
  ['segment', 10, 'starvation&count=30', 'text-length-budget'],
]) {
  test(`focused ${budget} boundary reports ${reason}`, async ({ page }) => {
    await openFixture(page, fixture); await installScanner(page, { [budget]: value });
    const { report } = await scan(page);
    expect(report.coverage.complete).toBe(false);
    expect(report.coverage.stopReason).toBe(reason);
  });
}

test('default work budgets give explicit incomplete coverage while the page remains responsive', async ({ page }, testInfo) => {
  await openFixture(page, 'large&count=1'); await installScanner(page);
  await page.evaluate(() => {
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < 120100; i++) fragment.append(document.createElement('span'));
    document.querySelector('#fixture').replaceChildren(fragment);
    window.__ticks = 0; window.__timer = setInterval(() => window.__ticks++, 0);
  });
  const { report } = await scan(page);
  expect(report.coverage.complete).toBe(false);
  expect(['node-budget', 'time-budget']).toContain(report.coverage.stopReason);
  if (report.coverage.stopReason === 'node-budget') expect(report.coverage.visitedNodes).toBe(120000);
  else expect(report.coverage.elapsedMs).toBeGreaterThanOrEqual(10000);
  expect(await page.evaluate(() => { clearInterval(window.__timer); return window.__ticks; })).toBeGreaterThan(2);
  await testInfo.attach('large-fixture-measurement', { body: JSON.stringify(report.coverage), contentType: 'application/json' });
  console.log(`Default-budget fixture: ${report.coverage.elapsedMs} ms, ${report.coverage.visitedNodes} visited nodes, ${report.coverage.stopReason}.`);
});

test('representative 10,000 visible spans yield to the page and report measured work', async ({ page }, testInfo) => {
  await openFixture(page, 'large&count=10000'); await installScanner(page);
  await page.evaluate(() => { window.__ticks = 0; window.__timer = setInterval(() => window.__ticks++, 0); });
  const { report } = await scan(page);
  expect(report.coverage.complete).toBe(true);
  expect(report.findings).toHaveLength(0);
  const ticks = await page.evaluate(() => { clearInterval(window.__timer); return window.__ticks; });
  expect(ticks).toBeGreaterThan(2);
  await testInfo.attach('representative-fixture-measurement', { body: JSON.stringify({ elapsedMs: report.coverage.elapsedMs, visitedNodes: report.coverage.visitedNodes, ticks }), contentType: 'application/json' });
  console.log(`10,000 visible spans: ${report.coverage.elapsedMs} ms, ${report.coverage.visitedNodes} visited nodes, ${ticks} timer callbacks.`);
});

test('cancellation, rescanning, stale scan IDs, wrong documents and page senders cannot overwrite the current report', async ({ page }) => {
  await openFixture(page, 'large&count=5000'); await installScanner(page);
  const old = await start(page);
  const cancelled = await send(page, { type: 'CANCEL_SCAN', documentId: old.documentId, scanId: old.scanId });
  expect(cancelled.report.status).toBe('cancelled');
  expect(cancelled.report.coverage.stopReason).toBe('cancelled');
  await page.evaluate(() => { document.querySelector('#fixture').innerHTML = '<p style="color:transparent">Newest scan secret</p>'; });
  const newest = await scan(page);
  expect(finding(newest.report, 'Newest scan secret')).toBeTruthy();
  expect(newest.scanId).not.toBe(old.scanId);
  expect((await send(page, { type: 'CLEAR', documentId: old.documentId, scanId: old.scanId })).ok).toBe(false);
  expect((await send(page, { type: 'START_SCAN', documentId: 'other-document', scanId: 'wrong', tolerance: 'default' })).ok).toBe(false);
  expect(await page.evaluate(() => window.__sendScanner({ type: 'GET_REPORT' }, { id: chrome.runtime.id, url: location.href, tab: { id: 1 } }))).toBeNull();
  await page.evaluate(() => window.postMessage({ type: 'GET_REPORT', report: { findings: ['forged'] } }, '*'));
  expect((await send(page, { type: 'GET_REPORT' })).scanId).toBe(newest.scanId);
  expect((await send(page, { type: 'GET_REPORT' })).report.findings).toEqual(newest.report.findings);
  await start(page);
  await clear(page);
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)));
  expect((await send(page, { type: 'GET_REPORT' })).report.status).toBe('idle');
  expect(await page.locator('[class*="revelio-"]').count()).toBe(0);
});
