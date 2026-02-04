
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { evalAbstract, analyzeTaint } from '../../../analysis/data-flow.js';
import { runOptimizationPass } from '../../../analysis/optimizer.js';
import type { Interval } from '../../../analysis/data-flow.js';
import { WorkerPool } from '../../../coordinator/worker-pool.js';

// ============================================================================
// Tool Registration
// ============================================================================

export function registerStaticAnalysisTools(server: McpServer, workerPool?: WorkerPool): void {

    server.tool(
        'analysis_abstract_interp',
        'Perform Interval Analysis on simple arithmetic expressions.',
        {
            assignments: z.array(z.object({ var: z.string(), min: z.number(), max: z.number() })),
            expression: z.any().describe("JSON AST: { op: '+', left: ..., right: ... }")
        },
        async ({ assignments, expression }) => {
            if (workerPool) {
                const taskResult = await workerPool.executeTask('analysis_abstract_interp', { assignments, expression });
                if (!taskResult.success) {
                    throw new Error(taskResult.error?.message || 'Worker task failed');
                }
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(taskResult.result, null, 2)
                    }]
                };
            }

            const env = new Map<string, Interval>();
            assignments.forEach(a => env.set(a.var, { min: a.min, max: a.max }));

            const result = evalAbstract(expression, env);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ interval: result }, null, 2)
                }]
            };
        }
    );

    server.tool(
        'analysis_taint',
        'Trace taint flow from sources to sinks (Simplified Data Flow).',
        {
            code: z.array(z.any()).describe("List of instructions"),
            sources: z.array(z.string()),
            sinks: z.array(z.string())
        },
        async ({ code, sources, sinks }) => {
            if (workerPool) {
                const taskResult = await workerPool.executeTask('analysis_taint', { code, sources, sinks });
                if (!taskResult.success) {
                    throw new Error(taskResult.error?.message || 'Worker task failed');
                }
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(taskResult.result, null, 2)
                    }]
                };
            }

            const flows = analyzeTaint(code, { sources, sinks });
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ detectedFlows: flows }, null, 2)
                }]
            };
        }
    );

    server.tool(
        'compiler_optimize',
        'Perform optimizations (Constant Propagation, Dead Code Elimination).',
        {
            code: z.array(z.any()).describe("List of IR instructions")
        },
        async ({ code }) => {
            if (workerPool) {
                const taskResult = await workerPool.executeTask('compiler_optimize', { code });
                if (!taskResult.success) {
                    throw new Error(taskResult.error?.message || 'Worker task failed');
                }
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(taskResult.result, null, 2)
                    }]
                };
            }

            const result = runOptimizationPass(code);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(result, null, 2)
                }]
            };
        }
    );
}

