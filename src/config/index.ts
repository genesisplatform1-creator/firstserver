/**
 * Project Configuration System
 * 
 * Features:
 * - .trae-ai.json per-project config
 * - Hierarchical config merge
 * - Schema validation
 * - Hot reload support
 */

import { z } from 'zod';
import { existsSync, readFileSync, watchFile, unwatchFile } from 'fs';
import { join } from 'path';

/**
 * Tool configuration schema
 */
export const ToolConfigSchema = z.object({
    enabled: z.boolean().default(true),
    options: z.record(z.unknown()).optional(),
});

/**
 * Security rules schema
 */
export const SecurityRulesSchema = z.object({
    allowedPatterns: z.array(z.string()).default([]),
    blockedPatterns: z.array(z.string()).default([]),
    maxFileSize: z.number().default(10 * 1024 * 1024), // 10MB
    allowExternalRequests: z.boolean().default(false),
});

/**
 * Compliance rules schema
 */
export const ComplianceRulesSchema = z.object({
    noConsoleLog: z.boolean().default(true),
    noDebugger: z.boolean().default(true),
    noTodo: z.boolean().default(false),
    maxComplexity: z.number().default(10),
    maxFileLength: z.number().default(500),
    customRules: z.array(z.object({
        name: z.string(),
        pattern: z.string(),
        message: z.string(),
        severity: z.enum(['error', 'warning', 'info']).default('warning'),
    })).default([]),
});

/**
 * Sub-agent isolation config
 */
export const IsolationConfigSchema = z.object({
    maxSteps: z.number().default(50),
    maxTokens: z.number().default(20000),
    timeoutMs: z.number().default(60000),
    maxConcurrent: z.number().default(4),
});

/**
 * Memory limits config
 */
export const MemoryConfigSchema = z.object({
    maxHeapBytes: z.number().default(8 * 1024 * 1024 * 1024), // 8GB
    warningThreshold: z.number().default(0.7),
    criticalThreshold: z.number().default(0.9),
});

/**
 * Full project config schema
 */
export const ProjectConfigSchema = z.object({
    version: z.string().default('1.0'),

    // Tool toggles
    tools: z.record(ToolConfigSchema).default({}),

    // Security settings
    security: SecurityRulesSchema.default({}),

    // Compliance rules
    compliance: ComplianceRulesSchema.default({}),

    // Sub-agent isolation
    isolation: IsolationConfigSchema.default({}),

    // Memory limits
    memory: MemoryConfigSchema.default({}),

    // Custom workflows
    workflows: z.array(z.object({
        name: z.string(),
        description: z.string().optional(),
        steps: z.array(z.object({
            tool: z.string(),
            args: z.record(z.unknown()),
        })),
    })).default([]),

    // File patterns to include/exclude
    include: z.array(z.string()).default(['**/*']),
    exclude: z.array(z.string()).default(['node_modules/**', '.git/**', 'dist/**']),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

/**
 * Config change callback
 */
export type ConfigChangeCallback = (config: ProjectConfig, oldConfig: ProjectConfig) => void;

/**
 * Configuration Manager
 */
export class ConfigManager {
    private projectRoot: string;
    private configPath: string;
    private config: ProjectConfig;
    private changeCallbacks: ConfigChangeCallback[] = [];
    private watching: boolean = false;

    constructor(projectRoot: string) {
        this.projectRoot = projectRoot;
        this.configPath = join(projectRoot, '.trae-ai.json');
        this.config = this.loadConfig();
    }

    /**
     * Get current config
     */
    getConfig(): ProjectConfig {
        return this.config;
    }

    /**
     * Get a specific tool's config
     */
    getToolConfig(toolName: string): z.infer<typeof ToolConfigSchema> {
        return this.config.tools[toolName] ?? { enabled: true };
    }

    /**
     * Check if a tool is enabled
     */
    isToolEnabled(toolName: string): boolean {
        return this.getToolConfig(toolName).enabled;
    }

    /**
     * Reload config from disk
     */
    reload(): void {
        const oldConfig = this.config;
        this.config = this.loadConfig();

        if (JSON.stringify(oldConfig) !== JSON.stringify(this.config)) {
            for (const callback of this.changeCallbacks) {
                try {
                    callback(this.config, oldConfig);
                } catch (error) {
                    console.error('Config change callback error:', error);
                }
            }
        }
    }

    /**
     * Watch for config changes
     */
    watch(): void {
        if (this.watching) return;

        if (existsSync(this.configPath)) {
            watchFile(this.configPath, { interval: 1000 }, () => {
                this.reload();
            });
            this.watching = true;
        }
    }

    /**
     * Stop watching
     */
    unwatch(): void {
        if (this.watching) {
            unwatchFile(this.configPath);
            this.watching = false;
        }
    }

    /**
     * Register change callback
     */
    onChange(callback: ConfigChangeCallback): void {
        this.changeCallbacks.push(callback);
    }

    /**
     * Generate default config file content
     */
    static generateDefault(): string {
        const config: ProjectConfig = ProjectConfigSchema.parse({});
        return JSON.stringify(config, null, 2);
    }

    /**
     * Validate a config object
     */
    static validate(obj: unknown): { valid: boolean; errors?: string[] } {
        const result = ProjectConfigSchema.safeParse(obj);
        if (result.success) {
            return { valid: true };
        }
        return {
            valid: false,
            errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
        };
    }

    private loadConfig(): ProjectConfig {
        try {
            if (existsSync(this.configPath)) {
                const content = readFileSync(this.configPath, 'utf-8');
                const parsed = JSON.parse(content);
                return ProjectConfigSchema.parse(parsed);
            }
        } catch (error) {
            console.error(`Failed to load config from ${this.configPath}:`, error);
        }

        // Return defaults
        return ProjectConfigSchema.parse({});
    }
}

// Singleton per project root
const configManagers: Map<string, ConfigManager> = new Map();

export function getConfigManager(projectRoot: string): ConfigManager {
    let manager = configManagers.get(projectRoot);
    if (!manager) {
        manager = new ConfigManager(projectRoot);
        configManagers.set(projectRoot, manager);
    }
    return manager;
}
