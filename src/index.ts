#!/usr/bin/env node

/**
 * Trae AI MCP Server
 * Comprehensive Model Context Protocol server for AI code editors
 * 
 * Features:
 * - 16 powerful tools across 4 categories
 * - ECS architecture for composable state  
 * - Durable execution with SQLite event sourcing
 * - Mahfuz integrity for full reasoning traces
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import * as path from 'path';

import { WorkerPool } from './coordinator/worker-pool.js';
import { StdioWorker } from './workers/worker-client.js';

import { getEventStore, closeEventStore } from './durability/index.js';
import {
    registerProgressTools,
    registerCodeIntelligenceTools,
    registerRiskGovernanceTools,
    registerProductivityTools,
    // Elite Research Tools
    registerAlgorithmSynthesisTools,
    registerPhysicsMathTools,
    registerReverseEngineeringTools,
    registerCyberRedteamTools,
    registerMathTools,
    registerGraphTools,
    registerGeometryTools,
    registerStringTools,
    registerNumberTheoryTools,
    registerDataStructureTools,
    registerTypeSystemTools,
    registerCFATools,
    registerStaticAnalysisTools,
    registerAdminTools,
} from './tools/index.js';
import { registerResources } from './resources/index.js';
import { registerPrompts } from './prompts/index.js';

/**
 * Server configuration
 */
const SERVER_NAME = 'trae-ai-mcp-server';
const SERVER_VERSION = '2.0.0';

/**
 * Main server initialization
 */
async function main(): Promise<void> {
    // Initialize event store (in-memory for now, can be file-based)
    const dbPath = process.env['TRAE_AI_DB_PATH'] ?? ':memory:';
    getEventStore(dbPath);

    // Create MCP server
    const server = new McpServer({
        name: SERVER_NAME,
        version: SERVER_VERSION,
    });
    let toolCount = 0;
    let resourceCount = 0;
    let promptCount = 0;
    const allowlist = process.env['TRAE_AI_TOOL_ALLOWLIST']
        ?.split(',')
        .map(v => v.trim())
        .filter(v => v.length > 0) ?? null;
    const denylist = process.env['TRAE_AI_TOOL_DENYLIST']
        ?.split(',')
        .map(v => v.trim())
        .filter(v => v.length > 0) ?? null;
    const rateLimit = Number(process.env['TRAE_AI_TOOL_RATE_LIMIT_PER_MIN'] ?? 0);
    const toolCalls: number[] = [];
    const parseJson = <T,>(value: string | undefined, fallback: T): T => {
        if (!value) return fallback;
        try {
            return JSON.parse(value) as T;
        } catch {
            return fallback;
        }
    };
    const toolRateLimits = parseJson<Record<string, number>>(process.env['TRAE_AI_TOOL_RATE_LIMITS'], {});
    const categoryRateLimits = parseJson<Record<string, number>>(process.env['TRAE_AI_TOOL_CATEGORY_LIMITS'], {});
    const toolCallHistory = new Map<string, number[]>();
    const categoryCallHistory = new Map<string, number[]>();
    const getCategory = (name: string) => name.split('_')[0] ?? 'other';
    const matchPattern = (name: string, pattern: string) => {
        if (pattern === '*') return true;
        const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
        const regex = new RegExp(`^${escaped}$`);
        return regex.test(name);
    };
    const isAllowedByList = (name: string, list: string[] | null, defaultAllow: boolean) => {
        if (!list || list.length === 0) return defaultAllow;
        return list.some(pattern => matchPattern(name, pattern));
    };
    const enforceWindow = (history: number[], limit: number) => {
        const now = Date.now();
        while (history.length > 0 && history[0]! < now - 60000) {
            history.shift();
        }
        if (history.length >= limit) return false;
        history.push(now);
        return true;
    };
    const enforceRateLimit = (name: string) => {
        if (!Number.isFinite(rateLimit) || rateLimit <= 0) return true;
        if (!enforceWindow(toolCalls, rateLimit)) return false;
        const toolLimit = toolRateLimits[name];
        if (typeof toolLimit === 'number' && toolLimit > 0) {
            const history = toolCallHistory.get(name) ?? [];
            if (!enforceWindow(history, toolLimit)) return false;
            toolCallHistory.set(name, history);
        }
        const category = getCategory(name);
        const categoryLimit = categoryRateLimits[category];
        if (typeof categoryLimit === 'number' && categoryLimit > 0) {
            const history = categoryCallHistory.get(category) ?? [];
            if (!enforceWindow(history, categoryLimit)) return false;
            categoryCallHistory.set(category, history);
        }
        return true;
    };
    const originalTool = server.tool.bind(server);
    const originalResource = server.resource.bind(server);
    const originalPrompt = server.prompt.bind(server);
    (server as any).tool = (name: string, description: string, schema: unknown, handler: (...args: any[]) => Promise<any>) => {
        toolCount++;
        const wrapped = async (...handlerArgs: any[]) => {
            if (!isAllowedByList(name, allowlist, true)) {
                return {
                    content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'TOOL_FORBIDDEN', message: `Tool ${name} not allowed` } }, null, 2) }],
                    isError: true,
                };
            }
            if (isAllowedByList(name, denylist, false)) {
                return {
                    content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'TOOL_FORBIDDEN', message: `Tool ${name} not allowed` } }, null, 2) }],
                    isError: true,
                };
            }
            if (!enforceRateLimit(name)) {
                return {
                    content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'RATE_LIMITED', message: 'Tool rate limit exceeded' } }, null, 2) }],
                    isError: true,
                };
            }
            try {
                return await handler(...handlerArgs);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return {
                    content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'TOOL_ERROR', message } }, null, 2) }],
                    isError: true,
                };
            }
        };
        return (originalTool as any)(name, description, schema, wrapped);
    };
    (server as any).resource = (...args: any[]) => {
        resourceCount++;
        return (originalResource as any)(...args);
    };
    (server as any).prompt = (...args: any[]) => {
        promptCount++;
        return (originalPrompt as any)(...args);
    };

    // Initialize Worker Pool
    const pool = new WorkerPool({
        max_workers: 4,
        min_workers: 1,
        worker_timeout_ms: 10000,
        health_check_interval_ms: 30000,
        auto_scale: true,
        scale_up_threshold: 0.8,
        scale_down_threshold: 0.2
    });

    // Resolve worker script path
    const isTs = fileURLToPath(import.meta.url).endsWith('.ts') || process.env['NODE_ENV'] === 'development';
    const workerScript = isTs
        ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), './workers/code-analysis-worker.ts')
        : path.resolve(path.dirname(fileURLToPath(import.meta.url)), './workers/code-analysis-worker.js');

    // Register initial workers
    for (let i = 0; i < 2; i++) {
        // Safe spawn for cross-platform (using node executable)
        // If TS, we use ts-node/tsx loader implicitly if this process is running in it?
        // Or explicitly invoke local tsx?
        // Since we are inside the server, we can guess usage.

        let proc;
        if (isTs) {
            // Assume npx tsx environment or similar
            // Using cmd /c to ensure reliable execution on Windows
            proc = spawn('cmd', ['/c', 'npx', 'tsx', workerScript], {
                stdio: ['pipe', 'pipe', 'inherit'],
                env: { ...process.env, PATH: process.env.PATH }
            });
        } else {
            proc = spawn(process.execPath, [workerScript], {
                stdio: ['pipe', 'pipe', 'inherit'],
                env: { ...process.env, PATH: process.env.PATH }
            });
        }

        const worker = new StdioWorker(`parser-${i}`, proc as any);
        pool.registerWorker(worker);
    }

    // Register all tools (32 total)
    // Original tools (16)
    registerProgressTools(server);         // 4 tools
    registerCodeIntelligenceTools(server, pool); // 4 tools + code_parse
    registerRiskGovernanceTools(server);   // 4 tools
    registerProductivityTools(server);     // 4 tools

    // Elite Research Tools (16 new)
    registerAlgorithmSynthesisTools(server);  // 4 tools: synthesize, complexity, genetic, proof
    registerPhysicsMathTools(server);         // 4 tools: simulate, numerical, symbolic, dimensional
    registerReverseEngineeringTools(server);  // 4 tools: disassemble, struct, protocol, api_trace
    registerCyberRedteamTools(server, pool);        // 4 tools: vuln_scan, attack_surface, exploit, pentest
    registerMathTools(server, pool);                // 16 tools: lattice, category, group, ring
    registerGraphTools(server);               // Graph tools (Structural, etc.)
    registerGeometryTools(server);            // Geometry tools (Hull, Delaunay, etc.)
    registerStringTools(server);              // String tools (Suffix Tree, Aho-Corasick)
    registerNumberTheoryTools(server);        // Number Theory (Miller-Rabin, Rho)
    registerDataStructureTools(server);       // Data Structures (Merkle, Bloom)
    registerTypeSystemTools(server);          // Compiler (Hindley-Milner)
    registerCFATools(server, pool);                 // Compiler (SSA, Dominators)
    registerStaticAnalysisTools(server, pool);      // Compiler (Abstract Interp, Taint)

    // Admin Tools
    registerAdminTools(server, pool);

    // Register resources
    registerResources(server);

    // Register prompts
    registerPrompts(server);

    // Startup Integrity Check
    console.error('Verifying Mahfuz Integrity...');
    try {
        const integrity = getEventStore().verifyIntegrity();
        if (integrity.valid) {
            console.error('✅ Integrity Check Passed');
        } else {
            console.error('❌ INTEGRITY CHECK FAILED:', integrity.error);
            if (process.env['TRAE_AI_STRICT_INTEGRITY'] === '1') {
                process.exit(1);
            }
        }
    } catch (err) {
        console.error('⚠️ Failed to run startup integrity check:', err);
        if (process.env['TRAE_AI_STRICT_INTEGRITY'] === '1') {
            process.exit(1);
        }
    }

    // Create stdio transport
    const transport = new StdioServerTransport();

    // Handle shutdown
    let shuttingDown = false;
    const shutdown = async () => {
        if (shuttingDown) return;
        shuttingDown = true;
        try {
            await pool.shutdown();
        } catch (e) {
            console.error('Failed to shutdown worker pool:', e);
        } finally {
            closeEventStore();
        }
        process.exit(0);
    };

    process.on('SIGINT', () => { void shutdown(); });
    process.on('SIGTERM', () => { void shutdown(); });

    // Connect and start server
    await server.connect(transport);

    // Log to stderr (stdout is used for MCP communication)
    console.error(`${SERVER_NAME} v${SERVER_VERSION} started`);
    console.error(`Database: ${dbPath}`);
    console.error(`Tools registered: ${toolCount}`);
    console.error(`Resources registered: ${resourceCount}`);
    console.error(`Prompts registered: ${promptCount}`);
}

// Run server
main().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
});
