/**
 * Replay Engine - Deterministic Workflow Recovery
 * 
 * Features:
 * - Event cursor for replay position
 * - Deterministic side-effect injection
 * - Checkpoint/restore
 * - Saga pattern with compensation
 */

import { getEventStore, type Event as DurableEvent, type SagaStateRecord } from '../durability/event-store.js';
import { v7 as uuidv7 } from 'uuid';

/**
 * Replay state
 */
export interface ReplayState {
    entityId: string;
    position: number;
    events: DurableEvent[];
    isReplaying: boolean;
    lastTimestamp: number;
}

/**
 * Saga step definition
 */
export interface SagaStep<T = unknown> {
    name: string;
    execute: (input: T) => Promise<unknown>;
    compensate: (input: T, error: Error) => Promise<void>;
}

/**
 * Saga result
 */
export interface SagaResult {
    success: boolean;
    results: Array<{ step: string; result?: unknown; error?: string }>;
    compensated: boolean;
}

/**
 * Replay Engine for durable workflows
 */
export class ReplayEngine {
    private replayStates: Map<string, ReplayState> = new Map();

    /**
     * Start replaying events for an entity
     */
    startReplay(entityId: string): ReplayState {
        const store = getEventStore();
        const events = store.loadEvents(entityId);

        const state: ReplayState = {
            entityId,
            position: 0,
            events,
            isReplaying: true,
            lastTimestamp: events.length > 0 ? events[events.length - 1]!.timestamp : 0,
        };

        this.replayStates.set(entityId, state);
        return state;
    }

    /**
     * Get next event in replay sequence
     */
    nextEvent(entityId: string): DurableEvent | undefined {
        const state = this.replayStates.get(entityId);
        if (!state || state.position >= state.events.length) {
            return undefined;
        }

        const event = state.events[state.position];
        state.position++;
        return event;
    }

    /**
     * Check if still in replay mode
     */
    isReplaying(entityId: string): boolean {
        const state = this.replayStates.get(entityId);
        return state?.isReplaying ?? false;
    }

    /**
     * End replay and switch to live mode
     */
    endReplay(entityId: string): void {
        const state = this.replayStates.get(entityId);
        if (state) {
            state.isReplaying = false;
        }
    }

    /**
     * Get replay position
     */
    getPosition(entityId: string): number {
        return this.replayStates.get(entityId)?.position ?? 0;
    }

    /**
     * Get total events in replay
     */
    getTotalEvents(entityId: string): number {
        return this.replayStates.get(entityId)?.events.length ?? 0;
    }

    /**
     * Create a checkpoint (snapshot) for an entity
     */
    checkpoint(entityId: string, state: unknown): void {
        const store = getEventStore();
        const currentVersion = store.getCurrentVersion(entityId);
        store.saveSnapshot(entityId, state, currentVersion);
    }

    /**
     * Restore from checkpoint
     */
    restore(entityId: string): unknown | undefined {
        const store = getEventStore();
        return store.loadSnapshot(entityId)?.state;
    }

    /**
     * Execute a saga (sequence of steps with compensation)
     * Persists state after each step for crash recovery
     */
    async executeSaga<T>(
        entityId: string,
        input: T,
        steps: Array<SagaStep<T>>
    ): Promise<SagaResult & { sagaId: string }> {
        const store = getEventStore();
        const sagaId = uuidv7();
        const results: Array<{ step: string; result?: unknown; error?: string }> = [];
        const completedStepNames: string[] = [];
        const completedSteps: Array<SagaStep<T>> = [];

        // Initialize saga state
        const sagaState: SagaStateRecord = {
            sagaId,
            entityId,
            status: 'running',
            currentStep: 0,
            totalSteps: steps.length,
            input,
            completedSteps: [],
            results: [],
            createdAt: Date.now(),
        };
        store.saveSagaState(sagaState);

        // Record saga start
        store.append(entityId, 'saga.started', {
            sagaId,
            steps: steps.map(s => s.name),
            input,
        });

        try {
            for (let i = 0; i < steps.length; i++) {
                const step = steps[i]!;
                sagaState.currentStep = i;
                store.saveSagaState(sagaState);

                try {
                    const result = await step.execute(input);
                    results.push({ step: step.name, result });
                    completedStepNames.push(step.name);
                    completedSteps.push(step);

                    // Update saga state after successful step
                    sagaState.completedSteps = [...completedStepNames];
                    sagaState.results = [...results];
                    store.saveSagaState(sagaState);

                    store.append(entityId, 'saga.step_completed', {
                        sagaId,
                        step: step.name,
                        result,
                    });
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                    results.push({ step: step.name, error: errorMsg });

                    // Update state to compensating
                    sagaState.status = 'compensating';
                    sagaState.results = [...results];
                    store.saveSagaState(sagaState);

                    store.append(entityId, 'saga.step_failed', {
                        sagaId,
                        step: step.name,
                        error: errorMsg,
                    });

                    // Compensate in reverse order
                    for (const completedStep of [...completedSteps].reverse()) {
                        try {
                            await completedStep.compensate(input, error as Error);
                            store.append(entityId, 'saga.compensated', {
                                sagaId,
                                step: completedStep.name,
                            });
                        } catch (compError) {
                            const compMsg = compError instanceof Error ? compError.message : 'Compensation failed';
                            store.append(entityId, 'saga.compensation_failed', {
                                sagaId,
                                step: completedStep.name,
                                error: compMsg,
                            });
                        }
                    }

                    // Mark saga as failed
                    sagaState.status = 'failed';
                    store.saveSagaState(sagaState);

                    store.append(entityId, 'saga.failed', {
                        sagaId,
                        error: errorMsg,
                    });

                    return {
                        sagaId,
                        success: false,
                        results,
                        compensated: true,
                    };
                }
            }

            // Mark saga as completed and remove from recovery table
            sagaState.status = 'completed';
            store.saveSagaState(sagaState);
            store.deleteSagaState(sagaId);

            store.append(entityId, 'saga.completed', {
                sagaId,
                results: results.map(r => ({ step: r.step, hasResult: r.result !== undefined })),
            });

            return {
                sagaId,
                success: true,
                results,
                compensated: false,
            };
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown saga error';
            sagaState.status = 'failed';
            store.saveSagaState(sagaState);

            store.append(entityId, 'saga.error', { sagaId, error: errorMsg });

            return {
                sagaId,
                success: false,
                results,
                compensated: false,
            };
        }
    }

    /**
     * Recover incomplete sagas after crash
     * Returns list of sagas that need to be resumed
     */
    getIncompleteSagas(): SagaStateRecord[] {
        const store = getEventStore();
        return store.loadIncompleteSagas();
    }

    /**
     * Resume a saga from a previous crash
     */
    async resumeSaga<T>(
        sagaState: SagaStateRecord,
        steps: Array<SagaStep<T>>
    ): Promise<SagaResult & { sagaId: string }> {
        const store = getEventStore();
        const { sagaId, entityId } = sagaState;
        const input = sagaState.input as T;
        const results = [...sagaState.results];

        // If was compensating, continue compensation
        if (sagaState.status === 'compensating') {
            const completedStepNames = sagaState.completedSteps;
            const stepsToCompensate = steps
                .filter(s => completedStepNames.includes(s.name))
                .reverse();

            for (const step of stepsToCompensate) {
                try {
                    await step.compensate(input, new Error('Crash recovery compensation'));
                    store.append(entityId, 'saga.compensated', { sagaId, step: step.name });
                } catch (compError) {
                    const compMsg = compError instanceof Error ? compError.message : 'Compensation failed';
                    store.append(entityId, 'saga.compensation_failed', { sagaId, step: step.name, error: compMsg });
                }
            }

            sagaState.status = 'failed';
            store.saveSagaState(sagaState);
            store.deleteSagaState(sagaId);

            return { sagaId, success: false, results, compensated: true };
        }

        // Continue from where we left off
        const startFrom = sagaState.currentStep;
        const completedSteps = steps.slice(0, startFrom);

        for (let i = startFrom; i < steps.length; i++) {
            const step = steps[i]!;
            sagaState.currentStep = i;
            store.saveSagaState(sagaState);

            try {
                const result = await step.execute(input);
                results.push({ step: step.name, result });
                sagaState.completedSteps.push(step.name);
                completedSteps.push(step);
                sagaState.results = [...results];
                store.saveSagaState(sagaState);

                store.append(entityId, 'saga.step_completed', { sagaId, step: step.name, result });
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                results.push({ step: step.name, error: errorMsg });
                sagaState.status = 'compensating';
                store.saveSagaState(sagaState);

                // Compensate
                for (const completed of [...completedSteps].reverse()) {
                    try {
                        await completed.compensate(input, error as Error);
                    } catch {
                        // Log but continue
                    }
                }

                sagaState.status = 'failed';
                store.saveSagaState(sagaState);
                store.deleteSagaState(sagaId);

                return { sagaId, success: false, results, compensated: true };
            }
        }

        sagaState.status = 'completed';
        store.saveSagaState(sagaState);
        store.deleteSagaState(sagaId);

        return { sagaId, success: true, results, compensated: false };
    }

    /**
     * Deterministic time during replay
     */
    now(entityId: string): number {
        const state = this.replayStates.get(entityId);
        if (state?.isReplaying && state.position < state.events.length) {
            return state.events[state.position]!.timestamp;
        }
        return Date.now();
    }

    /**
     * Deterministic random during replay
     */
    random(entityId: string, seed: number): number {
        const state = this.replayStates.get(entityId);
        if (state?.isReplaying) {
            // Use position as additional entropy during replay
            const combined = seed + state.position;
            // LCG with position-based seed
            const a = 1103515245;
            const c = 12345;
            const m = 2147483648;
            return ((a * combined + c) % m) / m;
        }
        // Live mode: real random
        return Math.random();
    }

    /**
     * Clear replay state
     */
    clear(entityId: string): void {
        this.replayStates.delete(entityId);
    }
}

// Singleton
let replayInstance: ReplayEngine | undefined;

export function getReplayEngine(): ReplayEngine {
    if (!replayInstance) {
        replayInstance = new ReplayEngine();
    }
    return replayInstance;
}

export function resetReplayEngine(): void {
    replayInstance = undefined;
}

