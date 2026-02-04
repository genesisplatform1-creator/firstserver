/**
 * Isolated Sandbox - True VM Isolation for Sub-Agents
 * 
 * Uses isolated-vm for real memory/CPU isolation:
 * - Separate V8 isolate per sub-agent
 * - Memory limits enforced by V8
 * - CPU time limits with preemption
 * - No filesystem/network access by default
 */

import ivm from 'isolated-vm';

/**
 * Sandbox configuration
 */
export interface SandboxConfig {
    memoryLimitMB: number;
    timeoutMs: number;
    maxSteps: number;
}

/**
 * Sandbox execution result
 */
export interface SandboxResult<T = unknown> {
    success: boolean;
    result?: T;
    error?: string;
    metrics: {
        cpuTimeMs: number;
        heapUsedBytes: number;
        stepsExecuted: number;
    };
}

/**
 * Default sandbox limits (Weak Notebook compliant)
 */
const DEFAULT_CONFIG: SandboxConfig = {
    memoryLimitMB: 128,  // Per-isolate limit
    timeoutMs: 30000,    // 30 seconds
    maxSteps: 50,        // Sub-agent step limit
};

/**
 * Isolated Sandbox for sub-agent execution
 */
export class IsolatedSandbox {
    private isolate: ivm.Isolate;
    private context: ivm.Context;
    private config: SandboxConfig;
    private stepCount: number = 0;

    private constructor(
        isolate: ivm.Isolate,
        context: ivm.Context,
        config: SandboxConfig
    ) {
        this.isolate = isolate;
        this.context = context;
        this.config = config;
    }

    /**
     * Create a new sandbox with isolation
     */
    static async create(config: Partial<SandboxConfig> = {}): Promise<IsolatedSandbox> {
        const fullConfig = { ...DEFAULT_CONFIG, ...config };

        // Create isolated V8 instance with memory limit
        const isolate = new ivm.Isolate({
            memoryLimit: fullConfig.memoryLimitMB,
        });

        // Create a fresh context (like a new browser tab)
        const context = await isolate.createContext();

        // Set up limited globals
        const jail = context.global;
        await jail.set('global', jail.derefInto());

        // Inject safe console
        await jail.set('log', new ivm.Reference(function (...args: unknown[]) {
            console.log('[Sandbox]', ...args);
        }));

        // Inject step counter
        await context.eval(`
            globalThis.console = { log: (...args) => log.apply(undefined, args) };
            globalThis.__stepCount = 0;
            globalThis.__maxSteps = ${fullConfig.maxSteps};
        `);

        return new IsolatedSandbox(isolate, context, fullConfig);
    }

    /**
     * Execute code in the sandbox with full isolation
     */
    async execute<T>(code: string, args: Record<string, unknown> = {}): Promise<SandboxResult<T>> {
        const startTime = Date.now();

        try {
            // Inject arguments as globals
            const jail = this.context.global;
            for (const [key, value] of Object.entries(args)) {
                await jail.set(key, new ivm.ExternalCopy(value).copyInto());
            }

            // Wrap code with step counting
            const wrappedCode = `
                (function() {
                    function __checkStep() {
                        globalThis.__stepCount++;
                        if (globalThis.__stepCount > globalThis.__maxSteps) {
                            throw new Error('Step limit exceeded: ' + globalThis.__stepCount);
                        }
                    }
                    
                    // Inject step checks (simplified - real impl would instrument AST)
                    const __result = (function() {
                        ${code}
                    })();
                    
                    return { result: __result, steps: globalThis.__stepCount };
                })();
            `;

            // Execute with timeout and copy result out
            const script = await this.isolate.compileScript(wrappedCode);
            const rawResult = await script.run(this.context, {
                timeout: this.config.timeoutMs,
                copy: true,  // Copy result out of isolate
            });

            // Get heap stats
            const heapStats = this.isolate.getHeapStatisticsSync();

            const output = rawResult as { result: T; steps: number };
            this.stepCount = output.steps;

            return {
                success: true,
                result: output.result,
                metrics: {
                    cpuTimeMs: Date.now() - startTime,
                    heapUsedBytes: heapStats.used_heap_size,
                    stepsExecuted: this.stepCount,
                },
            };
        } catch (error) {
            const heapStats = this.isolate.getHeapStatisticsSync();

            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                metrics: {
                    cpuTimeMs: Date.now() - startTime,
                    heapUsedBytes: heapStats.used_heap_size,
                    stepsExecuted: this.stepCount,
                },
            };
        }
    }

    /**
     * Check if step limit reached
     */
    isStepLimitReached(): boolean {
        return this.stepCount >= this.config.maxSteps;
    }

    /**
     * Get current heap usage
     */
    getHeapUsage(): number {
        return this.isolate.getHeapStatisticsSync().used_heap_size;
    }

    /**
     * Force dispose the sandbox
     */
    dispose(): void {
        this.context.release();
        this.isolate.dispose();
    }
}

/**
 * Sandbox pool for reusing isolates
 */
export class SandboxPool {
    private available: IsolatedSandbox[] = [];
    private inUse: Set<IsolatedSandbox> = new Set();
    private config: SandboxConfig;
    private maxSize: number;

    constructor(maxSize: number = 4, config: Partial<SandboxConfig> = {}) {
        this.maxSize = maxSize;
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Acquire a sandbox from the pool
     */
    async acquire(): Promise<IsolatedSandbox> {
        // Reuse existing if available
        const existing = this.available.pop();
        if (existing) {
            this.inUse.add(existing);
            return existing;
        }

        // Create new if under limit
        if (this.inUse.size < this.maxSize) {
            const sandbox = await IsolatedSandbox.create(this.config);
            this.inUse.add(sandbox);
            return sandbox;
        }

        // Wait for one to become available
        return new Promise((resolve) => {
            const check = setInterval(async () => {
                const available = this.available.pop();
                if (available) {
                    clearInterval(check);
                    this.inUse.add(available);
                    resolve(available);
                }
            }, 100);
        });
    }

    /**
     * Release a sandbox back to the pool
     */
    release(sandbox: IsolatedSandbox): void {
        this.inUse.delete(sandbox);

        // Dispose if over limit, otherwise recycle
        if (this.available.length >= this.maxSize) {
            sandbox.dispose();
        } else {
            this.available.push(sandbox);
        }
    }

    /**
     * Dispose all sandboxes
     */
    disposeAll(): void {
        for (const sandbox of this.available) {
            sandbox.dispose();
        }
        for (const sandbox of this.inUse) {
            sandbox.dispose();
        }
        this.available = [];
        this.inUse.clear();
    }
}

// Singleton pool
let sandboxPool: SandboxPool | null = null;

export function getSandboxPool(): SandboxPool {
    if (!sandboxPool) {
        sandboxPool = new SandboxPool(4, {
            memoryLimitMB: 128,
            timeoutMs: 30000,
            maxSteps: 50,
        });
    }
    return sandboxPool;
}

export function resetSandboxPool(): void {
    sandboxPool?.disposeAll();
    sandboxPool = null;
}
