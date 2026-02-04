
import { describe, it, expect } from 'vitest';
import { scanForVulnerabilities } from '../src/analysis/security-scanner';

describe('Security Scanner', () => {
    it('should detect SQL Injection', () => {
        const code = `
            const query = "SELECT * FROM users WHERE id = " + userId;
            db.execute("SELECT * FROM users WHERE id = " + userId);
        `;
        const result = scanForVulnerabilities(code);

        expect(result.findings).toHaveLength(1);
        expect(result.findings[0].vuln).toBe('SQL Injection');
        expect(result.findings[0].severity).toBe('critical');
    });

    it('should detect XSS', () => {
        const code = `
            document.getElementById('app').innerHTML = userInput;
        `;
        const result = scanForVulnerabilities(code);

        expect(result.findings).toHaveLength(1);
        expect(result.findings[0].vuln).toBe('XSS');
    });

    it('should detect Hardcoded Secrets', () => {
        const code = `
            const api_key = "12345-secret-key";
        `;
        const result = scanForVulnerabilities(code);

        expect(result.findings).toHaveLength(1);
        expect(result.findings[0].vuln).toBe('Hardcoded Secrets');
    });

    it('should return safe for clean code', () => {
        const code = `
            console.log("Hello World");
            const x = 1 + 1;
        `;
        const result = scanForVulnerabilities(code);

        expect(result.findings).toHaveLength(0);
        expect(result.riskLevel).toBe('low');
    });

    it('should aggregate summary correctly', () => {
        const code = `
            db.execute("SELECT * FROM " + table); // SQLi (Critical)
            const password = "password123"; // Secret (High)
        `;
        const result = scanForVulnerabilities(code);

        expect(result.summary.total).toBe(2);
        expect(result.summary.critical).toBe(1);
        expect(result.summary.high).toBe(1);
        expect(result.riskLevel).toBe('critical');
    });
});
