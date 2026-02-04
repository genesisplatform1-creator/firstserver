/**
 * Workflow Engine - Deterministic execution wrappers for durable workflows
 * Prohibits native Date.now() and Math.random() in workflow logic (Durable Execution Mandate)
 */

import { getEventStore, type Event } from './event-store.js';

/**
 * Workflow execution context with deterministic operations
 */
export interface WorkflowContext {
    workflowId: string;
    seed: number;
    currentTime: number;
    stepCount: number;
    isReplay: boolean;
}

/**
 * Create a new workflow context
 */
export function createWorkflowContext(
    workflowId: string,
    seed?: number,
    startTime?: number
): WorkflowContext {
    return {
        workflowId,
        seed: seed ?? Math.floor(Math.random() * 2147483647),
        currentTime: startTime ?? Date.now(),
        stepCount: 0,
        isReplay: false,
    };
}

/**
 * Workflow namespace with deterministic operations
 */
export const workflow = {
    /**
     * Deterministic time - must be used instead of Date.now() in workflow logic
     */
    now(ctx: WorkflowContext): number {
        return ctx.currentTime;
    },

    /**
     * Advance workflow time
     */
    advanceTime(ctx: WorkflowContext, ms: number): WorkflowContext {
        return {
            ...ctx,
            currentTime: ctx.currentTime + ms,
        };
    },

    /**
     * Deterministic random - must be used instead of Math.random() in workflow logic
     * Uses a simple linear congruential generator for reproducibility
     */
    random(ctx: WorkflowContext): { value: number; nextCtx: WorkflowContext } {
        // LCG parameters (same as Java's Random)
        const a = 1103515245;
        const c = 12345;
        const m = 2147483648;

        const nextSeed = (a * ctx.seed + c) % m;
        const value = nextSeed / m;

        return {
            value,
            nextCtx: { ...ctx, seed: nextSeed },
        };
    },

    /**
     * Deterministic random integer in range [min, max]
     */
    randomInt(
        ctx: WorkflowContext,
        min: number,
        max: number
    ): { value: number; nextCtx: WorkflowContext } {
        const { value, nextCtx } = workflow.random(ctx);
        const intValue = Math.floor(value * (max - min + 1)) + min;
        return { value: intValue, nextCtx };
    },

    /**
     * Increment step count
     */
    nextStep(ctx: WorkflowContext): WorkflowContext {
        return {
            ...ctx,
            stepCount: ctx.stepCount + 1,
        };
    },

    /**
     * Check if step limit exceeded (Sub-Agent Isolation)
     */
    isStepLimitExceeded(ctx: WorkflowContext, limit: number = 50): boolean {
        return ctx.stepCount >= limit;
    },
};

/**
 * Activity result that can be persisted
 */
export interface ActivityResult<T> {
    success: boolean;
    value?: T;
    error?: string;
    executedAt: number;
}

/**
 * Execute an activity with durable persistence
 * Activities are side-effect operations that run once and their results are persisted
 */
export async function executeActivity<T>(
    ctx: WorkflowContext,
    activityName: string,
    activityFn: () => Promise<T>
): Promise<{ result: ActivityResult<T>; nextCtx: WorkflowContext }> {
    const store = getEventStore();
    const activityId = `${ctx.workflowId}:activity:${activityName}:${ctx.stepCount}`;

    // Check if activity was already executed (replay)
    const existingEvents = store.loadEvents(activityId);
    const completedEvent = existingEvents.find(e => e.type === 'activity.completed');

    if (completedEvent) {
        // Replay: return persisted result
        return {
            result: completedEvent.payload as ActivityResult<T>,
            nextCtx: workflow.nextStep(ctx),
        };
    }

    // Execute activity
    const timestamp = workflow.now(ctx);
    store.append(activityId, 'activity.started', { activityName }, timestamp);

    let result: ActivityResult<T>;

    try {
        const value = await activityFn();
        result = {
            success: true,
            value,
            executedAt: timestamp,
        };
    } catch (error) {
        result = {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            executedAt: timestamp,
        };
    }

    store.append(activityId, 'activity.completed', result, timestamp);

    return {
        result,
        nextCtx: workflow.nextStep(ctx),
    };
}

/**
 * Start a child workflow (Sub-Agent pattern)
 */
export function startChildWorkflow(
    parentCtx: WorkflowContext,
    childWorkflowId: string,
    taskDescription: string
): WorkflowContext {
    const store = getEventStore();
    const timestamp = workflow.now(parentCtx);

    // Record child workflow start in parent
    store.append(parentCtx.workflowId, 'child.started', {
        childWorkflowId,
        taskDescription,
    }, timestamp);

    // Create child context with inherited seed for determinism
    const { value: childSeed, nextCtx } = workflow.randomInt(parentCtx, 0, 2147483647);

    const childCtx = createWorkflowContext(childWorkflowId, childSeed, timestamp);

    // Record child workflow creation
    store.append(childWorkflowId, 'workflow.created', {
        parentWorkflowId: parentCtx.workflowId,
        taskDescription,
    }, timestamp);

    return childCtx;
}

/**
 * Complete a child workflow and return result to parent
 */
export function completeChildWorkflow(
    parentCtx: WorkflowContext,
    childWorkflowId: string,
    result: unknown
): WorkflowContext {
    const store = getEventStore();
    const timestamp = workflow.now(parentCtx);

    // Record completion in child workflow
    store.append(childWorkflowId, 'workflow.completed', { result }, timestamp);

    // Record completion in parent workflow
    store.append(parentCtx.workflowId, 'child.completed', {
        childWorkflowId,
        result,
    }, timestamp);

    return workflow.nextStep(parentCtx);
}

/**
 * Replay a workflow from events
 */
export function replayWorkflow<TState>(
    workflowId: string,
    reducer: (state: TState | undefined, event: Event) => TState,
    initialState?: TState
): TState | undefined {
    const store = getEventStore();
    return store.reconstruct(workflowId, reducer, initialState);
}
