/**
 * Risk & Governance Tools
 * Tools for risk assessment, compliance checking, and security scanning
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
    createEntity,
    EntityType,
    serializeEntity,
    RiskComponentSchema,
    LineageComponentSchema,
    type RiskComponent,
    type LineageComponent,
    calculateRiskScore,
    addRiskFactor,
    addSecurityIssue,
    addReasoningStep,
    computeDataVersion,
    forkLineage,
} from '../../ecs/index.js';
import { getEventStore } from '../../durability/index.js';

/**
 * Known security patterns to scan for
 */
const SECURITY_PATTERNS = [
    { pattern: /eval\s*\(/g, type: 'code-injection', severity: 'critical' as const, cwe: '94' },
    { pattern: /innerHTML\s*=/g, type: 'xss', severity: 'high' as const, cwe: '79' },
    { pattern: /dangerouslySetInnerHTML/g, type: 'xss', severity: 'high' as const, cwe: '79' },
    { pattern: /password\s*=\s*['"][^'"]+['"]/g, type: 'hardcoded-credential', severity: 'critical' as const, cwe: '798' },
    { pattern: /api[_-]?key\s*=\s*['"][^'"]+['"]/gi, type: 'hardcoded-credential', severity: 'critical' as const, cwe: '798' },
    { pattern: /secret\s*=\s*['"][^'"]+['"]/gi, type: 'hardcoded-credential', severity: 'high' as const, cwe: '798' },
    { pattern: /exec\s*\(/g, type: 'command-injection', severity: 'critical' as const, cwe: '78' },
    { pattern: /child_process/g, type: 'command-injection', severity: 'high' as const, cwe: '78' },
    { pattern: /SELECT.*WHERE.*\+/gi, type: 'sql-injection', severity: 'critical' as const, cwe: '89' },
    { pattern: /\$\{.*\}.*SQL|sql.*\$\{/gi, type: 'sql-injection', severity: 'critical' as const, cwe: '89' },
    { pattern: /Math\.random\(\)/g, type: 'weak-random', severity: 'medium' as const, cwe: '330' },
    { pattern: /http:\/\//g, type: 'insecure-protocol', severity: 'medium' as const, cwe: '319' },
    { pattern: /verify\s*=\s*false|rejectUnauthorized\s*:\s*false/gi, type: 'ssl-bypass', severity: 'high' as const, cwe: '295' },
];

/**
 * Compliance rules
 */
const COMPLIANCE_RULES = [
    { id: 'no-console', pattern: /console\.(log|debug|info)/g, message: 'Remove console.* statements in production' },
    { id: 'no-debugger', pattern: /debugger;/g, message: 'Remove debugger statements' },
    { id: 'no-any', pattern: /:\s*any\b/g, message: 'Avoid using "any" type' },
    { id: 'use-strict', pattern: /^(?!.*['"]use strict['"])/m, message: 'Consider using strict mode' },
    { id: 'no-var', pattern: /\bvar\s+/g, message: 'Use let/const instead of var' },
    { id: 'max-params', pattern: /function\s*\([^)]{50,}\)/g, message: 'Function has too many parameters' },
];

/**
 * Register risk & governance tools
 */
export function registerRiskGovernanceTools(server: McpServer): void {
    // risk_assess - Evaluate critical risks
    server.tool(
        'risk_assess',
        'Evaluate critical risks in code changes. Analyzes based on change type, scope, and potential impact.',
        {
            changeDescription: z.string().describe('Description of the change'),
            affectedFiles: z.array(z.string()).optional().describe('List of affected files'),
            changeType: z.enum(['feature', 'bugfix', 'refactor', 'security', 'performance', 'dependency']).optional(),
            linesChanged: z.number().optional().describe('Number of lines changed'),
        },
        async ({ changeDescription, affectedFiles, changeType, linesChanged }) => {
            const store = getEventStore();
            const entity = createEntity(EntityType.TASK);
            const entityId = serializeEntity(entity);

            const factors: RiskComponent['factors'] = [];

            // Scope risk factor
            const fileCount = affectedFiles?.length ?? 0;
            if (fileCount > 10) {
                factors.push({
                    name: 'Large Scope',
                    score: Math.min(90, 40 + fileCount * 2),
                    description: `Change affects ${fileCount} files`,
                    mitigation: 'Consider breaking into smaller, focused changes',
                });
            } else if (fileCount > 5) {
                factors.push({
                    name: 'Medium Scope',
                    score: 40,
                    description: `Change affects ${fileCount} files`,
                });
            }

            // Lines changed risk
            const lines = linesChanged ?? 0;
            if (lines > 500) {
                factors.push({
                    name: 'Large Change Size',
                    score: Math.min(80, 30 + lines / 20),
                    description: `${lines} lines changed`,
                    mitigation: 'Ensure thorough code review',
                });
            }

            // Change type risk
            if (changeType === 'security') {
                factors.push({
                    name: 'Security Change',
                    score: 70,
                    description: 'Security-related changes require extra scrutiny',
                    mitigation: 'Security review required',
                });
            } else if (changeType === 'dependency') {
                factors.push({
                    name: 'Dependency Change',
                    score: 50,
                    description: 'Dependency changes may introduce vulnerabilities',
                    mitigation: 'Run security audit on new dependencies',
                });
            }

            // Critical file detection
            const criticalFiles = affectedFiles?.filter(f =>
                f.includes('auth') ||
                f.includes('security') ||
                f.includes('payment') ||
                f.includes('database') ||
                f.includes('.env')
            ) ?? [];

            if (criticalFiles.length > 0) {
                factors.push({
                    name: 'Critical Files Modified',
                    score: 75,
                    description: `Critical files affected: ${criticalFiles.join(', ')}`,
                    mitigation: 'Requires senior developer review',
                });
            }

            const { score, category } = calculateRiskScore(factors);

            const risk: RiskComponent = {
                entityId,
                overallScore: score,
                category,
                factors,
                securityIssues: [],
                complianceViolations: [],
                assessedAt: Date.now(),
            };

            RiskComponentSchema.parse(risk);
            store.append(entityId, 'risk.assessed', risk);

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify({
                            success: true,
                            entityId,
                            assessment: {
                                overallScore: score,
                                category,
                                factorCount: factors.length,
                                factors,
                                recommendation: category === 'critical' ? 'BLOCK: Requires immediate review'
                                    : category === 'high' ? 'WARN: Senior review recommended'
                                        : category === 'medium' ? 'CAUTION: Standard review'
                                            : 'OK: Low risk change',
                            },
                        }, null, 2),
                    },
                ],
            };
        }
    );

    // compliance_check - Check against coding standards
    server.tool(
        'compliance_check',
        'Check code against coding standards and best practices.',
        {
            code: z.string().describe('Code to check'),
            rules: z.array(z.string()).optional().describe('Specific rules to check (or all)'),
        },
        async ({ code, rules }) => {
            const store = getEventStore();
            const entity = createEntity(EntityType.TASK);
            const entityId = serializeEntity(entity);

            const violations: Array<{
                rule: string;
                message: string;
                count: number;
            }> = [];

            const rulesToCheck = rules
                ? COMPLIANCE_RULES.filter(r => rules.includes(r.id))
                : COMPLIANCE_RULES;

            for (const rule of rulesToCheck) {
                const matches = code.match(rule.pattern);
                if (matches && matches.length > 0) {
                    violations.push({
                        rule: rule.id,
                        message: rule.message,
                        count: matches.length,
                    });
                }
            }

            store.append(entityId, 'compliance.checked', { violations });

            const passed = violations.length === 0;

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify({
                            success: true,
                            entityId,
                            compliance: {
                                passed,
                                violationCount: violations.length,
                                violations,
                                rulesChecked: rulesToCheck.map(r => r.id),
                            },
                        }, null, 2),
                    },
                ],
            };
        }
    );

    // security_scan - Scan for vulnerabilities
    server.tool(
        'security_scan',
        'Scan code for security vulnerabilities and potential issues.',
        {
            code: z.string().describe('Code to scan'),
            context: z.string().optional().describe('Additional context'),
        },
        async ({ code, context }) => {
            const store = getEventStore();
            const entity = createEntity(EntityType.TASK);
            const entityId = serializeEntity(entity);

            const issues: RiskComponent['securityIssues'] = [];

            for (const pattern of SECURITY_PATTERNS) {
                const matches = code.match(pattern.pattern);
                if (matches && matches.length > 0) {
                    issues.push({
                        type: pattern.type,
                        severity: pattern.severity,
                        description: `Found ${matches.length} instance(s) of ${pattern.type}`,
                        cwe: pattern.cwe,
                    });
                }
            }

            // Calculate risk from security issues
            let risk: RiskComponent = {
                entityId,
                overallScore: 0,
                category: 'low',
                factors: [],
                securityIssues: [],
                complianceViolations: [],
                assessedAt: Date.now(),
            };

            for (const issue of issues) {
                risk = addSecurityIssue(risk, issue);
            }

            store.append(entityId, 'security.scanned', risk);

            const criticalCount = issues.filter(i => i.severity === 'critical').length;
            const highCount = issues.filter(i => i.severity === 'high').length;

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify({
                            success: true,
                            entityId,
                            scan: {
                                issueCount: issues.length,
                                critical: criticalCount,
                                high: highCount,
                                medium: issues.filter(i => i.severity === 'medium').length,
                                low: issues.filter(i => i.severity === 'low').length,
                                issues,
                                overallRisk: risk.category,
                                blocked: criticalCount > 0,
                                message: criticalCount > 0
                                    ? 'BLOCKED: Critical security issues found'
                                    : highCount > 0
                                        ? 'WARNING: High severity issues found'
                                        : issues.length > 0
                                            ? 'CAUTION: Security issues detected'
                                            : 'PASS: No security issues detected',
                            },
                            context,
                        }, null, 2),
                    },
                ],
            };
        }
    );

    // lineage_track - Full reasoning trace (Audit Log)
    server.tool(
        'lineage_track',
        'Retrieve the full immutable reasoning trace (Audit Log) for an entity.',
        {
            entityId: z.string().describe('ID of the entity (task, artifact)'),
            format: z.enum(['json', 'markdown']).default('markdown')
        },
        async ({ entityId, format }) => {
            const store = getEventStore();
            const events = store.loadEvents(entityId);

            if (events.length === 0) {
                return {
                    content: [{ type: 'text' as const, text: `No lineage found for entity ${entityId}` }]
                };
            }

            if (format === 'json') {
                return {
                    content: [{ type: 'text' as const, text: JSON.stringify(events, null, 2) }]
                };
            }

            // Format as markdown
            const lines = [
                `# Audit Log Lineage: ${entityId}`,
                `**Total Events:** ${events.length}`,
                `**Last Updated:** ${new Date(events[events.length - 1]!.timestamp).toISOString()}`,
                '',
                '## Trace',
                ...events.map(e => {
                    const date = new Date(e.timestamp).toISOString();
                    return `- **[${date}]** \`${e.type}\` (v${e.version})\n  - Payload: \`${JSON.stringify(e.payload).slice(0, 100)}...\``;
                })
            ];

            return {
                content: [{ type: 'text' as const, text: lines.join('\n') }]
            };
        }
    );
}
