
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// CONFIGURATION
// ============================================================================
const SERVER_SCRIPT = path.resolve(process.cwd(), 'src/index.ts');
const TEMP_DIR = path.resolve(process.cwd(), 'temp_cosmic_sim');

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
            env: { 
                ...process.env, 
                TRAE_AI_DB_PATH: ':memory:', 
                TRAE_AI_TOOL_ALLOWLIST: '*',
                // Increase memory for spectral analysis
                NODE_OPTIONS: '--max-old-space-size=4096' 
            }
        });

        this.rl = createInterface({ input: this.proc.stdout, terminal: false });
        this.rl.on('line', (line: string) => this.handleLine(line));

        await new Promise(resolve => setTimeout(resolve, 2000));
        await this.send('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'cosmic-sim', version: '1.0' }
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
        } catch (e) {
            // console.error('Failed to parse:', line);
        }
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
// SIMULATION
// ============================================================================

function generateGalaxy(size: number, density: number): number[][] {
    const matrix = Array.from({ length: size }, () => new Array(size).fill(0));
    for (let i = 0; i < size; i++) {
        for (let j = i + 1; j < size; j++) {
            if (Math.random() < density) {
                const weight = Math.random();
                matrix[i][j] = weight;
                matrix[j][i] = weight;
            }
        }
    }
    return matrix;
}

function generateTraffic(nodes: number, count: number): string[] {
    const traffic: string[] = [];
    // Zipfian-like distribution (some routes are very popular)
    for (let i = 0; i < count; i++) {
        const src = Math.floor(Math.pow(Math.random(), 2) * nodes); // Bias towards 0
        let dst = Math.floor(Math.random() * nodes);
        while (dst === src) dst = Math.floor(Math.random() * nodes);
        traffic.push(`Route:${src}->${dst}`);
    }
    return traffic;
}

async function runSimulation() {
    console.log('🌌 Starting "Cosmic Complexity" Simulation...');
    
    if (fs.existsSync(TEMP_DIR)) fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEMP_DIR);

    const client = new MCPClient();
    await client.start();

    try {
        const GALAXY_SIZE = 100; // 100 nodes (100x100 matrix) - O(N^3) spectral means ~1,000,000 ops
        const TRAFFIC_SIZE = 50000; // 50k messages

        // 1. GALAXY GENERATION
        console.log(`\n✨ [Phase 1] Generating Galaxy (${GALAXY_SIZE} Star Systems)...`);
        const adjMatrix = generateGalaxy(GALAXY_SIZE, 0.1); // 10% density
        console.log('   - Galaxy Matrix Created.');

        // 2. SPECTRAL PARTITIONING (Heavy Math)
        console.log('\n🔮 [Phase 2] Computing Spectral Partition (Fiedler Vector)...');
        const spectralStart = Date.now();
        const spectralResult = await client.send('tools/call', {
            name: 'spectral_community',
            arguments: {
                adjacencyMatrix: adjMatrix,
                method: 'sign'
            }
        });
        const partition = JSON.parse(spectralResult.content[0].text);
        const spectralTime = Date.now() - spectralStart;
        console.log(`   - Partitioned into 2 Factions:`);
        console.log(`     - Faction Alpha: ${partition.clusterA.length} stars`);
        console.log(`     - Faction Omega: ${partition.clusterB.length} stars`);
        console.log(`   - Computation Time: ${spectralTime}ms`);

        // 3. INTERSTELLAR TRAFFIC (Probabilistic & Stateful)
        console.log(`\n📡 [Phase 3] Monitoring Interstellar Traffic (${TRAFFIC_SIZE} signals)...`);
        const trafficStream = generateTraffic(GALAXY_SIZE, TRAFFIC_SIZE);
        
        // Use Stateful Stream for better accuracy and batching
        const STREAM_ID = 'cosmic-traffic-v1';
        console.log(`   - Creating Stateful Stream: ${STREAM_ID}`);
        await client.send('tools/call', {
            name: 'ds_prob_create_stream',
            arguments: {
                streamId: STREAM_ID,
                width: 5000, // Larger width for better accuracy
                depth: 5
            }
        });

        // Split traffic into chunks to simulate real streaming
        const CHUNK_SIZE = 5000; // 5k items per batch
        let processed = 0;
        const cmsStart = Date.now();

        console.log(`   - Streaming ${TRAFFIC_SIZE} signals in batches of ${CHUNK_SIZE}...`);
        
        let finalCounts: any = {};

        for (let i = 0; i < trafficStream.length; i += CHUNK_SIZE) {
            const batch = trafficStream.slice(i, i + CHUNK_SIZE);
            const result = await client.send('tools/call', {
                name: 'ds_prob_count_min',
                arguments: {
                    items: batch,
                    streamId: STREAM_ID
                }
            });
            processed += batch.length;
            if (processed % 10000 === 0) process.stdout.write('.');
            
            // In a real app, we might query only specific keys, but here we get all unique counts in batch
            // The tool returns counts for *items provided in the call*.
            // Since it's stateful, the counts are cumulative!
            if (i + CHUNK_SIZE >= trafficStream.length) {
                finalCounts = JSON.parse(result.content[0].text);
            }
        }
        console.log(' Done.');
        
        const cmsTime = Date.now() - cmsStart;
        
        // Find heavy hitters from the FINAL result
        const sortedRoutes = Object.entries(finalCounts)
            .sort(([, a], [, b]) => (b as number) - (a as number))
            .slice(0, 5);
            
        console.log(`   - Top 5 Congested Routes (Cumulative):`);
        sortedRoutes.forEach(([route, count]) => console.log(`     - ${route}: ~${count} signals`));
        console.log(`   - Computation Time: ${cmsTime}ms`);

        // 4. AUTOPILOT AUDIT (AST Analysis)
        console.log('\n🛡️ [Phase 4] Auditing Autopilot Firmware...');
        const autopilotCode = `
            class Autopilot {
                constructor(target) {
                    this.target = target;
                }
                
                engage() {
                    // DANGER: Accepting coordinates from unverified source
                    const coords = this.receiveCoordinates();
                    // VULNERABILITY: Eval injection
                    const vector = eval("calculate(" + coords + ")");
                    
                    // VULNERABILITY: Command Injection
                    system.exec("thrusters --power " + vector);
                    
                    return vector;
                }

                receiveCoordinates() {
                    return "10, 20";
                }
            }
        `;
        
        const scanResult = await client.send('tools/call', {
            name: 'vulnerability_scan',
            arguments: { code: autopilotCode, language: 'javascript' }
        });
        const scanData = JSON.parse(scanResult.content[0].text);
        console.log(`   - Findings: ${scanData.summary.total} vulnerabilities`);
        scanData.findings.forEach((f: any) => console.log(`     🚨 ${f.vuln} (${f.severity}) at line ${f.line}`));

        // 5. SYSTEM METRICS
        console.log('\n📊 [Phase 5] Simulation Telemetry...');
        const metrics = await client.send('tools/call', { name: 'admin_get_metrics', arguments: {} });
        console.log(JSON.parse(metrics.content[0].text));

    } catch (e) {
        console.error('❌ Simulation Failed:', e);
    } finally {
        client.stop();
        if (fs.existsSync(TEMP_DIR)) fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    }
}

runSimulation().catch(console.error);
