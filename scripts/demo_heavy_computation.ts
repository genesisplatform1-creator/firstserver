
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import * as path from 'path';

// ============================================================================
// CONFIGURATION
// ============================================================================
const SERVER_SCRIPT = path.resolve(process.cwd(), 'src/index.ts');

// ============================================================================
// CLIENT HELPER
// ============================================================================
class MCPClient {
    private proc: any;
    private rl: any;
    private requestId = 0;
    private pendingRequests = new Map<number, { resolve: Function, reject: Function }>();

    async start() {
        this.proc = spawn('cmd', ['/c', 'npx', 'tsx', SERVER_SCRIPT], {
            stdio: ['pipe', 'pipe', 'inherit'],
            env: { ...process.env, TRAE_AI_DB_PATH: ':memory:', TRAE_AI_TOOL_ALLOWLIST: '*' }
        });

        this.rl = createInterface({ input: this.proc.stdout, terminal: false });
        this.rl.on('line', (line: string) => this.handleLine(line));

        await new Promise(resolve => setTimeout(resolve, 2000));
        await this.send('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'heavy-demo', version: '1.0' }
        });
        this.notify('notifications/initialized');
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
        } catch (e) { }
    }

    send(method: string, params?: any) {
        return new Promise<any>((resolve, reject) => {
            const id = this.requestId++;
            const req = { jsonrpc: '2.0', id, method, params };
            this.pendingRequests.set(id, { resolve, reject });
            this.proc.stdin.write(JSON.stringify(req) + '\n');
        });
    }

    notify(method: string, params?: any) {
        const req = { jsonrpc: '2.0', method, params };
        this.proc.stdin.write(JSON.stringify(req) + '\n');
    }

    stop() {
        this.proc.kill();
    }
}

// ============================================================================
// HELPERS
// ============================================================================
function generateMatrix(rows: number, cols: number): number[][] {
    return Array.from({ length: rows }, () => 
        Array.from({ length: cols }, () => Math.floor(Math.random() * 10))
    );
}

function printMatrix(m: number[][], name: string) {
    console.log(`\n${name} (${m.length}x${m[0].length}):`);
    if (m.length > 5 || m[0].length > 5) {
        console.log(`[Top-left 3x3]`);
        for (let i=0; i<3; i++) console.log(m[i].slice(0, 3));
        console.log('...');
    } else {
        m.forEach(r => console.log(r));
    }
}

// ============================================================================
// THE "GRAND UNIFIED BENCHMARK"
// ============================================================================

async function runHeavyComputation() {
    console.log('🌌 Starting "Cosmic Heavy Computation" Benchmark...');
    console.log('   (Integrating: Compiler, Worker Pool, Spectral Analysis, Math Kernel)');
    const client = new MCPClient();
    await client.start();

    try {
        // --------------------------------------------------------------------
        // PHASE 1: COMPILER OPTIMIZATION (Kernel Preparation)
        // --------------------------------------------------------------------
        console.log('\n🔧 [Phase 1] Compiling Matrix Kernel...');
        
        const kernelCode = [
            { op: 'assign', target: 'N', value: 100 },
            { op: 'assign', target: 'blockSize', value: 10 },
            { op: 'assign', target: 'M', value: 'N' }, // Propagate constant
            { op: 'return', value: 'M' }
        ];
        
        console.log('   Running IR Optimization pass on kernel configuration...');
        const optResult = await client.send('tools/call', {
            name: 'compiler_optimize',
            arguments: { code: kernelCode }
        });
        const optData = JSON.parse(optResult.content[0].text);
        console.log('   Kernel Optimized:', JSON.stringify(optData.code));


        // --------------------------------------------------------------------
        // PHASE 2: HEAVY COMPUTATION (Distributed Matrix Multiplication)
        // --------------------------------------------------------------------
        console.log('\n⚔️  [Phase 2] Executing Heavy Computation (Worker Pool)...');
        
        // Use a decent size to stress it a bit, but not crash the demo
        const SIZE = 50; 
        console.log(`   Generating ${SIZE}x${SIZE} matrices...`);
        const matA = generateMatrix(SIZE, SIZE);
        const matB = generateMatrix(SIZE, SIZE);

        const startTime = Date.now();
        
        // In a real scenario, we would split this. Here we send it to the worker.
        // The worker is capable of handling this size easily.
        const mathResult = await client.send('tools/call', {
            name: 'math_matrix_multiply',
            arguments: { matrixA: matA, matrixB: matB }
        });
        
        const duration = Date.now() - startTime;
        const resultData = JSON.parse(mathResult.content[0].text);
        const resultMatrix = resultData.result;
        
        console.log(`   ✅ Computation Complete in ${duration}ms`);
        printMatrix(resultMatrix, 'Result Matrix');


        // --------------------------------------------------------------------
        // PHASE 3: SPECTRAL ANALYSIS (Graph Theory on Result)
        // --------------------------------------------------------------------
        console.log('\n🌈 [Phase 3] Spectral Analysis of Computation Result...');
        console.log('   Treating result matrix as Weighted Adjacency Matrix...');
        
        // The result of matrix mult can be treated as a graph where R[i][j] is edge weight.
        // We need to make it symmetric for spectral clustering usually, or just use it as is if directed.
        // Let's symmetrize it: M = (M + M.T) / 2
        
        // Actually, let's just pick a sub-graph for analysis to be fast
        const analyzeSize = Math.min(10, SIZE);
        const subGraphNodes = Array.from({length: analyzeSize}, (_, i) => `node_${i}`);
        
        // Create Adjacency Matrix
        const adjMatrix: number[][] = [];
        for(let i=0; i<analyzeSize; i++) {
            const row: number[] = [];
            for(let j=0; j<analyzeSize; j++) {
                if (i === j) {
                    row.push(0);
                } else {
                    const weight = (resultMatrix[i][j] + resultMatrix[j][i]) / 2;
                    row.push(weight);
                }
            }
            adjMatrix.push(row);
        }
        
        console.log(`   Constructed Graph: ${subGraphNodes.length} nodes (Adjacency Matrix)`);

        const spectralResult = await client.send('tools/call', {
            name: 'spectral_community',
            arguments: { 
                adjacencyMatrix: adjMatrix,
                method: 'sign'
            }
        });
        
        const spectralData = JSON.parse(spectralResult.content[0].text);
        console.log('   Eigenvalues (Fiedler Vector analysis):', spectralData.eigenvalues);
        console.log('   Partitions Found:', spectralData.clusterA.length, 'vs', spectralData.clusterB.length);


        // --------------------------------------------------------------------
        // PHASE 4: SYSTEM RATING (Telemetry)
        // --------------------------------------------------------------------
        console.log('\n📊 [Phase 4] System Capability Rating...');
        const metricsResult = await client.send('tools/call', { name: 'admin_get_metrics', arguments: {} });
        const metrics = JSON.parse(metricsResult.content[0].text);
        
        const throughput = (SIZE * SIZE * SIZE) / (duration || 1); // Ops/ms (very rough)
        const rating = Math.min(100, (throughput / 100) * 10 + (metrics.success_rate * 50));

        console.log('   --------------------------------------------------');
        console.log(`   Worker Efficiency:  ${metrics.success_rate * 100}%`);
        console.log(`   Ops/ms (Approx):    ${throughput.toFixed(2)}`);
        console.log(`   Tasks Completed:    ${metrics.completed_tasks}`);
        console.log(`   System Complexity:  HIGH`);
        console.log('   --------------------------------------------------');
        console.log(`   ⭐ FINAL RATING: ${rating.toFixed(1)} / 100`);
        console.log('   --------------------------------------------------');


    } catch (e) {
        console.error('❌ Benchmark Failed:', e);
    } finally {
        client.stop();
    }
}

runHeavyComputation().catch(console.error);
