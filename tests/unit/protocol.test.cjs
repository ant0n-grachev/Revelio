const test = require('node:test');
const assert = require('node:assert/strict');
const { validateEnvelope } = require('../../protocol.js');

function envelope() {
  return {
    ok: true, documentId: 'document-1', scanId: 'scan-1',
    report: {
      status: 'complete', mode: 'default', findings: [{
        id: 'finding-1', rootId: 'root-1', source: 'document', selector: '#secret',
        snippet: '<img src=x onerror=alert(1)>', reasons: ['Transparent text'],
        evidence: [{ id: 'color-alpha', message: 'Transparent text', alpha: 0 }], score: 6,
      }],
      coverage: {
        complete: true, stopReason: null, visitedNodes: 10, elapsedMs: 3,
        roots: [{ id: 'root-1', source: 'document', status: 'scanned' }],
        skippedFrames: 0, omitted: 0,
      },
    },
  };
}

test('validates literal untrusted text without interpreting it', () => {
  assert.equal(validateEnvelope(envelope(), { documentId: 'document-1', scanId: 'scan-1' }), true);
});

test('rejects stale document and scan identities', () => {
  assert.equal(validateEnvelope(envelope(), { documentId: 'other' }), false);
  assert.equal(validateEnvelope(envelope(), { scanId: 'other' }), false);
  assert.equal(validateEnvelope(envelope(), { scanId: null }), false);
});

test('rejects malformed, oversized, and nonfinite report data', () => {
  const mutations = [
    value => { value.report.findings = 'not an array'; },
    value => { value.report.findings[0].score = NaN; },
    value => { value.report.findings[0].reasons = [42]; },
    value => { value.report.findings[0].snippet = 'x'.repeat(100001); },
    value => { value.report.coverage.visitedNodes = -1; },
    value => { value.report.coverage.roots[0].status = 'definitely-safe'; },
    value => { value.report.findings[0].evidence = [() => {}]; },
    value => { value.report.status = 'success'; },
    value => { value.report.mode = 'unrecognized'; },
    value => { value.scanId = null; },
  ];
  for (const mutate of mutations) {
    const value = envelope();
    mutate(value);
    assert.equal(validateEnvelope(value), false);
  }
  for (const value of [null, undefined, {}, { ok: false }, []]) {
    assert.equal(validateEnvelope(value), false);
  }
});

test('requires unique findings and roots with valid root references', () => {
  const duplicate = envelope();
  duplicate.report.findings.push({ ...duplicate.report.findings[0] });
  assert.equal(validateEnvelope(duplicate), false);
  const missingRoot = envelope();
  missingRoot.report.findings[0].rootId = 'page-forged-root';
  assert.equal(validateEnvelope(missingRoot), false);
  const duplicateRoot = envelope();
  duplicateRoot.report.coverage.roots.push({ ...duplicateRoot.report.coverage.roots[0] });
  assert.equal(validateEnvelope(duplicateRoot), false);
});

test('accepts explicit incomplete coverage, omissions, and idle reports', () => {
  const incomplete = envelope();
  incomplete.report.coverage.complete = false;
  incomplete.report.coverage.stopReason = 'node-budget';
  incomplete.report.coverage.omitted = 12;
  assert.equal(validateEnvelope(incomplete), true);
  const idle = envelope();
  idle.scanId = null;
  idle.report.status = 'idle';
  idle.report.findings = [];
  idle.report.coverage.roots = [];
  idle.report.coverage.complete = false;
  assert.equal(validateEnvelope(idle, { scanId: null }), true);
});

test('rejects contradictory complete coverage and malformed structured evidence', () => {
  for (const mutate of [
    value => { value.report.coverage.roots[0].status = 'interrupted'; },
    value => { value.report.coverage.stopReason = 'time-budget'; },
    value => { value.report.coverage.skippedFrames = 1; },
    value => { value.report.status = 'cancelled'; },
    value => { value.report.findings[0].evidence = [{}]; },
    value => { value.report.findings[0].evidence = ['transparent']; },
  ]) {
    const value = envelope(); mutate(value);
    assert.equal(validateEnvelope(value), false);
  }
});
