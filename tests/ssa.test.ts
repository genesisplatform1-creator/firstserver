
import { describe, it, expect } from 'vitest';
import { computeDominators, computeDominanceFrontiers, CFG } from '../src/analysis/cfa.js';

describe('Static Analysis (SSA)', () => {

    /*
     * Graph: Diamond
     *       A
     *      / \
     *     B   C
     *      \ /
     *       D
     */
    it('should compute dominators for Diamond graph', () => {
        const cfg: CFG = {
            blocks: ['A', 'B', 'C', 'D'],
            edges: [
                { from: 'A', to: 'B' },
                { from: 'A', to: 'C' },
                { from: 'B', to: 'D' },
                { from: 'C', to: 'D' }
            ],
            entry: 'A'
        };

        const idoms = computeDominators(cfg);

        // A dominates everything
        expect(idoms['A']).toBe(null); // Entry
        expect(idoms['B']).toBe('A');
        expect(idoms['C']).toBe('A');
        expect(idoms['D']).toBe('A'); // D is dominated by A, not B or C individually
    });

    it('should compute dominance frontiers for Diamond graph', () => {
        const cfg: CFG = {
            blocks: ['A', 'B', 'C', 'D'],
            edges: [
                { from: 'A', to: 'B' },
                { from: 'A', to: 'C' },
                { from: 'B', to: 'D' },
                { from: 'C', to: 'D' }
            ],
            entry: 'A'
        };
        const idoms = computeDominators(cfg);
        const { frontiers } = computeDominanceFrontiers(cfg, idoms);

        // DF(B): B dominates B (strictly no). 
        // B dominates predecessor of D (B->D), essentially.
        // D is not strictly dominated by B (idom(D) = A).
        // So B E DF(B)? No.
        // D E DF(B)? Yes.
        expect(frontiers['B']).toContain('D');
        expect(frontiers['C']).toContain('D');

        // DF(A): A dominates D strictly. A dominates B strictly.
        // A dominates everything strictly.
        // DF(A) should be empty? 
        // DF(X) = { Y | X dom pred(Y) AND !(X sdom Y) }
        expect(frontiers['A'].length).toBe(0);

        // DF(D) = {}
        expect(frontiers['D'].length).toBe(0);
    });

    /*
     * Graph: Simple Loop
     *      Entry
     *        |
     *      Header <---
     *        |       |
     *       Body ----|
     *        |
     *       Exit
     */
    it('should handle Loops', () => {
        const cfg: CFG = {
            blocks: ['Entry', 'Header', 'Body', 'Exit'],
            edges: [
                { from: 'Entry', to: 'Header' },
                { from: 'Header', to: 'Body' },
                { from: 'Body', to: 'Header' }, // Back edge
                { from: 'Body', to: 'Exit' }
            ],
            entry: 'Entry'
        };

        const idoms = computeDominators(cfg);

        // Entry -> Header
        expect(idoms['Header']).toBe('Entry');
        // Header -> Body
        expect(idoms['Body']).toBe('Header');
        // Body dominates Exit?
        // Path Entry->Header->Body->Exit.
        // idom(Exit) = Body.
        expect(idoms['Exit']).toBe('Body');

        const { frontiers } = computeDominanceFrontiers(cfg, idoms);

        // DF(Body): 
        // Body -> Header. Body dom Body. !(Body sdom Header) (Header dom Body).
        // So Header E DF(Body).
        expect(frontiers['Body']).toContain('Header');

        // DF(Header):
        // Header -> Body -> Header.
        // Header does not sdom Header. 
        // Wait definition.
        // Header dominates pred(Header)? Pred is Entry, Body.
        // Header dominates Body.
        // Does Header strictly dominate Header? No.
        // So Header E DF(Body).
        // Is Header E DF(Header)? (Join point)
        // Preds of Header: Entry, Body.
        // Header dom Body. Header !sdom Header. -> Header E DF(Header) ?
        // Usually, yes, loop headers are in their own DF if implied by back edge.
        // Let's check algorithm.
        // Runner from Body up to idom(Header) (Entry).
        // Add Header to DF(Runner).
        // Runner = Body. Add Header to DF(Body).
        // Runner = idom(Body) = Header. Loop stops? (runner !== idoms[b])
        // Runner = Header. idom[b] = Entry.
        // Runner != Entry. Add Header to DF(Header).
        // Runner = idom(Header) = Entry. Loop stops.

        // So DF(Body) includes Header.
        // DF(Header) includes Header.

        expect(frontiers['Body']).toContain('Header');
        expect(frontiers['Header']).toContain('Header');
    });
});
