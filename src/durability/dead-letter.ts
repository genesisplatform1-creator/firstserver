/**
 * Dead-Letter Queue - Failed Event Storage
 * 
 * Stores events that failed all retry attempts for later inspection and manual replay.
 */

import { getEventStore } from './event-store.js';

/**
 * Dead-letter entry
 */
export interface DeadLetterEntry {
    id: string;
    originalEventId: string;
    entityId: string;
    eventType: string;
    payload: unknown;
    error: string;
    attempts: number;
    firstFailure: number;
    lastFailure: number;
    metadata?: Record<string, unknown>;
}

/**
 * Retry configuration with exponential backoff
 */
export interface RetryConfig {
    maxAttempts: number;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxAttempts: 3,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
};

/**
 * Calculate delay for attempt number (0-indexed)
 */
export function calculateBackoffDelay(attempt: number, config: RetryConfig = DEFAULT_RETRY_CONFIG): number {
    const delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt);
    return Math.min(delay, config.maxDelayMs);
}

/**
 * Dead-Letter Queue for permanently failed events
 */
export class DeadLetterQueue {
    private entries: Map<string, DeadLetterEntry> = new Map();
    private idCounter = 0;

    /**
     * Add a failed event to the queue
     */
    add(entry: Omit<DeadLetterEntry, 'id'>): DeadLetterEntry {
        const id = `dlq_${++this.idCounter}_${Date.now()}`;
        const fullEntry: DeadLetterEntry = { ...entry, id };
        this.entries.set(id, fullEntry);

        // Also persist to event store for durability
        const store = getEventStore();
        store.append(entry.entityId, 'dlq.added', {
            deadLetterId: id,
            originalEventId: entry.originalEventId,
            error: entry.error,
            attempts: entry.attempts,
        });

        return fullEntry;
    }

    /**
     * Get all dead-letter entries
     */
    getAll(): DeadLetterEntry[] {
        return Array.from(this.entries.values());
    }

    /**
     * Get entries by entity ID
     */
    getByEntity(entityId: string): DeadLetterEntry[] {
        return Array.from(this.entries.values()).filter(e => e.entityId === entityId);
    }

    /**
     * Get a specific entry
     */
    get(id: string): DeadLetterEntry | undefined {
        return this.entries.get(id);
    }

    /**
     * Remove an entry (after successful replay or manual resolution)
     */
    remove(id: string): boolean {
        const entry = this.entries.get(id);
        if (entry) {
            this.entries.delete(id);
            const store = getEventStore();
            store.append(entry.entityId, 'dlq.removed', { deadLetterId: id });
            return true;
        }
        return false;
    }

    /**
     * Get queue size
     */
    size(): number {
        return this.entries.size;
    }

    /**
     * Clear the queue
     */
    clear(): void {
        this.entries.clear();
    }
}

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    config: Partial<RetryConfig> = {}
): Promise<{ success: boolean; result?: T; error?: string; attempts: number }> {
    const cfg = { ...DEFAULT_RETRY_CONFIG, ...config };
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < cfg.maxAttempts; attempt++) {
        try {
            const result = await fn();
            return { success: true, result, attempts: attempt + 1 };
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            if (attempt < cfg.maxAttempts - 1) {
                const delay = calculateBackoffDelay(attempt, cfg);
                await sleep(delay);
            }
        }
    }

    return {
        success: false,
        error: lastError?.message ?? 'Unknown error',
        attempts: cfg.maxAttempts,
    };
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Singleton
let dlqInstance: DeadLetterQueue | undefined;

export function getDeadLetterQueue(): DeadLetterQueue {
    if (!dlqInstance) {
        dlqInstance = new DeadLetterQueue();
    }
    return dlqInstance;
}

export function resetDeadLetterQueue(): void {
    dlqInstance = new DeadLetterQueue();
}
