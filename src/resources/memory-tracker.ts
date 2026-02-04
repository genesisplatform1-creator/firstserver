/**
 * Memory Tracker - Real Resource Enforcement
 * 
 * Features:
 * - process.memoryUsage() monitoring
 * - Heap pressure detection
 * - File streaming for large files
 * - Threshold alerts
 */

/**
 * Memory usage snapshot
 */
export interface MemorySnapshot {
    timestamp: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
    arrayBuffers: number;
    rss: number;
    percentUsed: number;
}

/**
 * Memory limits configuration
 */
export interface MemoryLimits {
    maxHeapBytes: number;       // Default: 8GB
    warningThreshold: number;   // Default: 0.7 (70%)
    criticalThreshold: number;  // Default: 0.9 (90%)
    rejectThreshold: number;    // Default: 0.85 (85%) - reject new work
    enforceMode: boolean;       // Default: true - actively reject new work
}

export const DEFAULT_MEMORY_LIMITS: MemoryLimits = {
    maxHeapBytes: 8 * 1024 * 1024 * 1024, // 8GB "Weak Notebook" constraint
    warningThreshold: 0.7,
    criticalThreshold: 0.9,
    rejectThreshold: 0.85,
    enforceMode: true,
};

/**
 * Memory alert level
 */
export type AlertLevel = 'normal' | 'warning' | 'critical';

/**
 * Memory alert
 */
export interface MemoryAlert {
    level: AlertLevel;
    message: string;
    snapshot: MemorySnapshot;
    recommendation?: string;
}

/**
 * Alert callback
 */
export type AlertCallback = (alert: MemoryAlert) => void;

/**
 * Error thrown when memory enforcement rejects an operation
 */
export class MemoryEnforcementError extends Error {
    constructor(
        message: string,
        public readonly currentBytes: number,
        public readonly projectedBytes: number,
        public readonly limitBytes: number
    ) {
        super(message);
        this.name = 'MemoryEnforcementError';
    }
}

/**
 * Memory Tracker for real resource enforcement
 */
export class MemoryTracker {
    private limits: MemoryLimits;
    private history: MemorySnapshot[] = [];
    private maxHistorySize: number;
    private alertCallbacks: AlertCallback[] = [];
    private lastAlertLevel: AlertLevel = 'normal';
    private monitorInterval: ReturnType<typeof setInterval> | undefined;

    constructor(limits: Partial<MemoryLimits> = {}, maxHistorySize: number = 100) {
        this.limits = { ...DEFAULT_MEMORY_LIMITS, ...limits };
        this.maxHistorySize = maxHistorySize;
    }

    /**
     * Take a memory snapshot
     */
    snapshot(): MemorySnapshot {
        const usage = process.memoryUsage();
        const snapshot: MemorySnapshot = {
            timestamp: Date.now(),
            heapUsed: usage.heapUsed,
            heapTotal: usage.heapTotal,
            external: usage.external,
            arrayBuffers: usage.arrayBuffers,
            rss: usage.rss,
            percentUsed: usage.heapUsed / this.limits.maxHeapBytes,
        };

        this.history.push(snapshot);
        if (this.history.length > this.maxHistorySize) {
            this.history.shift();
        }

        this.checkThresholds(snapshot);
        return snapshot;
    }

    /**
     * Check if we can allocate a certain amount
     */
    canAllocate(bytes: number): boolean {
        const current = process.memoryUsage().heapUsed;
        const projected = current + bytes;
        return projected < this.limits.maxHeapBytes * this.limits.criticalThreshold;
    }

    /**
     * Check if we can accept new work (enforcement mode)
     * Returns false when memory exceeds reject threshold
     */
    canAcceptWork(): boolean {
        if (!this.limits.enforceMode) {
            return true; // Enforcement disabled
        }
        const current = process.memoryUsage().heapUsed;
        const percentUsed = current / this.limits.maxHeapBytes;
        return percentUsed < this.limits.rejectThreshold;
    }

    /**
     * Require allocation - throws if enforcement mode would reject
     */
    requireAllocation(bytes: number, operationName: string): void {
        if (!this.limits.enforceMode) {
            return; // No enforcement
        }

        const current = process.memoryUsage().heapUsed;
        const projected = current + bytes;
        const projectedPercent = projected / this.limits.maxHeapBytes;

        if (projectedPercent >= this.limits.rejectThreshold) {
            const available = this.limits.maxHeapBytes * this.limits.rejectThreshold - current;
            throw new MemoryEnforcementError(
                `Memory limit exceeded for "${operationName}": ` +
                `requires ${MemoryTracker.formatBytes(bytes)}, ` +
                `available ${MemoryTracker.formatBytes(Math.max(0, available))}`,
                current,
                projected,
                this.limits.maxHeapBytes
            );
        }
    }

    /**
     * Get reject threshold percentage
     */
    getRejectThreshold(): number {
        return this.limits.rejectThreshold;
    }

    /**
     * Enable/disable enforcement mode
     */
    setEnforceMode(enabled: boolean): void {
        this.limits.enforceMode = enabled;
    }

    /**
     * Check if enforcement is enabled
     */
    isEnforcing(): boolean {
        return this.limits.enforceMode;
    }

    /**
     * Get current memory status
     */
    getStatus(): {
        snapshot: MemorySnapshot;
        level: AlertLevel;
        available: number;
        percentAvailable: number;
    } {
        const snapshot = this.snapshot();
        const level = this.getAlertLevel(snapshot);
        const available = this.limits.maxHeapBytes - snapshot.heapUsed;

        return {
            snapshot,
            level,
            available,
            percentAvailable: available / this.limits.maxHeapBytes,
        };
    }

    /**
     * Get memory history
     */
    getHistory(): MemorySnapshot[] {
        return [...this.history];
    }

    /**
     * Detect memory pressure trend
     */
    detectPressure(): {
        increasing: boolean;
        rate: number; // bytes per second
        estimatedTimeToLimit: number | null; // seconds
    } {
        if (this.history.length < 2) {
            return { increasing: false, rate: 0, estimatedTimeToLimit: null };
        }

        const recent = this.history.slice(-10);
        if (recent.length < 2) {
            return { increasing: false, rate: 0, estimatedTimeToLimit: null };
        }

        const first = recent[0]!;
        const last = recent[recent.length - 1]!;
        const timeDelta = (last.timestamp - first.timestamp) / 1000; // seconds
        const memoryDelta = last.heapUsed - first.heapUsed;
        const rate = timeDelta > 0 ? memoryDelta / timeDelta : 0;

        let estimatedTimeToLimit: number | null = null;
        if (rate > 0) {
            const remaining = this.limits.maxHeapBytes - last.heapUsed;
            estimatedTimeToLimit = remaining / rate;
        }

        return {
            increasing: rate > 1024 * 1024, // More than 1MB/s
            rate,
            estimatedTimeToLimit,
        };
    }

    /**
     * Register alert callback
     */
    onAlert(callback: AlertCallback): void {
        this.alertCallbacks.push(callback);
    }

    /**
     * Force garbage collection (if exposed)
     */
    requestGC(): boolean {
        if (global.gc) {
            global.gc();
            return true;
        }
        return false;
    }

    /**
     * Start automatic monitoring
     */
    startMonitoring(intervalMs: number = 5000): void {
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
        }
        this.monitorInterval = setInterval(() => {
            this.snapshot();
        }, intervalMs);
    }

    /**
     * Stop automatic monitoring
     */
    stopMonitoring(): void {
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = undefined;
        }
    }

    /**
     * Format bytes for display
     */
    static formatBytes(bytes: number): string {
        const units = ['B', 'KB', 'MB', 'GB'];
        let unit = 0;
        let value = bytes;
        while (value >= 1024 && unit < units.length - 1) {
            value /= 1024;
            unit++;
        }
        return `${value.toFixed(2)} ${units[unit]}`;
    }

    private getAlertLevel(snapshot: MemorySnapshot): AlertLevel {
        if (snapshot.percentUsed >= this.limits.criticalThreshold) {
            return 'critical';
        }
        if (snapshot.percentUsed >= this.limits.warningThreshold) {
            return 'warning';
        }
        return 'normal';
    }

    private checkThresholds(snapshot: MemorySnapshot): void {
        const level = this.getAlertLevel(snapshot);

        // Only alert on level change or critical
        if (level !== this.lastAlertLevel || level === 'critical') {
            const alert = this.createAlert(level, snapshot);
            for (const callback of this.alertCallbacks) {
                try {
                    callback(alert);
                } catch (error) {
                    console.error('Alert callback error:', error);
                }
            }
            this.lastAlertLevel = level;
        }
    }

    private createAlert(level: AlertLevel, snapshot: MemorySnapshot): MemoryAlert {
        const used = MemoryTracker.formatBytes(snapshot.heapUsed);
        const limit = MemoryTracker.formatBytes(this.limits.maxHeapBytes);
        const percent = (snapshot.percentUsed * 100).toFixed(1);

        switch (level) {
            case 'critical':
                return {
                    level,
                    message: `CRITICAL: Memory at ${percent}% (${used}/${limit})`,
                    snapshot,
                    recommendation: 'Immediately reduce context size or terminate sub-agents',
                };
            case 'warning':
                return {
                    level,
                    message: `WARNING: Memory at ${percent}% (${used}/${limit})`,
                    snapshot,
                    recommendation: 'Consider reducing file context or completing current task',
                };
            default:
                return {
                    level,
                    message: `Memory usage normal: ${percent}% (${used}/${limit})`,
                    snapshot,
                };
        }
    }
}

// Singleton
let trackerInstance: MemoryTracker | undefined;

export function getMemoryTracker(): MemoryTracker {
    if (!trackerInstance) {
        trackerInstance = new MemoryTracker();
    }
    return trackerInstance;
}
