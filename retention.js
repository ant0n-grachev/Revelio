/* Bounded best-first retention. Traversal owns its separate work budget. */
(() => {
  function createRetainer(capacity, compare) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('Invalid result capacity');
    const retained = [];
    // IDs contain no page text; lifetime and cardinality are bounded by scan work.
    const eligible = new Set();
    return {
      offer(item) {
        eligible.add(item.id);
        const previous = retained.findIndex(value => value.id === item.id);
        if (previous !== -1) retained.splice(previous, 1);
        let low = 0, high = retained.length;
        while (low < high) {
          const mid = (low + high) >>> 1;
          if (compare(item, retained[mid]) < 0) high = mid;
          else low = mid + 1;
        }
        if (low < capacity) retained.splice(low, 0, { ...item });
        if (retained.length > capacity) retained.pop();
      },
      values: () => retained.slice(),
      get omitted() { return eligible.size - retained.length; },
    };
  }
  const api = { createRetainer };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.RevelioRetention = api;
})();
