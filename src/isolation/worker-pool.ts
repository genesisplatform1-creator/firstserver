/**
 * Worker Pool for Sub-Agent Isolation
 * 
 * Features:
 * - True process isolation via worker threads
 * - Resource limits (steps, tokens, time)
 * - Message passing with serialization
 * - Preemption via worker termination
 */

import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Sub-agent execution limits
 */
export interface ExecutionLimits {
    maxSteps: number;      // Default: 50
    maxTokens: number;     // Default: 20000
    timeoutMs: number;     // Default: 60000 (1 minute)
}

export const DEFAULT_LIMITS: ExecutionLimits = {
    maxSteps: 50,
    maxTokens: 20000,
    timeoutMs: 60000,
};

/**
 * Sub-agent task definition
 */
export interface SubAgentTask {
    id: string;
    systemPrompt: string;
    task: string;
    context: Record<string, unknown>;
    limits: ExecutionLimits;
}

/**
 * Sub-agent execution result
 */
export interface SubAgentResult {
    id: string;
    success: boolean;
    output?: unknown;
    error?: string;
    stepsUsed: number;
    tokensUsed: number;
    durationMs: number;
    terminated: boolean;
}

/**
 * Worker message types
 */
type WorkerMessage =
    | { type: 'step'; stepCount: number; tokensUsed: number }
    | { type: 'complete'; output: unknown }
    | { type: 'error'; error: string };

/**
 * Managed worker with tracking
 */
interface ManagedWorker {
    worker: Worker;
    taskId: string;
    startTime: number;
    stepsUsed: number;
    tokensUsed: number;
    limits: ExecutionLimits;
    timeoutHandle: ReturnType<typeof setTimeout>;
}

/**
 * Worker Pool for isolated sub-agent execution
 */
export class WorkerPool {
    private workers: Map<string, ManagedWorker> = new Map();
    private maxConcurrent: number;

    constructor(maxConcurrent: number = 4) {
        this.maxConcurrent = maxConcurrent;
    }

    /**
     * Execute a sub-agent task in isolation
     */
    async execute(task: SubAgentTask): Promise<SubAgentResult> {
        if (this.workers.size >= this.maxConcurrent) {
            throw new Error(`Worker pool exhausted. Max concurrent: ${this.maxConcurrent}`);
        }

        const startTime = Date.now();

        return new Promise((resolve) => {
            const workerPath = join(__dirname, 'sub-agent-worker.js');

            const worker = new Worker(workerPath, {
                workerData: {
                    taskId: task.id,
                    systemPrompt: task.systemPrompt,
                    task: task.task,
                    context: task.context,
                    limits: task.limits,
                },
            });

            // Timeout handler
            const timeoutHandle = setTimeout(() => {
                const managed = this.workers.get(task.id);
                if (managed) {
                    worker.terminate();
                    this.workers.delete(task.id);
                    resolve({
                        id: task.id,
                        success: false,
                        error: `Timeout exceeded: ${task.limits.timeoutMs}ms`,
                        stepsUsed: managed.stepsUsed,
                        tokensUsed: managed.tokensUsed,
                        durationMs: Date.now() - startTime,
                        terminated: true,
                    });
                }
            }, task.limits.timeoutMs);

            const managed: ManagedWorker = {
                worker,
                taskId: task.id,
                startTime,
                stepsUsed: 0,
                tokensUsed: 0,
                limits: task.limits,
                timeoutHandle,
            };

            this.workers.set(task.id, managed);

            worker.on('message', (message: WorkerMessage) => {
                if (message.type === 'step') {
                    managed.stepsUsed = message.stepCount;
                    managed.tokensUsed = message.tokensUsed;

                    // Check limits
                    if (message.stepCount >= task.limits.maxSteps) {
                        clearTimeout(timeoutHandle);
                        worker.terminate();
                        this.workers.delete(task.id);
                        resolve({
                            id: task.id,
                            success: false,
                            error: `Step limit exceeded: ${message.stepCount}/${task.limits.maxSteps}`,
                            stepsUsed: message.stepCount,
                            tokensUsed: message.tokensUsed,
                            durationMs: Date.now() - startTime,
                            terminated: true,
                        });
                    }

                    if (message.tokensUsed >= task.limits.maxTokens) {
                        clearTimeout(timeoutHandle);
                        worker.terminate();
                        this.workers.delete(task.id);
                        resolve({
                            id: task.id,
                            success: false,
                            error: `Token limit exceeded: ${message.tokensUsed}/${task.limits.maxTokens}`,
                            stepsUsed: message.stepCount,
                            tokensUsed: message.tokensUsed,
                            durationMs: Date.now() - startTime,
                            terminated: true,
                        });
                    }
                } else if (message.type === 'complete') {
                    clearTimeout(timeoutHandle);
                    this.workers.delete(task.id);
                    resolve({
                        id: task.id,
                        success: true,
                        output: message.output,
                        stepsUsed: managed.stepsUsed,
                        tokensUsed: managed.tokensUsed,
                        durationMs: Date.now() - startTime,
                        terminated: false,
                    });
                } else if (message.type === 'error') {
                    clearTimeout(timeoutHandle);
                    this.workers.delete(task.id);
                    resolve({
                        id: task.id,
                        success: false,
                        error: message.error,
                        stepsUsed: managed.stepsUsed,
                        tokensUsed: managed.tokensUsed,
                        durationMs: Date.now() - startTime,
                        terminated: false,
                    });
                }
            });

            worker.on('error', (error) => {
                clearTimeout(timeoutHandle);
                this.workers.delete(task.id);
                resolve({
                    id: task.id,
                    success: false,
                    error: error.message,
                    stepsUsed: managed.stepsUsed,
                    tokensUsed: managed.tokensUsed,
                    durationMs: Date.now() - startTime,
                    terminated: false,
                });
            });

            worker.on('exit', (code) => {
                if (this.workers.has(task.id)) {
                    clearTimeout(timeoutHandle);
                    this.workers.delete(task.id);
                    if (code !== 0) {
                        resolve({
                            id: task.id,
                            success: false,
                            error: `Worker exited with code ${code}`,
                            stepsUsed: managed.stepsUsed,
                            tokensUsed: managed.tokensUsed,
                            durationMs: Date.now() - startTime,
                            terminated: true,
                        });
                    }
                }
            });
        });
    }

    /**
     * Terminate a running sub-agent
     */
    terminate(taskId: string): boolean {
        const managed = this.workers.get(taskId);
        if (managed) {
            clearTimeout(managed.timeoutHandle);
            managed.worker.terminate();
            this.workers.delete(taskId);
            return true;
        }
        return false;
    }

    /**
     * Terminate all workers
     */
    terminateAll(): void {
        for (const [taskId] of this.workers) {
            this.terminate(taskId);
        }
    }

    /**
     * Get active worker count
     */
    getActiveCount(): number {
        return this.workers.size;
    }

    /**
     * Get status of a running task
     */
    getTaskStatus(taskId: string): {
        running: boolean;
        stepsUsed?: number;
        tokensUsed?: number;
        durationMs?: number;
    } {
        const managed = this.workers.get(taskId);
        if (!managed) {
            return { running: false };
        }
        return {
            running: true,
            stepsUsed: managed.stepsUsed,
            tokensUsed: managed.tokensUsed,
            durationMs: Date.now() - managed.startTime,
        };
    }
}

// Singleton pool
let poolInstance: WorkerPool | undefined;

export function getWorkerPool(): WorkerPool {
    if (!poolInstance) {
        poolInstance = new WorkerPool();
    }
    return poolInstance;
}
