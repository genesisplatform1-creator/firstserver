/**
 * ECS Systems - Pure functions that query and mutate components (per ECS Mandate)
 * Systems have no state, only transformations
 */

import type {
    ProgressComponent,
    RiskComponent,
    LineageComponent,
    ProductivityComponent,
    SubAgentComponent,
} from './components.js';

// ============================================================================
// Progress System
// ============================================================================

/**
 * Update progress percentage
 */
export function updateProgress(
    progress: ProgressComponent,
    percentage: number,
    currentStep?: string,
    now?: number
): ProgressComponent {
    const timestamp = now ?? Date.now();
    return {
        ...progress,
        percentage: Math.max(0, Math.min(100, percentage)),
        currentStep: currentStep ?? progress.currentStep,
        status: percentage >= 100 ? 'completed' : 'in_progress',
        updatedAt: timestamp,
        completedAt: percentage >= 100 ? timestamp : progress.completedAt,
    };
}

/**
 * Increment completed steps
 */
export function incrementStep(
    progress: ProgressComponent,
    now?: number
): ProgressComponent {
    const newCompleted = progress.completedSteps + 1;
    const totalSteps = progress.totalSteps ?? newCompleted;
    const percentage = Math.round((newCompleted / totalSteps) * 100);

    return updateProgress(
        {
            ...progress,
            completedSteps: newCompleted,
        },
        percentage,
        undefined,
        now
    );
}

/**
 * Mark progress as blocked
 */
export function blockProgress(
    progress: ProgressComponent,
    reason: string,
    now?: number
): ProgressComponent {
    return {
        ...progress,
        status: 'blocked',
        currentStep: reason,
        updatedAt: now ?? Date.now(),
    };
}

/**
 * Mark progress as failed
 */
export function failProgress(
    progress: ProgressComponent,
    reason: string,
    now?: number
): ProgressComponent {
    return {
        ...progress,
        status: 'failed',
        currentStep: reason,
        updatedAt: now ?? Date.now(),
    };
}

// ============================================================================
// Risk System
// ============================================================================

/**
 * Calculate overall risk score from factors
 */
export function calculateRiskScore(
    factors: RiskComponent['factors']
): { score: number; category: RiskComponent['category'] } {
    if (factors.length === 0) {
        return { score: 0, category: 'low' };
    }

    const avgScore = factors.reduce((sum, f) => sum + f.score, 0) / factors.length;
    const maxScore = Math.max(...factors.map(f => f.score));

    // Weight towards maximum risk factor
    const score = Math.round(avgScore * 0.4 + maxScore * 0.6);

    let category: RiskComponent['category'];
    if (score >= 80) category = 'critical';
    else if (score >= 60) category = 'high';
    else if (score >= 40) category = 'medium';
    else category = 'low';

    return { score, category };
}

/**
 * Add a risk factor
 */
export function addRiskFactor(
    risk: RiskComponent,
    factor: RiskComponent['factors'][0],
    now?: number
): RiskComponent {
    const factors = [...risk.factors, factor];
    const { score, category } = calculateRiskScore(factors);

    return {
        ...risk,
        factors,
        overallScore: score,
        category,
        assessedAt: now ?? Date.now(),
    };
}

/**
 * Add security issue
 */
export function addSecurityIssue(
    risk: RiskComponent,
    issue: RiskComponent['securityIssues'][0],
    now?: number
): RiskComponent {
    // Auto-add risk factor for security issues
    const severityScores: Record<string, number> = {
        low: 25,
        medium: 50,
        high: 75,
        critical: 95,
    };

    return addRiskFactor(
        {
            ...risk,
            securityIssues: [...risk.securityIssues, issue],
        },
        {
            name: `Security: ${issue.type}`,
            score: severityScores[issue.severity] ?? 50,
            description: issue.description,
            mitigation: issue.cwe ? `See CWE-${issue.cwe} for remediation` : undefined,
        },
        now
    );
}

// ============================================================================
// Lineage System (Mahfuz Integrity)
// ============================================================================

/**
 * Add reasoning step to lineage
 */
export function addReasoningStep(
    lineage: LineageComponent,
    action: string,
    input: unknown,
    output: unknown,
    now?: number
): LineageComponent {
    const timestamp = now ?? Date.now();
    const nextStep = lineage.reasoningTrace.length + 1;

    return {
        ...lineage,
        reasoningTrace: [
            ...lineage.reasoningTrace,
            { step: nextStep, action, input, output, timestamp },
        ],
    };
}

/**
 * Compute data version hash from component state
 */
export function computeDataVersion(component: unknown): string {
    const json = JSON.stringify(component, Object.keys(component as object).sort());
    // Simple hash for now - in production use crypto
    let hash = 0;
    for (let i = 0; i < json.length; i++) {
        const char = json.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Fork lineage for sub-agent
 */
export function forkLineage(
    parentLineage: LineageComponent,
    newEntityId: string,
    now?: number
): LineageComponent {
    const timestamp = now ?? Date.now();

    return {
        entityId: newEntityId,
        codeVersion: parentLineage.codeVersion,
        dataVersion: computeDataVersion(parentLineage),
        modelVersion: parentLineage.modelVersion,
        parentLineage: parentLineage.entityId,
        reasoningTrace: [],
        createdAt: timestamp,
    };
}

// ============================================================================
// Productivity System
// ============================================================================

/**
 * Check if sub-agent isolation limits are exceeded
 */
export function checkIsolationLimits(
    productivity: ProductivityComponent
): { exceeded: boolean; reason?: string } {
    if (productivity.stepsExecuted >= productivity.stepsLimit) {
        return {
            exceeded: true,
            reason: `Step limit exceeded: ${productivity.stepsExecuted}/${productivity.stepsLimit}`,
        };
    }
    if (productivity.tokensUsed >= productivity.tokensLimit) {
        return {
            exceeded: true,
            reason: `Token limit exceeded: ${productivity.tokensUsed}/${productivity.tokensLimit}`,
        };
    }
    return { exceeded: false };
}

/**
 * Increment productivity metrics
 */
export function trackProductivity(
    productivity: ProductivityComponent,
    metrics: {
        tokens?: number;
        steps?: number;
        timeMs?: number;
        linesAdded?: number;
        linesRemoved?: number;
        filesModified?: string[];
    },
    now?: number
): ProductivityComponent {
    return {
        ...productivity,
        tokensUsed: productivity.tokensUsed + (metrics.tokens ?? 0),
        stepsExecuted: productivity.stepsExecuted + (metrics.steps ?? 0),
        timeSpentMs: productivity.timeSpentMs + (metrics.timeMs ?? 0),
        linesAdded: productivity.linesAdded + (metrics.linesAdded ?? 0),
        linesRemoved: productivity.linesRemoved + (metrics.linesRemoved ?? 0),
        filesModified: [
            ...new Set([...productivity.filesModified, ...(metrics.filesModified ?? [])]),
        ],
        measuredAt: now ?? Date.now(),
    };
}

/**
 * Add bottleneck detection
 */
export function addBottleneck(
    productivity: ProductivityComponent,
    bottleneck: ProductivityComponent['bottlenecks'][0]
): ProductivityComponent {
    return {
        ...productivity,
        bottlenecks: [...productivity.bottlenecks, bottleneck],
    };
}

// ============================================================================
// Sub-Agent System
// ============================================================================

/**
 * Start sub-agent execution
 */
export function startSubAgent(
    subAgent: SubAgentComponent,
    now?: number
): SubAgentComponent {
    return {
        ...subAgent,
        status: 'running',
        createdAt: now ?? Date.now(),
    };
}

/**
 * Complete sub-agent execution
 */
export function completeSubAgent(
    subAgent: SubAgentComponent,
    result: unknown,
    now?: number
): SubAgentComponent {
    return {
        ...subAgent,
        status: 'completed',
        result,
        completedAt: now ?? Date.now(),
    };
}

/**
 * Fail sub-agent execution
 */
export function failSubAgent(
    subAgent: SubAgentComponent,
    error: string,
    now?: number
): SubAgentComponent {
    return {
        ...subAgent,
        status: 'failed',
        result: { error },
        completedAt: now ?? Date.now(),
    };
}
