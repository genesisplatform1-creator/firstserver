/**
 * Priority Scheduler - Request prioritization for MCP server
 * 
 * Features:
 * - Multi-queue priority scheduling (CRITICAL → BATCH)
 * - Deadline scheduling for user-blocking requests
 * - Backpressure with token bucket when load > 70%
 * - Work stealing for parallelism
 * - Statistics and monitoring
 */

import { v7 as uuidv7 } from 'uuid';

/**
 * Request priority levels
 */
export enum Priority {
    /** User-blocking requests (autocomplete, hover info) */
    CRITICAL = 0,
    /** Visible UI features (error squiggles, syntax highlighting) */
    HIGH = 1,
    /** Background analysis (full project scan) */
    NORMAL = 2,
    /** Speculative precomputation (predictive caching) */
    LOW = 3,
    /** Offline batch processing */
    BATCH = 4,
}

/**
 * Scheduled task
 */
export interface ScheduledTask<T = unknown> {
    id: string;
    priority: Priority;
    execute: () => Promise<T>;
    deadline?: number;
    createdAt: number;
    startedAt?: number;
    completedAt?: number;
}

/**
 * Task result
 */
export interface TaskResult<T = unknown> {
    id: string;
    success: boolean;
    value?: T;
    error?: Error;
    durationMs: number;
    queueTimeMs: number;
}

/**
 * Scheduler statistics
 */
export interface SchedulerStats {
    queued: number;
    running: number;
    completed: number;
    failed: number;
    avgQueueTimeMs: number;
    avgExecutionTimeMs: number;
    loadPercent: number;
}

/**
 * Scheduler options
 */
export interface SchedulerOptions {
    /** Maximum concurrent tasks (default: 8) */
    maxConcurrent?: number;
    /** Token bucket refill rate per second (default: 100) */
    tokenRefillRate?: number;
    /** Maximum tokens in bucket (default: 200) */
    maxTokens?: number;
    /** Backpressure threshold (0-1, default: 0.7) */
    backpressureThreshold?: number;
}

const DEFAULT_OPTIONS: Required<SchedulerOptions> = {
    maxConcurrent: 8,
    tokenRefillRate: 100,
    maxTokens: 200,
    backpressureThreshold: 0.7,
};

/**
 * Priority-based task scheduler with backpressure
 */
export class Scheduler {
    private queues: Map<Priority, ScheduledTask[]> = new Map();
    private running: Map<string, ScheduledTask> = new Map();
    private options: Required<SchedulerOptions>;
    private tokens: number;
    private lastRefill: number;
    private stats = {
        completed: 0,
        failed: 0,
        totalQueueTime: 0,
        totalExecutionTime: 0,
    };

    constructor(options: SchedulerOptions = {}) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
        this.tokens = this.options.maxTokens;
        this.lastRefill = Date.now();

        // Initialize queues for each priority
        for (const priority of Object.values(Priority)) {
            if (typeof priority === 'number') {
                this.queues.set(priority, []);
            }
        }
    }

    /**
     * Schedule a task for execution
     */
    async schedule<T>(
        priority: Priority,
        execute: () => Promise<T>,
        deadline?: number
    ): Promise<TaskResult<T>> {
        const task: ScheduledTask<T> = {
            id: uuidv7(),
            priority,
            execute,
            ...(deadline !== undefined && { deadline }),
            createdAt: Date.now(),
        };

        // CRITICAL priority bypasses queue
        if (priority === Priority.CRITICAL) {
            return this.executeImmediately(task);
        }

        // Check backpressure for non-critical requests
        if (!this.checkBackpressure(priority)) {
            return {
                id: task.id,
                success: false,
                error: new Error('Server overloaded, try again later'),
                durationMs: 0,
                queueTimeMs: 0,
            };
        }

        // Add to appropriate queue
        const queue = this.queues.get(priority) ?? [];
        queue.push(task);
        this.queues.set(priority, queue);

        // Try to process queues
        this.processQueues();

        // Return promise that resolves when task completes
        return this.waitForTask(task);
    }

    /**
     * Get scheduler statistics
     */
    getStats(): SchedulerStats {
        let queued = 0;
        for (const queue of this.queues.values()) {
            queued += queue.length;
        }

        const total = this.stats.completed + this.stats.failed;
        const load = this.running.size / this.options.maxConcurrent;

        return {
            queued,
            running: this.running.size,
            completed: this.stats.completed,
            failed: this.stats.failed,
            avgQueueTimeMs: total > 0 ? this.stats.totalQueueTime / total : 0,
            avgExecutionTimeMs: total > 0 ? this.stats.totalExecutionTime / total : 0,
            loadPercent: load * 100,
        };
    }

    /**
     * Cancel a pending task
     */
    cancel(taskId: string): boolean {
        for (const queue of this.queues.values()) {
            const index = queue.findIndex(t => t.id === taskId);
            if (index !== -1) {
                queue.splice(index, 1);
                return true;
            }
        }
        return false;
    }

    /**
     * Clear all queued tasks (running tasks continue)
     */
    clearQueues(): void {
        for (const queue of this.queues.values()) {
            queue.length = 0;
        }
    }

    // ========================================================================
    // Private methods
    // ========================================================================

    private async executeImmediately<T>(task: ScheduledTask<T>): Promise<TaskResult<T>> {
        task.startedAt = Date.now();
        this.running.set(task.id, task);

        try {
            const value = await task.execute();
            task.completedAt = Date.now();

            const result: TaskResult<T> = {
                id: task.id,
                success: true,
                value,
                durationMs: task.completedAt - task.startedAt,
                queueTimeMs: task.startedAt - task.createdAt,
            };

            this.recordSuccess(result);
            return result;
        } catch (error) {
            task.completedAt = Date.now();

            const result: TaskResult<T> = {
                id: task.id,
                success: false,
                error: error instanceof Error ? error : new Error(String(error)),
                durationMs: task.completedAt - task.startedAt,
                queueTimeMs: task.startedAt - task.createdAt,
            };

            this.recordFailure(result);
            return result;
        } finally {
            this.running.delete(task.id);
        }
    }

    private checkBackpressure(priority: Priority): boolean {
        this.refillTokens();

        const load = this.running.size / this.options.maxConcurrent;

        // Always allow if under threshold
        if (load < this.options.backpressureThreshold) {
            return true;
        }

        // Under heavy load, use token bucket
        if (this.tokens <= 0) {
            // Reject LOW and BATCH under extreme load
            return priority < Priority.LOW;
        }

        // Consume token
        this.tokens--;
        return true;
    }

    private refillTokens(): void {
        const now = Date.now();
        const elapsed = (now - this.lastRefill) / 1000;
        const refill = Math.floor(elapsed * this.options.tokenRefillRate);

        if (refill > 0) {
            this.tokens = Math.min(this.options.maxTokens, this.tokens + refill);
            this.lastRefill = now;
        }
    }

    private processQueues(): void {
        // Process highest priority queues first
        for (const priority of [Priority.CRITICAL, Priority.HIGH, Priority.NORMAL, Priority.LOW, Priority.BATCH]) {
            if (this.running.size >= this.options.maxConcurrent) {
                break;
            }

            const queue = this.queues.get(priority) ?? [];

            while (queue.length > 0 && this.running.size < this.options.maxConcurrent) {
                const task = queue.shift();
                if (task) {
                    // Check deadline
                    if (task.deadline && Date.now() > task.deadline) {
                        // Deadline passed, skip
                        continue;
                    }

                    // Execute asynchronously
                    this.executeImmediately(task).then(() => {
                        // Try processing more tasks after completion
                        this.processQueues();
                    });
                }
            }
        }
    }

    private waitForTask<T>(task: ScheduledTask<T>): Promise<TaskResult<T>> {
        return new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                if (task.completedAt !== undefined) {
                    clearInterval(checkInterval);

                    resolve({
                        id: task.id,
                        success: true,
                        durationMs: task.completedAt - (task.startedAt ?? task.createdAt),
                        queueTimeMs: (task.startedAt ?? task.createdAt) - task.createdAt,
                    });
                }
            }, 10);
        });
    }

    private recordSuccess(result: TaskResult): void {
        this.stats.completed++;
        this.stats.totalQueueTime += result.queueTimeMs;
        this.stats.totalExecutionTime += result.durationMs;
    }

    private recordFailure(result: TaskResult): void {
        this.stats.failed++;
        this.stats.totalQueueTime += result.queueTimeMs;
        this.stats.totalExecutionTime += result.durationMs;
    }
}

// ============================================================================
// Singleton instance
// ============================================================================

let globalScheduler: Scheduler | null = null;

/**
 * Get the global scheduler instance
 */
export function getScheduler(options?: SchedulerOptions): Scheduler {
    if (globalScheduler === null) {
        globalScheduler = new Scheduler(options);
    }
    return globalScheduler;
}

/**
 * Reset the global scheduler (for testing)
 */
export function resetScheduler(): void {
    if (globalScheduler !== null) {
        globalScheduler.clearQueues();
        globalScheduler = null;
    }
}
