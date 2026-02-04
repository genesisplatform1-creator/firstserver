
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkerPool } from '../src/coordinator/worker-pool';
import { EventEmitter } from 'events';
import type { IWorker, WorkerInfo, ExecuteRequest, WorkerResponse } from '../src/types/worker-types';

class MockWorker extends EventEmitter implements IWorker {
    public id: string;
    public info: WorkerInfo;
    public executeMock = vi.fn();

    constructor(id: string) {
        super();
        this.id = id;
        this.info = {
            id,
            capabilities: {
                tools: ['test_tool'],
                languages: [],
                max_concurrent: 1,
            },
            resources: { cpu_cores: 1, memory_mb: 128, gpu: false },
            status: 'ready',
            current_load: 0,
            queue_depth: 0,
            started_at: Date.now(),
            last_ping: Date.now(),
        };
    }

    async execute(request: ExecuteRequest): Promise<WorkerResponse> {
        return this.executeMock(request);
    }

    async ping(): Promise<boolean> {
        return true;
    }

    async shutdown(graceful: boolean): Promise<void> {
        // no-op
    }
}

describe('WorkerPool', () => {
    let pool: WorkerPool;

    beforeEach(() => {
        pool = new WorkerPool({
            max_workers: 2,
            min_workers: 1,
            worker_timeout_ms: 1000,
            health_check_interval_ms: 1000,
            auto_scale: false,
            scale_up_threshold: 0.8,
            scale_down_threshold: 0.2,
            cache: { l1_enabled: true }
        });
    });

    afterEach(async () => {
        await pool.shutdown();
    });

    it('should register workers', () => {
        const worker = new MockWorker('w1');
        pool.registerWorker(worker);
        
        const metrics = pool.getMetrics();
        expect(metrics.workers).toBe(1);
    });

    it('should route task to available worker', async () => {
        const worker = new MockWorker('w1');
        worker.executeMock.mockResolvedValue({
            type: 'success',
            id: 't1',
            result: { data: 'ok' }
        });
        pool.registerWorker(worker);

        const result = await pool.executeTask('test_tool', { foo: 'bar' });
        
        expect(result.success).toBe(true);
        expect(result.result).toEqual({ data: 'ok' });
        expect(worker.executeMock).toHaveBeenCalled();
    });

    it('should handle worker errors', async () => {
        const worker = new MockWorker('w1');
        worker.executeMock.mockResolvedValue({
            type: 'error',
            id: 't2',
            error: { code: 'ERR', message: 'Failed' }
        });
        pool.registerWorker(worker);

        const result = await pool.executeTask('test_tool', {});
        
        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('ERR');
    });

    it('should use cache for identical requests', async () => {
        const worker = new MockWorker('w1');
        worker.executeMock.mockResolvedValue({
            type: 'success',
            id: 't1',
            result: { value: 42 }
        });
        pool.registerWorker(worker);

        // First call
        const r1 = await pool.executeTask('test_tool', { input: 1 });
        expect(r1.from_cache).toBe(false);

        // Second call
        const r2 = await pool.executeTask('test_tool', { input: 1 });
        expect(r2.from_cache).toBe(true);
        expect(r2.result).toEqual({ value: 42 });
        
        // Worker should have been called only once
        expect(worker.executeMock).toHaveBeenCalledTimes(1);
    });

    it('should queue tasks when no worker available', async () => {
        // No workers registered yet
        const taskPromise = pool.executeTask('test_tool', {});
        
        // Register worker after a delay
        setTimeout(() => {
            const worker = new MockWorker('w1');
            worker.executeMock.mockResolvedValue({
                type: 'success',
                id: 'delayed',
                result: 'done'
            });
            pool.registerWorker(worker);
        }, 100);

        const result = await taskPromise;
        expect(result.success).toBe(true);
        expect(result.result).toBe('done');
    });
});
