/**
 * Worker Pool Coordinator
 * 
 * This is the Node.js implementation of the coordinator.
 * It speaks the worker protocol and can be replaced by Rust later.
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { LRUCache } from 'lru-cache';
import type {
  Task,
  TaskResult,
  TaskPriority,
  WorkerInfo,
  WorkerPoolConfig,
  ExecuteRequest,
  WorkerResponse,
  SuccessResponse,
  ErrorResponse,
  IWorker,
} from '../types/worker-types.js';

// ============================================================================
// Priority Queue (Simple Implementation)
// ============================================================================

class PriorityQueue<T> {
  private queues: Map<TaskPriority, T[]> = new Map([
    ['critical', []],
    ['high', []],
    ['normal', []],
    ['low', []],
    ['batch', []],
  ]);

  private priorities: TaskPriority[] = ['critical', 'high', 'normal', 'low', 'batch'];

  enqueue(item: T, priority: TaskPriority): void {
    this.queues.get(priority)!.push(item);
  }

  dequeue(): T | undefined {
    for (const priority of this.priorities) {
      const queue = this.queues.get(priority)!;
      if (queue.length > 0) {
        return queue.shift();
      }
    }
    return undefined;
  }

  get size(): number {
    return Array.from(this.queues.values()).reduce((sum, q) => sum + q.length, 0);
  }

  clear(): void {
    this.queues.forEach(q => q.length = 0);
  }
}

// ============================================================================
// Worker Interface
// ============================================================================



// ============================================================================
// Worker Pool
// ============================================================================

export class WorkerPool extends EventEmitter {
  private workers: Map<string, IWorker> = new Map();
  private taskQueue: PriorityQueue<Task> = new PriorityQueue();
  private pendingTasks: Map<string, Task> = new Map();
  private taskResolvers: Map<string, {
    resolve: (result: TaskResult) => void;
    reject: (error: Error) => void;
  }> = new Map();
  private maxQueueSize: number;
  private processing = false;
  private cache: LRUCache<string, any> | null = null;

  private metrics = {
    total_tasks: 0,
    completed_tasks: 0,
    failed_tasks: 0,
    cache_hits: 0,
    total_queue_time_ms: 0,
    total_execution_time_ms: 0,
  };

  constructor(private config: WorkerPoolConfig) {
    super();
    this.maxQueueSize = config.max_queue_size ?? 1000;

    if (config.cache?.l1_enabled !== false) {
      this.cache = new LRUCache({
        maxSize: (config.cache?.l1_max_size_mb ?? 64) * 1024 * 1024,
        ttl: (config.cache?.l1_ttl_seconds ?? 60) * 1000,
        sizeCalculation: (value) => {
          // Rough size estimation
          return JSON.stringify(value).length;
        },
      });
    }

    this.startHealthChecks();
  }

  private generateCacheKey(tool: string, params: Record<string, unknown>): string {
    return `${tool}:${JSON.stringify(params, Object.keys(params).sort())}`;
  }

  // ==========================================================================
  // Worker Management
  // ==========================================================================

  registerWorker(worker: IWorker): void {
    this.workers.set(worker.id, worker);

    worker.on('ready', () => {
      this.processQueue();
    });

    worker.on('error', (error) => {
      console.error(`Worker ${worker.id} error:`, error);
    });

    worker.on('crashed', () => {
      this.handleWorkerCrash(worker.id);
    });

    this.emit('worker-registered', worker.id);
    
    // Trigger queue processing in case there are pending tasks
    if (worker.info.status === 'ready') {
      void this.processQueue();
    }
  }

  unregisterWorker(workerId: string): void {
    const worker = this.workers.get(workerId);
    if (worker) {
      worker.shutdown(true).catch(console.error);
      this.workers.delete(workerId);
      this.emit('worker-unregistered', workerId);
    }
  }

  private handleWorkerCrash(workerId: string): void {
    console.error(`Worker ${workerId} crashed!`);

    // Find tasks assigned to this worker and requeue them
    for (const [taskId, task] of this.pendingTasks.entries()) {
      if (task.worker_id === workerId) {
        task.retries++;
        if (task.retries <= task.max_retries) {
          delete task.worker_id;
          this.taskQueue.enqueue(task, task.priority);
        } else {
          this.failTask(taskId, {
            code: 'WORKER_CRASHED',
            message: `Worker crashed after ${task.retries} retries`,
          });
        }
      }
    }

    this.unregisterWorker(workerId);
  }

  // ==========================================================================
  // Task Scheduling
  // ==========================================================================

  async executeTask(
    tool: string,
    params: Record<string, unknown>,
    options: {
      priority?: TaskPriority;
      timeout_ms?: number;
    } = {}
  ): Promise<TaskResult> {
    const task: Task = {
      id: randomUUID(),
      tool,
      params,
      priority: options.priority || 'normal',
      timeout_ms: options.timeout_ms || this.config.worker_timeout_ms,
      created_at: Date.now(),
      retries: 0,
      max_retries: 3,
    };

    // Check cache
    const cacheKey = this.generateCacheKey(tool, params);
    if (this.cache && this.cache.has(cacheKey)) {
      this.metrics.cache_hits++;
      return Promise.resolve({
        task_id: task.id,
        success: true,
        result: this.cache.get(cacheKey),
        metrics: {
          queue_time_ms: 0,
          execution_time_ms: 0,
          total_time_ms: 0,
        },
        from_cache: true,
        cache_key: cacheKey,
      });
    }

    return new Promise((resolve, reject) => {
      const queued = this.taskQueue.size + this.pendingTasks.size;
      if (queued >= this.maxQueueSize) {
        reject(new Error('QUEUE_FULL'));
        return;
      }
      this.taskResolvers.set(task.id, { resolve, reject });
      this.metrics.total_tasks++;

      // Add to queue
      this.taskQueue.enqueue(task, task.priority);

      // Try to process immediately
      void this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (true) {
        const task = this.taskQueue.dequeue();
        if (!task) break;

        const worker = this.selectWorker(task);
        if (!worker) {
          this.taskQueue.enqueue(task, task.priority);
          break;
        }

        task.worker_id = worker.id;
        task.started_at = Date.now();
        this.pendingTasks.set(task.id, task);

        void this.dispatchTask(worker, task);
      }
    } finally {
      this.processing = false;
    }
  }

  private selectWorker(task: Task): IWorker | undefined {
    // Simple strategy: find worker with lowest load that supports the tool
    let bestWorker: IWorker | undefined;
    let lowestLoad = Infinity;

    for (const worker of this.workers.values()) {
      if (worker.info.status === 'crashed') continue;

      // Check if worker supports this tool
      if (!worker.info.capabilities.tools.includes(task.tool)) continue;

      // Check load
      const load = worker.info.current_load;
      if (load < lowestLoad && load < 1) {
        lowestLoad = load;
        bestWorker = worker;
      }
    }

    return bestWorker;
  }

  private async dispatchTask(worker: IWorker, task: Task): Promise<void> {
    try {
      const request: ExecuteRequest = {
        type: 'execute',
        id: task.id,
        tool: task.tool,
        params: task.params,
        timeout_ms: task.timeout_ms,
        priority: task.priority,
      };

      const response = await Promise.race([
        worker.execute(request),
        this.createTimeout(task.timeout_ms),
      ]);

      this.handleTaskCompletion(task, response);
    } catch (error) {
      this.handleTaskError(task, error as Error);
    } finally {
      setImmediate(() => {
        void this.processQueue();
      });
    }
  }

  private handleTaskCompletion(task: Task, response: WorkerResponse): void {
    this.pendingTasks.delete(task.id);
    const resolver = this.taskResolvers.get(task.id);
    if (!resolver) return;

    const queue_time_ms = task.started_at! - task.created_at;
    const execution_time_ms = Date.now() - task.started_at!;
    const total_time_ms = Date.now() - task.created_at;

    this.metrics.total_queue_time_ms += queue_time_ms;
    this.metrics.total_execution_time_ms += execution_time_ms;

    if (response.type === 'success') {
      this.metrics.completed_tasks++;
      const successResponse = response as SuccessResponse;

      // Cache result
      if (this.cache && successResponse.result) {
        const cacheKey = this.generateCacheKey(task.tool, task.params);
        this.cache.set(cacheKey, successResponse.result);
      }

      resolver.resolve({
        task_id: task.id,
        success: true,
        result: successResponse.result,
        metrics: {
          queue_time_ms,
          execution_time_ms,
          total_time_ms,
        },
        from_cache: false, // TODO: implement cache checking
      });
    } else if (response.type === 'error') {
      this.metrics.failed_tasks++;
      const errorResponse = response as ErrorResponse;

      resolver.resolve({
        task_id: task.id,
        success: false,
        error: errorResponse.error,
        metrics: {
          queue_time_ms,
          execution_time_ms,
          total_time_ms,
        },
        from_cache: false,
      });
    }

    this.taskResolvers.delete(task.id);
  }

  private handleTaskError(task: Task, error: Error): void {
    this.failTask(task.id, {
      code: 'EXECUTION_ERROR',
      message: error.message,
      details: { stack: error.stack },
    });
  }

  private failTask(taskId: string, error: { code: string; message: string; details?: unknown }): void {
    const resolver = this.taskResolvers.get(taskId);
    if (resolver) {
      resolver.reject(new Error(`${error.code}: ${error.message}`));
      this.taskResolvers.delete(taskId);
    }
    this.pendingTasks.delete(taskId);
    this.metrics.failed_tasks++;
  }

  private createTimeout(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error('TIMEOUT')), ms);
    });
  }

  // ==========================================================================
  // Health Checks
  // ==========================================================================

  private startHealthChecks(): void {
    setInterval(() => {
      this.checkWorkerHealth();
    }, this.config.health_check_interval_ms);
  }

  private async checkWorkerHealth(): Promise<void> {
    for (const [workerId, worker] of this.workers.entries()) {
      try {
        const healthy = await worker.ping();
        if (!healthy) {
          console.warn(`Worker ${workerId} failed health check`);
          this.handleWorkerCrash(workerId);
        }
      } catch (error) {
        console.error(`Worker ${workerId} ping error:`, error);
        this.handleWorkerCrash(workerId);
      }
    }
  }

  // ==========================================================================
  // Metrics & Monitoring
  // ==========================================================================

  getMetrics(): {
    workers: number;
    queue_size: number;
    pending_tasks: number;
    total_tasks: number;
    completed_tasks: number;
    failed_tasks: number;
    cache_hits: number;
    success_rate: number;
    avg_queue_time_ms: number;
    avg_execution_time_ms: number;
  } {
    return {
      workers: this.workers.size,
      queue_size: this.taskQueue.size,
      pending_tasks: this.pendingTasks.size,
      total_tasks: this.metrics.total_tasks,
      completed_tasks: this.metrics.completed_tasks,
      failed_tasks: this.metrics.failed_tasks,
      cache_hits: this.metrics.cache_hits,
      success_rate: this.metrics.completed_tasks / Math.max(1, this.metrics.total_tasks),
      avg_queue_time_ms: this.metrics.total_queue_time_ms / Math.max(1, this.metrics.completed_tasks),
      avg_execution_time_ms: this.metrics.total_execution_time_ms / Math.max(1, this.metrics.completed_tasks),
    };
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  async shutdown(): Promise<void> {
    // Clear queue
    this.taskQueue.clear();

    // Shutdown all workers
    const shutdownPromises = Array.from(this.workers.values()).map(
      worker => worker.shutdown(true)
    );

    await Promise.all(shutdownPromises);
    this.workers.clear();
  }
}
