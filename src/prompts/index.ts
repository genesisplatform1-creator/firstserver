/**
 * MCP Prompts
 * Reusable prompt templates for common operations
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/**
 * Register MCP prompts
 */
export function registerPrompts(server: McpServer): void {
    // Code review prompt
    server.prompt(
        'code_review',
        'Generate a thorough code review for the given code',
        {
            code: z.string().describe('Code to review'),
            language: z.string().optional().describe('Programming language'),
            context: z.string().optional().describe('Additional context'),
        },
        ({ code, language, context }) => {
            return {
                messages: [
                    {
                        role: 'user' as const,
                        content: {
                            type: 'text' as const,
                            text: `Please perform a thorough code review for the following ${language ?? 'code'}:

\`\`\`${language ?? ''}
${code}
\`\`\`

${context ? `Additional context: ${context}\n` : ''}
Please analyze:
1. **Code Quality**: Readability, maintainability, and adherence to best practices
2. **Potential Bugs**: Logic errors, edge cases, null handling
3. **Security**: Vulnerabilities, injection risks, data exposure
4. **Performance**: Inefficiencies, memory leaks, algorithmic complexity
5. **Suggestions**: Specific improvements with code examples

Use the following tools for deeper analysis:
- \`code_analyze\` for metrics
- \`security_scan\` for vulnerabilities
- \`compliance_check\` for standards`,
                        },
                    },
                ],
            };
        }
    );

    // Risk analysis prompt
    server.prompt(
        'risk_analysis',
        'Analyze risks associated with a code change or feature',
        {
            changeDescription: z.string().describe('Description of the change'),
            affectedAreas: z.string().optional().describe('Areas of codebase affected'),
        },
        ({ changeDescription, affectedAreas }) => {
            return {
                messages: [
                    {
                        role: 'user' as const,
                        content: {
                            type: 'text' as const,
                            text: `Please analyze the risks associated with this change:

**Change Description:**
${changeDescription}

${affectedAreas ? `**Affected Areas:**\n${affectedAreas}\n` : ''}

Please evaluate:
1. **Technical Risk**: Complexity, dependencies, breaking changes
2. **Security Risk**: New attack surfaces, data handling changes
3. **Operational Risk**: Deployment, rollback, monitoring needs
4. **Business Risk**: User impact, compliance, SLA considerations

Use these tools for analysis:
- \`risk_assess\` for structured risk scoring
- \`security_scan\` for security-specific risks
- \`lineage_track\` to document the analysis trace`,
                        },
                    },
                ],
            };
        }
    );

    // Task decomposition prompt
    server.prompt(
        'task_breakdown',
        'Break down a complex task into manageable sub-tasks',
        {
            taskDescription: z.string().describe('Complex task to break down'),
            constraints: z.string().optional().describe('Time, resource, or technical constraints'),
        },
        ({ taskDescription, constraints }) => {
            return {
                messages: [
                    {
                        role: 'user' as const,
                        content: {
                            type: 'text' as const,
                            text: `Please break down the following complex task into manageable sub-tasks:

**Task:**
${taskDescription}

${constraints ? `**Constraints:**\n${constraints}\n` : ''}

**Requirements:**
- Each sub-task must be completable within 50 steps
- Each sub-task must use fewer than 20,000 tokens
- Sub-tasks should be independent where possible
- Provide clear acceptance criteria for each

Use \`task_decompose\` to generate sub-agent specifications with system prompts.
Use \`progress_init\` to track overall progress across sub-tasks.`,
                        },
                    },
                ],
            };
        }
    );

    // Productivity optimization prompt
    server.prompt(
        'optimize_workflow',
        'Analyze and suggest optimizations for coding workflow',
        {
            currentWorkflow: z.string().describe('Description of current workflow'),
            painPoints: z.string().optional().describe('Known pain points or bottlenecks'),
        },
        ({ currentWorkflow, painPoints }) => {
            return {
                messages: [
                    {
                        role: 'user' as const,
                        content: {
                            type: 'text' as const,
                            text: `Please analyze and optimize the following coding workflow:

**Current Workflow:**
${currentWorkflow}

${painPoints ? `**Known Pain Points:**\n${painPoints}\n` : ''}

Please provide:
1. **Bottleneck Analysis**: Identify the biggest time sinks
2. **Automation Opportunities**: Repetitive tasks that can be automated
3. **Tool Recommendations**: Better tools or techniques
4. **Workflow Improvements**: Step-by-step optimized workflow

Use these tools:
- \`bottleneck_detect\` to analyze productivity issues
- \`resource_optimize\` to check resource usage
- \`workflow_automate\` to define reusable workflows`,
                        },
                    },
                ],
            };
        }
    );

    // Mahfuz lineage prompt
    server.prompt(
        'trace_lineage',
        'Create a full reasoning trace for governance and compliance',
        {
            decision: z.string().describe('Decision or change to document'),
            codeVersion: z.string().optional().describe('Git commit hash'),
        },
        ({ decision, codeVersion }) => {
            return {
                messages: [
                    {
                        role: 'user' as const,
                        content: {
                            type: 'text' as const,
                            text: `Please create a full reasoning trace for governance compliance:

**Decision/Change:**
${decision}

${codeVersion ? `**Code Version:** ${codeVersion}\n` : ''}

**Mahfuz Integrity Requirements:**
1. Every state transition must be a committed event
2. Link code version (Git hash), data version, and model version
3. Document all reasoning steps with inputs and outputs
4. Maintain immutable lineage for audit trail

Steps:
1. Use \`lineage_track\` with action='create' to start
2. For each reasoning step, use \`lineage_track\` with action='step'
3. Query final trace with action='query'
4. If spawning sub-agents, use action='fork' for child lineage`,
                        },
                    },
                ],
            };
        }
    );
}
