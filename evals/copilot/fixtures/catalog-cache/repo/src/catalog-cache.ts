import type { CatalogItem, FetchCatalogItem } from "./types.ts";

export type CatalogCacheOptions = {
  ttlMs: number;
  fetchItem: FetchCatalogItem;
  now?: () => number;
};

type CacheEntry = {
  expiresAt: number;
  promise: Promise<CatalogItem>;
};

export class CatalogCache {
  private readonly ttlMs: number;
  private readonly fetchItem: FetchCatalogItem;
  private readonly now: () => number;
  private readonly entries = new Map<string, CacheEntry>();

  constructor(options: CatalogCacheOptions) {
    if (options.ttlMs <= 0) throw new RangeError("ttlMs must be positive");
    this.ttlMs = options.ttlMs;
    this.fetchItem = options.fetchItem;
    this.now = options.now ?? Date.now;
  }

  async getItem(id: string): Promise<CatalogItem> {
    const cached = this.entries.get(id);
    if (cached && cached.expiresAt > this.now()) {
      return cached.promise;
    }

    const promise = this.fetchItem(id);
    try {
      const item = await promise;
      this.entries.set(id, { expiresAt: this.now() + this.ttlMs, promise });
      return item;
    } catch (error) {
      this.entries.set(id, { expiresAt: this.now() + this.ttlMs, promise });
      throw error;
    }
  }

  async getMany(ids: string[]): Promise<CatalogItem[]> {
    return Promise.all(ids.map((id) => this.getItem(id)));
  }

  forget(id: string): boolean {
    return this.entries.delete(id);
  }

  get size(): number {
    return this.entries.size;
  }
}
