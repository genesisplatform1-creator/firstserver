
import { describe, it, expect } from 'vitest';
import { MinHash, LSHIndex } from '../src/tools/data-structures/probabilistic';

describe('Probabilistic Data Structures', () => {

    describe('MinHash', () => {
        it('should estimate Jaccard similarity correctly', () => {
            const mh1 = new MinHash(200);
            const mh2 = new MinHash(200);

            // Text with ~50% overlap
            const text1 = "The quick brown fox jumps over the lazy dog";
            const text2 = "The quick brown fox jumps over the active cat";
            // Shingles (3-char):
            // "The", "he ", "e q", ...
            // Overlap is significant.

            mh1.update(text1);
            mh2.update(text2);

            const sim = mh1.jaccard(mh2);
            // Actual Jaccard roughly > 0.4
            expect(sim).toBeGreaterThan(0.3);
            expect(sim).toBeLessThan(1.0);
        });

        it('should have Jaccard 1.0 for identical text', () => {
            const mh1 = new MinHash(100);
            const mh2 = new MinHash(100);
            const text = "repeat this text exactly";

            mh1.update(text);
            mh2.update(text);

            expect(mh1.jaccard(mh2)).toBe(1.0);
        });

        it('should have Jaccard ~0 for disjoint text', () => {
            const mh1 = new MinHash(100);
            const mh2 = new MinHash(100);

            mh1.update("abcdefg");
            mh2.update("1234567");

            expect(mh1.jaccard(mh2)).toBeLessThan(0.1);
        });
    });

    describe('LSHIndex', () => {
        it('should retrieve similar documents', () => {
            const index = new LSHIndex(20, 5); // 100 perms
            const mh1 = new MinHash(100);
            const mh2 = new MinHash(100); // Similar to 1
            const mh3 = new MinHash(100); // Distinct

            const t1 = "function calculateSum(a, b) { return a + b; }";
            const t2 = "function calculateSum(x, y) { return x + y; }"; // Similar
            const t3 = "class User { constructor(name) { this.name = name; } }"; // Different

            mh1.update(t1);
            mh2.update(t2);
            mh3.update(t3);

            index.insert("doc1", mh1);
            index.insert("doc3", mh3);

            const candidates = index.query(mh2);

            expect(candidates).toContain("doc1");
            expect(candidates.includes("doc3")).toBe(false);
            // Note: probabilistic false positives are possible but unlikely for this distinct case
        });
    });
});
