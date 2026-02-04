/**
 * Cyber Red Team Tools
 * Vulnerability scanning, attack surface mapping, exploit research, pentest planning
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createEntity, EntityType, serializeEntity } from '../../ecs/index.js';
import { getEventStore } from '../../durability/index.js';
import { scanForVulnerabilities, type SecurityScanResult, type VulnerabilityFinding } from '../../analysis/security-scanner.js';
import { WorkerPool } from '../../coordinator/worker-pool.js';

// Vulnerability patterns - MOVED to src/analysis/security-scanner.ts but kept here for fallback or if we want to remove duplication
// For now, I'll remove them to avoid duplication since I moved them to security-scanner.ts
// But wait, the original code used them inline.
// I will just import scanForVulnerabilities and use it.

// Attack surface categories
const ATTACK_SURFACE: Record<string, { indicators: string[]; risk: string }> = {
    'Web Endpoints': { indicators: ['router', 'express', 'fastapi', '@app.route'], risk: 'high' },
    'File Upload': { indicators: ['multer', 'multipart', 'upload', 'formidable'], risk: 'high' },
    'Authentication': { indicators: ['passport', 'jwt', 'session', 'oauth'], risk: 'critical' },
    'Database': { indicators: ['mongoose', 'sequelize', 'prisma', 'typeorm'], risk: 'high' },
    'External APIs': { indicators: ['axios', 'fetch', 'request', 'http.get'], risk: 'medium' },
    'Admin Interfaces': { indicators: ['admin', 'dashboard', 'management'], risk: 'critical' },
};

export function registerCyberRedteamTools(server: McpServer, workerPool?: WorkerPool): void {
    // Tool 1: vulnerability_scan
    server.tool(
        'vulnerability_scan',
        'Pattern-based vulnerability detection in source code',
        {
            code: z.string(),
            language: z.enum(['javascript', 'typescript', 'python', 'java', 'php']).default('javascript'),
            scanDepth: z.enum(['quick', 'standard', 'deep']).default('standard'),
        },
        async ({ code, language, scanDepth }) => {
            const entity = createEntity(EntityType.TASK);
            const entityId = serializeEntity(entity);
            const store = getEventStore();

            let result: SecurityScanResult;

            if (workerPool) {
                try {
                    const taskResult = await workerPool.executeTask('scan_vulnerabilities', { code });
                    result = taskResult.result as SecurityScanResult;
                } catch (error) {
                    console.error('Worker scan failed, falling back to local:', error);
                    result = scanForVulnerabilities(code);
                }
            } else {
                result = scanForVulnerabilities(code);
            }

            store.append(entityId, 'security.scanned', { language, findings: result.findings.length, critical: result.summary.critical });

            return {
                content: [{
                    type: 'text', text: JSON.stringify({
                        entityId, 
                        findings: result.findings,
                        summary: result.summary,
                        riskLevel: result.riskLevel,
                    }, null, 2)
                }]
            };
        }
    );

    // Tool 2: attack_surface_map
    server.tool(
        'attack_surface_map',
        'Enumerate and categorize attack surface from codebase',
        {
            files: z.array(z.object({ path: z.string(), content: z.string() })),
            includeEndpoints: z.boolean().default(true),
        },
        async ({ files, includeEndpoints }) => {
            const entity = createEntity(EntityType.TASK);
            const entityId = serializeEntity(entity);
            const store = getEventStore();

            const surfaces: Record<string, { files: string[]; risk: string }> = {};
            const endpoints: { path: string; method: string; file: string }[] = [];

            for (const file of files) {
                const content = file.content.toLowerCase();

                for (const [category, info] of Object.entries(ATTACK_SURFACE)) {
                    if (info.indicators.some(ind => content.includes(ind.toLowerCase()))) {
                        if (!surfaces[category]) surfaces[category] = { files: [], risk: info.risk };
                        surfaces[category]!.files.push(file.path);
                    }
                }

                if (includeEndpoints) {
                    const routePatterns = [
                        /(?:get|post|put|delete|patch)\s*\(['"]([^'"]+)['"]/gi,
                        /@(?:get|post|put|delete)\(['"]([^'"]+)['"]\)/gi,
                        /router\.(?:get|post|put|delete)\(['"]([^'"]+)['"]/gi,
                    ];
                    for (const pattern of routePatterns) {
                        let match;
                        while ((match = pattern.exec(file.content)) !== null) {
                            const method = match[0]?.match(/get|post|put|delete|patch/i)?.[0] ?? 'GET';
                            endpoints.push({ path: match[1] ?? '/', method: method.toUpperCase(), file: file.path });
                        }
                    }
                }
            }

            store.append(entityId, 'security.surface_mapped', { fileCount: files.length, categories: Object.keys(surfaces).length });

            return {
                content: [{
                    type: 'text', text: JSON.stringify({
                        entityId, surfaces, endpoints: endpoints.slice(0, 30),
                        priorityTargets: Object.entries(surfaces).filter(([, v]) => v.risk === 'critical').map(([k]) => k),
                    }, null, 2)
                }]
            };
        }
    );

    // Tool 3: exploit_research
    server.tool(
        'exploit_research',
        'Identify exploit primitives and attack vectors for vulnerabilities',
        {
            vulnerability: z.string(),
            context: z.object({
                language: z.string().optional(),
                framework: z.string().optional(),
                version: z.string().optional(),
            }).optional(),
        },
        async ({ vulnerability, context }) => {
            const entity = createEntity(EntityType.TASK);
            const entityId = serializeEntity(entity);
            const store = getEventStore();

            const vulnLower = vulnerability.toLowerCase();

            const exploitInfo: Record<string, { primitives: string[]; techniques: string[]; mitigations: string[] }> = {
                'sql': {
                    primitives: ['UNION-based extraction', 'Boolean blind', 'Time-based blind', 'Error-based'],
                    techniques: ['Stacked queries', 'Out-of-band exfil', 'File read/write'],
                    mitigations: ['Parameterized queries', 'Input validation', 'Least privilege DB user'],
                },
                'xss': {
                    primitives: ['Reflected XSS', 'Stored XSS', 'DOM-based XSS'],
                    techniques: ['Cookie theft', 'Keylogging', 'Phishing overlay', 'Session hijack'],
                    mitigations: ['Content Security Policy', 'Output encoding', 'HttpOnly cookies'],
                },
                'command': {
                    primitives: ['Argument injection', 'Command chaining', 'Environment variable injection'],
                    techniques: ['Reverse shell', 'File exfiltration', 'Privilege escalation'],
                    mitigations: ['Avoid shell execution', 'Input sanitization', 'Sandboxing'],
                },
                'ssrf': {
                    primitives: ['Internal port scan', 'Cloud metadata access', 'Internal service access'],
                    techniques: ['AWS credential theft via 169.254.169.254', 'Internal API abuse'],
                    mitigations: ['URL allowlisting', 'Disable redirects', 'Network segmentation'],
                },
            };

            let matched = { primitives: ['Generic exploitation'], techniques: ['Context-dependent'], mitigations: ['Patch vulnerability'] };
            for (const [key, info] of Object.entries(exploitInfo)) {
                if (vulnLower.includes(key)) { matched = info; break; }
            }

            store.append(entityId, 'security.exploit_researched', { vulnerability });

            return {
                content: [{
                    type: 'text', text: JSON.stringify({
                        entityId, vulnerability, context,
                        exploitPrimitives: matched.primitives,
                        techniques: matched.techniques,
                        mitigations: matched.mitigations,
                        resources: ['exploit-db.com', 'cvedetails.com', 'nvd.nist.gov'],
                    }, null, 2)
                }]
            };
        }
    );

    // Tool 4: pentest_plan
    server.tool(
        'pentest_plan',
        'Generate MCTS-based penetration test plan with prioritized attack paths',
        {
            target: z.object({
                type: z.enum(['web', 'network', 'mobile', 'api']),
                scope: z.array(z.string()),
                excludes: z.array(z.string()).optional(),
            }),
            objectives: z.array(z.string()).optional(),
            timeConstraint: z.number().optional().describe('Hours available'),
        },
        async ({ target, objectives, timeConstraint }) => {
            const entity = createEntity(EntityType.TASK);
            const entityId = serializeEntity(entity);
            const store = getEventStore();

            // MCTS-style phase planning
            const phases = [
                { phase: 'Reconnaissance', time: 0.15, tasks: ['OSINT', 'DNS enum', 'Tech fingerprinting', 'Directory bruteforce'], priority: 1 },
                { phase: 'Scanning', time: 0.15, tasks: ['Port scan', 'Service enum', 'Vuln scanning', 'Web crawling'], priority: 2 },
                { phase: 'Exploitation', time: 0.40, tasks: ['Auth testing', 'Injection attacks', 'Business logic', 'File upload abuse'], priority: 3 },
                { phase: 'Post-Exploitation', time: 0.20, tasks: ['Privilege escalation', 'Lateral movement', 'Data exfil', 'Persistence'], priority: 4 },
                { phase: 'Reporting', time: 0.10, tasks: ['Finding documentation', 'PoC creation', 'Risk rating', 'Remediation advice'], priority: 5 },
            ];

            const totalHours = timeConstraint ?? 40;
            const schedule = phases.map(p => ({
                ...p,
                allocatedHours: Math.round(p.time * totalHours * 10) / 10,
                tasks: target.type === 'api' && p.phase === 'Exploitation'
                    ? ['API auth bypass', 'BOLA/IDOR', 'Rate limiting', 'Mass assignment']
                    : p.tasks,
            }));

            const attackPaths = [
                { path: 'Auth Bypass → Admin Access → Data Exfil', probability: 0.3, impact: 'critical' },
                { path: 'SQLi → DB Access → Credential Dump', probability: 0.25, impact: 'critical' },
                { path: 'SSRF → Internal Access → Pivot', probability: 0.2, impact: 'high' },
                { path: 'File Upload → RCE → Full Compromise', probability: 0.15, impact: 'critical' },
            ];

            store.append(entityId, 'security.pentest_planned', { targetType: target.type, scopeSize: target.scope.length, hours: totalHours });

            return {
                content: [{
                    type: 'text', text: JSON.stringify({
                        entityId,
                        target: { type: target.type, scope: target.scope, excludes: target.excludes },
                        objectives: objectives ?? ['Identify critical vulnerabilities', 'Assess data exposure risk'],
                        schedule,
                        attackPaths,
                        tools: target.type === 'web' ? ['burpsuite', 'nuclei', 'ffuf', 'sqlmap'] :
                            target.type === 'api' ? ['postman', 'burpsuite', 'owasp-zap'] :
                                ['nmap', 'metasploit', 'responder'],
                    }, null, 2)
                }]
            };
        }
    );
}
