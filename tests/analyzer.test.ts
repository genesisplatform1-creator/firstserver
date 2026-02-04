
import { describe, it, expect } from 'vitest';
import { analyzeCode } from '../src/analysis/analyzer';

describe('Code Analyzer', () => {
    it('should analyze simple javascript code', () => {
        const code = `
            function hello() {
                console.log("world");
                return true;
            }
        `;
        const result = analyzeCode(code, 'javascript');

        expect(result.linesOfCode).toBeGreaterThan(0);
        expect(result.complexity).toBeGreaterThanOrEqual(0);
        expect(result.maintainability).toBeGreaterThan(0);
        expect(result.language).toBe('javascript');
    });

    it('should detect patterns', () => {
        const code = `
            async function fetchData() {
                const data = await fetch('/api');
                return data;
            }
            class User {}
        `;
        const result = analyzeCode(code, 'typescript');

        expect(result.patterns).toContain('async');
        expect(result.patterns).toContain('oop');
    });

    it('should detect TODOs', () => {
        const code = `
            // TODO: Fix this
            function broken() {
                // FIXME: Really broken
            }
        `;
        const result = analyzeCode(code, 'javascript');

        expect(result.issues.length).toBeGreaterThan(0);
        const todoIssue = result.issues.find(i => i.rule === 'no-todo');
        expect(todoIssue).toBeDefined();
    });

    it('should calculate complexity', () => {
        const code = `
            function complex() {
                if (a) {
                    if (b) {
                        for (let i=0; i<10; i++) {
                            while(true) {
                                break;
                            }
                        }
                    }
                }
            }
        `;
        const result = analyzeCode(code, 'javascript');
        expect(result.complexity).toBeGreaterThan(10); // Should be somewhat high
    });
});
