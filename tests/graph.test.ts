
import { describe, it, expect } from 'vitest';
import { Graph, edmondsKarp, buildGomoryHuTree } from '../src/tools/data-structures/graph';

describe('Graph Algorithms', () => {

    describe('Edmonds-Karp (Max Flow)', () => {
        it('should compute max flow in simple graph', () => {
            // S -> A (10)
            // S -> B (10)
            // A -> B (2) -> directed? We assume undirected in standard impl or directed?
            // The Graph class constructs undirected edges (capacity both ways)
            // Let's test basic undirected flow
            const nodes = ['S', 'A', 'B', 'T'];
            const g = new Graph(nodes);

            // S-A: 10
            // S-B: 5
            // A-T: 5
            // B-T: 10
            // A-B: 15
            g.addEdge('S', 'A', 10);
            g.addEdge('S', 'B', 5);
            g.addEdge('A', 'T', 5);
            g.addEdge('B', 'T', 10);
            g.addEdge('A', 'B', 15);

            // Flow S->T
            // Path S-A-T: 5
            // Remaining caps: S-A (5), A-T (0)
            // Path S-B-T: 5
            // Remaining caps: S-B (0), B-T (5)
            // Remaining S-A (5) can go S-A-B-T?
            // A-B has 15. So S->A(5)->B(5)->T(5).
            // Total Flow = 5 + 5 + 5 = 15.

            // Bottleneck is cut {S, A, B} vs {T}? 
            // Cut capacity: A-T(5) + B-T(10) = 15. Correct.

            const result = edmondsKarp(g, 'S', 'T');
            expect(result.maxFlow).toBe(15);
        });
    });

    describe('Gomory-Hu Tree', () => {
        it('should construct correct cut tree for Triangle', () => {
            // Nodes: 0, 1, 2
            // Edges: (0,1,10), (1,2,10), (0,2,2)
            // Min Cuts: 
            // 0-1: 12 (0-1 direct + 0-2-1 path 2) => Cut is {0} vs {1,2} val 12. Correct.
            // 1-2: 12 ...
            // 0-2: 4 (0-2 direct 2 + 0-1-2 limit 10) => Val 12??
            // Wait.
            // 0-2 Cut: {0} vs {1,2} weight is 10+2 = 12.
            // {2} vs {0,1} weight is 10+2 = 12.
            // Is min cut 12?
            // Paths: 0->2 (cap 2), 0->1->2 (cap 10). Total 12.

            // All pairs min cut is 12.
            // Tree: 0-1 (12), 1-2 (12).
            // Then 0-2 path is min(12, 12) = 12. Correct.

            const nodes = ['0', '1', '2'];
            const edges = [
                { u: '0', v: '1', capacity: 10 },
                { u: '1', v: '2', capacity: 10 },
                { u: '0', v: '2', capacity: 2 }
            ];

            const tree = buildGomoryHuTree(nodes, edges);

            // Should have 2 edges
            expect(tree.length).toBe(2);

            // Verify structure implies flow 12 everywhere
            // Edges could be (0,1,12) and (1,2,12) or similar
            // Let's verify min-cuts match
            // We can't easily check topology uniqueness, but we can verify values

            const has12 = tree.every(e => e.capacity === 12);
            expect(has12).toBe(true);
        });

        it('should handle K4 graph (Fully Connected, weight 1)', () => {
            // Nodes A, B, C, D all connected with 1.
            // Degree of each is 3. Max flow between any pair is degree = 3.
            // Min cut separates {x} from {rest}, cost 3.
            // Tree should have edges all weight 3. Star graph or Line graph?
            // Star center node? 
            // If line A-B-C-D with weights 3, 3, 3.
            // Then A-D min cut is 3. Correct.

            const nodes = ['A', 'B', 'C', 'D'];
            const edges = [
                { u: 'A', v: 'B', capacity: 1 }, { u: 'A', v: 'C', capacity: 1 }, { u: 'A', v: 'D', capacity: 1 },
                { u: 'B', v: 'C', capacity: 1 }, { u: 'B', v: 'D', capacity: 1 },
                { u: 'C', v: 'D', capacity: 1 }
            ];

            const tree = buildGomoryHuTree(nodes, edges);

            expect(tree.length).toBe(3);
            expect(tree.every(e => e.capacity === 3)).toBe(true);
        });
    });
});
