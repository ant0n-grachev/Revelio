(() => {
  // The singleton lives in Chrome's isolated extension world, never page state.
  if (globalThis.__RevelioScanner) return;
  const detection = globalThis.RevelioDetection;
  const { createRetainer } = globalThis.RevelioRetention;
  if (!detection) throw new Error('Revelio detection module was not loaded.');
  const LIMITS = { nodes: 120000, roots: 2000, milliseconds: 10000, text: 2000000, segment: 20000, results: 800 };
  const documentId = crypto.randomUUID();
  const token = `revelio-${crypto.randomUUID()}`;
  const classes = { source: `${token}-source`, target: `${token}-target`, pulse: `${token}-pulse` };
  const ownedNodes = new Set();
  const styles = new Map();
  const marked = new Map();
  const timers = new Set();
  let active = null;
  let located = new Map();

  function emptyReport() {
    return { status: 'idle', mode: 'default', findings: [], coverage: {
      complete: false, stopReason: null, visitedNodes: 0, elapsedMs: 0, roots: [], skippedFrames: 0, omitted: 0,
    } };
  }
  let report = emptyReport();
  let scanId = null;
  function envelope() { return { ok: true, documentId, scanId, report }; }
  function parent(el) {
    if (el.assignedSlot) return el.assignedSlot;
    if (el.parentElement) return el.parentElement;
    const root = el.getRootNode();
    if (root.host) return root.host;
    try { return el.ownerDocument.defaultView?.frameElement || null; } catch { return null; }
  }
  function cssPath(el) {
    const parts = [];
    for (let node = el, depth = 0; node && depth < 5; node = node.parentElement, depth++) {
      let part = node.localName || 'element';
      if (node.id) { parts.unshift(`${part}#${CSS.escape(node.id.slice(0, 100))}`); break; }
      let index = 1;
      for (let sibling = node.previousElementSibling; sibling && index < 1000; sibling = sibling.previousElementSibling) {
        if (sibling.localName === node.localName) index++;
      }
      parts.unshift(`${part}:nth-of-type(${index})`);
    }
    return parts.join(' > ').slice(0, 512);
  }
  function makeContext() {
    const stylesCache = new WeakMap(), rects = new WeakMap(), colors = new WeakMap();
    return {
      parent,
      style(el, pseudo = null) {
        let entries = stylesCache.get(el);
        if (!entries) { entries = new Map(); stylesCache.set(el, entries); }
        if (!entries.has(pseudo)) entries.set(pseudo, el.ownerDocument.defaultView.getComputedStyle(el, pseudo));
        return entries.get(pseudo);
      },
      rect(el) {
        if (!rects.has(el)) rects.set(el, el.getBoundingClientRect());
        return rects.get(el);
      },
      color(value, doc = document) {
        let resolver = colors.get(doc);
        if (!resolver) { resolver = detection.createColorResolver(doc); colors.set(doc, resolver); }
        return resolver(value);
      },
    };
  }
  function addClass(el, name) {
    if (!el?.isConnected) return;
    let entry = marked.get(el);
    if (!entry) { entry = { names: new Set(), hadClass: el.hasAttribute('class') }; marked.set(el, entry); }
    if (!el.classList.contains(name)) { el.classList.add(name); entry.names.add(name); }
  }
  function ensureStyle(root) {
    if (styles.has(root)) return;
    const doc = root.nodeType === 9 ? root : root.ownerDocument;
    const style = doc.createElement('style');
    style.textContent = `.${classes.source}{outline:3px solid #ff3b30!important;outline-offset:2px!important}
.${classes.target}{outline:3px solid #2563eb!important;outline-offset:2px!important}
.${classes.pulse}{box-shadow:0 0 0 4px #fbbf2480!important}`;
    (root.nodeType === 9 ? root.head || root.documentElement : root)?.append(style);
    styles.set(root, style); ownedNodes.add(style);
  }
  function highlight(el, kind) {
    if (!el?.isConnected) return;
    try { ensureStyle(el.getRootNode()); addClass(el, classes[kind]); } catch { /* Removed or navigated root. */ }
  }
  function clearDecorations() {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    for (const [el, entry] of marked) {
      try {
        for (const name of entry.names) el.classList.remove(name);
        if (!entry.hadClass && el.getAttribute('class') === '') el.removeAttribute('class');
      } catch { /* References can outlive a frame's document. */ }
    }
    marked.clear();
    // Only nodes we created, never selector matches in the page.
    for (const node of ownedNodes) { try { node.remove(); } catch { /* Detached root. */ } }
    ownedNodes.clear(); styles.clear();
  }
  function resolveTarget(el, context = makeContext()) {
    let fallback = el;
    for (let cur = el, depth = 0; cur && depth < 16; cur = parent(cur), depth++) {
      const cs = context.style(cur), rect = context.rect(cur);
      if (cs.display !== 'none' && cs.visibility !== 'hidden' && rect.width >= 2 && rect.height >= 2) {
        fallback = cur;
        if (/block|flex|grid|table|list-item/.test(cs.display) || rect.width >= 120 || rect.height >= 18) return cur;
      }
    }
    return fallback;
  }
  function locate(id) {
    const item = located.get(id);
    if (!item?.el.isConnected || !rootAvailable(item.root)) throw new Error('Finding is no longer available. Scan the page again.');
    const target = resolveTarget(item.el);
    for (let node = target, depth = 0; node && depth < 32; depth++) {
      node.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      try { node = node.ownerDocument.defaultView?.frameElement; } catch { break; }
    }
    highlight(item.el, 'source');
    if (target !== item.el) highlight(target, 'target');
    addClass(target, classes.pulse);
    const timer = setTimeout(() => { timers.delete(timer); target.classList.remove(classes.pulse); }, 1500);
    timers.add(timer);
  }
  function rootAvailable(entry) {
    try {
      if (entry.parent && !rootAvailable(entry.parent)) return false;
      if (entry.frame) return entry.frame.isConnected && entry.frame.contentDocument === entry.node;
      if (entry.node.host) return entry.node.host.isConnected && entry.node.host.shadowRoot === entry.node;
      return entry.node === document && !!document.documentElement;
    } catch { return false; }
  }
  function publicFinding(item) {
    return { id: item.id, rootId: item.rootId, source: item.source, selector: item.selector,
      snippet: item.snippet, reasons: item.evidence.map(e => e.message), evidence: item.evidence, score: item.score };
  }
  async function scan(job) {
    const started = performance.now();
    const context = makeContext();
    const retained = createRetainer(LIMITS.results, detection.compareFindings);
    const targets = new WeakMap(), rootsSeen = new WeakSet();
    const roots = [];
    let sequence = 0, totalText = 0, lastYield = started, lastPublish = started;
    const coverage = job.report.coverage;
    function addRoot(node, source, frame = null, parentEntry = null) {
      if (rootsSeen.has(node)) return;
      if (coverage.roots.length >= LIMITS.roots) { coverage.stopReason = 'root-budget'; return; }
      rootsSeen.add(node);
      const record = { id: `root-${coverage.roots.length + 1}`, source: source.slice(0, 512), status: 'scanning' };
      coverage.roots.push(record);
      roots.push({ node, frame, record, parent: parentEntry });
    }
    function skippedFrame(el, status, detail) {
      if (coverage.roots.length >= LIMITS.roots) { coverage.stopReason = 'root-budget'; return; }
      coverage.skippedFrames++;
      coverage.roots.push({ id: `root-${coverage.roots.length + 1}`, source: `frame ${cssPath(el)}`, status, detail });
    }
    function stop() {
      if (job.cancelled || active !== job) return 'cancelled';
      if (coverage.stopReason) return coverage.stopReason;
      if (performance.now() - started >= LIMITS.milliseconds) return 'time-budget';
      if (coverage.visitedNodes >= LIMITS.nodes) return 'node-budget';
      return null;
    }
    function publish() {
      coverage.elapsedMs = Math.round(performance.now() - started);
      coverage.omitted = retained.omitted;
      job.report.findings = retained.values().map(publicFinding);
    }
    function consider(el, text, entry, pseudo = null) {
      if (!text || /^[\t\n\r ]*$/.test(text)) return;
      if (text.length > LIMITS.segment) { coverage.stopReason = 'text-length-budget'; return; }
      totalText += text.length;
      if (totalText > LIMITS.text) { coverage.stopReason = 'text-budget'; return; }
      const evidence = detection.analyze(el, text, context, pseudo);
      if (!evidence.length) return;
      let variants = targets.get(el);
      if (!variants) { variants = new Map(); targets.set(el, variants); }
      const variantKey = `${entry.record.id}:${pseudo || 'text'}`;
      let item = variants.get(variantKey);
      const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 160);
      if (!item) {
        item = { id: `finding-${++sequence}`, order: sequence, el, root: entry, rootId: entry.record.id,
          source: `${entry.record.source}${pseudo ? ` ${pseudo}` : ''}`, pseudo,
          selector: cssPath(el), snippet, evidence: [] };
        variants.set(variantKey, item);
      } else if (!item.snippet.includes(snippet)) {
        item.snippet = `${item.snippet} ${snippet}`.slice(0, 320);
      }
      const merged = new Map(item.evidence.map(e => [e.id, e]));
      for (const e of evidence) {
        const previous = merged.get(e.id);
        if (previous && Array.isArray(previous.codePoints) && Array.isArray(e.codePoints)) {
          const codePoints = [...new Set([...previous.codePoints, ...e.codePoints])].slice(0, 64);
          const count = previous.count + e.count;
          merged.set(e.id, { ...e, codePoints, count,
            message: `${e.description || 'Unicode formatting characters'} (${codePoints.join(', ')}; x${count})` });
        } else if (!previous) merged.set(e.id, e);
      }
      item.evidence = [...merged.values()];
      item.score = detection.scoreFinding(item);
      if (detection.shouldKeepFinding(item, job.report.mode)) retained.offer(item);
    }
    addRoot(document, 'document');
    try {
      for (let rootIndex = 0; rootIndex < roots.length; rootIndex++) {
        const entry = roots[rootIndex];
        const rootStop = stop();
        if (rootStop) { coverage.stopReason = rootStop; break; }
        if (!rootAvailable(entry)) { entry.record.status = 'interrupted'; entry.record.detail = 'Root changed or was removed before inspection.'; continue; }
        try {
          const doc = entry.node.nodeType === 9 ? entry.node : entry.node.ownerDocument;
          const walker = doc.createTreeWalker(entry.node, NodeFilter.SHOW_ALL, {
            acceptNode(node) {
              if (ownedNodes.has(node) || (node.nodeType === 1 && /^(HEAD|TITLE|SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(node.tagName))) return NodeFilter.FILTER_REJECT;
              return NodeFilter.FILTER_ACCEPT;
            },
          });
          let node;
          while ((node = walker.nextNode())) {
            const nodeStop = stop();
            if (nodeStop) { coverage.stopReason = nodeStop; break; }
            coverage.visitedNodes++;
            if (node.nodeType === 1) {
              if (node.shadowRoot) addRoot(node.shadowRoot, `${entry.record.id} > shadow(${cssPath(node)})`, null, entry);
              if (node.tagName === 'IFRAME' || node.tagName === 'FRAME') {
                try {
                  const frameDoc = node.contentDocument;
                  if (frameDoc?.documentElement) addRoot(frameDoc, `${entry.record.id} > frame(${cssPath(node)})`, node, entry);
                  else skippedFrame(node, 'unavailable', 'Frame document unavailable: it may be cross-origin, sandboxed, loading, or detached. The browser did not expose the reason.');
                } catch {
                  skippedFrame(node, 'inaccessible', 'The browser denied access to the frame, so the scan skipped it.');
                }
              }
              for (const pseudo of ['::before', '::after']) {
                const value = context.style(node, pseudo).content;
                if (value && value !== 'none' && value !== 'normal') {
                  const text = /^(["']).*\1$/s.test(value) ? value.slice(1, -1) : value;
                  consider(node, text, entry, pseudo);
                }
              }
            } else if (node.nodeType === 3) {
              const target = node.parentElement || (node.parentNode === entry.node ? entry.node.host : null);
              if (target) consider(target, node.nodeValue || '', entry);
            }
            if (coverage.visitedNodes % 128 === 0 || performance.now() - lastYield >= 12) {
              if (performance.now() - lastPublish >= 150) { publish(); lastPublish = performance.now(); }
              await new Promise(resolve => setTimeout(resolve, 0));
              lastYield = performance.now();
              if (!rootAvailable(entry)) {
                entry.record.status = 'interrupted'; entry.record.detail = 'Root navigated or was removed during inspection.'; break;
              }
            }
          }
          if (entry.record.status === 'scanning' && !coverage.stopReason && !job.cancelled) entry.record.status = 'scanned';
        } catch {
          entry.record.status = 'interrupted';
          entry.record.detail = 'This root became unavailable or could not be inspected. The scan still tried the other accessible roots.';
        }
      }
      if (job.cancelled) coverage.stopReason = 'cancelled';
      // Revalidate even completed roots: asynchronous traversal is not an atomic snapshot.
      for (const entry of roots) {
        if (entry.record.status === 'scanning' || !rootAvailable(entry)) {
          entry.record.status = 'interrupted';
          entry.record.detail ||= coverage.stopReason ? `Inspection ended: ${coverage.stopReason}.` : 'Root changed or was removed during the scan.';
        }
      }
      coverage.complete = !coverage.stopReason && coverage.roots.every(r => r.status === 'scanned');
      job.report.status = job.cancelled ? 'cancelled' : 'running';
      publish();
      if (active !== job) return;
      located = new Map(retained.values().map(item => [item.id, item]));
      // Yield while applying bounded highlights as well. Clear/rescan invalidates this job.
      if (!job.cancelled) {
        let highlighted = 0;
        for (const item of located.values()) {
          if (active !== job || job.cancelled) break;
          if (rootAvailable(item.root)) {
            highlight(item.el, 'source');
            try {
              const target = resolveTarget(item.el, context);
              if (target !== item.el) highlight(target, 'target');
            } catch { /* Page changed after inspection. */ }
          }
          if (++highlighted % 64 === 0) await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
      if (active === job) {
        job.report.status = job.cancelled ? 'cancelled' : 'complete';
        if (job.cancelled) { coverage.complete = false; coverage.stopReason = 'cancelled'; }
        publish();
      }
    } catch (error) {
      if (active !== job) return;
      coverage.stopReason = 'scan-error'; coverage.complete = false;
      for (const root of coverage.roots) if (root.status === 'scanning') root.status = 'interrupted';
      job.report.status = 'error'; job.report.error = `Scan interrupted: ${String(error?.message || error).slice(0, 300)}`;
      publish();
    }
  }
  function cancel() {
    if (active) active.cancelled = true;
    if (report.status === 'running') {
      report.status = 'cancelled'; report.coverage.complete = false; report.coverage.stopReason = 'cancelled';
    }
  }
  function onMessage(msg, sender, sendResponse) {
    // Accept only this extension's UI, never content scripts or window.postMessage.
    if (sender.id !== chrome.runtime.id || sender.tab || sender.url !== chrome.runtime.getURL('popup.html')) return false;
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.type !== 'string') return false;
    try {
      if (msg.type === 'GET_REPORT') { sendResponse(envelope()); return false; }
      if (msg.documentId !== documentId) throw new Error('Page changed. Reopen Revelio and scan again.');
      if (msg.type === 'START_SCAN') {
        if (typeof msg.scanId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(msg.scanId) || msg.scanId === scanId) throw new Error('Invalid or repeated scan identifier.');
        if (!['everything', 'sweep', 'default', 'precise'].includes(msg.tolerance)) throw new Error('Invalid scan mode.');
        cancel(); clearDecorations(); located.clear();
        scanId = msg.scanId; report = emptyReport(); report.mode = msg.tolerance; report.status = 'running';
        active = { id: scanId, report, cancelled: false };
        const job = active;
        sendResponse(envelope());
        // Start after the acknowledgement, so popup closure never owns scan lifetime.
        setTimeout(() => { if (active === job && !job.cancelled) void scan(job); }, 0);
        return false;
      }
      if (msg.scanId !== scanId) throw new Error('Scan changed. Refresh the report.');
      if (msg.type === 'CANCEL_SCAN') cancel();
      else if (msg.type === 'CLEAR') { cancel(); active = null; clearDecorations(); located.clear(); scanId = null; report = emptyReport(); }
      else if (msg.type === 'LOCATE') {
        if (typeof msg.findingId !== 'string') throw new Error('Invalid finding identifier.');
        locate(msg.findingId);
      } else throw new Error('Unknown scanner request.');
      sendResponse(envelope());
    } catch (error) { sendResponse({ ok: false, error: String(error?.message || error) }); }
    return false;
  }
  chrome.runtime.onMessage.addListener(onMessage);
  // Includes back/forward-cache entry: never restore a previous navigation's text.
  window.addEventListener('pagehide', () => {
    cancel(); active = null; clearDecorations(); located.clear(); scanId = null; report = emptyReport();
  });
  globalThis.__RevelioScanner = { documentId };
})();
