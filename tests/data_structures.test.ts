import { describe, it, expect } from 'vitest';
import {
    buildMerkleTree,
    getMerkleProof,
    verifyMerkleProof,
    sha256,
    BloomFilter,
    hyperLogLog
} from '../src/tools/data-structures/index.js';

describe('Advanced Data Structures', () => {
    describe('Merkle Tree', () => {
        it('should verify included data', () => {
            const data = ['a', 'b', 'c', 'd'];
            const root = buildMerkleTree(data);
            expect(root).toBeDefined();

            const target = 'c';
            // getMerkleProof now handles the hashing internally with domain separation
            const proof = getMerkleProof(root!, target);
            expect(proof).toBeDefined();

            const verified = verifyMerkleProof(root!.hash, target, proof!);
            expect(verified).toBe(true);
        });

        it('should fail verifying non-included data', () => {
            const data = ['a', 'b', 'c'];
            const root = buildMerkleTree(data);
            const target = 'z';
            // getMerkleProof now handles the hashing internally with domain separation
            const proof = getMerkleProof(root!, target);
            // getMerkleProof might return null or just not find it. 
            // In the implementation, it returns null if not found.
            expect(proof).toBeNull();
        });
    });

    describe('Bloom Filter', () => {
        it('should identify included items', () => {
            const bf = new BloomFilter(100, 0.01);
            bf.add('hello');
            expect(bf.test('hello')).toBe(true);
        });

        it('should return false for distinct items (mostly)', () => {
            const bf = new BloomFilter(100, 0.01);
            bf.add('hello');
            expect(bf.test('world')).toBe(false);
        });
    });

    describe('HyperLogLog', () => {
        it('should estimate cardinality', () => {
            const items = [];
            for (let i = 0; i < 1000; i++) items.push(`item-${i}`);
            const estimate = hyperLogLog(items);
            // HLL is probabilistic, check for reasonable error (e.g. within 10-15%)
            const error = Math.abs(1000 - estimate) / 1000;
            // Standard error for m=1024 is around 3%, so 0.2 (20%) is very safe
            expect(error).toBeLessThan(0.2);
        });
    });
});
