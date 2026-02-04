/**
 * Event Store Unit Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EventStore, getEventStore, resetEventStore } from '../src/durability/event-store.js';
import { v7 as uuidv7 } from 'uuid';

describe('Event Store', () => {
    let store: EventStore;

    beforeEach(() => {
        resetEventStore();
        store = getEventStore();
    });

    describe('Event Append', () => {
        it('should append events with auto-incrementing version', async () => {
            const entityId = 'entity-1';

            store.append(entityId, 'created', { name: 'test' }, 1);
            store.append(entityId, 'updated', { name: 'updated' }, 2);

            await store.flushBuffer();
            const events = store.loadEvents(entityId);

            expect(events).toHaveLength(2);
            expect(events[0]!.type).toBe('created');
            expect(events[1]!.type).toBe('updated');
        });

        it('should assign unique event IDs', async () => {
            store.append('e1', 'test', {}, 1);
            store.append('e1', 'test', {}, 2);

            await store.flushBuffer();
            const events = store.loadEvents('e1');

            expect(events[0]!.id).not.toBe(events[1]!.id);
        });

        it('should store event payload', async () => {
            const payload = { key: 'value', nested: { deep: true } };
            store.append('e1', 'complex', payload, 1);

            await store.flushBuffer();
            const events = store.loadEvents('e1');

            expect(events[0]!.payload).toEqual(payload);
        });
    });

    describe('Event Loading', () => {
        it('should load events for specific entity only', async () => {
            store.append('entity-a', 'event-a', {}, 1);
            store.append('entity-b', 'event-b', {}, 1);
            store.append('entity-a', 'event-a2', {}, 2);

            await store.flushBuffer();
            const eventsA = store.loadEvents('entity-a');
            const eventsB = store.loadEvents('entity-b');

            expect(eventsA).toHaveLength(2);
            expect(eventsB).toHaveLength(1);
        });

        it('should load events in version order', async () => {
            store.append('e1', 'third', {}, 3);
            store.append('e1', 'first', {}, 1);
            store.append('e1', 'second', {}, 2);

            await store.flushBuffer();
            const events = store.loadEvents('e1');

            expect(events[0]!.version).toBe(1);
            expect(events[1]!.version).toBe(2);
            expect(events[2]!.version).toBe(3);
        });

        it('should return empty array for non-existent entity', () => {
            const events = store.loadEvents('non-existent');
            expect(events).toEqual([]);
        });
    });

    describe('Snapshots', () => {
        it('should save and load snapshots', () => {
            const state = { count: 42, data: ['a', 'b'] };

            store.saveSnapshot('e1', state, 5);
            const loaded = store.loadSnapshot('e1');

            expect(loaded?.state).toEqual(state);
            expect(loaded?.version).toBe(5);
        });

        it('should overwrite previous snapshots', () => {
            store.saveSnapshot('e1', { v: 1 }, 1);
            store.saveSnapshot('e1', { v: 2 }, 2);

            const loaded = store.loadSnapshot('e1');

            expect(loaded?.state).toEqual({ v: 2 });
            expect(loaded?.version).toBe(2);
        });

        it('should return null for non-existent snapshot', () => {
            const loaded = store.loadSnapshot('non-existent');
            expect(loaded).toBeNull();
        });
    });

    describe('Version Tracking', () => {
        it('should track current version', async () => {
            expect(store.getCurrentVersion('e1')).toBe(0);

            store.append('e1', 'event', {}, 1);
            // getCurrentVersion queries DB, so it should be 0 if not flushed.
            // But append logic adds buffered count.
            // Wait, getCurrentVersion in append() returns DB version.
            // But in test, we call store.getCurrentVersion('e1') which is the method on store.
            // The method logic: return this.db.prepare(...).get().
            // It does NOT look at buffer.
            // So if I don't flush, it returns 0 (or previous).
            // The previous logic was: append inserts, so getCurrentVersion returns new version.
            // Now: append buffers. getCurrentVersion returns OLD version.
            // To make test pass, I must flush.
            await store.flushBuffer();
            expect(store.getCurrentVersion('e1')).toBe(1);

            store.append('e1', 'event', {}, 2);
            await store.flushBuffer();
            expect(store.getCurrentVersion('e1')).toBe(2);
        });
    });

    describe('Mahfuz Integrity', () => {
        it('should seal an integrity block', async () => {
            const entityId = uuidv7();
            store.append(entityId, 'TEST_EVENT_1', { data: 1 });
            store.append(entityId, 'TEST_EVENT_2', { data: 2 });

            await store.flushBuffer();
            const result = store.sealIntegrityBlock(100);
            expect(result).not.toBeNull();
            expect(result!.eventCount).toBe(2);

            const verify = store.verifyIntegrity();
            expect(verify.valid).toBe(true);
        });

        it('should chain multiple blocks', async () => {
            const entityId = uuidv7();
            // Block 1
            store.append(entityId, 'E1', { v: 1 });
            await store.flushBuffer();
            store.sealIntegrityBlock(100);

            // Block 2
            store.append(entityId, 'E2', { v: 2 });
            await store.flushBuffer();
            store.sealIntegrityBlock(100);

            const verify = store.verifyIntegrity();
            expect(verify.valid).toBe(true);
        });

        it('should detect tampering with event data', async () => {
            const entityId = uuidv7();
            const event = store.append(entityId, 'SENSITIVE', { amount: 100 });
            await store.flushBuffer();
            store.sealIntegrityBlock(100);

            // Tamper with the event in DB
            const db = (store as any).db;
            db.prepare('UPDATE events SET payload = ? WHERE id = ?').run(
                JSON.stringify({ amount: 999999 }),
                event.id
            );

            const verify = store.verifyIntegrity();
            expect(verify.valid).toBe(false);
            expect(verify.error).toContain('Merkle Root mismatch');
        });

        it('should detect broken hash chain', async () => {
            const entityId = uuidv7();
            store.append(entityId, 'A', {});
            await store.flushBuffer();
            store.sealIntegrityBlock(100);

            store.append(entityId, 'B', {});
            await store.flushBuffer();
            const block2 = store.sealIntegrityBlock(100);

            // Tamper with the previous_block_hash of block 2
            const db = (store as any).db;
            db.prepare('UPDATE integrity_blocks SET previous_block_hash = ? WHERE id = ?').run(
                'fake_hash',
                block2!.blockId
            );

            const verify = store.verifyIntegrity();
            expect(verify.valid).toBe(false);
            expect(verify.error).toContain('Hash chain broken');
        });
    });
});
