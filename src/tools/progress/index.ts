/**
 * Progress Management Tools
 * Tools for tracking and managing overall coding progress
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
    createEntity,
    EntityType,
    serializeEntity,
    ProgressComponentSchema,
    type ProgressComponent,
    updateProgress,
    incrementStep,
    blockProgress,
    failProgress,
} from '../../ecs/index.js';
import { getEventStore } from '../../durability/index.js';

/**
 * Progress reducer for event sourcing
 */
function progressReducer(
    state: ProgressComponent | undefined,
    event: { type: string; payload: unknown; timestamp: number }
): ProgressComponent {
    const payload = event.payload as Record<string, unknown>;

    switch (event.type) {
        case 'progress.initialized':
            return ProgressComponentSchema.parse({
                entityId: payload['entityId'],
                taskName: payload['taskName'],
                totalSteps: payload['totalSteps'],
                startedAt: event.timestamp,
                updatedAt: event.timestamp,
                metadata: payload['metadata'],
            });

        case 'progress.updated':
            if (!state) throw new Error('Progress not initialized');
            return updateProgress(
                state,
                payload['percentage'] as number,
                payload['currentStep'] as string | undefined,
                event.timestamp
            );

        case 'progress.step_completed':
            if (!state) throw new Error('Progress not initialized');
            return incrementStep(state, event.timestamp);

        case 'progress.blocked':
            if (!state) throw new Error('Progress not initialized');
            return blockProgress(state, payload['reason'] as string, event.timestamp);

        case 'progress.failed':
            if (!state) throw new Error('Progress not initialized');
            return failProgress(state, payload['reason'] as string, event.timestamp);

        case 'progress.completed':
            if (!state) throw new Error('Progress not initialized');
            return {
                ...updateProgress(state, 100, undefined, event.timestamp),
                metadata: {
                    ...state.metadata,
                    summary: payload['summary'],
                },
            };

        default:
            return state!;
    }
}

/**
 * Get or create progress state from events
 */
function getProgressState(entityId: string): ProgressComponent | null {
    const store = getEventStore();
    const state = store.reconstruct(entityId, progressReducer);
    return state ?? null;
}

/**
 * Register progress management tools
 */
export function registerProgressTools(server: McpServer): void {
    // progress_init - Initialize progress tracking for a task
    server.tool(
        'progress_init',
        'Initialize progress tracking for a coding task. Creates a new progress entity.',
        {
            taskName: z.string().describe('Name of the task being tracked'),
            totalSteps: z.number().optional().describe('Total number of steps if known'),
            metadata: z.record(z.unknown()).optional().describe('Additional metadata'),
        },
        async ({ taskName, totalSteps, metadata }) => {
            const store = getEventStore();
            const entity = createEntity(EntityType.TASK);
            const entityId = serializeEntity(entity);

            store.append(entityId, 'progress.initialized', {
                entityId,
                taskName,
                totalSteps,
                metadata,
            });

            const state = getProgressState(entityId);

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify({
                            success: true,
                            entityId,
                            taskName,
                            message: `Progress tracking initialized for "${taskName}"`,
                            state,
                        }, null, 2),
                    },
                ],
            };
        }
    );

    // progress_update - Update task progress
    server.tool(
        'progress_update',
        'Update the progress of a task with percentage and optional status message.',
        {
            entityId: z.string().describe('Entity ID of the progress to update'),
            percentage: z.number().min(0).max(100).optional().describe('Progress percentage (0-100)'),
            currentStep: z.string().optional().describe('Current step description'),
            incrementStep: z.boolean().optional().describe('Increment step counter instead of setting percentage'),
        },
        async ({ entityId, percentage, currentStep, incrementStep: shouldIncrement }) => {
            const store = getEventStore();
            const state = getProgressState(entityId);

            if (!state) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: JSON.stringify({
                                success: false,
                                error: `Progress entity not found: ${entityId}`,
                            }, null, 2),
                        },
                    ],
                    isError: true,
                };
            }

            if (shouldIncrement) {
                store.append(entityId, 'progress.step_completed', {});
            } else if (percentage !== undefined) {
                store.append(entityId, 'progress.updated', { percentage, currentStep });
            }

            const updatedState = getProgressState(entityId);

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify({
                            success: true,
                            entityId,
                            state: updatedState,
                        }, null, 2),
                    },
                ],
            };
        }
    );

    // progress_query - Query current progress state
    server.tool(
        'progress_query',
        'Query the current progress state of a task or list all active tasks.',
        {
            entityId: z.string().optional().describe('Entity ID to query, or omit to list all'),
        },
        async ({ entityId }) => {
            const store = getEventStore();

            if (entityId) {
                const state = getProgressState(entityId);

                if (!state) {
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: JSON.stringify({
                                    success: false,
                                    error: `Progress entity not found: ${entityId}`,
                                }, null, 2),
                            },
                        ],
                        isError: true,
                    };
                }

                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: JSON.stringify({
                                success: true,
                                state,
                            }, null, 2),
                        },
                    ],
                };
            }

            // List all progress entities
            const allEntityIds = store.getAllEntityIds();
            const taskEntities = allEntityIds.filter(id => id.startsWith('task:'));

            const progressStates: ProgressComponent[] = [];
            for (const id of taskEntities) {
                const state = getProgressState(id);
                if (state) {
                    progressStates.push(state);
                }
            }

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify({
                            success: true,
                            count: progressStates.length,
                            tasks: progressStates.map(s => ({
                                entityId: s.entityId,
                                taskName: s.taskName,
                                percentage: s.percentage,
                                status: s.status,
                            })),
                        }, null, 2),
                    },
                ],
            };
        }
    );

    // progress_complete - Mark task as complete
    server.tool(
        'progress_complete',
        'Mark a task as complete with an optional summary.',
        {
            entityId: z.string().describe('Entity ID of the progress to complete'),
            summary: z.string().optional().describe('Completion summary'),
        },
        async ({ entityId, summary }) => {
            const store = getEventStore();
            const state = getProgressState(entityId);

            if (!state) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: JSON.stringify({
                                success: false,
                                error: `Progress entity not found: ${entityId}`,
                            }, null, 2),
                        },
                    ],
                    isError: true,
                };
            }

            store.append(entityId, 'progress.completed', { summary });

            const updatedState = getProgressState(entityId);

            // Save snapshot for completed tasks
            if (updatedState) {
                store.saveSnapshot(entityId, updatedState, store.getCurrentVersion(entityId));
            }

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify({
                            success: true,
                            entityId,
                            message: `Task "${state.taskName}" marked as complete`,
                            state: updatedState,
                        }, null, 2),
                    },
                ],
            };
        }
    );
}
