
import { spawn } from 'child_process';
import { WorkerPool } from '../src/coordinator/worker-pool';
import { StdioWorker } from '../src/workers/worker-client'; // We can use the existing wrapper class
import { parseCode } from '../src/analysis/parser';
import { analyzeCode } from '../src/analysis/analyzer';
import { performance } from 'perf_hooks';
import * as path from 'path';

async function runBenchmark() {
    console.log('🚀 Starting Benchmark: Direct vs Worker vs Cached');

    const ITERATIONS = 100;
    const SAMPLE_CODE = `
        import { useState } from 'react';
        export function Component() {
            const [count, setCount] = useState(0);
            return <div>{count}</div>;
        }
    `;

    // 1. Direct Execution Benchmark (Parse)
    console.log(`\n1️⃣  Direct Execution (Parse) (${ITERATIONS} runs)`);
    const startDirect = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
        parseCode(SAMPLE_CODE, 'javascript');
    }
    const endDirect = performance.now();
    const timeDirect = endDirect - startDirect;
    console.log(`   Total: ${timeDirect.toFixed(2)}ms`);
    console.log(`   Avg:   ${(timeDirect / ITERATIONS).toFixed(2)}ms`);

    // Direct Execution Benchmark (Analyze)
    console.log(`\n1️⃣.5 Direct Execution (Analyze) (${ITERATIONS} runs)`);
    const startDirectAnalyze = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
        analyzeCode(SAMPLE_CODE, 'javascript');
    }
    const endDirectAnalyze = performance.now();
    const timeDirectAnalyze = endDirectAnalyze - startDirectAnalyze;
    console.log(`   Total: ${timeDirectAnalyze.toFixed(2)}ms`);
    console.log(`   Avg:   ${(timeDirectAnalyze / ITERATIONS).toFixed(2)}ms`);


    // 2. Worker Execution Setup
    const pool = new WorkerPool({
        max_workers: 2,
        min_workers: 1,
        worker_timeout_ms: 10000,
        health_check_interval_ms: 10000,
        auto_scale: false,
        cache: {
            l1_enabled: true, // We'll manually bypass or clear for "uncached" test if needed, or just use unique inputs
        }
    });

    // Spawn workers
    const workerScript = path.resolve(process.cwd(), 'src/workers/code-analysis-worker.ts');
    for (let i = 0; i < 2; i++) {
        const proc = spawn('cmd', ['/c', 'npx', 'tsx', workerScript], {
            cwd: process.cwd(),
            env: { ...process.env, PATH: process.env.PATH },
            stdio: ['pipe', 'pipe', 'inherit'],
        });
        const worker = new StdioWorker(`bench-worker-${i}`, proc as any);
        pool.registerWorker(worker);
    }

    // Wait for workers to be ready (approximate)
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 2. Worker Execution (Uncached - using unique inputs)
    console.log(`\n2️⃣  Worker Execution (Uncached Parse, ${ITERATIONS} runs)`);
    const startWorker = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
        // Appending comment to make code unique and bypass cache
        await pool.executeTask('parse', {
            language: 'javascript',
            code: `${SAMPLE_CODE}\n// run ${i}`,
        });
    }
    const endWorker = performance.now();
    const timeWorker = endWorker - startWorker;
    console.log(`   Total: ${timeWorker.toFixed(2)}ms`);
    console.log(`   Avg:   ${(timeWorker / ITERATIONS).toFixed(2)}ms`);
    console.log(`   Overhead: +${((timeWorker - timeDirect) / ITERATIONS).toFixed(2)}ms per req`);

    console.log(`\n2️⃣.5 Worker Execution (Uncached Analyze, ${ITERATIONS} runs)`);
    const startWorkerAnalyze = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
        await pool.executeTask('analyze', {
            language: 'javascript',
            code: `${SAMPLE_CODE}\n// run ${i}`,
        });
    }
    const endWorkerAnalyze = performance.now();
    const timeWorkerAnalyze = endWorkerAnalyze - startWorkerAnalyze;
    console.log(`   Total: ${timeWorkerAnalyze.toFixed(2)}ms`);
    console.log(`   Avg:   ${(timeWorkerAnalyze / ITERATIONS).toFixed(2)}ms`);

    // 3. Worker Execution (Cached)
    console.log(`\n3️⃣  Worker Execution (Cached Parse, ${ITERATIONS} runs)`);
    // First run to warm cache
    await pool.executeTask('parse', { language: 'javascript', code: SAMPLE_CODE });
    
    const startCache = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
        await pool.executeTask('parse', {
            language: 'javascript',
            code: SAMPLE_CODE,
        });
    }
    const endCache = performance.now();
    const timeCache = endCache - startCache;
    console.log(`   Total: ${timeCache.toFixed(2)}ms`);
    console.log(`   Avg:   ${(timeCache / ITERATIONS).toFixed(2)}ms`);
    console.log(`   Speedup vs Direct: ${(timeDirect / timeCache).toFixed(1)}x`);

    await pool.shutdown();
    process.exit(0);
}

runBenchmark();
