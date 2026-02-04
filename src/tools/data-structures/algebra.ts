
/**
 * Abstract Algebra for Type Systems
 * 
 * Implements:
 * 1. Lattice Interfaces (PartialOrder, Join, Meet).
 * 2. PowerSetLattice: Fundamental for set-based analysis.
 * 3. Fixpoint Combinator: For dataflow analysis convergence.
 */

// ============================================================================
// Core Interfaces
// ============================================================================

export interface PartialOrder<T> {
    leq(a: T, b: T): boolean; // a <= b
}

export interface JoinSemilattice<T> extends PartialOrder<T> {
    join(a: T, b: T): T; // Least Upper Bound (LUB)
    bottom: T;
}

export interface MeetSemilattice<T> extends PartialOrder<T> {
    meet(a: T, b: T): T; // Greatest Lower Bound (GLB)
    top?: T; // Top is optional for some structures, but common in complete lattices
}

export interface Lattice<T> extends JoinSemilattice<T>, MeetSemilattice<T> { }

// ============================================================================
// Concrete Implementations
// ============================================================================

/**
 * Lattice over the Power Set of a given set of elements.
 * Elements are strings for simplicity.
 * 
 * Orders: Subset containment (A <= B iff A is subset of B)
 * Join: Union (A U B)
 * Meet: Intersection (A n B)
 * Bottom: Empty Set
 * Top: The Universe Set
 */
export class PowerSetLattice implements Lattice<Set<string>> {
    public readonly universe: Set<string>;
    public readonly bottom: Set<string>;
    public readonly top: Set<string>;

    constructor(universeElements: string[]) {
        this.universe = new Set(universeElements);
        this.bottom = new Set();
        this.top = this.universe;
    }

    leq(a: Set<string>, b: Set<string>): boolean {
        // A <= B iff every elem in A is in B
        for (const elem of a) {
            if (!b.has(elem)) return false;
        }
        return true;
    }

    join(a: Set<string>, b: Set<string>): Set<string> {
        // Union
        const result = new Set(a);
        for (const elem of b) {
            result.add(elem);
        }
        return result;
    }

    meet(a: Set<string>, b: Set<string>): Set<string> {
        // Intersection
        const result = new Set<string>();
        for (const elem of a) {
            if (b.has(elem)) {
                result.add(elem);
            }
        }
        return result;
    }
}

// ============================================================================
// Algorithms
// ============================================================================

/**
 * Computes the least fixed point of a monotonic function f on a lattice.
 * Starts from bottom and iterates f(x) until x stabilizes (x == f(x)).
 * 
 * Requirement: The lattice must be of finite height or satisfy the Ascending Chain Condition (ACC)
 * for termination guaranteed. We include a maxIterations guard.
 */
export function computeFixpoint<T>(
    lattice: JoinSemilattice<T>,
    f: (x: T) => T,
    maxIterations: number = 1000
): { value: T, converged: boolean, iterations: number } {
    let curr = lattice.bottom;
    for (let i = 0; i < maxIterations; i++) {
        const next = f(curr);

        // Convergence check: if next <= curr (and since f is monotonic and we started at bot, curr <= next),
        // then curr == next.
        // Strictly, we check strict equality for convergence in concrete types, 
        // but leq check is mathematically sufficient if anti-symmetry holds.
        // For Sets, "leq(next, curr)" implies next is subset of curr.
        // Since we are moving UP the lattice (curr <= next is invariant for monotonic f starting at bot),
        // if next <= curr, then curr == next.

        // However, we need value equality check which might strictly be expensive.
        // Let's rely on lattice properties: if leq(next, curr), we are done.

        if (lattice.leq(next, curr)) {
            return { value: curr, converged: true, iterations: i };
        }

        curr = next;
    }
    return { value: curr, converged: false, iterations: maxIterations };
}
