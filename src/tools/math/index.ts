
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WorkerPool } from '../../coordinator/worker-pool.js';
import * as fs from 'fs';

export function registerMathTools(server: McpServer, workerPool?: WorkerPool): void {
    server.tool(
        'math_matrix_multiply',
        'Multiply two matrices (offloaded to worker pool).',
        {
            matrixA: z.array(z.array(z.number())),
            matrixB: z.array(z.array(z.number()))
        },
        async ({ matrixA, matrixB }) => {
            if (!workerPool) {
                return {
                    content: [{ type: 'text', text: JSON.stringify({ error: "WorkerPool not available for heavy computation." }) }],
                    isError: true
                };
            }

            // In a real distributed system, we would split this into chunks here.
            // For this demo, we send the whole chunk to one worker (or simulate splitting).
            // Let's just send it to a worker.
            
            try {
                const taskResult = await workerPool.executeTask('compute_matrix_chunk', { matrixA, matrixB });
                if (!taskResult.success) {
                    throw new Error(taskResult.error?.message || "Computation failed");
                }

                // Handle Large Data Offloading (Context Token Limit Protection)
                if (taskResult.result && (taskResult.result as any).resultRef) {
                    const ref = (taskResult.result as any).resultRef;
                    if (ref.type === 'file') {
                        // The worker offloaded the result to a file.
                        // We return a reference to the LLM instead of the full JSON.
                        return {
                            content: [{
                                type: 'text',
                                text: JSON.stringify({
                                    status: "success_large_payload",
                                    summary: ref.summary,
                                    rows: ref.rows,
                                    cols: ref.cols,
                                    resourceUri: `file://${ref.path}`, // In a real server, this would be a resource:// URI
                                    note: "Result too large for context window. Use 'fs_read_file' (if allowed) to inspect parts."
                                }, null, 2)
                            }]
                        };
                    }
                }

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(taskResult.result, null, 2)
                    }]
                };
            } catch (error) {
                 return {
                    content: [{ type: 'text', text: JSON.stringify({ error: `Computation Error: ${error}` }) }],
                    isError: true
                };
            }
        }
    );
}
