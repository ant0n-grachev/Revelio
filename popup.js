(() => {
  'use strict';

  const ui = Object.fromEntries([
    'scan', 'cancel', 'clear', 'copy', 'tolerance', 'status', 'coverage', 'results', 'roots', 'root-details',
    'report-actions', 'coverage-note',
  ].map(id => [id, document.getElementById(id)]));
  let target = null;
  let current = null;
  let generation = 0;
  let pollTimer = null;
  let disposed = false;
  let busy = false;

  function setStatus(message) {
    ui.status.textContent = message;
  }

  function updateActions() {
    ui.scan.disabled = busy;
    ui.cancel.hidden = current?.report.status !== 'running';
    ui.cancel.disabled = busy;
    const hasReport = Boolean(current && current.report.status !== 'idle');
    ui['report-actions'].hidden = !hasReport;
    ui['coverage-note'].hidden = !hasReport;
    ui.clear.disabled = busy || !hasReport;
    ui.copy.disabled = busy || !hasReport;
  }

  function stopPolling() {
    clearTimeout(pollTimer);
    pollTimer = null;
  }

  function forgetReport(message) {
    generation += 1;
    stopPolling();
    current = null;
    target = null;
    busy = false;
    ui.results.replaceChildren();
    ui.results.hidden = true;
    ui.roots.replaceChildren();
    ui.coverage.hidden = true;
    ui['root-details'].hidden = true;
    setStatus(message);
    updateActions();
  }

  function isCurrent(version) {
    return !disposed && version === generation;
  }

  async function activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!Number.isInteger(tab?.id)) throw new Error('No active tab found. Open a webpage and try again.');
    if (tab.status === 'loading') throw new Error('The page is loading. Wait for it to finish and try again.');
    return { id: tab.id, url: tab.url || '' };
  }

  async function checkTarget(version, expectedTarget) {
    if (!isCurrent(version)) throw new Error('This request is no longer current.');
    const tab = await activeTab();
    if (!isCurrent(version) || tab.id !== expectedTarget.id || tab.url !== expectedTarget.url) {
      throw new Error('The active page changed. Scan the current page again.');
    }
  }

  function noReceiver(error) {
    return /Receiving end does not exist|Could not establish connection/i.test(String(error?.message || error));
  }

  function friendlyError(error) {
    const message = String(error?.message || error || 'Unknown error');
    if (/Cannot access|extensions gallery cannot be scripted|Missing host permission/i.test(message)) {
      return "Revelio cannot scan this restricted page. Open a regular webpage. For local files, enable 'Allow access to file URLs' in chrome://extensions → Revelio.";
    }
    if (noReceiver(error) || /message port closed|Extension context invalidated/i.test(message)) {
      return 'The page or extension changed. Reload the webpage, then open Revelio and scan again.';
    }
    return message;
  }

  async function send(tab, message) {
    return chrome.tabs.sendMessage(tab.id, message, { frameId: 0 });
  }

  function checkedEnvelope(value, expected) {
    if (value?.ok === false) throw new Error(typeof value.error === 'string' ? value.error : 'Scanner rejected this request.');
    if (!RevelioProtocol.validateEnvelope(value, expected)) {
      throw new Error('The report is invalid or belongs to a different document or scan. Scan the current page again.');
    }
    return value;
  }

  async function readReport(tab, version, inject = false, expected = {}) {
    let response;
    try {
      response = await send(tab, { type: 'GET_REPORT' });
    } catch (error) {
      if (!inject || !noReceiver(error)) throw error;
      await checkTarget(version, tab);
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [0] },
        files: ['detection.js', 'retention.js', 'content.js'],
      });
      await checkTarget(version, tab);
      response = await send(tab, { type: 'GET_REPORT' });
    }
    await checkTarget(version, tab);
    return checkedEnvelope(response, expected);
  }

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function counted(count, label) {
    return `${count} ${label}${count === 1 ? '' : 's'}`;
  }

  function render(envelope) {
    current = envelope;
    const report = envelope.report;
    const coverage = report.coverage;
    const running = report.status === 'running';
    const findingsCount = counted(report.findings.length, 'finding');
    if (report.status === 'idle') setStatus('Ready to scan.');
    else if (running) setStatus(`Scanning (${report.mode})… ${findingsCount} retained so far.`);
    else if (report.status === 'cancelled') setStatus(`Scan cancelled. ${findingsCount} in the content inspected.`);
    else if (report.status === 'error') setStatus(`Scan failed: ${report.error || 'The page changed or scanning was interrupted.'}`);
    else if (report.findings.length === 0) setStatus(`No findings in scanned content (${report.mode}).`);
    else setStatus(`${findingsCount} in scanned content (${report.mode}).`);

    ui.coverage.hidden = report.status === 'idle';
    ui.coverage.classList.toggle('warning', !coverage.complete || coverage.skippedFrames > 0);
    let description = running ? 'Coverage is partial while scanning.' :
      coverage.complete ? 'Accessible roots scanned.' : 'Incomplete coverage.';
    if (coverage.stopReason) description += ` Stop reason: ${coverage.stopReason}.`;
    if (coverage.skippedFrames) description += ` ${counted(coverage.skippedFrames, 'frame')} skipped.`;
    description += ` ${counted(coverage.visitedNodes, 'node')} visited in ${Math.round(coverage.elapsedMs)} ms.`;
    if (coverage.omitted) description += ` ${counted(coverage.omitted, 'additional eligible finding')} omitted from the report.`;
    ui.coverage.textContent = description;
    ui['root-details'].hidden = coverage.roots.length === 0;
    const rootItems = coverage.roots.map(root => element('li',
      `${root.id} · ${root.source}: ${root.status}${root.detail ? `. ${root.detail}` : ''}`));
    ui.roots.replaceChildren(...rootItems);

    const findings = report.findings.map((finding, index) => {
      const item = element('li', undefined, 'finding');
      item.dataset.findingId = finding.id;
      item.append(element('div', `Finding ${index + 1}`, 'finding-title'));
      item.append(element('pre', finding.snippet, 'snippet'));

      const footer = element('div', undefined, 'finding-footer');
      const details = element('details', undefined, 'finding-details');
      details.append(element('summary', 'Evidence'));
      details.append(element('p', `Score ${finding.score} · ${finding.source}`));
      details.append(element('p', `${finding.rootId} · ${finding.selector}`));
      const reasons = element('ul', undefined, 'reasons');
      reasons.append(...finding.reasons.map(reason => element('li', reason)));
      details.append(reasons);

      const locate = element('button', 'Locate on page', 'locate');
      locate.type = 'button';
      locate.disabled = running;
      locate.addEventListener('click', () => locateFinding(envelope, finding.id));
      footer.append(details, locate);
      item.append(footer);
      return item;
    });
    ui.results.replaceChildren(...findings);
    ui.results.hidden = findings.length === 0;
    updateActions();
  }

  function schedulePoll(version) {
    stopPolling();
    if (!isCurrent(version) || current?.report.status !== 'running') return;
    pollTimer = setTimeout(async () => {
      const tab = target;
      const identity = { documentId: current.documentId, scanId: current.scanId };
      try {
        const envelope = await readReport(tab, version, false, identity);
        if (!isCurrent(version)) return;
        render(envelope);
        schedulePoll(version);
      } catch (error) {
        if (isCurrent(version)) forgetReport(friendlyError(error));
      }
    }, 300);
  }

  async function openReport() {
    const version = ++generation;
    busy = true;
    updateActions();
    try {
      const tab = await activeTab();
      if (!isCurrent(version)) return;
      target = tab;
      const envelope = await readReport(tab, version, true);
      if (!isCurrent(version)) return;
      target = tab;
      busy = false;
      render(envelope);
      schedulePoll(version);
    } catch (error) {
      if (isCurrent(version)) forgetReport(friendlyError(error));
    }
  }

  async function startScan() {
    const version = ++generation;
    stopPolling();
    busy = true;
    updateActions();
    setStatus('Starting scan…');
    try {
      const tab = await activeTab();
      if (!isCurrent(version)) return;
      target = tab;
      const prior = await readReport(tab, version, true);
      const identity = { documentId: prior.documentId, scanId: crypto.randomUUID() };
      await checkTarget(version, tab);
      checkedEnvelope(await send(tab, { type: 'START_SCAN', ...identity, tolerance: ui.tolerance.value }), identity);
      // Confirm against the current document after the async action, including
      // same-URL reloads that cannot be distinguished from the tab URL alone.
      const envelope = await readReport(tab, version, false, identity);
      if (!isCurrent(version)) return;
      target = tab;
      busy = false;
      render(envelope);
      schedulePoll(version);
    } catch (error) {
      if (isCurrent(version)) forgetReport(friendlyError(error));
    }
  }

  async function changeScan(type) {
    if (!current || !target || busy) return;
    const tab = target;
    const identity = { documentId: current.documentId, scanId: current.scanId };
    const version = ++generation;
    stopPolling();
    busy = true;
    updateActions();
    try {
      await checkTarget(version, tab);
      const expected = type === 'CLEAR' ? { ...identity, scanId: null } : identity;
      checkedEnvelope(await send(tab, { type, ...identity }), expected);
      const envelope = await readReport(tab, version, false, expected);
      if (!isCurrent(version)) return;
      busy = false;
      render(envelope);
      schedulePoll(version);
    } catch (error) {
      if (isCurrent(version)) forgetReport(friendlyError(error));
    }
  }

  async function locateFinding(envelope, findingId) {
    if (!target || busy || envelope.documentId !== current?.documentId || envelope.scanId !== current?.scanId) return;
    const version = generation;
    const tab = target;
    const identity = { documentId: envelope.documentId, scanId: envelope.scanId };
    try {
      await readReport(tab, version, false, identity);
      const response = await send(tab, { type: 'LOCATE', ...identity, findingId });
      await checkTarget(version, tab);
      if (response?.ok !== true) throw new Error(response?.error || 'This finding is no longer available on the page.');
      if (response.documentId !== identity.documentId || response.scanId !== identity.scanId) {
        throw new Error('The page or scan changed. Scan the current page again.');
      }
      setStatus('Finding located on the page.');
    } catch (error) {
      if (isCurrent(version)) setStatus(friendlyError(error));
    }
  }

  async function copyReport() {
    if (!current || !target || busy) return;
    const version = generation;
    const identity = { documentId: current.documentId, scanId: current.scanId };
    try {
      const envelope = await readReport(target, version, false, identity);
      if (!isCurrent(version)) return;
      await navigator.clipboard.writeText(JSON.stringify(envelope, null, 2));
      if (isCurrent(version)) setStatus('Report copied as JSON.');
    } catch (error) {
      if (isCurrent(version)) setStatus(`Copy failed: ${friendlyError(error)}`);
    }
  }

  function tabActivated(info) {
    if (target && info.tabId !== target.id) forgetReport('Active tab changed. Scan this page to start a new report.');
  }

  function tabUpdated(tabId, change) {
    if (target?.id === tabId && (change.status === 'loading' || (change.url && change.url !== target.url))) {
      forgetReport('The page navigated or reloaded. Scan this page again.');
    }
  }

  try {
    const saved = localStorage.getItem('revelio_tolerance');
    const mode = ({ all: 'everything', strict: 'sweep', balanced: 'default' })[saved] || saved;
    if (['everything', 'sweep', 'default', 'precise'].includes(mode)) ui.tolerance.value = mode;
  } catch { /* Preferences are optional when extension storage is unavailable. */ }
  ui.tolerance.addEventListener('change', () => {
    try { localStorage.setItem('revelio_tolerance', ui.tolerance.value); } catch { /* No scanned text is persisted. */ }
  });
  ui.scan.addEventListener('click', startScan);
  ui.cancel.addEventListener('click', () => changeScan('CANCEL_SCAN'));
  ui.clear.addEventListener('click', () => changeScan('CLEAR'));
  ui.copy.addEventListener('click', copyReport);
  chrome.tabs.onActivated.addListener(tabActivated);
  chrome.tabs.onUpdated.addListener(tabUpdated);
  window.addEventListener('pagehide', () => {
    disposed = true;
    generation += 1;
    stopPolling();
    chrome.tabs.onActivated.removeListener(tabActivated);
    chrome.tabs.onUpdated.removeListener(tabUpdated);
    current = null;
    target = null;
  }, { once: true });
  openReport();
})();
