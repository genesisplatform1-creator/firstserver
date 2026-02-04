/**
 * Productivity Tools
 * Tools for tracking productivity, detecting bottlenecks, and resource optimization
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
    createEntity,
    EntityType,
    serializeEntity,
    ProductivityComponentSchema,
    type ProductivityComponent,
    trackProductivity,
    addBottleneck,
    checkIsolationLimits,
} from '../../ecs/index.js';
import { getEventStore } from '../../durability/index.js';

/**
 * Productivity state reducer
 */
function productivityReducer(
    state: ProductivityComponent | undefined,
    event: { type: string; payload: unknown; timestamp: number }
): ProductivityComponent {
    const payload = event.payload as Record<string, unknown>;

    switch (event.type) {
        case 'productivity.initialized':
            return ProductivityComponentSchema.parse({
                entityId: payload['entityId'],
                sessionId: payload['sessionId'],
                stepsLimit: payload['stepsLimit'] ?? 50,
                tokensLimit: payload['tokensLimit'] ?? 20000,
                measuredAt: event.timestamp,
            });

        case 'productivity.tracked':
            if (!state) throw new Error('Productivity not initialized');
            return trackProductivity(state, payload['metrics'] as Parameters<typeof trackProductivity>[1], event.timestamp);

        case 'productivity.bottleneck_added':
            if (!state) throw new Error('Productivity not initialized');
            return addBottleneck(state, payload['bottleneck'] as ProductivityComponent['bottlenecks'][0]);

        default:
            return state!;
    }
}

/**
 * Get productivity state from events
 */
function getProductivityState(entityId: string): ProductivityComponent | null {
    const store = getEventStore();
    const state = store.reconstruct(entityId, productivityReducer);
    return state ?? null;
}

/**
 * Register productivity tools
 */
export function registerProductivityTools(server: McpServer): void {
    // productivity_metrics - Track coding productivity
    server.tool(
        'productivity_metrics',
        'Track and query coding productivity metrics for a session.',
        {
            action: z.enum(['start', 'track', 'query']).describe('Action to perform'),
            sessionId: z.string().optional().describe('Session ID (auto-created for start)'),
            entityId: z.string().optional().describe('Entity ID for track/query'),
            tokens: z.number().optional().describe('Tokens used'),
            steps: z.number().optional().describe('Steps executed'),
            timeMs: z.number().optional().describe('Time spent in ms'),
            linesAdded: z.number().optional().describe('Lines of code added'),
            linesRemoved: z.number().optional().describe('Lines of code removed'),
            filesModified: z.array(z.string()).optional().describe('Files modified'),
        },
        async ({ action, sessionId, entityId, tokens, steps, timeMs, linesAdded, linesRemoved, filesModified }) => {
            const store = getEventStore();

            switch (action) {
                case 'start': {
                    const entity = createEntity(EntityType.SESSION);
                    const newEntityId = serializeEntity(entity);
                    const session = sessionId ?? serializeEntity(createEntity(EntityType.SESSION));

                    store.append(newEntityId, 'productivity.initialized', {
                        entityId: newEntityId,
                        sessionId: session,
                    });

                    const state = getProductivityState(newEntityId);

                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: JSON.stringify({
                                    success: true,
                                    entityId: newEntityId,
                                    sessionId: session,
                                    message: 'Productivity tracking started',
                                    limits: {
                                        stepsLimit: state?.stepsLimit,
                                        tokensLimit: state?.tokensLimit,
                                    },
                                }, null, 2),
                            },
                        ],
                    };
                }

                case 'track': {
                    if (!entityId) {
                        return {
                            content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'entityId required' }) }],
                            isError: true,
                        };
                    }

                    const state = getProductivityState(entityId);
                    if (!state) {
                        return {
                            content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'Session not found' }) }],
                            isError: true,
                        };
                    }

                    const metrics = {
                        tokens,
                        steps,
                        timeMs,
                        linesAdded,
                        linesRemoved,
                        filesModified,
                    };

                    store.append(entityId, 'productivity.tracked', { metrics });

                    const updatedState = getProductivityState(entityId);
                    const limits = checkIsolationLimits(updatedState!);

                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: JSON.stringify({
                                    success: true,
                                    entityId,
                                    tracked: metrics,
                                    current: {
                                        tokensUsed: updatedState?.tokensUsed,
                                        stepsExecuted: updatedState?.stepsExecuted,
                                        timeSpentMs: updatedState?.timeSpentMs,
                                        linesAdded: updatedState?.linesAdded,
                                        linesRemoved: updatedState?.linesRemoved,
                                        filesModified: updatedState?.filesModified.length,
                                    },
                                    limits: {
                                        exceeded: limits.exceeded,
                                        reason: limits.reason,
                                        tokensRemaining: (updatedState?.tokensLimit ?? 20000) - (updatedState?.tokensUsed ?? 0),
                                        stepsRemaining: (updatedState?.stepsLimit ?? 50) - (updatedState?.stepsExecuted ?? 0),
                                    },
                                }, null, 2),
                            },
                        ],
                    };
                }

                case 'query': {
                    if (!entityId) {
                        // List all sessions
                        const allEntityIds = store.getAllEntityIds();
                        const sessionEntities = allEntityIds.filter(id => id.startsWith('session:'));

                        const sessions: Array<{
                            entityId: string;
                            tokensUsed: number;
                            stepsExecuted: number;
                            limitExceeded: boolean;
                        }> = [];

                        for (const id of sessionEntities) {
                            const state = getProductivityState(id);
                            if (state) {
                                const limits = checkIsolationLimits(state);
                                sessions.push({
                                    entityId: id,
                                    tokensUsed: state.tokensUsed,
                                    stepsExecuted: state.stepsExecuted,
                                    limitExceeded: limits.exceeded,
                                });
                            }
                        }

                        return {
                            content: [
                                {
                                    type: 'text' as const,
                                    text: JSON.stringify({
                                        success: true,
                                        sessionCount: sessions.length,
                                        sessions,
                                    }, null, 2),
                                },
                            ],
                        };
                    }

                    const state = getProductivityState(entityId);
                    if (!state) {
                        return {
                            content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'Session not found' }) }],
                            isError: true,
                        };
                    }

                    const limits = checkIsolationLimits(state);

                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: JSON.stringify({
                                    success: true,
                                    entityId,
                                    productivity: {
                                        ...state,
                                        limitsExceeded: limits.exceeded,
                                        limitsReason: limits.reason,
                                    },
                                }, null, 2),
                            },
                        ],
                    };
                }
            }
        }
    );

    // bottleneck_detect - Identify productivity blockers
    server.tool(
        'bottleneck_detect',
        'Analyze and detect productivity bottlenecks in the coding workflow.',
        {
            entityId: z.string().optional().describe('Session entity to analyze'),
            analysisType: z.enum(['performance', 'workflow', 'resource', 'all']).default('all'),
            context: z.string().optional().describe('Additional context'),
        },
        async ({ entityId, analysisType, context }) => {
            const store = getEventStore();
            const bottlenecks: ProductivityComponent['bottlenecks'] = [];

            let state: ProductivityComponent | null = null;
            if (entityId) {
                state = getProductivityState(entityId);
            }

            // Performance bottlenecks
            if (analysisType === 'all' || analysisType === 'performance') {
                if (state && state.timeSpentMs > 0 && state.linesAdded > 0) {
                    const linesPerMinute = (state.linesAdded / state.timeSpentMs) * 60000;
                    if (linesPerMinute < 1) {
                        bottlenecks.push({
                            type: 'slow-progress',
                            description: `Low productivity: ${linesPerMinute.toFixed(2)} lines/minute`,
                            impact: 'high',
                            suggestion: 'Consider breaking task into smaller chunks or using code generation',
                        });
                    }
                }

                if (state && state.stepsExecuted > 40) {
                    bottlenecks.push({
                        type: 'step-limit-approaching',
                        description: `${state.stepsExecuted}/${state.stepsLimit} steps used`,
                        impact: 'high',
                        suggestion: 'Approaching step limit - decompose remaining work into sub-agent',
                    });
                }
            }

            // Workflow bottlenecks
            if (analysisType === 'all' || analysisType === 'workflow') {
                if (state && state.filesModified.length > 10) {
                    bottlenecks.push({
                        type: 'scattered-changes',
                        description: `Changes spread across ${state.filesModified.length} files`,
                        impact: 'medium',
                        suggestion: 'Consider focusing on fewer files per task',
                    });
                }

                if (state && state.linesRemoved > state.linesAdded * 2) {
                    bottlenecks.push({
                        type: 'high-churn',
                        description: 'More code removed than added - possible rework',
                        impact: 'medium',
                        suggestion: 'Review if requirements are clear before coding',
                    });
                }
            }

            // Resource bottlenecks
            if (analysisType === 'all' || analysisType === 'resource') {
                if (state && state.tokensUsed > state.tokensLimit * 0.8) {
                    bottlenecks.push({
                        type: 'token-limit-approaching',
                        description: `${state.tokensUsed}/${state.tokensLimit} tokens used (${Math.round(state.tokensUsed / state.tokensLimit * 100)}%)`,
                        impact: 'high',
                        suggestion: 'Approaching token limit - wrap up or spawn sub-agent',
                    });
                }
            }

            // Add context-based analysis
            if (context) {
                if (context.toLowerCase().includes('stuck') || context.toLowerCase().includes('blocked')) {
                    bottlenecks.push({
                        type: 'blocked',
                        description: 'User reports being blocked',
                        impact: 'high',
                        suggestion: 'Consider asking for help or breaking down the problem',
                    });
                }
            }

            // Persist bottlenecks if we have a session
            if (entityId && state && bottlenecks.length > 0) {
                for (const bottleneck of bottlenecks) {
                    store.append(entityId, 'productivity.bottleneck_added', { bottleneck });
                }
            }

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify({
                            success: true,
                            entityId,
                            analysisType,
                            bottleneckCount: bottlenecks.length,
                            bottlenecks,
                            summary: bottlenecks.length === 0
                                ? 'No bottlenecks detected'
                                : `Found ${bottlenecks.length} bottleneck(s): ${bottlenecks.map(b => b.type).join(', ')}`,
                        }, null, 2),
                    },
                ],
            };
        }
    );

    // resource_optimize - Optimize token/memory usage
    server.tool(
        'resource_optimize',
        'Analyze and optimize resource usage (tokens, memory) with Weak Notebook constraint (8GB).',
        {
            currentTokens: z.number().optional().describe('Current token usage'),
            currentMemoryMB: z.number().optional().describe('Current memory usage in MB'),
            activeContextSize: z.number().optional().describe('Number of active context items'),
            suggestions: z.boolean().default(true).describe('Include optimization suggestions'),
        },
        async ({ currentTokens, currentMemoryMB, activeContextSize, suggestions }) => {
            const MEMORY_LIMIT_MB = 8 * 1024; // 8GB (Weak Notebook)
            const TOKEN_LIMIT = 20000; // Sub-agent limit

            const analysis = {
                tokens: {
                    current: currentTokens ?? 0,
                    limit: TOKEN_LIMIT,
                    percentUsed: ((currentTokens ?? 0) / TOKEN_LIMIT) * 100,
                    withinLimit: (currentTokens ?? 0) < TOKEN_LIMIT,
                },
                memory: {
                    currentMB: currentMemoryMB ?? 0,
                    limitMB: MEMORY_LIMIT_MB,
                    percentUsed: ((currentMemoryMB ?? 0) / MEMORY_LIMIT_MB) * 100,
                    withinWeakNotebookLimit: (currentMemoryMB ?? 0) < MEMORY_LIMIT_MB,
                },
                context: {
                    activeItems: activeContextSize ?? 0,
                    recommendation: (activeContextSize ?? 0) > 50 ? 'Consider pruning context' : 'Context size OK',
                },
            };

            const optimizations: string[] = [];

            if (suggestions) {
                if (analysis.tokens.percentUsed > 80) {
                    optimizations.push('Token usage high - consider spawning sub-agent for remaining work');
                }
                if (analysis.memory.percentUsed > 70) {
                    optimizations.push('Memory usage high - prune inactive context files');
                }
                if (analysis.context.activeItems > 50) {
                    optimizations.push('Many active context items - focus on most relevant files');
                }
                if (analysis.tokens.percentUsed < 20 && analysis.context.activeItems < 5) {
                    optimizations.push('Resources underutilized - can add more context for better results');
                }
            }

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify({
                            success: true,
                            analysis,
                            optimizations,
                            summary: {
                                tokensStatus: analysis.tokens.withinLimit ? 'OK' : 'EXCEEDED',
                                memoryStatus: analysis.memory.withinWeakNotebookLimit ? 'OK' : 'EXCEEDED',
                                overall: analysis.tokens.withinLimit && analysis.memory.withinWeakNotebookLimit
                                    ? 'Resources within limits'
                                    : 'Resource limits exceeded - action required',
                            },
                        }, null, 2),
                    },
                ],
            };
        }
    );

    // workflow_automate - Automate repetitive tasks
    server.tool(
        'workflow_automate',
        'Define and execute automated workflow patterns for repetitive coding tasks.',
        {
            action: z.enum(['define', 'list', 'execute', 'delete']).describe('Action to perform'),
            workflowName: z.string().optional().describe('Workflow name'),
            steps: z.array(z.object({
                name: z.string(),
                tool: z.string(),
                args: z.record(z.unknown()),
            })).optional().describe('Workflow steps for define'),
            args: z.record(z.unknown()).optional().describe('Runtime arguments for execute'),
        },
        async ({ action, workflowName, steps, args }) => {
            const store = getEventStore();
            const workflowEntityId = 'workflows:registry';

            // Load existing workflows
            const events = store.loadEvents(workflowEntityId);
            const workflows = new Map<string, { name: string; steps: Array<{ name: string; tool: string; args: Record<string, unknown> }> }>();

            for (const event of events) {
                if (event.type === 'workflow.defined') {
                    const payload = event.payload as { name: string; steps: Array<{ name: string; tool: string; args: Record<string, unknown> }> };
                    workflows.set(payload.name, payload);
                } else if (event.type === 'workflow.deleted') {
                    const payload = event.payload as { name: string };
                    workflows.delete(payload.name);
                }
            }

            switch (action) {
                case 'define': {
                    if (!workflowName || !steps) {
                        return {
                            content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'workflowName and steps required' }) }],
                            isError: true,
                        };
                    }

                    store.append(workflowEntityId, 'workflow.defined', { name: workflowName, steps });

                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: JSON.stringify({
                                    success: true,
                                    message: `Workflow "${workflowName}" defined with ${steps.length} steps`,
                                    workflow: { name: workflowName, steps },
                                }, null, 2),
                            },
                        ],
                    };
                }

                case 'list': {
                    const workflowList = Array.from(workflows.values());

                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: JSON.stringify({
                                    success: true,
                                    count: workflowList.length,
                                    workflows: workflowList.map(w => ({
                                        name: w.name,
                                        stepCount: w.steps.length,
                                        steps: w.steps.map(s => s.name),
                                    })),
                                }, null, 2),
                            },
                        ],
                    };
                }

                case 'execute': {
                    if (!workflowName) {
                        return {
                            content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'workflowName required' }) }],
                            isError: true,
                        };
                    }

                    const workflow = workflows.get(workflowName);
                    if (!workflow) {
                        return {
                            content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: `Workflow "${workflowName}" not found` }) }],
                            isError: true,
                        };
                    }

                    // Record execution start
                    const executionId = serializeEntity(createEntity(EntityType.TASK));
                    store.append(executionId, 'workflow.execution_started', {
                        workflowName,
                        args,
                    });

                    // Return workflow steps for the AI to execute
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: JSON.stringify({
                                    success: true,
                                    executionId,
                                    workflowName,
                                    message: 'Execute the following steps in order:',
                                    steps: workflow.steps.map((s, i) => ({
                                        order: i + 1,
                                        name: s.name,
                                        tool: s.tool,
                                        args: { ...s.args, ...args },
                                    })),
                                }, null, 2),
                            },
                        ],
                    };
                }

                case 'delete': {
                    if (!workflowName) {
                        return {
                            content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'workflowName required' }) }],
                            isError: true,
                        };
                    }

                    if (!workflows.has(workflowName)) {
                        return {
                            content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: `Workflow "${workflowName}" not found` }) }],
                            isError: true,
                        };
                    }

                    store.append(workflowEntityId, 'workflow.deleted', { name: workflowName });

                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: JSON.stringify({
                                    success: true,
                                    message: `Workflow "${workflowName}" deleted`,
                                }, null, 2),
                            },
                        ],
                    };
                }
            }
        }
    );
}
