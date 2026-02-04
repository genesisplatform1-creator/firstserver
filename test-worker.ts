
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { StdioWorker } from './src/workers/worker-client';
import { WorkerPool } from './src/coordinator/worker-pool';

async function testWorker() {
    console.log('Starting Worker Test...');

    // 1. Test Single Worker Process via StdioWorker wrapper
    console.log('\n--- Testing Single Worker ---');
    // Use cmd /c npx tsx explicitly to handle Windows execution + stdio
    const proc = spawn('cmd', ['/c', 'npx', 'tsx', 'src/workers/code-analysis-worker.ts'], {
        cwd: process.cwd(),
        env: { ...process.env, PATH: process.env.PATH },
        stdio: ['pipe', 'pipe', 'inherit'], // inherit stderr for debugging
    });

    const worker = new StdioWorker('test-worker-1', proc as any);

    worker.on('ready', async () => {
        console.log('Worker is ready!');

        try {
            console.log('Sending parse request...');
            const result = await worker.execute({
                id: 'req-1',
                type: 'execute',
                tool: 'parse',
                params: {
                    language: 'javascript',
                    code: 'const x = 42; function test() { return x * 2; }',
                },
                timeout_ms: 10000,
                priority: 'high'
            });
            console.log('Worker Result:', JSON.stringify(result, null, 2));

            // 2. Test Worker Pool
            console.log('\n--- Testing Worker Pool ---');
            const pool = new WorkerPool({
                max_workers: 2,
                min_workers: 1,
                worker_timeout_ms: 10000,
                health_check_interval_ms: 10000,
                auto_scale: false,
                scale_up_threshold: 0.8,
                scale_down_threshold: 0.2
            });

            pool.registerWorker(worker);

            const poolResult = await pool.executeTask('parse', {
                language: 'javascript',
                code: 'const y = 100;',
            });
            console.log('Pool Result:', JSON.stringify(poolResult, null, 2));

            // 3. Test Cache
            console.log('\n--- Testing Cache ---');
            const cachedResult = await pool.executeTask('parse', {
                language: 'javascript',
                code: 'const y = 100;',
            });
            console.log('Cached Result:', JSON.stringify(cachedResult, null, 2));

            if (cachedResult.from_cache) {
                console.log('✅ Cache HIT verified');
            } else {
                console.error('❌ Cache MISS (expected hit)');
            }

            console.log('Test Complete. Shutting down...');
            // Wait a bit for pending logs
            await new Promise(resolve => setTimeout(resolve, 500));
            await worker.shutdown(true);
            process.exit(0);

        } catch (err) {
            console.error('Test Failed:', err);
            process.exit(1);
        }
    });

    worker.on('error', (err) => {
        console.error('Worker Error:', err);
    });

    // Handle process exit
    proc.on('exit', (code) => {
        console.log(`Worker process exited with code ${code}`);
    });
}

testWorker();
