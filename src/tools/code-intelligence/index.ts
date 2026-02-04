/**
 * Code Intelligence Tools
 * Tools for code analysis, task decomposition, and context management
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
    createEntity,
    EntityType,
    serializeEntity,
    CodeAnalysisComponentSchema,
    SubAgentComponentSchema,
    ContextComponentSchema,
    type CodeAnalysisComponent,
    type SubAgentComponent,
    type ContextComponent,
} from '../../ecs/index.js';
import { getEventStore } from '../../durability/index.js';

/**
 * Simple code analysis (in production, integrate with external tools)
 */
// analyzeCode moved to src/analysis/analyzer.ts

import { analyzeCode } from '../../analysis/analyzer.js';
import { WorkerPool } from '../../coordinator/worker-pool.js';

/**
 * Register code intelligence tools
 */
export function registerCodeIntelligenceTools(server: McpServer, workerPool?: WorkerPool): void {
    // code_analyze - Analyze code quality
    server.tool(
        'code_analyze',
        'Analyze code quality, patterns, and issues. Returns metrics and suggestions.',
        {
            code: z.string().describe('Code to analyze'),
            language: z.string().default('typescript').describe('Programming language'),
            filePath: z.string().optional().describe('File path for context'),
        },
        async ({ code, language, filePath }) => {
            const store = getEventStore();
            const entity = createEntity(EntityType.TASK);
            const entityId = serializeEntity(entity);

            let analysis: Omit<CodeAnalysisComponent, 'entityId' | 'analyzedAt'>;

            if (workerPool) {
                try {
                    const result = await workerPool.executeTask('analyze', {
                        code,
                        language,
                    });
                    analysis = result.result as Omit<CodeAnalysisComponent, 'entityId' | 'analyzedAt'>;
                } catch (error) {
                    console.error('Worker analysis failed, falling back to local:', error);
                    analysis = analyzeCode(code, language);
                }
            } else {
                analysis = analyzeCode(code, language);
            }

            const component: CodeAnalysisComponent = {
                ...analysis,
                entityId,
                filePath: filePath ?? 'inline',
                analyzedAt: Date.now(),
            };

            // Validate and persist
            CodeAnalysisComponentSchema.parse(component);
            store.append(entityId, 'code.analyzed', component);

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify({
                            success: true,
                            entityId,
                            analysis: {
                                linesOfCode: component.linesOfCode,
                                complexity: component.complexity,
                                maintainability: component.maintainability,
                                issueCount: component.issues.length,
                                issues: component.issues,
                                patterns: component.patterns,
                            },
                            summary: `Code analysis complete: ${component.linesOfCode} lines, complexity ${component.complexity}/100, ${component.issues.length} issues found`,
                        }, null, 2),
                    },
                ],
            };
        }
    );

    // code_parse - Parse code using worker pool
    if (workerPool) {
        server.tool(
            'code_parse',
            'Parse code into AST using specialized workers (supports JS, TS, Python).',
            {
                code: z.string().describe('Source code to parse'),
                language: z.string().describe('Language (javascript, typescript, python)'),
            },
            async ({ code, language }) => {
                try {
                    const result = await workerPool.executeTask('parse', {
                        code,
                        language,
                    });

                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: JSON.stringify(result, null, 2),
                            },
                        ],
                    };
                } catch (error: any) {
                    return {
                        content: [{ type: 'text', text: `Parse error: ${error.message}` }],
                        isError: true,
                    };
                }
            }
        );
    }

    // task_decompose - Break task into sub-agents (Sub-Agent Isolation Mandate)
    server.tool(
        'task_decompose',
        'Decompose a complex task into sub-agents. Each sub-agent has a 50-step/20k token limit. Returns sub-task specifications.',
        {
            taskDescription: z.string().describe('Description of the task to decompose'),
            estimatedSteps: z.number().optional().describe('Estimated steps if known'),
            estimatedTokens: z.number().optional().describe('Estimated tokens if known'),
            constraints: z.array(z.string()).optional().describe('Additional constraints'),
        },
        async ({ taskDescription, estimatedSteps, estimatedTokens, constraints }) => {
            const store = getEventStore();
            const parentEntity = createEntity(EntityType.AGENT);
            const parentId = serializeEntity(parentEntity);

            const STEP_LIMIT = 50;
            const TOKEN_LIMIT = 20000;

            const steps = estimatedSteps ?? 100;
            const tokens = estimatedTokens ?? 50000;

            // Calculate number of sub-agents needed
            const subAgentsBySteps = Math.ceil(steps / STEP_LIMIT);
            const subAgentsByTokens = Math.ceil(tokens / TOKEN_LIMIT);
            const numSubAgents = Math.max(subAgentsBySteps, subAgentsByTokens);

            // Generate sub-agent specifications
            const subAgents: Array<{
                id: string;
                order: number;
                taskDescription: string;
                systemPrompt: string;
                stepBudget: number;
                tokenBudget: number;
            }> = [];

            for (let i = 0; i < numSubAgents; i++) {
                const subEntity = createEntity(EntityType.AGENT);
                const subId = serializeEntity(subEntity);

                const subTaskDesc = numSubAgents === 1
                    ? taskDescription
                    : `Part ${i + 1}/${numSubAgents} of: ${taskDescription}`;

                const systemPrompt = `You are a focused sub-agent with a specific micro-task.
TASK: ${subTaskDesc}
CONSTRAINTS:
- Maximum ${STEP_LIMIT} steps
- Maximum ${TOKEN_LIMIT} tokens
- Return only the final artifact
- Discard chat history after completion
${constraints?.map(c => `- ${c}`).join('\n') ?? ''}

Focus solely on this micro-task and return a clean, complete result.`;

                const subComponent: SubAgentComponent = {
                    entityId: subId,
                    parentAgentId: parentId,
                    taskDescription: subTaskDesc,
                    systemPrompt,
                    status: 'pending',
                    stepsExecuted: 0,
                    tokensUsed: 0,
                    createdAt: Date.now(),
                };

                SubAgentComponentSchema.parse(subComponent);
                store.append(subId, 'subagent.created', subComponent);

                subAgents.push({
                    id: subId,
                    order: i + 1,
                    taskDescription: subTaskDesc,
                    systemPrompt,
                    stepBudget: STEP_LIMIT,
                    tokenBudget: TOKEN_LIMIT,
                });
            }

            // Record decomposition event
            store.append(parentId, 'task.decomposed', {
                originalTask: taskDescription,
                subAgentCount: numSubAgents,
                subAgentIds: subAgents.map(s => s.id),
            });

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify({
                            success: true,
                            parentId,
                            decomposition: {
                                originalTask: taskDescription,
                                estimatedSteps: steps,
                                estimatedTokens: tokens,
                                requiresDecomposition: numSubAgents > 1,
                                subAgentCount: numSubAgents,
                            },
                            subAgents: subAgents.map(s => ({
                                id: s.id,
                                order: s.order,
                                taskDescription: s.taskDescription,
                                stepBudget: s.stepBudget,
                                tokenBudget: s.tokenBudget,
                            })),
                            systemPrompts: subAgents.map(s => ({
                                id: s.id,
                                prompt: s.systemPrompt,
                            })),
                        }, null, 2),
                    },
                ],
            };
        }
    );

    // context_manage - Manage code context and memory
    server.tool(
        'context_manage',
        'Manage coding context - add files, query relevance, check memory usage (8GB limit for Weak Notebook).',
        {
            action: z.enum(['add', 'remove', 'query', 'status']).describe('Action to perform'),
            workspaceId: z.string().optional().describe('Workspace ID (auto-created if not provided)'),
            filePath: z.string().optional().describe('File path to add/remove'),
            language: z.string().optional().describe('File language'),
            relevanceScore: z.number().min(0).max(1).optional().describe('File relevance (0-1)'),
        },
        async ({ action, workspaceId, filePath, language, relevanceScore }) => {
            const store = getEventStore();

            // Get or create workspace
            let wsId = workspaceId;
            if (!wsId) {
                const wsEntity = createEntity(EntityType.WORKSPACE);
                wsId = serializeEntity(wsEntity);
            }

            // Load current context
            const events = store.loadEvents(wsId);
            let context: ContextComponent = {
                entityId: wsId,
                workspaceId: wsId,
                activeFiles: [],
                symbols: [],
                memoryUsageBytes: 0,
                memoryLimitBytes: 8 * 1024 * 1024 * 1024, // 8GB
                updatedAt: Date.now(),
            };

            for (const event of events) {
                if (event.type === 'context.file_added') {
                    const payload = event.payload as { path: string; language: string; relevanceScore: number };
                    context.activeFiles.push({
                        path: payload.path,
                        language: payload.language,
                        relevanceScore: payload.relevanceScore,
                        lastAccessed: event.timestamp,
                    });
                } else if (event.type === 'context.file_removed') {
                    const payload = event.payload as { path: string };
                    context.activeFiles = context.activeFiles.filter(f => f.path !== payload.path);
                }
            }

            switch (action) {
                case 'add':
                    if (!filePath) {
                        return {
                            content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'filePath required for add' }) }],
                            isError: true,
                        };
                    }
                    store.append(wsId, 'context.file_added', {
                        path: filePath,
                        language: language ?? 'unknown',
                        relevanceScore: relevanceScore ?? 0.5,
                    });
                    context.activeFiles.push({
                        path: filePath,
                        language: language ?? 'unknown',
                        relevanceScore: relevanceScore ?? 0.5,
                        lastAccessed: Date.now(),
                    });
                    break;

                case 'remove':
                    if (!filePath) {
                        return {
                            content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'filePath required for remove' }) }],
                            isError: true,
                        };
                    }
                    store.append(wsId, 'context.file_removed', { path: filePath });
                    context.activeFiles = context.activeFiles.filter(f => f.path !== filePath);
                    break;

                case 'query':
                    // Return files sorted by relevance
                    const sorted = [...context.activeFiles].sort((a, b) => b.relevanceScore - a.relevanceScore);
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: JSON.stringify({
                                    success: true,
                                    workspaceId: wsId,
                                    fileCount: sorted.length,
                                    files: sorted,
                                }, null, 2),
                            },
                        ],
                    };

                case 'status':
                    break;
            }

            // Estimate memory usage (rough: 1KB per file entry)
            context.memoryUsageBytes = context.activeFiles.length * 1024;
            const memoryPercent = (context.memoryUsageBytes / context.memoryLimitBytes) * 100;

            ContextComponentSchema.parse(context);

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify({
                            success: true,
                            workspaceId: wsId,
                            action,
                            context: {
                                fileCount: context.activeFiles.length,
                                memoryUsageBytes: context.memoryUsageBytes,
                                memoryLimitBytes: context.memoryLimitBytes,
                                memoryPercent: memoryPercent.toFixed(2) + '%',
                                withinWeakNotebookLimit: memoryPercent < 100,
                            },
                        }, null, 2),
                    },
                ],
            };
        }
    );

    // diff_review - Review and validate code changes
    server.tool(
        'diff_review',
        'Review code changes (diff) and provide analysis of the modifications.',
        {
            diff: z.string().describe('Unified diff format string'),
            context: z.string().optional().describe('Additional context about the change'),
        },
        async ({ diff, context }) => {
            const store = getEventStore();
            const entity = createEntity(EntityType.TASK);
            const entityId = serializeEntity(entity);

            // Parse diff
            const addedLines = (diff.match(/^\+[^+]/gm) ?? []).length;
            const removedLines = (diff.match(/^-[^-]/gm) ?? []).length;
            const files = new Set(
                (diff.match(/^(?:\+\+\+|---) [ab]\/(.+)$/gm) ?? [])
                    .map(l => l.replace(/^(?:\+\+\+|---) [ab]\//, ''))
            );

            // Simple risk assessment
            const risks: string[] = [];
            if (removedLines > addedLines * 2) {
                risks.push('Large deletion detected - verify no important code is removed');
            }
            if (diff.includes('password') || diff.includes('secret') || diff.includes('api_key')) {
                risks.push('Potential credentials in diff - verify no secrets committed');
            }
            if (diff.includes('TODO') || diff.includes('FIXME')) {
                risks.push('TODO/FIXME comments added - ensure they are tracked');
            }

            store.append(entityId, 'diff.reviewed', {
                addedLines,
                removedLines,
                fileCount: files.size,
                risks,
            });

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify({
                            success: true,
                            entityId,
                            review: {
                                filesChanged: Array.from(files),
                                fileCount: files.size,
                                linesAdded: addedLines,
                                linesRemoved: removedLines,
                                netChange: addedLines - removedLines,
                                risks,
                                riskLevel: risks.length === 0 ? 'low' : risks.length < 3 ? 'medium' : 'high',
                            },
                            context,
                        }, null, 2),
                    },
                ],
            };
        }
    );
}
