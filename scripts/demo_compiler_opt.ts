
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
            clientInfo: { name: 'compiler-demo', version: '1.0' }
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
// SIMULATION: COMPILER OPTIMIZATION PASS
// ============================================================================

async function runCompilerDemo() {
    console.log('🏗️  Starting "Hyper-Optimizing Compiler" Simulation...');
    const client = new MCPClient();
    await client.start();

    try {
        // --------------------------------------------------------------------
        // SCENARIO: Optimizing a critical hot-path function
        // --------------------------------------------------------------------
        // Source Code (Conceptual):
        // function compute(input) {
        //    let x = 0;
        //    if (input > 10) { x = input * 2; } else { x = input + 5; }
        //    while (x < 1000) { 
        //       x = x + 10; 
        //       unsafe_sink(x); // Taint check needed
        //    }
        //    return x;
        // }
        // --------------------------------------------------------------------

        // 1. CONTROL FLOW ANALYSIS (SSA Construction)
        console.log('\n🔄 [Phase 1] SSA Construction (Dominance Analysis)...');
        
        // CFG Representation
        const blocks = ['entry', 'if_cond', 'then_blk', 'else_blk', 'join_phi', 'loop_head', 'loop_body', 'exit'];
        const edges = [
            { from: 'entry', to: 'if_cond' },
            { from: 'if_cond', to: 'then_blk' },
            { from: 'if_cond', to: 'else_blk' },
            { from: 'then_blk', to: 'join_phi' },
            { from: 'else_blk', to: 'join_phi' },
            { from: 'join_phi', to: 'loop_head' },
            { from: 'loop_head', to: 'loop_body' },
            { from: 'loop_head', to: 'exit' },
            { from: 'loop_body', to: 'loop_head' } // Back edge
        ];

        const cfaResult = await client.send('tools/call', {
            name: 'cfa_ssa',
            arguments: { blocks, edges, entry: 'entry' }
        });
        const ssaData = JSON.parse(cfaResult.content[0].text);
        
        console.log('   - Immediate Dominators computed.');
        // Verify Loop Header dominance (loop_head should dominate loop_body)
        const loopBodyDom = ssaData.immediateDominators['loop_body'];
        console.log(`   - 'loop_body' is dominated by: ${loopBodyDom} (${loopBodyDom === 'loop_head' ? '✅ Correct' : '❌ Incorrect'})`);
        
        // Check Dominance Frontier for Phi placement
        // join_phi should be in DF of then_blk and else_blk
        const dfThen = ssaData.dominanceFrontiers['then_blk'];
        console.log(`   - DF(then_blk): [${dfThen.join(', ')}] (Needs Phi node: ${dfThen.includes('join_phi') ? '✅ Yes' : '❌ No'})`);


        // 2. TAINT ANALYSIS (Data Flow Safety)
        console.log('\n🌊 [Phase 2] Taint Analysis (Security Pass)...');
        
        // IR Instructions
        const irCode = [
            { op: 'assign', target: 'input', value: 'EXTERNAL_SOURCE' }, // Source
            { op: 'assign', target: 'x', value: 'input' }, // Propagate
            { op: 'assign', target: 'y', value: 'x' },     // Propagate
            { op: 'call', target: 'safe_log', arg: 'y' },
            { op: 'call', target: 'unsafe_sink', arg: 'x' } // Sink
        ];

        const taintResult = await client.send('tools/call', {
            name: 'analysis_taint',
            arguments: {
                code: irCode,
                sources: ['EXTERNAL_SOURCE'],
                sinks: ['unsafe_sink']
            }
        });
        const taintData = JSON.parse(taintResult.content[0].text);
        
        if (taintData.detectedFlows.length > 0) {
            console.log(`   🚨 Taint Leak Detected!`);
            taintData.detectedFlows.forEach((f: any) => console.log(`      - Flow: ${f.from} -> ${f.to}`));
        } else {
            console.log('   ✅ No Taint Leaks.');
        }


        // 3. ABSTRACT INTERPRETATION (Range Analysis / Dead Code Elimination)
        console.log('\n🧮 [Phase 3] Abstract Interpretation (Range Analysis)...');
        
        // Check if `x + 5` overflows or stays within bounds if input is [0, 10]
        // Expression: (input + 5)
        const rangeResult = await client.send('tools/call', {
            name: 'analysis_abstract_interp',
            arguments: {
                assignments: [
                    { var: 'input', min: 0, max: 10 },
                    { var: 'constant', min: 5, max: 5 }
                ],
                expression: {
                    op: '+',
                    left: 'input',
                    right: 'constant'
                }
            }
        });
        const rangeData = JSON.parse(rangeResult.content[0].text);
        console.log(`   - Input Range: [0, 10]`);
        console.log(`   - Result Range: [${rangeData.interval.min}, ${rangeData.interval.max}]`);
        
        if (rangeData.interval.max <= 15) {
            console.log('   ✅ Optimization: Array bounds check can be eliminated (Index < 20).');
        }

        // 4. OPTIMIZATION PASS (Real Transformation)
        console.log('\n🚀 [Phase 4] Optimization Pass (Constant Folding & DCE)...');
        const optIR = [
            { op: 'assign', target: 'a', value: 10 },
            { op: 'assign', target: 'b', value: 20 },
            { op: '+', target: 'c', left: 'a', right: 'b' }, // Should fold to c=30
            { op: 'assign', target: 'd', value: 'c' },       // Should propagate d=30
            { op: 'assign', target: 'e', value: 100 },       // Dead code
            { op: 'return', value: 'd' }                     // Should become return 30 (or return d with d=30)
        ];

        console.log('   Input IR:', JSON.stringify(optIR));

        const optResult = await client.send('tools/call', {
            name: 'compiler_optimize',
            arguments: { code: optIR }
        });
        
        const optData = JSON.parse(optResult.content[0].text);
        console.log('   Optimization Stats:', JSON.stringify(optData.stats, null, 2));
        console.log('   Optimized IR:', JSON.stringify(optData.code, null, 2));

        if (optData.stats.constantsPropagated > 0 && optData.stats.deadCodeRemoved > 0) {
             console.log('   ✅ Optimization Successful!');
        } else {
             console.log('   ❌ Optimization Failed.');
        }


        // 5. METRICS
        console.log('\n📊 [Phase 5] Compiler Telemetry...');
        const metrics = await client.send('tools/call', { name: 'admin_get_metrics', arguments: {} });
        console.log(JSON.parse(metrics.content[0].text));

    } catch (e) {
        console.error('❌ Demo Failed:', e);
    } finally {
        client.stop();
    }
}

runCompilerDemo().catch(console.error);
