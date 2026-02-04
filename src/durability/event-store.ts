/**
 * Event Store - SQLite-backed event sourcing for durable execution
 * Implements append-only log with state reconstruction (Immutable Audit Log)
 */

import Database from 'better-sqlite3';
import { v7 as uuidv7 } from 'uuid';
import { buildMerkleTree, sha256 } from '../tools/data-structures/index.js';

/**
 * Event structure for the append-only log
 */
export interface Event {
    id: string;
    entityId: string;
    type: string;
    payload: unknown;
    timestamp: number;
    version: number;
}

/**
 * Snapshot for performance optimization
 */
export interface Snapshot {
    entityId: string;
    state: unknown;
    version: number;
    createdAt: number;
}

/**
 * Saga status for crash recovery
 */
export type SagaStatus = 'running' | 'compensating' | 'completed' | 'failed';

/**
 * Saga state record for persistence
 */
export interface SagaStateRecord {
    sagaId: string;
    entityId: string;
    status: SagaStatus;
    currentStep: number;
    totalSteps: number;
    input: unknown;
    completedSteps: string[];
    results: Array<{ step: string; result?: unknown; error?: string }>;
    createdAt?: number;
    updatedAt?: number;
}

/**
 * Event store for durable state persistence
 */
export class EventStore {
    private db: Database.Database;
    private insertEvent: Database.Statement;
    private insertSnapshot: Database.Statement;
    private getEvents: Database.Statement;
    private getEventsAfterVersion: Database.Statement;
    private getLatestSnapshot: Database.Statement;

    private writeBuffer: Event[] = [];
    private flushTimer: NodeJS.Timeout | null = null;

    constructor(dbPath: string = ':memory:') {
        this.db = new Database(dbPath);
        
        // Performance optimizations for local write-heavy workloads
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('synchronous = NORMAL'); // 2x speedup over FULL
        this.db.pragma('cache_size = -64000'); // 64MB cache
        this.db.pragma('temp_store = MEMORY');
        this.db.pragma('mmap_size = 30000000000'); // 30GB mmap

        this.initializeSchema();

        // Prepare statements for performance
        this.insertEvent = this.db.prepare(`
      INSERT INTO events (id, entity_id, type, payload, timestamp, version)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

        this.insertSnapshot = this.db.prepare(`
      INSERT OR REPLACE INTO snapshots (entity_id, state, version, created_at)
      VALUES (?, ?, ?, ?)
    `);

        this.getEvents = this.db.prepare(`
      SELECT id, entity_id as entityId, type, payload, timestamp, version
      FROM events
      WHERE entity_id = ?
      ORDER BY version ASC
    `);

        this.getEventsAfterVersion = this.db.prepare(`
      SELECT id, entity_id as entityId, type, payload, timestamp, version
      FROM events
      WHERE entity_id = ? AND version > ?
      ORDER BY version ASC
    `);

        this.getLatestSnapshot = this.db.prepare(`
      SELECT entity_id as entityId, state, version, created_at as createdAt
      FROM snapshots
      WHERE entity_id = ?
      ORDER BY version DESC
      LIMIT 1
    `);
    }

    private initializeSchema(): void {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        version INTEGER NOT NULL,
        UNIQUE(entity_id, version)
      );
      
      CREATE INDEX IF NOT EXISTS idx_events_entity ON events(entity_id);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
      
      CREATE TABLE IF NOT EXISTS snapshots (
        entity_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS saga_state (
        saga_id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        status TEXT NOT NULL,
        current_step INTEGER NOT NULL,
        total_steps INTEGER NOT NULL,
        input TEXT NOT NULL,
        completed_steps TEXT NOT NULL,
        results TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_saga_entity ON saga_state(entity_id);
      CREATE INDEX IF NOT EXISTS idx_saga_status ON saga_state(status);

      CREATE TABLE IF NOT EXISTS integrity_blocks (
        id TEXT PRIMARY KEY,
        previous_block_hash TEXT,
        merkle_root TEXT NOT NULL,
        start_event_id TEXT NOT NULL,
        end_event_id TEXT NOT NULL,
        event_count INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_integrity_created ON integrity_blocks(created_at);
    `);
    }

    public async flushBuffer(): Promise<void> {
        this.flush();
        // Wait for next tick to ensure any async operations (if any) complete?
        // Flush is synchronous (using transaction), but wrapped in try-catch.
        return Promise.resolve();
    }

    private flush(): void {
        if (this.writeBuffer.length === 0) return;

        const insert = this.insertEvent;
        const eventsToFlush = [...this.writeBuffer];
        this.writeBuffer = [];

        try {
            const transaction = this.db.transaction((events: Event[]) => {
                for (const event of events) {
                    insert.run(
                        event.id,
                        event.entityId,
                        event.type,
                        JSON.stringify(event.payload),
                        event.timestamp,
                        event.version
                    );
                }
            });
            transaction(eventsToFlush);
        } catch (error) {
            console.error('Failed to flush events:', error);
        }

        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
    }

    /**
     * Append a new event to the log (Buffered)
     */
    append(entityId: string, type: string, payload: unknown, timestamp?: number): Event {
        // We need to calculate the version carefully.
        // getCurrentVersion hits the DB, which might be behind the buffer.
        // We add the count of buffered events for this entity.
        const dbVersion = this.getCurrentVersion(entityId);
        const bufferedCount = this.getBufferedCount(entityId);
        
        const event: Event = {
            id: uuidv7(),
            entityId,
            type,
            payload,
            timestamp: timestamp ?? Date.now(),
            version: dbVersion + bufferedCount + 1,
        };

        this.writeBuffer.push(event);

        if (this.writeBuffer.length >= 100) {
            this.flush();
        } else if (!this.flushTimer) {
            this.flushTimer = setTimeout(() => this.flush(), 50);
        }

        return event;
    }

    private getBufferedCount(entityId: string): number {
        return this.writeBuffer.filter(e => e.entityId === entityId).length;
    }

    /**
     * Get current version for an entity
     */
    getCurrentVersion(entityId: string): number {
        const result = this.db.prepare(`
      SELECT MAX(version) as version FROM events WHERE entity_id = ?
    `).get(entityId) as { version: number | null } | undefined;

        return result?.version ?? 0;
    }

    /**
     * Load all events for an entity
     */
    loadEvents(entityId: string): Event[] {
        const rows = this.getEvents.all(entityId) as Array<{
            id: string;
            entityId: string;
            type: string;
            payload: string;
            timestamp: number;
            version: number;
        }>;

        return rows.map(row => ({
            ...row,
            payload: JSON.parse(row.payload),
        }));
    }

    /**
     * Load events after a specific version (for incremental replay)
     */
    loadEventsAfterVersion(entityId: string, afterVersion: number): Event[] {
        const rows = this.getEventsAfterVersion.all(entityId, afterVersion) as Array<{
            id: string;
            entityId: string;
            type: string;
            payload: string;
            timestamp: number;
            version: number;
        }>;

        return rows.map(row => ({
            ...row,
            payload: JSON.parse(row.payload),
        }));
    }

    /**
     * Save a snapshot
     */
    saveSnapshot(entityId: string, state: unknown, version: number): void {
        this.insertSnapshot.run(
            entityId,
            JSON.stringify(state),
            version,
            Date.now()
        );
    }

    /**
     * Load the latest snapshot for an entity
     */
    loadSnapshot(entityId: string): Snapshot | null {
        const row = this.getLatestSnapshot.get(entityId) as {
            entityId: string;
            state: string;
            version: number;
            createdAt: number;
        } | undefined;

        if (!row) return null;

        return {
            ...row,
            state: JSON.parse(row.state),
        };
    }

    /**
     * Reconstruct state from events with optional reducer
     */
    reconstruct<T>(
        entityId: string,
        reducer: (state: T | undefined, event: Event) => T,
        initialState?: T
    ): T | undefined {
        // Try to load from snapshot first
        const snapshot = this.loadSnapshot(entityId);

        let state: T | undefined;
        let events: Event[];

        if (snapshot) {
            state = snapshot.state as T;
            events = this.loadEventsAfterVersion(entityId, snapshot.version);
        } else {
            state = initialState;
            events = this.loadEvents(entityId);
        }

        // Apply events
        for (const event of events) {
            state = reducer(state, event);
        }

        return state;
    }

    /**
     * Get all entity IDs in the store
     */
    getAllEntityIds(): string[] {
        const rows = this.db.prepare(`
      SELECT DISTINCT entity_id FROM events
    `).all() as Array<{ entity_id: string }>;

        return rows.map(row => row.entity_id);
    }

    // ============ Saga Persistence Methods ============

    /**
     * Save saga state for crash recovery
     */
    saveSagaState(saga: SagaStateRecord): void {
        const now = Date.now();
        this.db.prepare(`
            INSERT OR REPLACE INTO saga_state 
            (saga_id, entity_id, status, current_step, total_steps, input, completed_steps, results, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            saga.sagaId,
            saga.entityId,
            saga.status,
            saga.currentStep,
            saga.totalSteps,
            JSON.stringify(saga.input),
            JSON.stringify(saga.completedSteps),
            JSON.stringify(saga.results),
            saga.createdAt ?? now,
            now
        );
    }

    /**
     * Load saga state by ID
     */
    loadSagaState(sagaId: string): SagaStateRecord | null {
        const row = this.db.prepare(`
            SELECT saga_id, entity_id, status, current_step, total_steps, input, completed_steps, results, created_at, updated_at
            FROM saga_state WHERE saga_id = ?
        `).get(sagaId) as {
            saga_id: string;
            entity_id: string;
            status: string;
            current_step: number;
            total_steps: number;
            input: string;
            completed_steps: string;
            results: string;
            created_at: number;
            updated_at: number;
        } | undefined;

        if (!row) return null;

        return {
            sagaId: row.saga_id,
            entityId: row.entity_id,
            status: row.status as SagaStatus,
            currentStep: row.current_step,
            totalSteps: row.total_steps,
            input: JSON.parse(row.input),
            completedSteps: JSON.parse(row.completed_steps),
            results: JSON.parse(row.results),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    /**
     * Load all incomplete sagas (for recovery on restart)
     */
    loadIncompleteSagas(): SagaStateRecord[] {
        const rows = this.db.prepare(`
            SELECT saga_id, entity_id, status, current_step, total_steps, input, completed_steps, results, created_at, updated_at
            FROM saga_state WHERE status IN ('running', 'compensating')
            ORDER BY created_at ASC
        `).all() as Array<{
            saga_id: string;
            entity_id: string;
            status: string;
            current_step: number;
            total_steps: number;
            input: string;
            completed_steps: string;
            results: string;
            created_at: number;
            updated_at: number;
        }>;

        return rows.map(row => ({
            sagaId: row.saga_id,
            entityId: row.entity_id,
            status: row.status as SagaStatus,
            currentStep: row.current_step,
            totalSteps: row.total_steps,
            input: JSON.parse(row.input),
            completedSteps: JSON.parse(row.completed_steps),
            results: JSON.parse(row.results),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        }));
    }

    /**
     * Delete completed saga state
     */
    deleteSagaState(sagaId: string): void {
        this.db.prepare('DELETE FROM saga_state WHERE saga_id = ?').run(sagaId);
    }

    // ============ Audit Log Integrity Methods ============

    /**
     * Seal a new integrity block (Merkle Tree of recent events)
     */
    sealIntegrityBlock(maxEvents: number = 1000): { blockId: string, eventCount: number } | null {
        // 1. Get last sealed event timestamp/Order
        // We use ROWID or implicit ordering by timestamp/creation?
        // Since UUIDv7 is time-sortable, we can sort by ID.

        const lastBlock = this.db.prepare(`
            SELECT end_event_id, previous_block_hash, merkle_root 
            FROM integrity_blocks 
            ORDER BY created_at DESC 
            LIMIT 1
        `).get() as { end_event_id: string, previous_block_hash: string, merkle_root: string } | undefined;

        let query = `SELECT id, entity_id, type, payload, timestamp, version FROM events`;
        const params: any[] = [];

        if (lastBlock) {
            query += ` WHERE id > ?`;
            params.push(lastBlock.end_event_id);
        }

        query += ` ORDER BY id ASC LIMIT ?`;
        params.push(maxEvents);

        const events = this.db.prepare(query).all(...params) as Array<{
            id: string;
            entity_id: string;
            type: string;
            payload: string;
            timestamp: number;
            version: number;
        }>;

        if (events.length === 0) return null;

        const dataBlocks = events.map(e => {
            // Canonical serialization for hashing
            return JSON.stringify({
                id: e.id,
                entityId: e.entity_id,
                type: e.type,
                payload: e.payload, // Already stringified in DB
                timestamp: e.timestamp,
                version: e.version
            });
        });

        const root = buildMerkleTree(dataBlocks);
        if (!root) return null; // Should be handled by length check but safe guard

        const blockId = uuidv7();
        const prevHash = lastBlock ? sha256(lastBlock.merkle_root) : null; // Hash Chain: Hash of prev root? Or prev block ID? 
        // Hash Chain usually hashes the previous block header. Simplified: Hash of previous Merkle Root.

        this.db.prepare(`
            INSERT INTO integrity_blocks (id, previous_block_hash, merkle_root, start_event_id, end_event_id, event_count, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            blockId,
            prevHash,
            root.hash,
            events[0]!.id,
            events[events.length - 1]!.id,
            events.length,
            Date.now()
        );

        return { blockId, eventCount: events.length };
    }

    /**
     * Verify the integrity of the event log against sealed blocks
     */
    verifyIntegrity(): { valid: boolean, error?: string, failedBlockId?: string } {
        const blocks = this.db.prepare(`
            SELECT id, previous_block_hash, merkle_root, start_event_id, end_event_id, event_count 
            FROM integrity_blocks 
            ORDER BY created_at ASC
        `).all() as Array<{
            id: string;
            previous_block_hash: string | null;
            merkle_root: string;
            start_event_id: string;
            end_event_id: string;
            event_count: number;
        }>;

        let lastRootHash: string | null = null;

        for (const block of blocks) {
            // 1. Verify Hash Chain
            const expectedPrevHash = lastRootHash ? sha256(lastRootHash) : null;
            if (block.previous_block_hash !== expectedPrevHash) {
                return {
                    valid: false,
                    error: `Hash chain broken at block ${block.id}. Expected prev: ${expectedPrevHash}, Got: ${block.previous_block_hash}`,
                    failedBlockId: block.id
                };
            }

            // 2. Verify Merkle Root
            // Fetch events range
            const events = this.db.prepare(`
                SELECT id, entity_id, type, payload, timestamp, version 
                FROM events 
                WHERE id >= ? AND id <= ?
                ORDER BY id ASC
            `).all(block.start_event_id, block.end_event_id) as Array<{
                id: string, entity_id: string, type: string, payload: string, timestamp: number, version: number
            }>;

            if (events.length !== block.event_count) {
                return {
                    valid: false,
                    error: `Event count mismatch at block ${block.id}. Expected: ${block.event_count}, Got: ${events.length}`,
                    failedBlockId: block.id
                };
            }

            const dataBlocks = events.map(e => JSON.stringify({
                id: e.id,
                entityId: e.entity_id,
                type: e.type,
                payload: e.payload,
                timestamp: e.timestamp,
                version: e.version
            }));

            const root = buildMerkleTree(dataBlocks);

            if (!root || root.hash !== block.merkle_root) {
                return {
                    valid: false,
                    error: `Merkle Root mismatch at block ${block.id}.`,
                    failedBlockId: block.id
                };
            }

            lastRootHash = block.merkle_root;
        }

        return { valid: true };
    }

    /**
     * Close the database connection
     */
    close(): void {
        this.db.close();
    }
}

/**
 * Create a global event store singleton
 */
let globalEventStore: EventStore | null = null;

export function getEventStore(dbPath?: string): EventStore {
    if (!globalEventStore) {
        globalEventStore = new EventStore(dbPath);
    }
    return globalEventStore;
}

export function closeEventStore(): void {
    if (globalEventStore) {
        globalEventStore.close();
        globalEventStore = null;
    }
}

export function resetEventStore(): void {
    closeEventStore();
    // Next call to getEventStore will create fresh in-memory DB
}

