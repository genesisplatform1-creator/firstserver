/**
 * ECS World Unit Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { World, ComponentType, getWorld, resetWorld } from '../src/ecs/world.js';

describe('ECS World', () => {
    let world: World;

    beforeEach(() => {
        resetWorld();
        world = getWorld();
    });

    describe('Entity Management', () => {
        it('should create entities with unique UUIDv7 IDs', () => {
            const id1 = world.createEntity();
            const id2 = world.createEntity();

            expect(id1).toBeDefined();
            expect(id2).toBeDefined();
            expect(id1).not.toBe(id2);
            expect(id1.length).toBe(36); // UUID format
        });

        it('should create entity with custom ID', () => {
            const customId = 'custom-entity-123';
            const id = world.createEntity(customId);

            expect(id).toBe(customId);
        });

        it('should delete entities and their components', () => {
            const id = world.createEntity();
            world.addComponent(id, ComponentType.Progress, { taskName: 'test' });

            const deleted = world.deleteEntity(id);

            expect(deleted).toBe(true);
            expect(world.hasEntity(id)).toBe(false);
            expect(world.getComponent(id, ComponentType.Progress)).toBeUndefined();
        });

        it('should return false when deleting non-existent entity', () => {
            const deleted = world.deleteEntity('non-existent');
            expect(deleted).toBe(false);
        });
    });

    describe('Component Management', () => {
        it('should add and retrieve components', () => {
            const id = world.createEntity();
            const progressData = { taskName: 'Test Task', percentage: 50 };

            world.addComponent(id, ComponentType.Progress, progressData);
            const retrieved = world.getComponent(id, ComponentType.Progress);

            expect(retrieved).toEqual(progressData);
        });

        it('should update existing components', () => {
            const id = world.createEntity();
            world.addComponent(id, ComponentType.Progress, { taskName: 'v1' });
            world.addComponent(id, ComponentType.Progress, { taskName: 'v2' });

            const retrieved = world.getComponent(id, ComponentType.Progress);
            expect(retrieved).toEqual({ taskName: 'v2' });
        });

        it('should remove components', () => {
            const id = world.createEntity();
            world.addComponent(id, ComponentType.Progress, { taskName: 'test' });

            world.removeComponent(id, ComponentType.Progress);

            expect(world.getComponent(id, ComponentType.Progress)).toBeUndefined();
            expect(world.hasComponent(id, ComponentType.Progress)).toBe(false);
        });

        it('should check if entity has component', () => {
            const id = world.createEntity();

            expect(world.hasComponent(id, ComponentType.Progress)).toBe(false);

            world.addComponent(id, ComponentType.Progress, {});

            expect(world.hasComponent(id, ComponentType.Progress)).toBe(true);
        });
    });

    describe('Query System', () => {
        it('should query entities with single component', () => {
            const id1 = world.createEntity();
            const id2 = world.createEntity();
            const id3 = world.createEntity();

            world.addComponent(id1, ComponentType.Progress, { name: 'a' });
            world.addComponent(id2, ComponentType.Progress, { name: 'b' });
            // id3 has no Progress component

            const result = world.query(ComponentType.Progress);

            expect(result.count()).toBe(2);
        });

        it('should query entities with multiple components', () => {
            const id1 = world.createEntity();
            const id2 = world.createEntity();

            world.addComponent(id1, ComponentType.Progress, {});
            world.addComponent(id1, ComponentType.Risk, {});
            world.addComponent(id2, ComponentType.Progress, {});
            // id2 has only Progress, not Risk

            const result = world.query(ComponentType.Progress, ComponentType.Risk);

            expect(result.count()).toBe(1);
        });

        it('should map over query results', () => {
            const id1 = world.createEntity();
            const id2 = world.createEntity();

            world.addComponent(id1, ComponentType.Progress, { value: 10 });
            world.addComponent(id2, ComponentType.Progress, { value: 20 });

            const values = world.query(ComponentType.Progress)
                .map((entityId, progress) => (progress as { value: number }).value);

            expect(values).toContain(10);
            expect(values).toContain(20);
        });

        it('should filter query results', () => {
            const id1 = world.createEntity();
            const id2 = world.createEntity();

            world.addComponent(id1, ComponentType.Progress, { value: 10 });
            world.addComponent(id2, ComponentType.Progress, { value: 20 });

            const filtered = world.query(ComponentType.Progress)
                .filter((_, progress) => (progress as { value: number }).value > 15);

            expect(filtered.count()).toBe(1);
        });

        it('should get first matching entity', () => {
            const id = world.createEntity();
            world.addComponent(id, ComponentType.Progress, { found: true });

            const first = world.query(ComponentType.Progress).first();

            expect(first).toBeDefined();
            expect(first?.entityId).toBe(id);
        });
    });

    describe('Serialization', () => {
        it('should serialize and deserialize world state', () => {
            const id = world.createEntity('test-entity');
            world.addComponent(id, ComponentType.Progress, { task: 'serialize-test' });

            const serialized = world.serialize();

            resetWorld();
            const newWorld = World.deserialize(serialized);

            expect(newWorld.hasEntity('test-entity')).toBe(true);
            expect(newWorld.getComponent('test-entity', ComponentType.Progress))
                .toEqual({ task: 'serialize-test' });
        });
    });
});
