/**
 * Event Bus - Reactive Event Composition
 * 
 * Features:
 * - Typed events with schema validation
 * - Tool-to-tool piping
 * - Subscription management
 * - Event replay support
 */

import { z } from 'zod';
import { Subject, Observable, Subscription as RxSubscription } from 'rxjs';
import { filter, buffer, debounceTime, throttleTime, map, take } from 'rxjs/operators';

/**
 * Event schema
 */
export const EventSchema = z.object({
    id: z.string(),
    type: z.string(),
    source: z.string(), // Tool or system that emitted
    timestamp: z.number(),
    payload: z.unknown(),
    correlationId: z.string().optional(), // For tracing across tools
    causationId: z.string().optional(),   // Event that caused this one
});

export type BusEvent = z.infer<typeof EventSchema>;

/**
 * Event handler type
 */
export type EventHandler<T = unknown> = (event: BusEvent) => void | Promise<void>;

/**
 * Subscription with filter
 */
interface Subscription {
    id: string;
    pattern: string | RegExp;
    handler: EventHandler;
    once: boolean;
}

/**
 * Pipe definition for tool composition
 */
interface Pipe {
    id: string;
    sourcePattern: string | RegExp;
    targetTool: string;
    transformer?: ((payload: unknown) => unknown) | undefined;
}

/**
 * Event Bus with reactive composition
 */
export class EventBus {
    private subscriptions: Subscription[] = [];
    private pipes: Pipe[] = [];
    private eventHistory: BusEvent[] = [];
    private maxHistorySize: number;
    private subscriptionIdCounter = 0;
    private pipeIdCounter = 0;

    constructor(maxHistorySize: number = 10000) {
        this.maxHistorySize = maxHistorySize;
    }

    /**
     * Emit an event
     */
    async emit(event: Omit<BusEvent, 'id' | 'timestamp'>): Promise<void> {
        const fullEvent: BusEvent = {
            ...event,
            id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            timestamp: Date.now(),
        };

        // Store in history
        this.eventHistory.push(fullEvent);
        if (this.eventHistory.length > this.maxHistorySize) {
            this.eventHistory.shift();
        }

        // Notify subscribers
        const matchingSubscriptions = this.subscriptions.filter(sub =>
            this.matchPattern(sub.pattern, fullEvent.type)
        );

        for (const sub of matchingSubscriptions) {
            try {
                await sub.handler(fullEvent);
            } catch (error) {
                console.error(`Event handler error for ${fullEvent.type}:`, error);
            }

            if (sub.once) {
                this.unsubscribe(sub.id);
            }
        }

        // Execute pipes
        const matchingPipes = this.pipes.filter(pipe =>
            this.matchPattern(pipe.sourcePattern, fullEvent.type)
        );

        for (const pipe of matchingPipes) {
            const transformedPayload = pipe.transformer
                ? pipe.transformer(fullEvent.payload)
                : fullEvent.payload;

            // Emit pipe event
            await this.emit({
                type: `pipe.${pipe.targetTool}`,
                source: 'event-bus',
                payload: transformedPayload,
                correlationId: fullEvent.correlationId ?? fullEvent.id,
                causationId: fullEvent.id,
            });
        }
    }

    /**
     * Subscribe to events matching a pattern
     */
    subscribe(pattern: string | RegExp, handler: EventHandler): string {
        const id = `sub_${++this.subscriptionIdCounter}`;
        this.subscriptions.push({
            id,
            pattern,
            handler,
            once: false,
        });
        return id;
    }

    /**
     * Subscribe to a single event occurrence
     */
    once(pattern: string | RegExp, handler: EventHandler): string {
        const id = `sub_${++this.subscriptionIdCounter}`;
        this.subscriptions.push({
            id,
            pattern,
            handler,
            once: true,
        });
        return id;
    }

    /**
     * Unsubscribe by ID
     */
    unsubscribe(subscriptionId: string): boolean {
        const index = this.subscriptions.findIndex(s => s.id === subscriptionId);
        if (index !== -1) {
            this.subscriptions.splice(index, 1);
            return true;
        }
        return false;
    }

    /**
     * Create a pipe from one event type to a tool
     */
    pipe(
        sourcePattern: string | RegExp,
        targetTool: string,
        transformer?: (payload: unknown) => unknown
    ): string {
        const id = `pipe_${++this.pipeIdCounter}`;
        this.pipes.push({
            id,
            sourcePattern,
            targetTool,
            transformer,
        });
        return id;
    }

    /**
     * Remove a pipe
     */
    removePipe(pipeId: string): boolean {
        const index = this.pipes.findIndex(p => p.id === pipeId);
        if (index !== -1) {
            this.pipes.splice(index, 1);
            return true;
        }
        return false;
    }

    /**
     * Get events matching a pattern
     */
    query(pattern: string | RegExp, limit: number = 100): BusEvent[] {
        return this.eventHistory
            .filter(e => this.matchPattern(pattern, e.type))
            .slice(-limit);
    }

    /**
     * Get events by correlation ID
     */
    getCorrelated(correlationId: string): BusEvent[] {
        return this.eventHistory.filter(e =>
            e.correlationId === correlationId || e.id === correlationId
        );
    }

    /**
     * Replay events to a handler
     */
    async replay(
        pattern: string | RegExp,
        handler: EventHandler,
        fromTimestamp?: number
    ): Promise<number> {
        const events = this.eventHistory.filter(e => {
            const matchesPattern = this.matchPattern(pattern, e.type);
            const matchesTime = fromTimestamp ? e.timestamp >= fromTimestamp : true;
            return matchesPattern && matchesTime;
        });

        for (const event of events) {
            await handler(event);
        }

        return events.length;
    }

    /**
     * Clear event history
     */
    clearHistory(): void {
        this.eventHistory = [];
    }

    /**
     * Get history size
     */
    getHistorySize(): number {
        return this.eventHistory.length;
    }

    /**
     * Export history for persistence
     */
    exportHistory(): BusEvent[] {
        return [...this.eventHistory];
    }

    /**
     * Import history for recovery
     */
    importHistory(events: BusEvent[]): void {
        this.eventHistory = [...events];
    }

    private matchPattern(pattern: string | RegExp, eventType: string): boolean {
        if (pattern instanceof RegExp) {
            return pattern.test(eventType);
        }

        // Support glob-like patterns
        if (pattern.includes('*')) {
            const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
            return regex.test(eventType);
        }

        return pattern === eventType;
    }
}

// Singleton instance
let busInstance: EventBus | undefined;

export function getEventBus(): EventBus {
    if (!busInstance) {
        busInstance = new EventBus();
    }
    return busInstance;
}

export function resetEventBus(): void {
    busInstance = new EventBus();
}

// ============ RxJS Reactive Event Bus ============

/**
 * Backpressure strategy for slow consumers
 */
export type BackpressureStrategy = 'buffer' | 'drop' | 'throttle';

/**
 * Backpressure configuration
 */
export interface BackpressureConfig {
    strategy: BackpressureStrategy;
    bufferSize?: number;      // For 'buffer' strategy
    throttleMs?: number;      // For 'throttle' strategy
    debounceMs?: number;      // Optional debounce
}

const DEFAULT_BACKPRESSURE: BackpressureConfig = {
    strategy: 'buffer',
    bufferSize: 1000,
    throttleMs: 100,
};

/**
 * Reactive Event Bus with RxJS backpressure support
 */
export class ReactiveEventBus {
    private subject: Subject<BusEvent> = new Subject();
    private subscriptions: Map<string, RxSubscription> = new Map();
    private subIdCounter = 0;

    /**
     * Get the raw observable stream
     */
    asObservable(): Observable<BusEvent> {
        return this.subject.asObservable();
    }

    /**
     * Emit an event
     */
    emit(event: Omit<BusEvent, 'id' | 'timestamp'>): void {
        const fullEvent: BusEvent = {
            ...event,
            id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            timestamp: Date.now(),
        };
        this.subject.next(fullEvent);
    }

    /**
     * Subscribe with backpressure protection
     */
    subscribe(
        pattern: string | RegExp,
        handler: EventHandler,
        config: Partial<BackpressureConfig> = {}
    ): string {
        const cfg = { ...DEFAULT_BACKPRESSURE, ...config };
        const id = `rxsub_${++this.subIdCounter}`;

        let stream$ = this.subject.pipe(
            filter(e => this.matchPattern(pattern, e.type))
        );

        // Apply backpressure strategy
        switch (cfg.strategy) {
            case 'buffer':
                stream$ = stream$.pipe(
                    buffer(this.subject.pipe(debounceTime(cfg.debounceMs ?? 50))),
                    // Flatten buffer but limit size
                    map(events => events.slice(-(cfg.bufferSize ?? 1000))),
                    map(events => events[events.length - 1]!), // Take latest from buffer
                    filter((e): e is BusEvent => e !== undefined)
                );
                break;
            case 'throttle':
                stream$ = stream$.pipe(
                    throttleTime(cfg.throttleMs ?? 100)
                );
                break;
            case 'drop':
                // No buffering, just process what we can
                // Events are dropped if handler is slow
                break;
        }

        const subscription = stream$.subscribe({
            next: async (event) => {
                try {
                    await handler(event);
                } catch (error) {
                    console.error(`Reactive handler error for ${event.type}:`, error);
                }
            },
            error: (err) => console.error('Stream error:', err),
        });

        this.subscriptions.set(id, subscription);
        return id;
    }

    /**
     * Subscribe to a fixed number of events
     */
    take(pattern: string | RegExp, count: number, handler: EventHandler): string {
        const id = `rxsub_${++this.subIdCounter}`;

        const subscription = this.subject.pipe(
            filter(e => this.matchPattern(pattern, e.type)),
            take(count)
        ).subscribe({
            next: async (event) => {
                try {
                    await handler(event);
                } catch (error) {
                    console.error(`Reactive handler error:`, error);
                }
            },
            complete: () => {
                this.subscriptions.delete(id);
            },
        });

        this.subscriptions.set(id, subscription);
        return id;
    }

    /**
     * Unsubscribe
     */
    unsubscribe(subscriptionId: string): boolean {
        const sub = this.subscriptions.get(subscriptionId);
        if (sub) {
            sub.unsubscribe();
            this.subscriptions.delete(subscriptionId);
            return true;
        }
        return false;
    }

    /**
     * Dispose all subscriptions
     */
    dispose(): void {
        for (const sub of this.subscriptions.values()) {
            sub.unsubscribe();
        }
        this.subscriptions.clear();
        this.subject.complete();
    }

    /**
     * Get subscription count
     */
    getSubscriptionCount(): number {
        return this.subscriptions.size;
    }

    private matchPattern(pattern: string | RegExp, eventType: string): boolean {
        if (pattern instanceof RegExp) {
            return pattern.test(eventType);
        }
        if (pattern.includes('*')) {
            const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
            return regex.test(eventType);
        }
        return pattern === eventType;
    }
}

// Singleton for reactive bus
let reactiveBusInstance: ReactiveEventBus | undefined;

export function getReactiveEventBus(): ReactiveEventBus {
    if (!reactiveBusInstance) {
        reactiveBusInstance = new ReactiveEventBus();
    }
    return reactiveBusInstance;
}

export function resetReactiveEventBus(): void {
    reactiveBusInstance?.dispose();
    reactiveBusInstance = new ReactiveEventBus();
}
