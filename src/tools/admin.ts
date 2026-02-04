
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getEventStore } from '../durability/index.js';
import { WorkerPool } from '../coordinator/worker-pool.js';

/**
 * Register administration tools
 */
export function registerAdminTools(server: McpServer, workerPool?: WorkerPool): void {
    // 1. Seal Integrity Block (Manual or Scheduled)
    server.tool(
        'admin_seal_integrity_block',
        'Manually seal a batch of events into a Merkle Integrity Block.',
        {
            maxEvents: z.number().optional().default(1000).describe('Maximum number of events to include in the block'),
        },
        async ({ maxEvents }) => {
            const store = getEventStore();
            try {
                const result = store.sealIntegrityBlock(maxEvents);
                if (!result) {
                    return {
                        content: [{ type: 'text', text: 'No unsealed events found to block.' }],
                    };
                }
                return {
                    content: [{
                        type: 'text',
                        text: `Sealed Integrity Block ${result.blockId} with ${result.eventCount} events.`,
                    }],
                };
            } catch (error) {
                return {
                    content: [{
                        type: 'text',
                        text: `Failed to seal integrity block: ${error instanceof Error ? error.message : String(error)}`,
                    }],
                    isError: true,
                };
            }
        }
    );

    // 2. Verify Integrity (Audit)
    server.tool(
        'admin_verify_integrity',
        'Verify the cryptographic integrity of the EventStore (Hash Chain + Merkle Roots).',
        {},
        async () => {
            const store = getEventStore();
            try {
                const result = store.verifyIntegrity();
                if (result.valid) {
                    return {
                        content: [{ type: 'text', text: 'Integrity Check Passed: All blocks and event chains are valid.' }],
                    };
                } else {
                    return {
                        content: [{
                            type: 'text',
                            text: `INTEGRITY CHECK FAILED!\nError: ${result.error}\nFailed Block ID: ${result.failedBlockId}`,
                        }],
                        isError: true,
                    };
                }
            } catch (error) {
                return {
                    content: [{
                        type: 'text',
                        text: `Failed to run integrity check: ${error instanceof Error ? error.message : String(error)}`,
                    }],
                    isError: true,
                };
            }
        }
    );

    // 3. Get System Metrics
    if (workerPool) {
        server.tool(
            'admin_get_metrics',
            'Get current system metrics (Worker Pool, Cache, Queue).',
            {},
            async () => {
                const metrics = workerPool.getMetrics();
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(metrics, null, 2),
                    }],
                };
            }
        );
    }
}
