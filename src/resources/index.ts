/**
 * MCP Resources
 * Expose workspace and progress state as MCP resources
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getEventStore } from '../durability/index.js';

/**
 * Register MCP resources
 */
export function registerResources(server: McpServer): void {
    // Progress state resource
    server.resource(
        'progress://state',
        'progress://state',
        async (uri) => {
            const store = getEventStore();
            const allEntityIds = store.getAllEntityIds();
            const taskEntities = allEntityIds.filter(id => id.startsWith('task:'));


            const progressStates: Array<{
                entityId: string;
                taskName: string;
                percentage: number;
                status: string;
            }> = [];

            for (const id of taskEntities) {
                const events = store.loadEvents(id);
                const initEvent = events.find(e => e.type === 'progress.initialized');
                if (initEvent) {
                    const payload = initEvent.payload as Record<string, unknown>;

                    // Find latest progress update
                    const updates = events.filter(e => e.type.startsWith('progress.'));
                    const lastUpdate = updates[updates.length - 1];
                    const updatePayload = lastUpdate?.payload as Record<string, unknown> | undefined;

                    progressStates.push({
                        entityId: id,
                        taskName: (payload['taskName'] as string | undefined) ?? 'Unknown',
                        percentage: (updatePayload?.['percentage'] as number | undefined) ?? 0,
                        status: (updatePayload?.['status'] as string | undefined) ?? 'pending',
                    });
                }
            }


            return {
                contents: [
                    {
                        uri: uri.href,
                        mimeType: 'application/json',
                        text: JSON.stringify({
                            taskCount: progressStates.length,
                            tasks: progressStates,
                            timestamp: new Date().toISOString(),
                        }, null, 2),
                    },
                ],
            };
        }
    );

    // Workflow registry resource
    server.resource(
        'workflows://registry',
        'workflows://registry',
        async (uri) => {
            const store = getEventStore();
            const events = store.loadEvents('workflows:registry');

            const workflows = new Map<string, { name: string; stepCount: number }>();

            for (const event of events) {
                if (event.type === 'workflow.defined') {
                    const payload = event.payload as { name: string; steps: unknown[] };
                    workflows.set(payload.name, { name: payload.name, stepCount: payload.steps.length });
                } else if (event.type === 'workflow.deleted') {
                    const payload = event.payload as { name: string };
                    workflows.delete(payload.name);
                }
            }

            return {
                contents: [
                    {
                        uri: uri.href,
                        mimeType: 'application/json',
                        text: JSON.stringify({
                            count: workflows.size,
                            workflows: Array.from(workflows.values()),
                            timestamp: new Date().toISOString(),
                        }, null, 2),
                    },
                ],
            };
        }
    );

    // Event log resource (for debugging)
    server.resource(
        'events://recent',
        'events://recent',
        async (uri) => {
            const store = getEventStore();
            const allEntityIds = store.getAllEntityIds();

            // Collect recent events from all entities
            const allEvents: Array<{
                entityId: string;
                type: string;
                timestamp: number;
            }> = [];

            for (const id of allEntityIds) {
                const events = store.loadEvents(id);
                for (const event of events.slice(-5)) { // Last 5 per entity
                    allEvents.push({
                        entityId: event.entityId,
                        type: event.type,
                        timestamp: event.timestamp,
                    });
                }
            }

            // Sort by timestamp descending
            allEvents.sort((a, b) => b.timestamp - a.timestamp);

            return {
                contents: [
                    {
                        uri: uri.href,
                        mimeType: 'application/json',
                        text: JSON.stringify({
                            count: allEvents.length,
                            events: allEvents.slice(0, 50), // Most recent 50
                            timestamp: new Date().toISOString(),
                        }, null, 2),
                    },
                ],
            };
        }
    );
}
