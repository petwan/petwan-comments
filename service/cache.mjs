/**
 * A TTL map with a bounded size.
 *
 * The service caches two things: the slug -> discussion index, and the
 * rendered thread. Both are keyed by strings the site controls, so the
 * key space is small — but a cap keeps a bug from turning into an
 * unbounded heap.
 */

export class TtlCache {
  /** @param {number} ttlMs */
  constructor(ttlMs, maxEntries = 500) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    /** @type {Map<string, {value: unknown, expires: number}>} */
    this.entries = new Map();
  }

  /**
   * @param {string} key
   * @returns {unknown | undefined} the cached value, or undefined when absent
   *   or expired
   */
  get(key) {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expires <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  /** @param {string} key @param {unknown} value */
  set(key, value) {
    if (this.entries.size >= this.maxEntries) {
      // The Map iterates in insertion order, so the first key is the oldest.
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expires: Date.now() + this.ttlMs });
    return value;
  }

  delete(key) {
    return this.entries.delete(key);
  }
}
