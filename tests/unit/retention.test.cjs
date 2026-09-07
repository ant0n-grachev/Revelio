const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRetainer } = require('../../retention.js');
const compare = (a, b) => b.score - a.score || a.order - b.order;
const item = (id, score, order = Number(id)) => ({ id: String(id), score, order });
test('late high-priority result displaces weakest with deterministic ties', () => {
  const r = createRetainer(2, compare);
  r.offer(item(1, 3)); r.offer(item(2, 3)); r.offer(item(3, 3)); r.offer(item(4, 9));
  assert.deepEqual(r.values().map(x => x.id), ['4', '1']);
  assert.equal(r.omitted, 2);
});
test('updates same target before consuming another retained slot', () => {
  const r = createRetainer(2, compare);
  r.offer(item(1, 3)); r.offer(item(1, 8)); r.offer(item(2, 4));
  assert.deepEqual(r.values().map(x => x.id), ['1', '2']);
  assert.equal(r.omitted, 0);
});
test('evicted target can return after combined evidence changes its rank', () => {
  const r = createRetainer(1, compare);
  r.offer(item(1, 3)); r.offer(item(2, 4)); r.offer(item(1, 8));
  assert.equal(r.values()[0].id, '1'); assert.equal(r.omitted, 1);
});
test('capacity is bounded independently of number of eligible candidates', () => {
  const r = createRetainer(800, compare);
  for (let i = 0; i < 3000; i++) r.offer(item(i, i));
  assert.equal(r.values().length, 800); assert.equal(r.omitted, 2200);
  assert.equal(r.values()[0].id, '2999');
});
