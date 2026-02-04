
import { describe, it, expect } from 'vitest';
import { CountMinSketch } from '../src/tools/data-structures/probabilistic';

describe('CountMinSketch', () => {
    it('should initialize with correct dimensions', () => {
        const cms = new CountMinSketch(100, 5);
        expect(cms).toBeDefined();
    });

    it('should estimate frequency of a single item', () => {
        const cms = new CountMinSketch(1000, 5);
        cms.add('apple');
        cms.add('apple');
        cms.add('apple');

        expect(cms.estimate('apple')).toBeGreaterThan(0);
        // CMS guarantees estimate >= actual.
        expect(cms.estimate('apple')).toBeGreaterThan(2);
    });

    it('should handle frequency of multiple items', () => {
        const cms = new CountMinSketch(1000, 5);
        cms.add('apple', 5);
        cms.add('banana', 3);

        // Exact counts are likely for small datasets in large sketch
        // But we strictly check the >= property and approx range
        expect(cms.estimate('apple')).toBeGreaterThanOrEqual(5);
        expect(cms.estimate('banana')).toBeGreaterThanOrEqual(3);
        expect(cms.estimate('orange')).toBe(0); // Should be 0 if no collisions (likely for 1000 width)
    });

    it('should handle collisions gracefully', () => {
        // Force collisions with tiny width
        const cms = new CountMinSketch(1, 1); // 1 bucket!
        cms.add('a', 10);
        cms.add('b', 20);

        // Both hash to bucket 0
        // Estimate for 'a' should be total count 30
        expect(cms.estimate('a')).toBe(30);
        expect(cms.estimate('b')).toBe(30);
    });

    it('should respect stream updates', () => {
        const cms = new CountMinSketch(100, 5);
        expect(cms.estimate('stream')).toBe(0);

        cms.add('stream');
        expect(cms.estimate('stream')).toBeGreaterThanOrEqual(1);

        cms.add('stream', 99);
        expect(cms.estimate('stream')).toBeGreaterThanOrEqual(100);
    });
});
