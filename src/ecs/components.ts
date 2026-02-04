/**
 * ECS Components - Pure data schemas using Zod (per ECS Mandate)
 * Components have no logic, only data validation
 */

import { z } from 'zod';

/**
 * Progress Component - Tracks task progress state
 */
export const ProgressComponentSchema = z.object({
    entityId: z.string(),
    taskName: z.string(),
    percentage: z.number().min(0).max(100).default(0),
    status: z.enum(['pending', 'in_progress', 'blocked', 'completed', 'failed']).default('pending'),
    currentStep: z.string().optional(),
    totalSteps: z.number().optional(),
    completedSteps: z.number().default(0),
    startedAt: z.number(), // Unix timestamp (deterministic)
    updatedAt: z.number(),
    completedAt: z.number().optional(),
    metadata: z.record(z.unknown()).optional(),
});

export type ProgressComponent = z.infer<typeof ProgressComponentSchema>;

/**
 * Code Analysis Component - Code quality metrics
 */
export const CodeAnalysisComponentSchema = z.object({
    entityId: z.string(),
    filePath: z.string(),
    language: z.string(),
    linesOfCode: z.number(),
    complexity: z.number().min(0).max(100),
    maintainability: z.number().min(0).max(100),
    issues: z.array(z.object({
        severity: z.enum(['error', 'warning', 'info']),
        message: z.string(),
        line: z.number().optional(),
        column: z.number().optional(),
        rule: z.string().optional(),
    })),
    patterns: z.array(z.string()).default([]),
    dependencies: z.array(z.string()).default([]),
    analyzedAt: z.number(),
});

export type CodeAnalysisComponent = z.infer<typeof CodeAnalysisComponentSchema>;

/**
 * Risk Component - Risk assessment data
 */
export const RiskComponentSchema = z.object({
    entityId: z.string(),
    overallScore: z.number().min(0).max(100),
    category: z.enum(['low', 'medium', 'high', 'critical']),
    factors: z.array(z.object({
        name: z.string(),
        score: z.number().min(0).max(100),
        description: z.string(),
        mitigation: z.string().optional(),
    })),
    securityIssues: z.array(z.object({
        type: z.string(),
        severity: z.enum(['low', 'medium', 'high', 'critical']),
        description: z.string(),
        cwe: z.string().optional(),
    })).default([]),
    complianceViolations: z.array(z.string()).default([]),
    assessedAt: z.number(),
});

export type RiskComponent = z.infer<typeof RiskComponentSchema>;

/**
 * Lineage Component - Mahfuz integrity tracking
 */
export const LineageComponentSchema = z.object({
    entityId: z.string(),
    codeVersion: z.string(), // Git hash
    dataVersion: z.string(), // Component hash
    modelVersion: z.string().optional(), // GGUF hash if applicable
    parentLineage: z.string().optional(),
    reasoningTrace: z.array(z.object({
        step: z.number(),
        action: z.string(),
        input: z.unknown(),
        output: z.unknown(),
        timestamp: z.number(),
    })),
    createdAt: z.number(),
});

export type LineageComponent = z.infer<typeof LineageComponentSchema>;

/**
 * Productivity Component - Productivity metrics
 */
export const ProductivityComponentSchema = z.object({
    entityId: z.string(),
    sessionId: z.string(),
    tokensUsed: z.number().default(0),
    tokensLimit: z.number().default(20000), // Sub-agent limit
    stepsExecuted: z.number().default(0),
    stepsLimit: z.number().default(50), // Sub-agent limit
    timeSpentMs: z.number().default(0),
    filesModified: z.array(z.string()).default([]),
    linesAdded: z.number().default(0),
    linesRemoved: z.number().default(0),
    bottlenecks: z.array(z.object({
        type: z.string(),
        description: z.string(),
        impact: z.enum(['low', 'medium', 'high']),
        suggestion: z.string().optional(),
    })).default([]),
    measuredAt: z.number(),
});

export type ProductivityComponent = z.infer<typeof ProductivityComponentSchema>;

/**
 * Sub-Agent Component - Tracks spawned sub-agents (Isolation Mandate)
 */
export const SubAgentComponentSchema = z.object({
    entityId: z.string(),
    parentAgentId: z.string(),
    taskDescription: z.string(),
    systemPrompt: z.string(),
    status: z.enum(['pending', 'running', 'completed', 'failed']).default('pending'),
    stepsExecuted: z.number().default(0),
    tokensUsed: z.number().default(0),
    result: z.unknown().optional(),
    createdAt: z.number(),
    completedAt: z.number().optional(),
});

export type SubAgentComponent = z.infer<typeof SubAgentComponentSchema>;

/**
 * Context Component - Code context management
 */
export const ContextComponentSchema = z.object({
    entityId: z.string(),
    workspaceId: z.string(),
    activeFiles: z.array(z.object({
        path: z.string(),
        language: z.string(),
        relevanceScore: z.number().min(0).max(1),
        lastAccessed: z.number(),
    })),
    symbols: z.array(z.object({
        name: z.string(),
        type: z.enum(['function', 'class', 'variable', 'type', 'interface']),
        file: z.string(),
        line: z.number(),
    })).default([]),
    memoryUsageBytes: z.number().default(0),
    memoryLimitBytes: z.number().default(8 * 1024 * 1024 * 1024), // 8GB (Weak Notebook)
    updatedAt: z.number(),
});

export type ContextComponent = z.infer<typeof ContextComponentSchema>;

/**
 * Component type registry for runtime type checking
 */
export const ComponentRegistry = {
    progress: ProgressComponentSchema,
    codeAnalysis: CodeAnalysisComponentSchema,
    risk: RiskComponentSchema,
    lineage: LineageComponentSchema,
    productivity: ProductivityComponentSchema,
    subAgent: SubAgentComponentSchema,
    context: ContextComponentSchema,
} as const;

export type ComponentType = keyof typeof ComponentRegistry;
