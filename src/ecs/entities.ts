/**
 * ECS Entities - Pure ID generators following Entity Component System pattern
 * Entities are unique IDs only with no methods (per ECS Mandate)
 */

import { v7 as uuidv7 } from 'uuid';

/**
 * Entity types enumeration for type-safe entity creation
 */
export const EntityType = {
    TASK: 'task',
    AGENT: 'agent',
    WORKSPACE: 'workspace',
    SESSION: 'session',
    EVENT: 'event',
} as const;

export type EntityType = (typeof EntityType)[keyof typeof EntityType];

/**
 * Entity ID structure with type prefix for debugging
 */
export interface EntityId {
    readonly type: EntityType;
    readonly id: string;
}

/**
 * Create a new entity ID with UUIDv7 (time-sortable)
 */
export function createEntity(type: EntityType): EntityId {
    return {
        type,
        id: uuidv7(),
    };
}

/**
 * Serialize entity ID for storage/transmission
 */
export function serializeEntity(entity: EntityId): string {
    return `${entity.type}:${entity.id}`;
}

/**
 * Deserialize entity ID from storage/transmission
 */
export function deserializeEntity(serialized: string): EntityId {
    const [type, id] = serialized.split(':');
    if (!type || !id) {
        throw new Error(`Invalid entity ID: ${serialized}`);
    }
    if (!Object.values(EntityType).includes(type as EntityType)) {
        throw new Error(`Unknown entity type: ${type}`);
    }
    return { type: type as EntityType, id };
}

/**
 * Type guards for specific entity types
 */
export function isTaskEntity(entity: EntityId): boolean {
    return entity.type === EntityType.TASK;
}

export function isAgentEntity(entity: EntityId): boolean {
    return entity.type === EntityType.AGENT;
}

export function isWorkspaceEntity(entity: EntityId): boolean {
    return entity.type === EntityType.WORKSPACE;
}

export function isSessionEntity(entity: EntityId): boolean {
    return entity.type === EntityType.SESSION;
}
