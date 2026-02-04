/**
 * Request Router - Fast routing with priority classification
 * 
 * Features:
 * - Tool name pattern matching for priority classification
 * - Cache-first lookup strategy
 * - Parallel execution for independent calls
 * - Request batching support
 */

import { getL1Cache } from '../cache/index.js';
import { getScheduler, Priority, type TaskResult } from './scheduler.js';

/**
 * Tool priority classification rules
 */
const PRIORITY_RULES: Array<{ pattern: RegExp; priority: Priority }> = [
    // CRITICAL: Interactive, user-blocking
    { pattern: /^(autocomplete|hover|signature|definition)/, priority: Priority.CRITICAL },

    // HIGH: Visible UI updates
    { pattern: /^(lint|diagnose|highlight|format)/, priority: Priority.HIGH },

    // NORMAL: Background analysis
    { pattern: /^(analyze|check|scan|complexity)/, priority: Priority.NORMAL },

    // LOW: Speculative/optional
    { pattern: /^(suggest|recommend|predict)/, priority: Priority.LOW },

    // BATCH: Heavy computation
    { pattern: /^(refactor|migrate|generate|synthesize|genetic|simulate)/, priority: Priority.BATCH },
];

/**
 * Routed request
 */
export interface RoutedRequest<T = unknown> {
    toolName: string;
    args: T;
    priority: Priority;
    cacheKey?: string;
    skipCache?: boolean;
}

/**
 * Router options
 */
export interface RouterOptions {
    /** Enable caching (default: true) */
    cacheEnabled?: boolean;
    /** Cache TTL in ms (default: 5 minutes) */
    cacheTtl?: number;
    /** Enable request batching (default: true) */
    batchingEnabled?: boolean;
    /** Batch window in ms (default: 50) */
    batchWindow?: number;
}

const DEFAULT_OPTIONS: Required<RouterOptions> = {
    cacheEnabled: true,
    cacheTtl: 5 * 60 * 1000,
    batchingEnabled: true,
    batchWindow: 50,
};

/**
 * Pending batch entry
 */
interface PendingBatch {
    request: RoutedRequest;
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
}

/**
 * Request router with caching and batching
 */
export class Router {
    private options: Required<RouterOptions>;
    private pendingBatches: Map<string, PendingBatch[]> = new Map();
    private batchTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

    constructor(options: RouterOptions = {}) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }

    /**
     * Classify priority for a tool
     */
    classifyPriority(toolName: string): Priority {
        for (const rule of PRIORITY_RULES) {
            if (rule.pattern.test(toolName)) {
                return rule.priority;
            }
        }
        return Priority.NORMAL;
    }

    /**
     * Route a request through cache and scheduler
     */
    async route<T, R>(
        request: RoutedRequest<T>,
        handler: (args: T) => Promise<R>
    ): Promise<R> {
        const cache = getL1Cache();
        const scheduler = getScheduler();

        // Generate cache key if not provided
        const cacheKey = request.cacheKey ?? cache.generateKey(request.toolName, request.args);

        // Check cache first (unless skip requested)
        if (this.options.cacheEnabled && !request.skipCache) {
            const cached = cache.get<R>(cacheKey);
            if (cached !== undefined) {
                return cached;
            }
        }

        // Schedule execution based on priority
        const result = await scheduler.schedule(
            request.priority,
            async () => handler(request.args)
        );

        if (!result.success) {
            throw result.error ?? new Error('Task execution failed');
        }

        // Cache successful results
        if (this.options.cacheEnabled && result.value !== undefined) {
            cache.set(cacheKey, result.value, this.options.cacheTtl);
        }

        return result.value as R;
    }

    /**
     * Route with batching support
     * Accumulates requests for batch window, then executes together
     */
    async routeBatched<T, R>(
        request: RoutedRequest<T>,
        batchHandler: (args: T[]) => Promise<R[]>
    ): Promise<R> {
        if (!this.options.batchingEnabled) {
            // Fall back to individual execution
            return this.route(request, async (args) => {
                const results = await batchHandler([args]);
                return results[0] as R;
            });
        }

        return new Promise((resolve, reject) => {
            const batchKey = request.toolName;

            // Add to pending batch
            const pending = this.pendingBatches.get(batchKey) ?? [];
            pending.push({
                request,
                resolve: resolve as (result: unknown) => void,
                reject,
            });
            this.pendingBatches.set(batchKey, pending);

            // Set timer if not already set
            if (!this.batchTimers.has(batchKey)) {
                const timer = setTimeout(() => {
                    this.flushBatch(batchKey, batchHandler as (args: unknown[]) => Promise<unknown[]>);
                }, this.options.batchWindow);
                this.batchTimers.set(batchKey, timer);
            }
        });
    }

    /**
     * Execute multiple requests in parallel
     */
    async parallel<T, R>(
        requests: Array<RoutedRequest<T>>,
        handler: (args: T) => Promise<R>
    ): Promise<R[]> {
        return Promise.all(
            requests.map(request => this.route(request, handler))
        );
    }

    // ========================================================================
    // Private methods
    // ========================================================================

    private async flushBatch<T, R>(
        batchKey: string,
        handler: (args: T[]) => Promise<R[]>
    ): Promise<void> {
        // Get and clear pending batch
        const pending = this.pendingBatches.get(batchKey) ?? [];
        this.pendingBatches.delete(batchKey);
        this.batchTimers.delete(batchKey);

        if (pending.length === 0) {
            return;
        }

        try {
            // Execute batch
            const args = pending.map(p => p.request.args as T);
            const results = await handler(args);

            // Distribute results
            for (let i = 0; i < pending.length; i++) {
                pending[i]?.resolve(results[i]);
            }
        } catch (error) {
            // Propagate error to all pending requests
            const err = error instanceof Error ? error : new Error(String(error));
            for (const p of pending) {
                p.reject(err);
            }
        }
    }
}

// ============================================================================
// Singleton instance
// ============================================================================

let globalRouter: Router | null = null;

/**
 * Get the global router instance
 */
export function getRouter(options?: RouterOptions): Router {
    if (globalRouter === null) {
        globalRouter = new Router(options);
    }
    return globalRouter;
}

/**
 * Reset the global router (for testing)
 */
export function resetRouter(): void {
    globalRouter = null;
}
