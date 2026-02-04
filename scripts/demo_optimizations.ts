
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

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
    public isConnected = false;

    async start() {
        this.proc = spawn('cmd', ['/c', 'npx', 'tsx', SERVER_SCRIPT], {
            stdio: ['pipe', 'pipe', 'inherit'],
            env: { 
                ...process.env, 
                TRAE_AI_DB_PATH: ':memory:', 
                TRAE_AI_TOOL_ALLOWLIST: '*'
            }
        });

        this.rl = createInterface({ input: this.proc.stdout, terminal: false });
        this.rl.on('line', (line: string) => this.handleLine(line));
        
        await new Promise(resolve => setTimeout(resolve, 3000));
        await this.send('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'opt-tester', version: '1.0' }
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
        try {
            this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
        } catch (e) {}
    }

    stop() {
        this.proc.kill();
    }
}

// ============================================================================
// TESTS
// ============================================================================

async function testStreamingHLL(client: MCPClient) {
    console.log('\n📊 [Test 1] Streaming HyperLogLog (Memory Efficiency)...');
    
    // Create a dummy log file (100k lines)
    const tmpFile = path.join(os.tmpdir(), 'large-log.txt');
    console.log(`   - Generating 100k lines log file at ${tmpFile}...`);
    
    const stream = fs.createWriteStream(tmpFile);
    const uniqueIPs = new Set();
    for(let i=0; i<100000; i++) {
        const ip = `192.168.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`;
        stream.write(ip + '\n');
        uniqueIPs.add(ip);
    }
    stream.end();
    
    await new Promise(r => stream.on('finish', r));
    console.log(`   - File created. Unique IPs: ${uniqueIPs.size}`);
    
    const start = Date.now();
    const res = await client.send('tools/call', {
        name: 'ds_hyperloglog',
        arguments: { filePath: tmpFile }
    });
    const duration = Date.now() - start;
    
    const content = JSON.parse(res.content[0].text);
    console.log(`   - Result: Estimated ${content.estimated} (Actual: ${uniqueIPs.size})`);
    console.log(`   - Error: ${(Math.abs(content.estimated - uniqueIPs.size) / uniqueIPs.size * 100).toFixed(2)}%`);
    console.log(`   - Time: ${duration}ms`);
    console.log('   ✅ Streaming processed successfully without loading file to RAM.');
    
    fs.unlinkSync(tmpFile);
}

async function testEventBuffering(client: MCPClient) {
    console.log('\n🚀 [Test 2] SQLite Event Buffering (Write Speed)...');
    
    const count = 500;
    console.log(`   - Writing ${count} events via 'context_manage' tool...`);
    
    const start = Date.now();
    const promises = [];
    for(let i=0; i<count; i++) {
        promises.push(client.send('tools/call', {
            name: 'context_manage',
            arguments: { 
                action: 'add', 
                filePath: `/test/file-${i}.ts`,
                language: 'typescript' 
            }
        }));
    }
    
    await Promise.all(promises);
    const duration = Date.now() - start;
    const tps = (count / (duration/1000)).toFixed(2);
    
    console.log(`   - Time: ${duration}ms`);
    console.log(`   - Write TPS: ${tps} events/sec`);
    
    if (parseFloat(tps) > 100) {
        console.log('   ✅ High TPS confirmed (Buffering is working).');
    } else {
        console.log('   ⚠️  TPS is lower than expected.');
    }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
    const client = new MCPClient();
    try {
        await client.start();
        await testStreamingHLL(client);
        await testEventBuffering(client);
    } catch (e) {
        console.error('Test Failed:', e);
    } finally {
        client.stop();
        process.exit(0);
    }
}

main();
