/**
 * ECS World - Proper Entity Component System
 * 
 * Features:
 * - Sparse-set entity storage
 * - Component bitmask for fast archetype queries
 * - Query API for component composition
 * - Deterministic iteration order
 */

import * as uuidModule from 'uuidv7';
const uuidv7 = uuidModule.uuidv7;

// Component type IDs (bitmask positions)
export const ComponentType = {
    Progress: 1 << 0,
    CodeAnalysis: 1 << 1,
    Risk: 1 << 2,
    Lineage: 1 << 3,
    Productivity: 1 << 4,
    SubAgent: 1 << 5,
    Context: 1 << 6,
} as const;

export type ComponentTypeKey = keyof typeof ComponentType;
export type ComponentMask = number;

/**
 * Entity - Just an ID with archetype mask
 */
export interface Entity {
    id: string;
    mask: ComponentMask;
    createdAt: number;
}

/**
 * Component storage - typed map per component type
 */
type ComponentStorage<T> = Map<string, T>;

/**
 * Query result iterator
 */
export interface QueryResult<T extends unknown[]> {
    forEach(callback: (entityId: string, ...components: T) => void): void;
    map<R>(callback: (entityId: string, ...components: T) => R): R[];
    filter(predicate: (entityId: string, ...components: T) => boolean): QueryResult<T>;
    first(): { entityId: string; components: T } | undefined;
    count(): number;
}

/**
 * ECS World - Central registry for all entities and components
 */
export class World {
    private entities: Map<string, Entity> = new Map();
    private components: Map<ComponentMask, ComponentStorage<unknown>> = new Map();
    private entityOrder: string[] = []; // Deterministic iteration

    constructor() {
        // Initialize component storage for each type
        for (const mask of Object.values(ComponentType)) {
            this.components.set(mask, new Map());
        }
    }

    /**
     * Create a new entity
     */
    createEntity(id?: string): string {
        const entityId = id ?? uuidv7();
        const entity: Entity = {
            id: entityId,
            mask: 0,
            createdAt: Date.now(),
        };
        this.entities.set(entityId, entity);
        this.entityOrder.push(entityId);
        return entityId;
    }

    /**
     * Delete an entity and all its components
     */
    deleteEntity(entityId: string): boolean {
        const entity = this.entities.get(entityId);
        if (!entity) return false;

        // Remove all components
        for (const [mask, storage] of this.components) {
            if (entity.mask & mask) {
                storage.delete(entityId);
            }
        }

        this.entities.delete(entityId);
        this.entityOrder = this.entityOrder.filter(id => id !== entityId);
        return true;
    }

    /**
     * Check if entity exists
     */
    hasEntity(entityId: string): boolean {
        return this.entities.has(entityId);
    }

    /**
     * Add a component to an entity
     */
    addComponent<T>(entityId: string, componentType: ComponentMask, data: T): void {
        const entity = this.entities.get(entityId);
        if (!entity) {
            throw new Error(`Entity ${entityId} not found`);
        }

        const storage = this.components.get(componentType);
        if (!storage) {
            throw new Error(`Unknown component type: ${componentType}`);
        }

        storage.set(entityId, data);
        entity.mask |= componentType;
    }

    /**
     * Remove a component from an entity
     */
    removeComponent(entityId: string, componentType: ComponentMask): boolean {
        const entity = this.entities.get(entityId);
        if (!entity) return false;

        const storage = this.components.get(componentType);
        if (!storage) return false;

        const deleted = storage.delete(entityId);
        if (deleted) {
            entity.mask &= ~componentType;
        }
        return deleted;
    }

    /**
     * Get a component from an entity
     */
    getComponent<T>(entityId: string, componentType: ComponentMask): T | undefined {
        const storage = this.components.get(componentType);
        return storage?.get(entityId) as T | undefined;
    }

    /**
     * Check if entity has a component
     */
    hasComponent(entityId: string, componentType: ComponentMask): boolean {
        const entity = this.entities.get(entityId);
        return entity ? (entity.mask & componentType) !== 0 : false;
    }

    /**
     * Update a component (must already exist)
     */
    updateComponent<T>(entityId: string, componentType: ComponentMask, updater: (current: T) => T): void {
        const current = this.getComponent<T>(entityId, componentType);
        if (current === undefined) {
            throw new Error(`Component not found for entity ${entityId}`);
        }
        const updated = updater(current);
        const storage = this.components.get(componentType);
        storage?.set(entityId, updated);
    }

    /**
     * Query entities by component mask
     * Returns all entities that have ALL specified components
     */
    query<T extends unknown[]>(...componentTypes: ComponentMask[]): QueryResult<T> {
        const mask = componentTypes.reduce((acc, type) => acc | type, 0);
        const matches: Array<{ entityId: string; components: unknown[] }> = [];

        for (const entityId of this.entityOrder) {
            const entity = this.entities.get(entityId);
            if (entity && (entity.mask & mask) === mask) {
                const components = componentTypes.map(type =>
                    this.components.get(type)?.get(entityId)
                );
                matches.push({ entityId, components });
            }
        }

        return this.createQueryResult<T>(matches);
    }

    /**
     * Query entities that have ANY of the specified components
     */
    queryAny<T extends unknown[]>(...componentTypes: ComponentMask[]): QueryResult<T> {
        const mask = componentTypes.reduce((acc, type) => acc | type, 0);
        const matches: Array<{ entityId: string; components: unknown[] }> = [];

        for (const entityId of this.entityOrder) {
            const entity = this.entities.get(entityId);
            if (entity && (entity.mask & mask) !== 0) {
                const components = componentTypes.map(type =>
                    this.components.get(type)?.get(entityId)
                );
                matches.push({ entityId, components });
            }
        }

        return this.createQueryResult<T>(matches);
    }

    /**
     * Get all entity IDs
     */
    getAllEntityIds(): string[] {
        return [...this.entityOrder];
    }

    /**
     * Get entity count
     */
    getEntityCount(): number {
        return this.entities.size;
    }

    /**
     * Serialize world state
     */
    serialize(): string {
        const state: {
            entities: Array<{ id: string; mask: number; createdAt: number }>;
            components: Record<string, Array<{ entityId: string; data: unknown }>>;
        } = {
            entities: [],
            components: {},
        };

        for (const [id, entity] of this.entities) {
            state.entities.push({ id, mask: entity.mask, createdAt: entity.createdAt });
        }

        for (const [mask, storage] of this.components) {
            const typeName = Object.entries(ComponentType).find(([, v]) => v === mask)?.[0];
            if (typeName) {
                state.components[typeName] = [];
                for (const [entityId, data] of storage) {
                    state.components[typeName].push({ entityId, data });
                }
            }
        }

        return JSON.stringify(state);
    }

    /**
     * Deserialize world state
     */
    static deserialize(json: string): World {
        const state = JSON.parse(json) as {
            entities: Array<{ id: string; mask: number; createdAt: number }>;
            components: Record<string, Array<{ entityId: string; data: unknown }>>;
        };

        const world = new World();
        world.entities.clear();
        world.entityOrder = [];

        for (const entity of state.entities) {
            world.entities.set(entity.id, {
                id: entity.id,
                mask: entity.mask,
                createdAt: entity.createdAt,
            });
            world.entityOrder.push(entity.id);
        }

        for (const [typeName, entries] of Object.entries(state.components)) {
            const mask = ComponentType[typeName as ComponentTypeKey];
            if (mask) {
                const storage = world.components.get(mask);
                if (storage) {
                    for (const { entityId, data } of entries) {
                        storage.set(entityId, data);
                    }
                }
            }
        }

        return world;
    }

    private createQueryResult<T extends unknown[]>(
        matches: Array<{ entityId: string; components: unknown[] }>
    ): QueryResult<T> {
        const self = this;
        return {
            forEach(callback) {
                for (const { entityId, components } of matches) {
                    callback(entityId, ...(components as T));
                }
            },
            map<R>(callback: (entityId: string, ...components: T) => R): R[] {
                return matches.map(({ entityId, components }) =>
                    callback(entityId, ...(components as T))
                );
            },
            filter: (predicate) => {
                const filtered = matches.filter(({ entityId, components }) =>
                    predicate(entityId, ...(components as T))
                );
                return self.createQueryResult<T>(filtered);
            },
            first() {
                const first = matches[0];
                return first ? { entityId: first.entityId, components: first.components as T } : undefined;
            },
            count() {
                return matches.length;
            },
        };
    }
}

// Singleton world instance
let worldInstance: World | undefined;

export function getWorld(): World {
    if (!worldInstance) {
        worldInstance = new World();
    }
    return worldInstance;
}

export function resetWorld(): void {
    worldInstance = new World();
}
