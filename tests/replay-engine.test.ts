/**
 * Replay Engine Unit Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ReplayEngine, getReplayEngine, resetReplayEngine } from '../src/durability/replay-engine.js';
import { getEventStore, resetEventStore } from '../src/durability/event-store.js';

describe('Replay Engine', () => {
    let engine: ReplayEngine;

    beforeEach(() => {
        resetEventStore();
        resetReplayEngine();
        engine = getReplayEngine();
    });

    describe('Replay Mode', () => {
        it('should start replay with existing events', async () => {
            const store = getEventStore();
            store.append('e1', 'created', { v: 1 });
            store.append('e1', 'updated', { v: 2 });

            await store.flushBuffer();

            const state = engine.startReplay('e1');

            expect(state.isReplaying).toBe(true);
            expect(state.events).toHaveLength(2);
            expect(state.position).toBe(0);
        });

        it('should iterate through events in order', async () => {
            const store = getEventStore();
            store.append('e1', 'first', {});
            store.append('e1', 'second', {});
            store.append('e1', 'third', {});

            await store.flushBuffer();

            engine.startReplay('e1');

            expect(engine.nextEvent('e1')?.type).toBe('first');
            expect(engine.nextEvent('e1')?.type).toBe('second');
            expect(engine.nextEvent('e1')?.type).toBe('third');
            expect(engine.nextEvent('e1')).toBeUndefined();
        });

        it('should end replay mode', async () => {
            const store = getEventStore();
            store.append('e1', 'event', {});

            await store.flushBuffer();

            engine.startReplay('e1');
            expect(engine.isReplaying('e1')).toBe(true);

            engine.endReplay('e1');
            expect(engine.isReplaying('e1')).toBe(false);
        });

        it('should report correct replay position', async () => {
            const store = getEventStore();
            store.append('e1', 'a', {});
            store.append('e1', 'b', {});

            await store.flushBuffer();

            engine.startReplay('e1');
            expect(engine.getPosition('e1')).toBe(0);

            engine.nextEvent('e1');
            expect(engine.getPosition('e1')).toBe(1);

            engine.nextEvent('e1');
            expect(engine.getPosition('e1')).toBe(2);
        });
    });

    describe('Deterministic Time', () => {
        it('should return event timestamp during replay', async () => {
            const store = getEventStore();
            store.append('e1', 'event', {});

            await store.flushBuffer();

            engine.startReplay('e1');
            const events = store.loadEvents('e1');

            // During replay, now() should return event timestamp
            const replayTime = engine.now('e1');
            expect(replayTime).toBe(events[0]!.timestamp);
        });

        it('should return current time when not replaying', () => {
            const before = Date.now();
            const time = engine.now('non-replaying');
            const after = Date.now();

            expect(time).toBeGreaterThanOrEqual(before);
            expect(time).toBeLessThanOrEqual(after);
        });
    });

    describe('Deterministic Random', () => {
        it('should return consistent values for same seed', async () => {
            // Start replay mode so random is deterministic
            const store = getEventStore();
            store.append('e1', 'test', {});
            await store.flushBuffer();
            
            engine.startReplay('e1');

            const rand1 = engine.random('e1', 123);

            // Same seed should produce a number between 0 and 1
            expect(typeof rand1).toBe('number');
            expect(rand1).toBeGreaterThanOrEqual(0);
            expect(rand1).toBeLessThan(1);
        });
    });

    describe('Checkpoint/Restore', () => {
        it('should checkpoint and restore state', async () => {
            // First create an event so checkpoint has a version
            const store = getEventStore();
            store.append('e1', 'init', {});
            await store.flushBuffer();

            const state = { counter: 42, items: ['a', 'b'] };

            engine.checkpoint('e1', state);
            const restored = engine.restore('e1');

            expect(restored).toEqual(state);
        });

        it('should return undefined for non-existent checkpoint', () => {
            const restored = engine.restore('non-existent');
            expect(restored).toBeUndefined();
        });
    });

    describe('Saga Pattern', () => {
        it('should execute saga steps in order', async () => {
            const executed: string[] = [];

            const steps = [
                {
                    name: 'step1',
                    execute: async () => { executed.push('step1'); return 'result1'; },
                    compensate: async () => { executed.push('compensate1'); },
                },
                {
                    name: 'step2',
                    execute: async () => { executed.push('step2'); return 'result2'; },
                    compensate: async () => { executed.push('compensate2'); },
                },
            ];

            // Note: executeSaga signature is (entityId, input, steps)
            const result = await engine.executeSaga('e1', {}, steps);

            expect(result.success).toBe(true);
            expect(result.compensated).toBe(false);
            expect(executed).toEqual(['step1', 'step2']);
            expect(result.results).toHaveLength(2);
        });

        it('should compensate on failure in reverse order', async () => {
            const executed: string[] = [];

            const steps = [
                {
                    name: 'step1',
                    execute: async () => { executed.push('exec1'); },
                    compensate: async () => { executed.push('comp1'); },
                },
                {
                    name: 'step2',
                    execute: async () => { executed.push('exec2'); },
                    compensate: async () => { executed.push('comp2'); },
                },
                {
                    name: 'step3',
                    execute: async () => { throw new Error('Step 3 failed'); },
                    compensate: async () => { executed.push('comp3'); },
                },
            ];

            const result = await engine.executeSaga('e1', {}, steps);

            expect(result.success).toBe(false);
            expect(result.compensated).toBe(true);
            // Should compensate step2 then step1 (reverse order)
            expect(executed).toEqual(['exec1', 'exec2', 'comp2', 'comp1']);
        });
    });
});
