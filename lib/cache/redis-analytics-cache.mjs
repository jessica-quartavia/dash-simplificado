/**
 * Cache analítico persistente via Upstash Redis REST (compatível Vercel KV).
 * Falhas Redis são absorvidas — nunca derrubam handlers (fail-open via ResilientAnalyticsCache).
 */
export class RedisAnalyticsCache {
  /**
   * @param {{ url: string, token: string }} config
   */
  constructor(config) {
    this.url = String(config.url || "").replace(/\/$/, "");
    this.token = String(config.token || "").trim();
    this.inflight = new Map();
    this.provider = "redis";
  }

  async command(...args) {
    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const err = new Error(`Redis HTTP ${response.status}: ${detail.slice(0, 120)}`);
      err.code = "REDIS_ERROR";
      throw err;
    }
    const payload = await response.json();
    return payload?.result ?? null;
  }

  async get(key) {
    try {
      const raw = await this.command("GET", key);
      if (!raw) return null;
      const row = JSON.parse(raw);
      if (!row?.value || Date.now() > row.expiresAt) {
        await this.del(key).catch(() => {});
        return null;
      }
      return { value: row.value, cachedAt: row.cachedAt, expiresAt: row.expiresAt };
    } catch {
      return null;
    }
  }

  async set(key, value, ttlMs) {
    try {
      const cachedAt = Date.now();
      const row = { value, cachedAt, expiresAt: cachedAt + ttlMs };
      const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
      await this.command("SET", key, JSON.stringify(row), "EX", ttlSeconds);
    } catch (error) {
      console.warn("[Cache] Redis SET failed:", error instanceof Error ? error.message : error);
    }
  }

  async del(key) {
    this.inflight.delete(key);
    try {
      await this.command("DEL", key);
    } catch {
      /* ignore */
    }
  }

  clear(prefix = null) {
    this.inflight.clear();
    if (!prefix) return;
    void this.command("EVAL", `for _,k in ipairs(redis.call('keys', ARGV[1])) do redis.call('del', k) end`, "0", `${prefix}*`).catch(
      () => {},
    );
  }

  /**
   * Coalescing local + persistência Redis.
   * Falha em Redis não impede compute — exceção só se computeFn falhar.
   */
  async getOrCompute(key, ttlMs, computeFn, { force = false } = {}) {
    if (!force) {
      try {
        const hit = await this.get(key);
        if (hit) return { ...hit, cacheHit: true, cacheKey: key, provider: this.provider };
      } catch {
        /* fall through to compute */
      }
    } else {
      await this.del(key);
    }

    if (this.inflight.has(key)) {
      const value = await this.inflight.get(key);
      return {
        value,
        cachedAt: Date.now(),
        expiresAt: Date.now() + ttlMs,
        cacheHit: false,
        coalesced: true,
        cacheKey: key,
        provider: this.provider,
      };
    }

    const promise = Promise.resolve().then(computeFn);
    this.inflight.set(key, promise);
    try {
      const value = await promise;
      await this.set(key, value, ttlMs);
      const stored = await this.get(key);
      return {
        ...(stored || { value, cachedAt: Date.now(), expiresAt: Date.now() + ttlMs }),
        cacheHit: false,
        cacheKey: key,
        provider: this.provider,
      };
    } finally {
      this.inflight.delete(key);
    }
  }

  stats() {
    return { provider: this.provider, inflight: this.inflight.size };
  }
}
