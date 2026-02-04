
import { spawn } from 'child_process';
import { createInterface } from 'readline';

async function main() {
    console.log('🚀 Starting MCP Server Stress Test...');

    // Spawn server with relaxed policy
    const proc = spawn('cmd', ['/c', 'npx', 'tsx', 'src/index.ts'], {
        stdio: ['pipe', 'pipe', 'inherit'],
        env: {
            ...process.env,
            TRAE_AI_DB_PATH: ':memory:',
            TRAE_AI_TOOL_ALLOWLIST: '*', // Allow all for stress test
            TRAE_AI_MAX_MESSAGE_CHARS: '1000000'
        }
    });

    if (!proc.stdin || !proc.stdout) {
        throw new Error('Failed to spawn server');
    }

    const rl = createInterface({ input: proc.stdout, terminal: false });
    let requestId = 0;
    const pendingRequests = new Map<number, { resolve: (val: any) => void; reject: (err: Error) => void; start: number }>();
    
    // Response Handler
    rl.on('line', (line) => {
        try {
            const msg = JSON.parse(line);
            if (msg.id !== undefined && pendingRequests.has(msg.id)) {
                const { resolve, reject } = pendingRequests.get(msg.id)!;
                pendingRequests.delete(msg.id);
                if (msg.error) reject(new Error(msg.error.message));
                else resolve(msg.result);
            }
        } catch (e) {
            console.error('Failed to parse:', line);
        }
    });

    const send = (method: string, params?: any) => {
        return new Promise<any>((resolve, reject) => {
            const id = requestId++;
            const req = { jsonrpc: '2.0', id, method, params };
            pendingRequests.set(id, { resolve, reject, start: Date.now() });
            proc.stdin!.write(JSON.stringify(req) + '\n');
        });
    };

    const notify = (method: string, params?: any) => {
        const req = { jsonrpc: '2.0', method, params };
        proc.stdin!.write(JSON.stringify(req) + '\n');
    };

    // Wait for init
    await new Promise(resolve => setTimeout(resolve, 1000));
    await send('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'stress-tester', version: '1.0' }
    });
    notify('notifications/initialized');

    console.log('✅ Server initialized. Starting load...');

    // Configuration
    const CONCURRENCY = 50;
    const TOTAL_REQUESTS = 500;
    const SAMPLE_CODE = `
        function fibonacci(n) {
            if (n <= 1) return n;
            return fibonacci(n - 1) + fibonacci(n - 2);
        }
        class Processor {
            async process(data) {
                return await fetch('/api');
            }
        }
    `;

    const results: number[] = [];
    let errors = 0;
    const startTime = Date.now();

    // Batch execution
    for (let i = 0; i < TOTAL_REQUESTS; i += CONCURRENCY) {
        const batch = [];
        for (let j = 0; j < CONCURRENCY && (i + j) < TOTAL_REQUESTS; j++) {
            const reqNum = i + j;
            batch.push(
                send('tools/call', {
                    name: 'code_analyze',
                    arguments: {
                        // Reuse code every 10 requests to test cache
                        code: `${SAMPLE_CODE}\n// request ${reqNum % 50}`,
                        language: 'javascript'
                    }
                }).then(() => {
                    const duration = Date.now() - pendingRequests.get(requestId - 1)?.start!; // Rough estimate, actually handled in handler
                    // We can't easily get exact duration this way without cleaner map handling, 
                    // but let's just count success
                    return true;
                }).catch((e) => {
                    // console.error(`Req ${reqNum} failed:`, e.message);
                    errors++;
                    return false;
                })
            );
        }
        await Promise.all(batch);
        process.stdout.write(`\rProgress: ${Math.min(i + CONCURRENCY, TOTAL_REQUESTS)}/${TOTAL_REQUESTS}`);
    }

    const totalTime = Date.now() - startTime;
    console.log('\n\n✅ Stress Test Complete');
    console.log(`Total Requests: ${TOTAL_REQUESTS}`);
    console.log(`Concurrency:    ${CONCURRENCY}`);
    console.log(`Total Time:     ${totalTime}ms`);
    console.log(`Throughput:     ${(TOTAL_REQUESTS / (totalTime / 1000)).toFixed(2)} req/s`);
    console.log(`Errors:         ${errors}`);

    // Get Metrics
    console.log('\n📊 Final Server Metrics:');
    try {
        const metrics = await send('tools/call', { name: 'admin_get_metrics', arguments: {} });
        console.log(JSON.parse(metrics.content[0].text));
    } catch (e) {
        console.error('Failed to get metrics:', e);
    }

    process.exit(0);
}

main().catch(console.error);
