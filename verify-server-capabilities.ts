
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { readFileSync } from 'fs';

/**
 * Simple MCP Client to verify server capabilities
 */
async function main() {
    console.log('🚀 Starting MCP Server Capability Verification...');

    const policyEnv = process.env['TRAE_AI_VERIFY_POLICY'] === '1'
        ? { TRAE_AI_TOOL_ALLOWLIST: 'code_*,ds_*,vulnerability_scan,admin_*' }
        : {};
    const proc = spawn('cmd', ['/c', 'npx', 'tsx', 'src/index.ts'], {
        stdio: ['pipe', 'pipe', 'inherit'],
        env: { ...process.env, TRAE_AI_DB_PATH: ':memory:', ...policyEnv }
    });

    if (!proc.stdin || !proc.stdout) {
        throw new Error('Failed to spawn server with stdio pipes');
    }

    const rl = createInterface({
        input: proc.stdout,
        terminal: false
    });

    let requestId = 0;
    const pendingRequests = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void; method: string }>();
    const timeouts: Array<ReturnType<typeof setTimeout>> = [];

    const sendLine = (obj: unknown) => {
        proc.stdin.write(JSON.stringify(obj) + '\n');
    };

    const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
    const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

    const killProcessTree = async (pid: number) => {
        if (!Number.isFinite(pid)) return;
        if (process.platform === 'win32') {
            await new Promise<void>((resolve) => {
                const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
                killer.on('exit', () => resolve());
                killer.on('error', () => resolve());
            });
            return;
        }
        try {
            process.kill(pid, 'SIGTERM');
        } catch {
            return;
        }
        await sleep(200);
        try {
            process.kill(pid, 'SIGKILL');
        } catch {
            return;
        }
    };

    // Listener
    const handleResponse = (resp: unknown, method: string, resolve: (value: unknown) => void, reject: (reason: Error) => void) => {
        if (!isObject(resp)) {
            reject(new Error(`Invalid JSON-RPC response for ${method}`));
            return;
        }
        if (isObject(resp['error'])) {
            const errObj = resp['error'];
            const msg = typeof errObj['message'] === 'string' ? errObj['message'] : JSON.stringify(errObj);
            reject(new Error(`RPC error for ${method}: ${msg}`));
            return;
        }
        resolve(resp['result']);
    };

    rl.on('line', (line) => {
        try {
            const msg: unknown = JSON.parse(line);
            if (isObject(msg)) {
                const id = typeof msg['id'] === 'number' ? (msg['id'] as number) : undefined;
                if (id !== undefined) {
                    const handler = pendingRequests.get(id);
                    if (handler) {
                        pendingRequests.delete(id);
                        handleResponse(msg, handler.method, handler.resolve, handler.reject);
                        return;
                    }
                }
            }

            // Notification or unsolicited
            // console.log('Notification:', msg);
        } catch (e) {
            console.error('Failed to parse line:', line);
        }
    });

    // Helper to send request
    const send = (method: string, params?: unknown) => {
        return new Promise<unknown>((resolve, reject) => {
            const id = requestId++;
            const req = params !== undefined
                ? { jsonrpc: '2.0', id, method, params }
                : { jsonrpc: '2.0', id, method };

            pendingRequests.set(id, { resolve, reject, method });
            sendLine(req);

            // Timeout
            const t = setTimeout(() => {
                if (pendingRequests.has(id)) {
                    reject(new Error(`Timeout for ${method}`));
                    pendingRequests.delete(id);
                }
            }, 15000);
            timeouts.push(t);
            t.unref?.();
        });
    };

    const notify = (method: string, params?: unknown) => {
        const req = params !== undefined
            ? { jsonrpc: '2.0', method, params }
            : { jsonrpc: '2.0', method };
        sendLine(req);
    };

    proc.on('exit', (code) => {
        if (pendingRequests.size > 0) {
            const error = new Error(`Server exited with code ${code ?? 'unknown'}`);
            for (const [, handler] of pendingRequests) {
                handler.reject(error);
            }
            pendingRequests.clear();
        }
    });

    try {
        // 1. Initialize
        await new Promise(resolve => setTimeout(resolve, 300));
        console.log('\nSending initialize...');
        const initResult = await send('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'verifier', version: '1.0' }
        });
        console.log('✅ Initialized:', (initResult as any)?.serverInfo ?? initResult);

        notify('notifications/initialized');

        if (process.env['TRAE_AI_VERIFY_POLICY'] === '1') {
            console.log('\n🔒 Verifying policy controls...');
            const blockedResult = await send('tools/call', {
                name: 'admin_seal_integrity_block', // Use a tool NOT in the allowlist
                arguments: {
                    maxEvents: 10
                }
            });
            const blockedText = (blockedResult as any)?.content?.[0]?.text ?? '';
            if (typeof blockedText === 'string' && blockedText.includes('TOOL_FORBIDDEN')) {
                console.log('✅ Allowlist enforced');
            } else {
                console.error('❌ Allowlist not enforced');
            }
        }

        // 2. List Tools
        console.log('\n🔍 Listing Tools...');
        const toolsResult = await send('tools/list');
        const toolCount = (toolsResult as any)?.tools?.length ?? 0;
        console.log(`✅ Found ${toolCount} tools.`);

        // Check for specific tools
        const tools = Array.isArray((toolsResult as any)?.tools) ? (toolsResult as any).tools : [];
        const hasWorkerTool = tools.find((t: any) => t?.name === 'code_parse');
        const hasProbTool = tools.find((t: any) => t?.name === 'ds_prob_count_min');
        const hasAdminTool = tools.find((t: any) => t?.name === 'admin_verify_integrity');
        const hasAnalyzeTool = tools.find((t: any) => t?.name === 'code_analyze');
        const hasVulnTool = tools.find((t: any) => t?.name === 'vulnerability_scan');

        console.log(`   - code_parse: ${hasWorkerTool ? '✅' : '❌'}`);
        console.log(`   - ds_prob_count_min: ${hasProbTool ? '✅' : '❌'}`);
        console.log(`   - admin_verify_integrity: ${hasAdminTool ? '✅' : '❌'}`);
        console.log(`   - code_analyze: ${hasAnalyzeTool ? '✅' : '❌'}`);
        console.log(`   - vulnerability_scan: ${hasVulnTool ? '✅' : '❌'}`);

        console.log('\n📚 Listing Resources/Prompts (best-effort)...');
        try {
            const resourcesResult = await send('resources/list');
            const resources = (resourcesResult as any)?.resources;
            console.log(`resources/list: ${Array.isArray(resources) ? resources.length : 0}`);
        } catch (e) {
            console.log(`resources/list: skipped (${e instanceof Error ? e.message : String(e)})`);
        }
        try {
            const promptsResult = await send('prompts/list');
            const prompts = (promptsResult as any)?.prompts;
            console.log(`prompts/list: ${Array.isArray(prompts) ? prompts.length : 0}`);
        } catch (e) {
            console.log(`prompts/list: skipped (${e instanceof Error ? e.message : String(e)})`);
        }

        // 3. Test Worker Pool (code_parse)
        console.log('\n🛠️ Testing Worker Pool (code_parse)...');
        const parseResult = await send('tools/call', {
            name: 'code_parse',
            arguments: {
                language: 'javascript',
                code: 'function hello() { return "world"; }'
            }
        });

        const parsedText = (parseResult as any)?.content?.[0]?.text;
        const parsedContent = typeof parsedText === 'string' ? JSON.parse(parsedText) : null;
        if (parsedContent?.success && parsedContent?.result?.success && Array.isArray(parsedContent?.result?.nodes)) {
            console.log('✅ Worker Parse Success (AST generated)');
        } else {
            console.error('❌ Worker Parse Failed:', parseResult);
        }

        console.log('\n🧵 Testing Worker Pool concurrency (5 parses)...');
        const parseJobs = Array.from({ length: 5 }, (_, i) =>
            send('tools/call', {
                name: 'code_parse',
                arguments: {
                    language: 'javascript',
                    code: `function f${i}(){ return ${i}; }`
                }
            })
        );
        const parseResults = await Promise.all(parseJobs);
        const okCount = parseResults.reduce<number>((acc, r) => {
            const t = (r as any)?.content?.[0]?.text;
            try {
                const obj = typeof t === 'string' ? JSON.parse(t) : null;
                return acc + (obj?.success && obj?.result?.success ? 1 : 0);
            } catch {
                return acc;
            }
        }, 0);
        console.log(`✅ Concurrency parse ok: ${okCount}/5`);

        // 4. Test Probabilistic Data Structure
        console.log('\n🎲 Testing Count-Min Sketch...');
        const cmsResult = await send('tools/call', {
            name: 'ds_prob_count_min',
            arguments: {
                items: ['apple', 'apple', 'banana', 'banana', 'banana'],
                width: 200,
                depth: 5
            }
        });

        const cmsText = (cmsResult as any)?.content?.[0]?.text;
        const cmsCounts = typeof cmsText === 'string' ? JSON.parse(cmsText) : {};
        if ((cmsCounts.apple ?? 0) >= 2 && (cmsCounts.banana ?? 0) >= 3) {
            console.log('✅ Count-Min Sketch Counting Looks Correct');
        } else {
            console.error('❌ Count-Min Sketch Counting Unexpected:', cmsCounts);
        }

        // 5. Test tools on a real project file (this repo)
        console.log('\n📦 Testing on real project file (src/index.ts)...');
        const repoIndex = readFileSync('src/index.ts', 'utf8');

        const analyzeResult = await send('tools/call', {
            name: 'code_analyze',
            arguments: {
                code: repoIndex,
                language: 'typescript',
                filePath: 'src/index.ts'
            }
        });
        console.log('code_analyze:', (analyzeResult as any)?.content?.[0]?.text ?? analyzeResult);

        const vulnResult = await send('tools/call', {
            name: 'vulnerability_scan',
            arguments: {
                code: repoIndex,
                language: 'typescript',
                scanDepth: 'quick'
            }
        });
        console.log('vulnerability_scan:', (vulnResult as any)?.content?.[0]?.text ?? vulnResult);

        // 6. Test Admin Integrity
        console.log('\n🛡️ Testing Admin Integrity...');
        const integrityResult = await send('tools/call', {
            name: 'admin_verify_integrity',
            arguments: {}
        });
        console.log('Admin Integrity Result:', (integrityResult as any)?.content?.[0]?.text ?? integrityResult);

        // 7. Test Admin Metrics
        console.log('\n📊 Testing Admin Metrics...');
        const metricsResult = await send('tools/call', {
            name: 'admin_get_metrics',
            arguments: {}
        });
        console.log('Admin Metrics Result:', (metricsResult as any)?.content?.[0]?.text ?? metricsResult);

        console.log('\n✨ ALL TESTS COMPLETED');

    } catch (err) {
        console.error('❌ Test Failed:', err);
    } finally {
        pendingRequests.clear();
        for (const t of timeouts) clearTimeout(t);
        rl.close();
        await killProcessTree(proc.pid ?? NaN);
    }
}

main();
