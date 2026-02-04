
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { computeDominators, computeDominanceFrontiers } from '../../../analysis/cfa.js';
import type { CFG } from '../../../analysis/cfa.js';
import { WorkerPool } from '../../../coordinator/worker-pool.js';
import { createEntity, serializeEntity, EntityType } from '../../../ecs/entities.js';

// ============================================================================
// Tool Registration
// ============================================================================

export function registerCFATools(server: McpServer, workerPool?: WorkerPool): void {

    server.tool(
        'cfa_ssa',
        'Compute Dominator Tree and Dominance Frontiers for SSA construction.',
        {
            blocks: z.array(z.string()),
            edges: z.array(z.object({ from: z.string(), to: z.string() })),
            entry: z.string()
        },
        async ({ blocks, edges, entry }) => {
            // Use worker pool if available
            if (workerPool) {
                const taskResult = await workerPool.executeTask('cfa_ssa', { blocks, edges, entry });
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

            // Fallback to local execution
            const cfg: CFG = { blocks, edges, entry };

            // 1. Dominators
            const idoms = computeDominators(cfg);

            // 2. Frontiers
            const { frontiers } = computeDominanceFrontiers(cfg, idoms);

            // 3. Tree Edges (for viz)
            const treeEdges = Object.entries(idoms)
                .filter(([n, p]) => p !== null)
                .map(([n, p]) => ({ from: p!, to: n }));

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        immediateDominators: idoms,
                        dominanceFrontiers: frontiers,
                        dominatorTreeEdges: treeEdges
                    }, null, 2)
                }]
            };
        }
    );

    server.tool(
        'cfa_loop',
        'Detect Natural Loops using Dominators.',
        {
            blocks: z.array(z.string()),
            edges: z.array(z.object({ from: z.string(), to: z.string() })),
            entry: z.string()
        },
        async ({ blocks, edges, entry }) => {
            const cfg: CFG = { blocks, edges, entry };
            const idoms = computeDominators(cfg);
            const loops: { header: string, body: string[] }[] = [];

            // Back edge (u -> v) where v dominates u
            for (const e of edges) {
                // Check if e.to dominates e.from
                let curr: string | null = e.from;
                while (curr !== null) {
                    if (curr === e.to) {
                        // Found back edge e.from -> e.to
                        // Construct loop body
                        loops.push({ header: e.to, body: [e.from, e.to] }); // Simplified body
                        break;
                    }
                    curr = idoms[curr]!;  // Safe as we are traversing up strictly
                }
            }

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ naturalLoops: loops }, null, 2)
                }]
            };
        }
    );
}
