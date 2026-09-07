// Reports are accepted only from extension messaging and validated at the UI
// boundary. This module never reads page DOM or window messages.
(function (global) {
  'use strict';

  const modes = new Set(['everything', 'sweep', 'default', 'precise']);
  const statuses = new Set(['idle', 'running', 'complete', 'cancelled', 'error']);
  const rootStatuses = new Set(['scanned', 'scanning', 'inaccessible', 'unavailable', 'interrupted']);
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const text = (value, max = 100000) => typeof value === 'string' && value.length <= max;
  const identifier = value => text(value, 256) && value.length > 0;
  const count = value => Number.isSafeInteger(value) && value >= 0;

  function jsonValue(value, depth = 0, budget = { left: 2000 }) {
    if (--budget.left < 0 || depth > 6) return false;
    if (value === null || typeof value === 'boolean') return true;
    if (typeof value === 'string') return text(value, 10000);
    if (typeof value === 'number') return Number.isFinite(value);
    if (Array.isArray(value)) return value.length <= 256 && value.every(item => jsonValue(item, depth + 1, budget));
    if (!record(value)) return false;
    const entries = Object.entries(value);
    return entries.length <= 64 && entries.every(([key, item]) =>
      text(key, 256) && jsonValue(item, depth + 1, budget));
  }

  function validateEnvelope(value, expected = {}) {
    if (!record(value) || value.ok !== true || !identifier(value.documentId)) return false;
    if (value.scanId !== null && !identifier(value.scanId)) return false;
    if (expected.documentId !== undefined && value.documentId !== expected.documentId) return false;
    if (Object.hasOwn(expected, 'scanId') && value.scanId !== expected.scanId) return false;
    const report = value.report;
    if (!record(report) || !statuses.has(report.status) || !modes.has(report.mode)) return false;
    if ((report.status === 'idle') !== (value.scanId === null)) return false;
    if (report.error !== undefined && !text(report.error, 10000)) return false;
    const coverage = report.coverage;
    if (!record(coverage) || typeof coverage.complete !== 'boolean' ||
        !(coverage.stopReason === null || text(coverage.stopReason, 10000)) ||
        !count(coverage.visitedNodes) || !Number.isFinite(coverage.elapsedMs) || coverage.elapsedMs < 0 ||
        !count(coverage.skippedFrames) || !count(coverage.omitted) ||
        !Array.isArray(coverage.roots) || coverage.roots.length > 10000) return false;
    const roots = new Set();
    for (const root of coverage.roots) {
      if (!record(root) || !identifier(root.id) || roots.has(root.id) ||
          !text(root.source, 10000) || !rootStatuses.has(root.status) ||
          (root.detail !== undefined && !text(root.detail, 10000))) return false;
      roots.add(root.id);
    }
    if (coverage.complete && (coverage.stopReason !== null || coverage.skippedFrames !== 0 ||
        !['running', 'complete'].includes(report.status) || roots.size === 0 ||
        coverage.roots.some(root => root.status !== 'scanned'))) return false;
    if (!Array.isArray(report.findings) || report.findings.length > 2000) return false;
    const findings = new Set();
    for (const finding of report.findings) {
      if (!record(finding) || !identifier(finding.id) || findings.has(finding.id) ||
          !roots.has(finding.rootId) || !text(finding.source, 10000) ||
          !text(finding.selector, 10000) || !text(finding.snippet) ||
          !Number.isFinite(finding.score) || !Array.isArray(finding.reasons) ||
          finding.reasons.length > 128 || !finding.reasons.every(reason => text(reason, 10000)) ||
          !Array.isArray(finding.evidence) || !jsonValue(finding.evidence) ||
          !finding.evidence.every(rule => record(rule) && identifier(rule.id) && text(rule.message, 10000))) return false;
      findings.add(finding.id);
    }
    return report.status !== 'idle' || report.findings.length === 0;
  }

  const api = Object.freeze({ validateEnvelope });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.RevelioProtocol = api;
})(globalThis);
