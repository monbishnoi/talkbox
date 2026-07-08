import { randomUUID } from 'node:crypto';

export class DetailCache {
  constructor(limit = 50) {
    this.limit = limit;
    this.items = new Map();
  }

  put(entry) {
    const key = entry.cacheKey || `turn-${randomUUID()}`;
    this.items.set(key, {
      ...entry,
      cacheKey: key,
      savedAt: new Date().toISOString(),
    });

    while (this.items.size > this.limit) {
      const oldest = this.items.keys().next().value;
      this.items.delete(oldest);
    }

    return this.items.get(key);
  }

  get(key) {
    return this.items.get(key) || null;
  }
}

export const detailCache = new DetailCache();
