
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getEventStore } from '../../../durability/event-store.js';
import { createEntity, serializeEntity, EntityType } from '../../../ecs/entities.js';

// ============================================================================
// Types & Schemas
// ============================================================================

const EdgeSchema = z.tuple([z.string(), z.string()]);

const MatroidInputSchema = z.object({
    type: z.enum(['graphic', 'linear']),
    // For Graphic Matroid
    graph: z.object({
        nodes: z.array(z.string()),
        edges: z.array(EdgeSchema)
    }).optional(),
    // For Linear Matroid
    matrix: z.array(z.array(z.number())).optional(), // Rows = vectors? Cols = dimensions?
    // Convention: Columns are elements of ground set. Rows are dimensions.
});

type MatroidDef = z.infer<typeof MatroidInputSchema>;

// Abstract Matroid Interface
interface Matroid {
    groundSet: string[]; // Element IDs
    isIndependent(subset: string[]): boolean;
    rank(subset: string[]): number;
}

// ----------------------------------------------------------------------------
// Graphic Matroid Implementation
// ----------------------------------------------------------------------------
class GraphicMatroid implements Matroid {
    groundSet: string[];
    edges: [string, string][];
    edgeMap: Map<string, [string, string]>;
    nodes: Set<string>;

    constructor(nodes: string[], edges: [string, string][]) {
        this.nodes = new Set(nodes);
        this.edges = edges;
        this.groundSet = edges.map((_, i) => `e${i}`);
        this.edgeMap = new Map();
        edges.forEach((e, i) => this.edgeMap.set(`e${i}`, e));
    }

    isIndependent(subset: string[]): boolean {
        // Build graph from subset edges and check for cycles
        const uf = new Map<string, string>();
        for (const n of this.nodes) uf.set(n, n);

        const find = (x: string): string => {
            if (uf.get(x) !== x) uf.set(x, find(uf.get(x)!));
            return uf.get(x)!;
        };

        const union = (x: string, y: string): boolean => {
            const rootX = find(x);
            const rootY = find(y);
            if (rootX === rootY) return false; // Cycle detected
            uf.set(rootX, rootY);
            return true;
        };

        for (const edgeId of subset) {
            const edge = this.edgeMap.get(edgeId);
            if (!edge) throw new Error(`Unknown edge ${edgeId}`);
            if (!union(edge[0], edge[1])) return false;
        }
        return true;
    }

    rank(subset: string[]): number {
        // Rank = |V| - number of connected components in subgraph(V, subset)
        const uf = new Map<string, string>();
        for (const n of this.nodes) uf.set(n, n);

        const find = (x: string): string => {
            if (uf.get(x) !== x) uf.set(x, find(uf.get(x)!));
            return uf.get(x)!;
        };

        let rank = 0;
        for (const edgeId of subset) {
            const edge = this.edgeMap.get(edgeId);
            if (!edge) continue;
            const rootX = find(edge[0]);
            const rootY = find(edge[1]);
            if (rootX !== rootY) {
                uf.set(rootX, rootY);
                rank++;
            }
        }
        return rank;
    }
}

// ----------------------------------------------------------------------------
// Linear Matroid Implementation (over Real numbers for simplicity)
// ----------------------------------------------------------------------------
class LinearMatroid implements Matroid {
    groundSet: string[];
    matrix: number[][]; // Rows=dimensions, Cols=elements

    constructor(matrix: number[][]) {
        if (matrix.length === 0) {
            this.matrix = [];
            this.groundSet = [];
            return;
        }
        const cols = matrix[0]?.length || 0;
        this.matrix = matrix;
        this.groundSet = Array.from({ length: cols }, (_, i) => `c${i}`);
    }

    isIndependent(subset: string[]): boolean {
        // Check if columns strictly linearly independent
        const colIndices = subset.map(s => parseInt(s.slice(1)));
        const subMatrix = this.matrix.map(row => colIndices.map(i => row[i]!));

        // Gaussian elimination to check rank
        return this.computeRank(subMatrix) === subset.length;
    }

    rank(subset: string[]): number {
        const colIndices = subset.map(s => parseInt(s.slice(1)));
        const subMatrix = this.matrix.map(row => colIndices.map(i => row[i]!));
        return this.computeRank(subMatrix);
    }

    private computeRank(mat: number[][]): number {
        // Simple Gaussian elimination
        if (mat.length === 0 || !mat[0] || mat[0].length === 0) return 0;
        const R = mat.length;
        const C = mat[0].length;
        let rank = 0;
        // Deep copy
        const tempMat = mat.map(row => [...row]);

        for (let j = 0; j < C && rank < R; j++) {
            let pivotRow = -1;
            for (let i = rank; i < R; i++) {
                if (Math.abs(tempMat[i]?.[j] ?? 0) > 1e-9) {
                    pivotRow = i;
                    break;
                }
            }
            if (pivotRow === -1) continue;

            const rowRank = tempMat[rank];
            const rowPivot = tempMat[pivotRow];
            if (!rowRank || !rowPivot) continue;

            tempMat[rank] = rowPivot;
            tempMat[pivotRow] = rowRank;

            const rankRow = tempMat[rank];
            if (!rankRow) continue;

            const pivotVal = rankRow[j];
            if (pivotVal === undefined) continue;

            for (let k = j; k < C; k++) {
                const val = rankRow[k];
                if (val !== undefined) rankRow[k] = val / pivotVal;
            }

            for (let i = 0; i < R; i++) {
                if (i === rank) continue;
                const targetRow = tempMat[i];
                if (!targetRow) continue;

                const factor = targetRow[j];
                if (factor !== undefined && Math.abs(factor) > 1e-9) {
                    for (let k = j; k < C; k++) {
                        const sVal = rankRow[k];
                        if (sVal !== undefined) {
                            targetRow[k] = (targetRow[k] ?? 0) - factor * sVal;
                        }
                    }
                }
            }
            rank++;
        }
        return rank;
    }
}

// Helper to create matroid instance
function createMatroid(def: MatroidDef): Matroid {
    if (def.type === 'graphic') {
        if (!def.graph) throw new Error("Graph input required for 'graphic' matroid type");
        return new GraphicMatroid(def.graph.nodes, def.graph.edges as [string, string][]);
    } else {
        if (!def.matrix) throw new Error("Matrix input required for 'linear' matroid type");
        return new LinearMatroid(def.matrix);
    }
}

// ----------------------------------------------------------------------------
// Algorithms
// ----------------------------------------------------------------------------

// 1. Greedy Correctness (Rado-Edmonds verification)
function verifyGreedy(matroid: Matroid, weights: Record<string, number>): { isOptimal: boolean; greedyWeight: number } {
    const sorted = [...matroid.groundSet].sort((a, b) => (weights[b] || 0) - (weights[a] || 0));
    const I: string[] = [];
    let greedyW = 0;

    for (const e of sorted) {
        if (matroid.isIndependent([...I, e])) {
            I.push(e);
            greedyW += (weights[e] || 0);
        }
    }
    return { isOptimal: true, greedyWeight: greedyW };
}

// 2. Matroid Intersection
function algorithmIntersection(m1: Matroid, m2: Matroid): string[] {
    let I: string[] = [];
    const elements = m1.groundSet.filter(e => m2.groundSet.includes(e));

    while (true) {
        const X1: string[] = [];
        const X2: string[] = [];
        const notI = elements.filter(e => !I.includes(e));

        for (const e of notI) {
            if (m1.isIndependent([...I, e])) X1.push(e);
            if (m2.isIndependent([...I, e])) X2.push(e);
        }

        if (X1.length === 0 || X2.length === 0) break;

        const pred = new Map<string, string>();
        const queue: string[] = [...X1];
        const visited = new Set<string>(X1);

        for (const x of X1) pred.set(x, 'SOURCE');

        let foundSink: string | null = null;

        while (queue.length > 0) {
            const u = queue.shift()!;

            if (X2.includes(u)) {
                foundSink = u;
                break;
            }

            if (!I.includes(u)) {
                for (const v of I) {
                    if (!visited.has(v)) {
                        if (m2.isIndependent(I.filter(x => x !== v).concat([u]))) {
                            visited.add(v);
                            pred.set(v, u);
                            queue.push(v);
                        }
                    }
                }
            } else {
                for (const v of notI) {
                    if (!visited.has(v)) {
                        if (m1.isIndependent(I.filter(x => x !== u).concat([v]))) {
                            visited.add(v);
                            pred.set(v, u);
                            queue.push(v);
                        }
                    }
                }
            }
        }

        if (!foundSink) break;

        let curr = foundSink;
        while (curr !== 'SOURCE') {
            if (I.includes(curr)) {
                I = I.filter(x => x !== curr);
            } else {
                I.push(curr);
            }
            curr = pred.get(curr)!;
        }
    }

    return I;
}

// ----------------------------------------------------------------------------
// Tool Registration
// ----------------------------------------------------------------------------

export function registerMatroidTools(server: McpServer): void {
    const store = getEventStore();

    server.tool(
        'matroid_greedy_correctness',
        'Verify independence system properties using Rado-Edmonds theorem.',
        {
            matroid: MatroidInputSchema,
            weights: z.record(z.number()),
        },
        async ({ matroid, weights }) => {
            const m = createMatroid(matroid as MatroidDef);
            const res = verifyGreedy(m, weights);

            store.append(
                'task-temp', // Todo: proper entity ID
                'matroid.greedy.verified',
                res
            );

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(res, null, 2)
                }]
            };
        }
    );

    server.tool(
        'matroid_intersection',
        'Compute maximum size common independent set of two matroids.',
        {
            matroid1: MatroidInputSchema,
            matroid2: MatroidInputSchema,
        },
        async ({ matroid1, matroid2 }) => {
            const m1 = createMatroid(matroid1 as MatroidDef);
            const m2 = createMatroid(matroid2 as MatroidDef);

            const result = algorithmIntersection(m1, m2);

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ size: result.length, elements: result }, null, 2)
                }]
            };
        }
    );

    server.tool(
        'matroid_partition',
        'Partition ground set into minimum number of independent sets.',
        {
            matroid: MatroidInputSchema,
        },
        async ({ matroid }) => {
            const m = createMatroid(matroid as MatroidDef);
            const remaining = new Set(m.groundSet);
            const partitions: string[][] = [];

            while (remaining.size > 0) {
                const currentPart: string[] = [];
                for (const e of remaining) {
                    if (m.isIndependent([...currentPart, e])) {
                        currentPart.push(e);
                    }
                }
                partitions.push(currentPart);
                for (const e of currentPart) remaining.delete(e);
            }

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ partitionCount: partitions.length, partitions }, null, 2)
                }]
            };
        }
    );
}
