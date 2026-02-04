
/**
 * Graph Algorithms for "Mathematical Bedrock"
 * 
 * Implements:
 * 1. Edmonds-Karp: Max-Flow Min-Cut algorithm.
 * 2. Gusfield's Algorithm: Constructs a Gomory-Hu Tree (Equivalent Flow Tree) 
 *    using N-1 max flow computations.
 */

// Basic Graph Interface
export interface Edge {
    u: string;
    v: string;
    capacity: number;
}

export interface FlowResult {
    maxFlow: number;
    cut: Set<string>; // Set of nodes on the 'source' side of the cut
}

export class Graph {
    // Adjacency list: node -> [{to, capacity, reverseEdgeIndex}]
    public adj: Map<string, Array<{ to: string, capacity: number, rev: number, flow: number }>>;
    public nodes: string[];

    constructor(nodes: string[]) {
        this.nodes = nodes;
        this.adj = new Map();
        nodes.forEach(n => this.adj.set(n, []));
    }

    public addEdge(u: string, v: string, capacity: number) {
        if (!this.adj.has(u) || !this.adj.has(v)) throw new Error(`Nodes ${u}, ${v} must exist`);

        const uAdj = this.adj.get(u)!;
        const vAdj = this.adj.get(v)!;

        // Forward edge
        uAdj.push({ to: v, capacity, rev: vAdj.length, flow: 0 });
        // Backward edge (residual)
        vAdj.push({ to: u, capacity: capacity, rev: uAdj.length - 1, flow: 0 }); // Undirected graph -> capacity both ways
        // NOTE: For Gomory-Hu on undirected graphs, capacity is symmetric. 
        // If directed, backward capacity is 0. 
        // Gomory-Hu is typically for undirected graphs. We assume UNDIRECTED here.
    }

    public resetFlow() {
        for (const edges of this.adj.values()) {
            for (const e of edges) {
                e.flow = 0;
            }
        }
    }
}

/**
 * Computes Max-Flow and Min-Cut between s and t using Edmonds-Karp (BFS).
 */
export function edmondsKarp(graph: Graph, s: string, t: string): FlowResult {
    graph.resetFlow();
    let maxFlow = 0;

    while (true) {
        // BFS to find augmenting path
        const parent = new Map<string, { node: string, edgeIdx: number }>();
        const queue: string[] = [s];
        parent.set(s, { node: s, edgeIdx: -1 }); // Root

        let pathFound = false;
        while (queue.length > 0) {
            const u = queue.shift()!;
            if (u === t) {
                pathFound = true;
                break;
            }

            const edges = graph.adj.get(u)!;
            for (let i = 0; i < edges.length; i++) {
                const e = edges[i]!;
                if (!parent.has(e.to) && e.capacity > e.flow) {
                    parent.set(e.to, { node: u, edgeIdx: i });
                    queue.push(e.to);
                }
            }
        }

        if (!pathFound) break;

        // Traceback path to find bottleneck capacity
        let pathFlow = Infinity;
        let curr = t;
        while (curr !== s) {
            const p = parent.get(curr)!;
            const edge = graph.adj.get(p.node)![p.edgeIdx]!;
            pathFlow = Math.min(pathFlow, edge.capacity - edge.flow);
            curr = p.node;
        }

        // Apply flow
        curr = t;
        while (curr !== s) {
            const p = parent.get(curr)!;
            const edges = graph.adj.get(p.node)!;
            const edge = edges[p.edgeIdx]!;

            edge.flow += pathFlow;

            const revEdge = graph.adj.get(edge.to)![edge.rev]!;
            revEdge.flow -= pathFlow;

            curr = p.node;
        }

        maxFlow += pathFlow;
    }

    // Identify Min-Cut (Reachability from s in residual graph)
    const cut = new Set<string>();
    const q: string[] = [s];
    cut.add(s);
    while (q.length > 0) {
        const u = q.shift()!;
        const edges = graph.adj.get(u)!;
        for (const e of edges) {
            if (!cut.has(e.to) && e.capacity > e.flow) {
                cut.add(e.to);
                q.push(e.to);
            }
        }
    }

    return { maxFlow, cut };
}

/**
 * Gusfield's Algorithm for Gomory-Hu Tree construction.
 * No node contractions required.
 * Returns a list of tree edges { u, v, weight } representing the Min-Cuts.
 */
export function buildGomoryHuTree(nodes: string[], edges: Edge[]): Edge[] {
    const n = nodes.length;
    if (n <= 1) return [];

    // Map string IDs to indices 0..n-1 for array handling
    const nodeToIndex = new Map<string, number>();
    nodes.forEach((id, i) => nodeToIndex.set(id, i));

    // Parent array p for the tree structure. Initially p[i] = 0 for all i > 0.
    const p = new Array(n).fill(0);
    // Weights of tree edges (i, p[i])
    const w = new Array(n).fill(0);

    // Build the graph once
    const graph = new Graph(nodes);
    for (const e of edges) {
        graph.addEdge(e.u, e.v, e.capacity);
    }

    // Iterations s = 1 to n-1
    for (let s = 1; s < n; s++) {
        const t = p[s]; // Current neighbor in tree

        const sNode = nodes[s]!;
        const tNode = nodes[t]!;

        // Compute Max-Flow between s and t
        const { maxFlow, cut } = edmondsKarp(graph, sNode, tNode);

        w[s] = maxFlow;

        // Update tree structure:
        // For all i != s such that p[i] == t AND i is on the same side of cut as s:
        // set p[i] = s
        for (let i = 0; i < n; i++) {
            if (i !== s && p[i] === t) {
                const iNode = nodes[i]!;
                if (cut.has(iNode)) {
                    p[i] = s;
                }
            }
        }

        // Also if p[t] is in X (cut side of s), update? 
        // Gusfield's specific update:
        // If predecessor of s (which is t) is on s-side of cut, we reparent.
        // Wait, standard Gusfield logic loops for i in {s+1 ... n-1}?
        // No, loop is over all nodes for reparenting.
        // Actually: Predecessor array `p` defines edges (i, p[i]) for i > 0.
        // We compute flow between s and p[s].
        // Cut splits vertices into X (contains s) and Y (contains p[s]).
        // For all nodes i (other than s), if i is in X and p[i] == p[s], then p[i] = s.
    }

    // Convert p array to Edge list
    const treeEdges: Edge[] = [];
    for (let i = 1; i < n; i++) {
        treeEdges.push({
            u: nodes[i]!,
            v: nodes[p[i]]!,
            capacity: w[i]
        });
    }

    return treeEdges;
}
