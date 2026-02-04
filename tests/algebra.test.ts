
import { describe, it, expect } from 'vitest';
import { PowerSetLattice, computeFixpoint } from '../src/tools/data-structures/algebra';

describe('Abstract Algebra (Lattice Theory)', () => {

    describe('PowerSetLattice', () => {
        const universe = ['a', 'b', 'c'];
        const lattice = new PowerSetLattice(universe);

        it('should join correctly (Union)', () => {
            const A = new Set(['a']);
            const B = new Set(['b']);
            const result = lattice.join(A, B);
            expect(result.size).toBe(2);
            expect(result.has('a')).toBe(true);
            expect(result.has('b')).toBe(true);
        });

        it('should meet correctly (Intersection)', () => {
            const A = new Set(['a', 'b']);
            const B = new Set(['b', 'c']);
            const result = lattice.meet(A, B);
            expect(result.size).toBe(1);
            expect(result.has('b')).toBe(true);
        });

        it('should respect Absorption Law: a join (a meet b) = a', () => {
            const A = new Set(['a', 'c']);
            const B = new Set(['b', 'c']);

            // a meet b
            const meet = lattice.meet(A, B); // { c }
            // a join (meet)
            const result = lattice.join(A, meet); // {a, c} U {c} = {a, c}

            // Equality check for Sets
            expect(result.size).toBe(A.size);
            A.forEach(e => expect(result.has(e)).toBe(true));
        });

        it('should check partial order (Subset)', () => {
            const A = new Set(['a']);
            const B = new Set(['a', 'b']);

            expect(lattice.leq(A, B)).toBe(true);
            expect(lattice.leq(B, A)).toBe(false);
            expect(lattice.leq(A, A)).toBe(true);
        });
    });

    describe('Fixpoint Combinator', () => {
        it('should converge on simplified monotonic function', () => {
            // Function: f(S) = S U {x | x is next char of some y in S} bounded by universe
            // Universe: a, b, c, d
            const universe = ['a', 'b', 'c', 'd'];
            const lattice = new PowerSetLattice(universe);

            // Initial seed S0 = {a} (We wrap this in the monotonic function F)
            // F(S) = S U {a} U { next(y) | y in S }

            const f = (s: Set<string>): Set<string> => {
                const next = new Set(s);
                next.add('a'); // Constant injection (Start)

                for (const elem of s) {
                    const code = elem.charCodeAt(0) + 1;
                    const char = String.fromCharCode(code);
                    if (universe.includes(char)) next.add(char);
                }
                return next;
            };

            // Iteration 0: Bot {} -> F({}) = {a}
            // Iteration 1: {a} -> F({a}) = {a} U {b} = {a,b}
            // Iteration 2: {a,b} -> F({a,b}) = {a,b} U {b,c} = {a,b,c}
            // Iteration 3: {a,b,c} -> F({a,b,c}) = {a,b,c} U {b,c,d} = {a,b,c,d}
            // Iteration 4: {a,b,c,d} -> F(...) = {a,b,c,d} (Stable)

            const result = computeFixpoint(lattice, f);

            expect(result.converged).toBe(true);
            expect(result.value.size).toBe(4);
            expect(result.iterations).toBeGreaterThan(0);
        });
    });
});
