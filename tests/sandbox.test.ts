/**
 * Isolated Sandbox Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IsolatedSandbox, SandboxPool } from '../src/isolation/sandbox.js';

describe('Isolated Sandbox', () => {
    let sandbox: IsolatedSandbox;

    beforeEach(async () => {
        sandbox = await IsolatedSandbox.create({
            memoryLimitMB: 64,
            timeoutMs: 5000,
            maxSteps: 10,
        });
    });

    afterEach(() => {
        sandbox.dispose();
    });

    describe('Code Execution', () => {
        it('should execute simple code and return result', async () => {
            const result = await sandbox.execute<number>('return 42;');

            expect(result.success).toBe(true);
            expect(result.result).toBe(42);
        });

        it('should execute code with injected arguments', async () => {
            const result = await sandbox.execute<number>(
                'return a + b;',
                { a: 10, b: 20 }
            );

            expect(result.success).toBe(true);
            expect(result.result).toBe(30);
        });

        it('should handle complex objects', async () => {
            const result = await sandbox.execute<{ sum: number }>(
                'return { sum: items.reduce((a, b) => a + b, 0) };',
                { items: [1, 2, 3, 4, 5] }
            );

            expect(result.success).toBe(true);
            expect(result.result?.sum).toBe(15);
        });
    });

    describe('Error Handling', () => {
        it('should catch runtime errors', async () => {
            const result = await sandbox.execute('throw new Error("test error");');

            expect(result.success).toBe(false);
            expect(result.error).toContain('test error');
        });

        it('should catch syntax errors', async () => {
            const result = await sandbox.execute('this is not valid javascript');

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });
    });

    describe('Resource Metrics', () => {
        it('should track CPU time', async () => {
            const result = await sandbox.execute('return 1;');

            expect(result.metrics.cpuTimeMs).toBeGreaterThanOrEqual(0);
        });

        it('should track heap usage', async () => {
            const result = await sandbox.execute('return 1;');

            expect(result.metrics.heapUsedBytes).toBeGreaterThan(0);
        });
    });

    describe('Isolation', () => {
        it('should not have access to Node.js APIs', async () => {
            const result = await sandbox.execute('return typeof require;');

            expect(result.success).toBe(true);
            expect(result.result).toBe('undefined');
        });

        it('should not have access to filesystem', async () => {
            const result = await sandbox.execute('return typeof process;');

            expect(result.success).toBe(true);
            expect(result.result).toBe('undefined');
        });
    });
});

describe('Sandbox Pool', () => {
    let pool: SandboxPool;

    beforeEach(() => {
        pool = new SandboxPool(2, {
            memoryLimitMB: 32,
            timeoutMs: 3000,
            maxSteps: 10,
        });
    });

    afterEach(() => {
        pool.disposeAll();
    });

    describe('Pool Management', () => {
        it('should acquire and release sandboxes', async () => {
            const sandbox = await pool.acquire();

            expect(sandbox).toBeDefined();

            const result = await sandbox.execute<number>('return 1;');
            expect(result.success).toBe(true);

            pool.release(sandbox);
        });

        it('should reuse released sandboxes', async () => {
            const sandbox1 = await pool.acquire();
            pool.release(sandbox1);

            const sandbox2 = await pool.acquire();

            // Should be the same instance
            expect(sandbox2).toBe(sandbox1);

            pool.release(sandbox2);
        });

        it('should respect max pool size', async () => {
            const s1 = await pool.acquire();
            const s2 = await pool.acquire();

            // Pool has 2 slots, both are in use
            // Third acquire should wait
            let acquired = false;
            const acquirePromise = pool.acquire().then(s => {
                acquired = true;
                return s;
            });

            // Wait a bit - should still be waiting
            await new Promise(r => setTimeout(r, 50));
            expect(acquired).toBe(false);

            // Release one
            pool.release(s1);

            // Now it should acquire
            const s3 = await acquirePromise;
            expect(acquired).toBe(true);

            pool.release(s2);
            pool.release(s3);
        });
    });
});
