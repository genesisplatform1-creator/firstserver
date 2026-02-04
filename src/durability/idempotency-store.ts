/**
 * Idempotency Store - Duplicate Prevention
 * 
 * Prevents duplicate execution of operations using idempotency keys.
 * Keys are stored with TTL and result caching.
 */

/**
 * Idempotency entry
 */
export interface IdempotencyEntry {
    key: string;
    operationName: string;
    result: unknown;
    status: 'pending' | 'completed' | 'failed';
    createdAt: number;
    expiresAt: number;
}

/**
 * Idempotency configuration
 */
export interface IdempotencyConfig {
    defaultTtlMs: number;  // Default: 24 hours
    cleanupIntervalMs: number;  // How often to clean expired entries
}

const DEFAULT_CONFIG: IdempotencyConfig = {
    defaultTtlMs: 24 * 60 * 60 * 1000,  // 24 hours
    cleanupIntervalMs: 60 * 60 * 1000,  // 1 hour
};

/**
 * Idempotency Store for duplicate prevention
 */
export class IdempotencyStore {
    private entries: Map<string, IdempotencyEntry> = new Map();
    private config: IdempotencyConfig;
    private cleanupInterval: ReturnType<typeof setInterval> | undefined;

    constructor(config: Partial<IdempotencyConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Check if an operation has already been executed
     */
    has(key: string): boolean {
        const entry = this.entries.get(key);
        if (!entry) return false;

        // Check if expired
        if (Date.now() > entry.expiresAt) {
            this.entries.delete(key);
            return false;
        }

        return true;
    }

    /**
     * Get result of a previous operation
     */
    get(key: string): IdempotencyEntry | undefined {
        const entry = this.entries.get(key);
        if (!entry) return undefined;

        if (Date.now() > entry.expiresAt) {
            this.entries.delete(key);
            return undefined;
        }

        return entry;
    }

    /**
     * Start an operation (mark as pending)
     */
    start(key: string, operationName: string, ttlMs?: number): boolean {
        if (this.has(key)) {
            return false; // Already exists
        }

        const now = Date.now();
        this.entries.set(key, {
            key,
            operationName,
            result: undefined,
            status: 'pending',
            createdAt: now,
            expiresAt: now + (ttlMs ?? this.config.defaultTtlMs),
        });

        return true;
    }

    /**
     * Complete an operation with result
     */
    complete(key: string, result: unknown): void {
        const entry = this.entries.get(key);
        if (entry) {
            entry.status = 'completed';
            entry.result = result;
        }
    }

    /**
     * Mark operation as failed
     */
    fail(key: string, error: string): void {
        const entry = this.entries.get(key);
        if (entry) {
            entry.status = 'failed';
            entry.result = { error };
        }
    }

    /**
     * Remove an entry (useful for retry)
     */
    remove(key: string): boolean {
        return this.entries.delete(key);
    }

    /**
     * Execute operation with idempotency protection
     */
    async executeOnce<T>(
        key: string,
        operationName: string,
        fn: () => Promise<T>,
        ttlMs?: number
    ): Promise<{ executed: boolean; result: T | undefined; cached: boolean }> {
        // Check for existing result
        const existing = this.get(key);
        if (existing?.status === 'completed') {
            return { executed: false, result: existing.result as T, cached: true };
        }
        if (existing?.status === 'pending') {
            // Operation in progress, might be a different process
            throw new Error(`Operation "${operationName}" with key "${key}" is already in progress`);
        }

        // Start new operation
        this.start(key, operationName, ttlMs);

        try {
            const result = await fn();
            this.complete(key, result);
            return { executed: true, result, cached: false };
        } catch (error) {
            this.fail(key, error instanceof Error ? error.message : String(error));
            throw error;
        }
    }

    /**
     * Clean up expired entries
     */
    cleanup(): number {
        const now = Date.now();
        let removed = 0;

        for (const [key, entry] of this.entries) {
            if (now > entry.expiresAt) {
                this.entries.delete(key);
                removed++;
            }
        }

        return removed;
    }

    /**
     * Start automatic cleanup
     */
    startCleanup(): void {
        if (this.cleanupInterval) return;
        this.cleanupInterval = setInterval(
            () => this.cleanup(),
            this.config.cleanupIntervalMs
        );
    }

    /**
     * Stop automatic cleanup
     */
    stopCleanup(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = undefined;
        }
    }

    /**
     * Get store size
     */
    size(): number {
        return this.entries.size;
    }

    /**
     * Clear all entries
     */
    clear(): void {
        this.entries.clear();
    }
}

// Singleton
let storeInstance: IdempotencyStore | undefined;

export function getIdempotencyStore(): IdempotencyStore {
    if (!storeInstance) {
        storeInstance = new IdempotencyStore();
    }
    return storeInstance;
}

export function resetIdempotencyStore(): void {
    storeInstance?.stopCleanup();
    storeInstance = new IdempotencyStore();
}
