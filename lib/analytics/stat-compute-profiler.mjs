/**
 * Profiler leve para compute de Cruzamentos Estatísticos.
 */
export function createStatComputeProfiler(enabled = false) {
  const blocks = new Map();
  let fetchMs = 0;
  let serializationMs = 0;
  const startedAt = Date.now();

  function mark(name, fn) {
    if (!enabled) return fn();
    const t0 = Date.now();
    const result = fn();
    const elapsed = Date.now() - t0;
    blocks.set(name, (blocks.get(name) || 0) + elapsed);
    return result;
  }

  async function markAsync(name, fn) {
    if (!enabled) return fn();
    const t0 = Date.now();
    const result = await fn();
    const elapsed = Date.now() - t0;
    blocks.set(name, (blocks.get(name) || 0) + elapsed);
    return result;
  }

  function section(name) {
    const sub = new Map();
    return {
      mark(subName, fn) {
        if (!enabled) return fn();
        const t0 = Date.now();
        const result = fn();
        const key = `${name}.${subName}`;
        sub.set(key, (sub.get(key) || 0) + (Date.now() - t0));
        return result;
      },
      entries() {
        return Object.fromEntries([...sub.entries()].sort((a, b) => b[1] - a[1]));
      },
      mergeIntoParent() {
        for (const [key, ms] of sub.entries()) {
          blocks.set(key, (blocks.get(key) || 0) + ms);
        }
      },
    };
  }

  return {
    enabled,
    mark,
    markAsync,
    section,
    setFetchMs(ms) {
      fetchMs = ms;
    },
    setSerializationMs(ms) {
      serializationMs = ms;
    },
    snapshot() {
      const computeEntries = [...blocks.entries()].sort((a, b) => b[1] - a[1]);
      const computeMs = computeEntries
        .filter(([key]) => !String(key).includes("."))
        .reduce((sum, [, ms]) => sum + ms, 0);
      return {
        generatedAt: new Date().toISOString(),
        total_ms: Date.now() - startedAt,
        fetch_ms: fetchMs,
        compute_ms: computeMs,
        serialization_ms: serializationMs,
        blocks: Object.fromEntries(computeEntries),
      };
    },
  };
}

export function percentile(values, q) {
  const nums = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const pos = (nums.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (nums[base + 1] !== undefined) return nums[base] + rest * (nums[base + 1] - nums[base]);
  return nums[base];
}
