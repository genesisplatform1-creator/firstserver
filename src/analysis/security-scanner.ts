
import { parse } from '@babel/parser';

export interface VulnerabilityFinding {
    vuln: string;
    severity: string;
    cwe: string;
    line?: number;
    description?: string;
}

export interface SecurityScanResult {
    findings: VulnerabilityFinding[];
    summary: {
        total: number;
        critical: number;
        high: number;
    };
    riskLevel: 'critical' | 'high' | 'medium' | 'low';
}

// Fallback Regex Patterns (for when parsing fails or for simple string matching)
const FALLBACK_PATTERNS: Record<string, { pattern: RegExp; severity: string; cwe: string }> = {
    'Hardcoded Secrets': { pattern: /password\s*=\s*['"][^'"]+['"]|api_key\s*=\s*['"][^'"]+['"]/i, severity: 'high', cwe: 'CWE-798' },
    'Insecure Crypto': { pattern: /md5\(|sha1\(|DES|RC4|Math\.random\(\)/i, severity: 'medium', cwe: 'CWE-327' },
    'Path Traversal': { pattern: /\.\.\/|\.\.\\/i, severity: 'high', cwe: 'CWE-22' },
};

export function scanForVulnerabilities(code: string): SecurityScanResult {
    const findings: VulnerabilityFinding[] = [];
    
    try {
        // 1. Try AST Analysis
        const ast = parse(code, {
            sourceType: 'module',
            plugins: ['typescript', 'jsx', 'classProperties'],
            errorRecovery: true
        });
        
        walkAST(ast, (node: any) => {
            // Check Call Expressions
            if (node.type === 'CallExpression') {
                const callee = node.callee;
                
                // Code Injection: eval()
                if (callee.type === 'Identifier' && callee.name === 'eval') {
                    findings.push({
                        vuln: 'Code Injection',
                        severity: 'critical',
                        cwe: 'CWE-94',
                        line: node.loc?.start.line,
                        description: 'Usage of eval() detected'
                    });
                }

                // Command Injection: exec, spawn
                if (callee.type === 'Identifier' && (callee.name === 'exec' || callee.name === 'execSync' || callee.name === 'spawn')) {
                     // Check if first arg is variable or concatenation
                     if (node.arguments.length > 0 && isDirty(node.arguments[0])) {
                        findings.push({
                            vuln: 'Command Injection',
                            severity: 'critical',
                            cwe: 'CWE-78',
                            line: node.loc?.start.line,
                            description: 'Potential command injection in execution function'
                        });
                     }
                }

                // SQL Injection: execute, query (method calls)
                if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
                    const method = callee.property.name;
                    if (method === 'execute' || method === 'query') {
                         if (node.arguments.length > 0 && isDirty(node.arguments[0])) {
                             findings.push({
                                 vuln: 'SQL Injection',
                                 severity: 'critical',
                                 cwe: 'CWE-89',
                                 line: node.loc?.start.line,
                                 description: 'Unsafe SQL query construction detected'
                             });
                         }
                    }
                }

                // XSS: res.send (Express)
                if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier' && callee.property.name === 'send') {
                    // Check if object is 'res'
                    if (callee.object.type === 'Identifier' && callee.object.name === 'res') {
                        if (node.arguments.length > 0 && isDirty(node.arguments[0])) {
                            findings.push({
                                vuln: 'XSS',
                                severity: 'high',
                                cwe: 'CWE-79',
                                line: node.loc?.start.line,
                                description: 'Reflected XSS in res.send()'
                            });
                        }
                    }
                }
            }

            // Check Assignments (XSS via innerHTML)
            if (node.type === 'AssignmentExpression') {
                if (node.left.type === 'MemberExpression' && node.left.property.type === 'Identifier') {
                    if (node.left.property.name === 'innerHTML' || node.left.property.name === 'outerHTML') {
                        findings.push({
                            vuln: 'XSS',
                            severity: 'high',
                            cwe: 'CWE-79',
                            line: node.loc?.start.line,
                            description: 'Unsafe assignment to innerHTML'
                        });
                    }
                }
            }
        });

    } catch (e) {
        // console.error('AST parsing failed, falling back to regex', e);
    }

    // 2. Fallback / Complementary Regex Checks
    const lines = code.split('\n');
    for (const [name, info] of Object.entries(FALLBACK_PATTERNS)) {
        if (info.pattern.test(code)) {
            let lineNum: number | undefined;
            for (let i = 0; i < lines.length; i++) {
                if (info.pattern.test(lines[i] ?? '')) { lineNum = i + 1; break; }
            }
            // Avoid duplicates if AST caught it (though these are mostly different categories)
            // Simple deduplication based on line number + vuln name
            const isDuplicate = findings.some(f => f.vuln === name && f.line === lineNum);
            if (!isDuplicate) {
                findings.push({ vuln: name, severity: info.severity, cwe: info.cwe, ...(lineNum !== undefined && { line: lineNum }) });
            }
        }
    }

    const critCount = findings.filter(f => f.severity === 'critical').length;
    const highCount = findings.filter(f => f.severity === 'high').length;

    return {
        findings,
        summary: { total: findings.length, critical: critCount, high: highCount },
        riskLevel: critCount > 0 ? 'critical' : highCount > 0 ? 'high' : findings.length > 0 ? 'medium' : 'low',
    };
}

// Helper: Walk AST
function walkAST(node: any, callback: (node: any) => void) {
    if (!node) return;
    callback(node);

    for (const key in node) {
        if (key === 'loc' || key === 'start' || key === 'end') continue;
        const val = node[key];
        if (Array.isArray(val)) {
            val.forEach(child => walkAST(child, callback));
        } else if (typeof val === 'object' && val !== null && typeof val.type === 'string') {
            walkAST(val, callback);
        }
    }
}

// Helper: Check if an expression is "dirty" (concatenation or variable)
function isDirty(node: any): boolean {
    if (node.type === 'BinaryExpression' && node.operator === '+') {
        // Recursive check: if ANY part is dirty, the whole thing is dirty
        return isDirty(node.left) || isDirty(node.right);
    }
    if (node.type === 'TemplateLiteral' && node.expressions.length > 0) {
         // Check expressions in template literal
         return node.expressions.some((expr: any) => isDirty(expr));
    }
    if (node.type === 'Identifier') return true; // Passing a variable is potentially dirty
    
    // CallExpression - check if it's a sanitizer
    if (node.type === 'CallExpression') {
        const callee = node.callee;
        if (callee.type === 'Identifier') {
             const safeFunctions = ['escapeHTML', 'sanitize', 'encodeURIComponent', 'String'];
             if (safeFunctions.includes(callee.name)) return false; // Considered safe
        }
        return true; // Unknown function call result is considered dirty
    }

    if (node.type === 'Literal') return false; // Strings/numbers are safe

    return false; // Default safe
}
