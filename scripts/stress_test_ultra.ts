
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import * as path from 'path';

// ============================================================================
// CONFIGURATION
// ============================================================================
const SERVER_SCRIPT = path.resolve(process.cwd(), 'src/index.ts');
const MAX_CONCURRENCY = 50;
const TEST_DURATION_MS = 30000; // 30 seconds stress test

// ============================================================================
// CLIENT HELPER
// ============================================================================
class MCPClient {
    private proc: any;
    private rl: any;
    private requestId = 0;
    private pendingRequests = new Map<number, { resolve: Function, reject: Function }>();
    public isConnected = false;

    async start() {
        this.proc = spawn('cmd', ['/c', 'npx', 'tsx', SERVER_SCRIPT], {
            stdio: ['pipe', 'pipe', 'inherit'],
            env: { 
                ...process.env, 
                TRAE_AI_DB_PATH: ':memory:', 
                TRAE_AI_TOOL_ALLOWLIST: '*',
                // TRAE_AI_MAX_MESSAGE_CHARS: '100000000' // Uncomment to test higher limits
            }
        });

        this.rl = createInterface({ input: this.proc.stdout, terminal: false });
        this.rl.on('line', (line: string) => this.handleLine(line));
        
        // Handle process exit
        this.proc.on('exit', (code: number) => {
            console.log(`Server exited with code ${code}`);
            this.isConnected = false;
        });

        await new Promise(resolve => setTimeout(resolve, 3000));
        await this.send('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'ultra-heavy-tester', version: '2.0' }
        });
        this.notify('notifications/initialized');
        this.isConnected = true;
        console.log('✅ MCP Server Connected');
    }

    private handleLine(line: string) {
        try {
            const msg = JSON.parse(line);
            if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
                const { resolve, reject } = this.pendingRequests.get(msg.id)!;
                this.pendingRequests.delete(msg.id);
                if (msg.error) reject(new Error(msg.error.message));
                else resolve(msg.result);
            }
        } catch (e) { 
            // console.error('Parse error:', e);
        }
    }

    send(method: string, params?: any) {
        return new Promise<any>((resolve, reject) => {
            if (!this.isConnected && method !== 'initialize') {
                reject(new Error('Server disconnected'));
                return;
            }
            const id = this.requestId++;
            const req = { jsonrpc: '2.0', id, method, params };
            this.pendingRequests.set(id, { resolve, reject });
            try {
                const payload = JSON.stringify(req);
                this.proc.stdin.write(payload + '\n');
            } catch (err) {
                reject(err);
            }
        });
    }

    notify(method: string, params?: any) {
        const req = { jsonrpc: '2.0', method, params };
        try {
            this.proc.stdin.write(JSON.stringify(req) + '\n');
        } catch (e) {}
    }

    stop() {
        this.proc.kill();
    }
}

// ============================================================================
// UTILS
// ============================================================================
function generateMatrix(size: number): number[][] {
    return Array.from({ length: size }, () => 
        Array.from({ length: size }, () => Math.floor(Math.random() * 10))
    );
}

// ============================================================================
// STRESS TESTS
// ============================================================================

async function runLatencyTest(client: MCPClient) {
    console.log('\n🏎️  [Test 1] Latency & Concurrency (Small Payload)...');
    const iterations = 100;
    const concurrency = 20;
    
    let completed = 0;
    let errors = 0;
    const start = Date.now();

    const task = async () => {
        try {
            await client.send('tools/call', {
                name: 'math_matrix_multiply',
                arguments: { 
                    matrixA: [[1, 2], [3, 4]], 
                    matrixB: [[1, 0], [0, 1]] 
                }
            });
            completed++;
        } catch (e) {
            errors++;
        }
    };

    const promises = [];
    for(let i=0; i<iterations; i++) {
        promises.push(task());
        if (promises.length >= concurrency) {
            await Promise.all(promises.splice(0, concurrency));
        }
    }
    await Promise.all(promises);
    
    const duration = Date.now() - start;
    console.log(`   - Time: ${duration}ms`);
    console.log(`   - TPS: ${(completed / (duration/1000)).toFixed(2)}`);
    console.log(`   - Errors: ${errors}`);
}

async function runPayloadLimitTest(client: MCPClient) {
    console.log('\n🐘 [Test 2] Payload Size Limit (Finding the Breaking Point)...');
    
    const sizes = [10, 50, 100, 200, 300, 500]; // 500x500 = 250k elements * ~5 bytes = ~1.2MB JSON
    
    for (const size of sizes) {
        process.stdout.write(`   - Testing ${size}x${size} matrix... `);
        const mat = generateMatrix(size);
        const start = Date.now();
        try {
            await client.send('tools/call', {
                name: 'math_matrix_multiply',
                arguments: { matrixA: mat, matrixB: mat }
            });
            const duration = Date.now() - start;
            console.log(`✅ OK (${duration}ms)`);
        } catch (e: any) {
            console.log(`❌ FAILED: ${e.message.slice(0, 100)}...`);
            break;
        }
    }
}

async function runContextTokenSim(client: MCPClient) {
    console.log('\n📚 [Test 3] Simulating "Context Token" Overflow...');
    console.log('   (Requesting a massive result that would choke an LLM)');

    // We'll use a large matrix request, but we expect the server to HANDLE it gracefully
    // (i.e. not crash, even if it returns a huge JSON).
    // The "improvement" will be to make it return a reference instead.
    
    const size = 300; // 300x300 ~ 90k integers. Response JSON ~ 300-500KB.
    console.log(`   - Requesting ${size}x${size} result...`);
    
    try {
        const start = Date.now();
        const res = await client.send('tools/call', {
            name: 'math_matrix_multiply',
            arguments: { matrixA: generateMatrix(size), matrixB: generateMatrix(size) }
        });
        const duration = Date.now() - start;
        const jsonLength = JSON.stringify(res).length;
        console.log(`   - Received ${jsonLength} bytes in ${duration}ms`);
        console.log(`   - Token Estimate: ~${Math.ceil(jsonLength / 4)} tokens`);
        
        if (jsonLength > 1000000) {
            console.log('   ⚠️  WARNING: Response exceeds 1MB. This is risky for LLM contexts.');
        } else {
            console.log('   ✅ Response within reasonable limits (for now).');
        }

    } catch (e: any) {
        console.log(`   ❌ Failed: ${e.message}`);
    }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
    const client = new MCPClient();
    try {
        await client.start();
        
        await runLatencyTest(client);
        await runPayloadLimitTest(client);
        await runContextTokenSim(client);

        // Check Metrics
        console.log('\n📊 Checking Server Metrics...');
        const metrics = await client.send('tools/call', { name: 'admin_get_metrics', arguments: {} });
        console.log(JSON.parse(metrics.content[0].text));
        
    } catch (e) {
        console.error('Stress Test Failed:', e);
    } finally {
        client.stop();
        process.exit(0);
    }
}

main();
