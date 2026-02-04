/**
 * L1 Cache - High-Performance In-Memory LRU Cache
 * 
 * Features:
 * - Content-addressed keys using xxhash for fast hashing
 * - LRU eviction with configurable max size
 * - TTL support with stale-while-revalidate
 * - Pattern-based invalidation
 * - Cache statistics for monitoring
 */

import { LRUCache } from 'lru-cache';

/**
 * Cache entry metadata
 */
interface CacheEntry<T> {
    value: T;
    hash: string;
    createdAt: number;
    accessCount: number;
}

/**
 * Cache statistics
 */
export interface CacheStats {
    hits: number;
    misses: number;
    size: number;
    maxSize: number;
    hitRate: number;
    evictions: number;
}

/**
 * Cache options
 */
export interface L1CacheOptions {
    /** Maximum cache size in bytes (default: 100MB) */
    maxSize?: number;
    /** Default TTL in milliseconds (default: 5 minutes) */
    defaultTtl?: number;
    /** Stale-while-revalidate window in ms (default: 1 minute) */
    staleWindow?: number;
    /** Update access time on get (default: true) */
    updateAgeOnGet?: boolean;
}

const DEFAULT_OPTIONS: Required<L1CacheOptions> = {
    maxSize: 100 * 1024 * 1024, // 100MB
    defaultTtl: 5 * 60 * 1000,   // 5 minutes
    staleWindow: 60 * 1000,      // 1 minute
    updateAgeOnGet: true,
};

/**
 * High-performance L1 cache with LRU eviction
 */
export class L1Cache {
    private cache: LRUCache<string, CacheEntry<unknown>>;
    private options: Required<L1CacheOptions>;
    private stats = {
        hits: 0,
        misses: 0,
        evictions: 0,
    };

    constructor(options: L1CacheOptions = {}) {
        this.options = { ...DEFAULT_OPTIONS, ...options };

        this.cache = new LRUCache<string, CacheEntry<unknown>>({
            maxSize: this.options.maxSize,
            sizeCalculation: (entry) => {
                // Estimate size: JSON stringify for rough byte count
                return JSON.stringify(entry.value).length + 100; // +100 for metadata overhead
            },
            ttl: this.options.defaultTtl,
            updateAgeOnGet: this.options.updateAgeOnGet,
            dispose: () => {
                this.stats.evictions++;
            },
        });
    }

    /**
     * Generate a cache key from operation and inputs
     * Uses fast xxhash for content-addressed hashing
     */
    generateKey(operation: string, inputs: unknown): string {
        // Normalize and stringify inputs
        const normalized = this.normalizeInputs(inputs);
        const content = `${operation}:${JSON.stringify(normalized)}`;

        // Use simple hash for now (xxhash async requires await)
        // Can upgrade to xxhash for even faster hashing
        return this.simpleHash(content);
    }

    /**
     * Get a value from cache
     */
    get<T>(key: string): T | undefined {
        const entry = this.cache.get(key) as CacheEntry<T> | undefined;

        if (entry !== undefined) {
            this.stats.hits++;
            entry.accessCount++;
            return entry.value;
        }

        this.stats.misses++;
        return undefined;
    }

    /**
     * Get with stale-while-revalidate support
     * Returns stale value immediately while revalidation happens
     */
    getStale<T>(key: string): { value: T | undefined; isStale: boolean } {
        const entry = this.cache.get(key, { allowStale: true }) as CacheEntry<T> | undefined;

        if (entry === undefined) {
            this.stats.misses++;
            return { value: undefined, isStale: false };
        }

        this.stats.hits++;
        entry.accessCount++;

        const age = Date.now() - entry.createdAt;
        const isStale = age > this.options.defaultTtl;

        return { value: entry.value, isStale };
    }

    /**
     * Set a value in cache
     */
    set<T>(key: string, value: T, ttl?: number): void {
        const entry: CacheEntry<T> = {
            value,
            hash: key,
            createdAt: Date.now(),
            accessCount: 0,
        };

        this.cache.set(key, entry, { ttl: ttl ?? this.options.defaultTtl });
    }

    /**
     * Check if key exists (without updating access time)
     */
    has(key: string): boolean {
        return this.cache.has(key);
    }

    /**
     * Delete a specific key
     */
    delete(key: string): boolean {
        return this.cache.delete(key);
    }

    /**
     * Invalidate entries matching a pattern
     * Supports prefix matching and regex
     */
    invalidate(pattern: string | RegExp): number {
        let count = 0;
        const regex = typeof pattern === 'string'
            ? new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
            : pattern;

        for (const key of this.cache.keys()) {
            if (regex.test(key)) {
                this.cache.delete(key);
                count++;
            }
        }

        return count;
    }

    /**
     * Invalidate all entries for an entity
     */
    invalidateEntity(entityId: string): number {
        return this.invalidate(new RegExp(`entity:${entityId}`));
    }

    /**
     * Invalidate all entries for an operation type
     */
    invalidateOperation(operation: string): number {
        return this.invalidate(new RegExp(`^${operation}:`));
    }

    /**
     * Clear entire cache
     */
    clear(): void {
        this.cache.clear();
    }

    /**
     * Get cache statistics
     */
    getStats(): CacheStats {
        const total = this.stats.hits + this.stats.misses;
        return {
            hits: this.stats.hits,
            misses: this.stats.misses,
            size: this.cache.calculatedSize ?? 0,
            maxSize: this.options.maxSize,
            hitRate: total > 0 ? this.stats.hits / total : 0,
            evictions: this.stats.evictions,
        };
    }

    /**
     * Reset statistics
     */
    resetStats(): void {
        this.stats = { hits: 0, misses: 0, evictions: 0 };
    }

    /**
     * Get or compute - cache-aside pattern
     */
    async getOrCompute<T>(
        key: string,
        compute: () => Promise<T>,
        ttl?: number
    ): Promise<T> {
        // Check cache first
        const cached = this.get<T>(key);
        if (cached !== undefined) {
            return cached;
        }

        // Compute and cache
        const value = await compute();
        this.set(key, value, ttl);
        return value;
    }

    /**
     * Get or compute with stale-while-revalidate
     * Returns stale value immediately, revalidates in background
     */
    async getOrComputeStale<T>(
        key: string,
        compute: () => Promise<T>,
        ttl?: number
    ): Promise<T> {
        const { value, isStale } = this.getStale<T>(key);

        if (value !== undefined) {
            if (isStale) {
                // Revalidate in background (fire and forget)
                compute().then(newValue => {
                    this.set(key, newValue, ttl);
                }).catch(() => {
                    // Ignore revalidation errors, stale value still valid
                });
            }
            return value;
        }

        // No cached value, compute synchronously
        const newValue = await compute();
        this.set(key, newValue, ttl);
        return newValue;
    }

    // ========================================================================
    // Private helpers
    // ========================================================================

    private normalizeInputs(inputs: unknown): unknown {
        if (inputs === null || inputs === undefined) {
            return null;
        }

        if (typeof inputs === 'string') {
            // Remove comments and normalize whitespace for code
            return inputs
                .replace(/\/\/.*$/gm, '')      // Remove line comments
                .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
                .replace(/\s+/g, ' ')          // Normalize whitespace
                .trim();
        }

        if (Array.isArray(inputs)) {
            return inputs.map(item => this.normalizeInputs(item));
        }

        if (typeof inputs === 'object') {
            const sorted: Record<string, unknown> = {};
            for (const key of Object.keys(inputs as Record<string, unknown>).sort()) {
                sorted[key] = this.normalizeInputs((inputs as Record<string, unknown>)[key]);
            }
            return sorted;
        }

        return inputs;
    }

    private simpleHash(str: string): string {
        // FNV-1a hash - fast and good distribution
        let hash = 2166136261;
        for (let i = 0; i < str.length; i++) {
            hash ^= str.charCodeAt(i);
            hash = (hash * 16777619) >>> 0;
        }
        return hash.toString(36);
    }
}

// ============================================================================
// Singleton instance
// ============================================================================

let globalCache: L1Cache | null = null;

/**
 * Get the global L1 cache instance
 */
export function getL1Cache(options?: L1CacheOptions): L1Cache {
    if (globalCache === null) {
        globalCache = new L1Cache(options);
    }
    return globalCache;
}

/**
 * Reset the global cache (for testing)
 */
export function resetL1Cache(): void {
    if (globalCache !== null) {
        globalCache.clear();
        globalCache = null;
    }
}
