
import { describe, it, expect } from 'vitest';
import { BitVector, WaveletTree } from '../src/tools/data-structures/succinct';

describe('BitVector', () => {
    it('should correctly construct and access bits', () => {
        const bv = new BitVector('10110');
        expect(bv.length).toBe(5);
        expect(bv.access(0)).toBe(true);
        expect(bv.access(1)).toBe(false);
        expect(bv.access(2)).toBe(true);
        expect(bv.access(3)).toBe(true);
        expect(bv.access(4)).toBe(false);
        expect(bv.access(5)).toBe(false); // Out of bounds
    });

    it('should calculate rank1 correctly', () => {
        // Index: 0123456789
        // Bits:  1011001011
        const bv = new BitVector('1011001011');

        expect(bv.rank1(0)).toBe(0);
        expect(bv.rank1(1)).toBe(1); // 1 (at 0)
        expect(bv.rank1(2)).toBe(1);
        expect(bv.rank1(3)).toBe(2); // 1, 1 (at 0, 2)
        expect(bv.rank1(4)).toBe(3);
        expect(bv.rank1(10)).toBe(6); // Total ones
    });

    it('should calculate select1 correctly', () => {
        // Index: 012345678
        // Bits:  010010001
        // Ones at: 1, 4, 8
        const bv = new BitVector('010010001');

        expect(bv.select1(0)).toBe(1);
        expect(bv.select1(1)).toBe(4);
        expect(bv.select1(2)).toBe(8);
        expect(bv.select1(3)).toBe(-1); // Fail
    });

    it('should handle large bit vectors', () => {
        const size = 10000;
        const bits = new Array(size).fill(false);
        const setIndices = [10, 500, 1000, 9999];
        setIndices.forEach(i => bits[i] = true);

        const bv = new BitVector(bits);

        expect(bv.access(10)).toBe(true);
        expect(bv.access(11)).toBe(false);

        expect(bv.rank1(501)).toBe(2); // 10 and 500
        expect(bv.select1(2)).toBe(1000); // 3rd one (index 2) is at 1000
    });
});

describe('WaveletTree', () => {
    it('should access characters correctly', () => {
        const text = 'banana';
        const wt = new WaveletTree(text);

        for (let i = 0; i < text.length; i++) {
            expect(wt.access(i)).toBe(text[i]);
        }
    });

    it('should calculate rank correctly', () => {
        const text = 'abracadabra';
        //            01234567890
        const wt = new WaveletTree(text);

        // 'a's at 0, 3, 5, 7, 10
        expect(wt.rank('a', 0)).toBe(0);
        expect(wt.rank('a', 1)).toBe(1);
        expect(wt.rank('a', 4)).toBe(2);
        expect(wt.rank('a', 11)).toBe(5);

        // 'b's at 1, 8
        expect(wt.rank('b', 9)).toBe(2);

        // 'z'
        expect(wt.rank('z', 5)).toBe(0);
    });

    it('should calculate select correctly', () => {
        const text = 'abracadabra';
        //            01234567890
        // 'a' indices: 0, 3, 5, 7, 10
        const wt = new WaveletTree(text);

        expect(wt.select('a', 0)).toBe(0);
        expect(wt.select('a', 1)).toBe(3);
        expect(wt.select('a', 2)).toBe(5);
        expect(wt.select('a', 4)).toBe(10);
        expect(wt.select('a', 5)).toBe(-1); // Only 5 'a's

        // 'r' indices: 2, 9
        expect(wt.select('r', 0)).toBe(2);
        expect(wt.select('r', 1)).toBe(9);
    });
});
