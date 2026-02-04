
import type { CodeAnalysisComponent } from '../ecs/index.js';

/**
 * Simple code analysis (in production, integrate with external tools)
 */
export function analyzeCode(code: string, language: string): Omit<CodeAnalysisComponent, 'entityId' | 'analyzedAt'> {
    const lines = code.split('\n');
    const linesOfCode = lines.filter(l => l.trim().length > 0).length;

    // Simple complexity estimation based on control flow keywords
    const complexityKeywords = ['if', 'else', 'for', 'while', 'switch', 'case', 'try', 'catch'];
    let complexity = 0;
    for (const keyword of complexityKeywords) {
        const regex = new RegExp(`\\b${keyword}\\b`, 'g');
        const matches = code.match(regex);
        complexity += matches?.length ?? 0;
    }
    // Normalize to 0-100
    complexity = Math.min(100, Math.round((complexity / linesOfCode) * 50));

    // Maintainability is inverse of complexity with line count factor
    const maintainability = Math.max(0, 100 - complexity - Math.min(30, linesOfCode / 10));

    const issues: CodeAnalysisComponent['issues'] = [];

    // Simple issue detection
    if (linesOfCode > 300) {
        issues.push({
            severity: 'warning',
            message: 'File is very long, consider splitting',
            rule: 'max-lines',
        });
    }

    if (code.includes('TODO') || code.includes('FIXME')) {
        const todoMatches = code.match(/(TODO|FIXME).*$/gm) ?? [];
        for (const match of todoMatches) {
            issues.push({
                severity: 'info',
                message: match,
                rule: 'no-todo',
            });
        }
    }

    // Detect common patterns
    const patterns: string[] = [];
    if (code.includes('async') || code.includes('await')) patterns.push('async');
    if (code.includes('class ')) patterns.push('oop');
    if (code.includes('=>')) patterns.push('arrow-functions');
    if (code.includes('export')) patterns.push('modules');

    return {
        filePath: 'inline',
        language,
        linesOfCode,
        complexity,
        maintainability: Math.round(maintainability),
        issues,
        patterns,
        dependencies: [],
    };
}
