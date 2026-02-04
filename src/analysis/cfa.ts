
// ============================================================================
// Control Flow Analysis Algorithms
// ============================================================================

// Basic CFG Graph Representation
// Nodes are identified by string IDs (e.g., "block1", "block2")
export interface CFG {
    blocks: string[];
    edges: { from: string; to: string }[];
    entry: string;
}

// output structures
export interface DominatorTree {
    immediateDominators: Record<string, string | null>; // node -> idom
    treeEdges: { from: string; to: string }[];
}

export interface DominanceFrontiers {
    frontiers: Record<string, string[]>;
}

// Helper: Adjacency List
function buildAdjacency(cfg: CFG): { preds: Map<string, string[]>, succs: Map<string, string[]> } {
    const preds = new Map<string, string[]>();
    const succs = new Map<string, string[]>();

    cfg.blocks.forEach(b => {
        preds.set(b, []);
        succs.set(b, []);
    });

    cfg.edges.forEach(e => {
        succs.get(e.from)?.push(e.to);
        preds.get(e.to)?.push(e.from);
    });

    return { preds, succs };
}

// 1. Compute Dominators (Cooper, Harvey, Kennedy Algorithm)
// Simple iterative O(n^2) worst case, effectively O(n) in practice
export function computeDominators(cfg: CFG): Record<string, string | null> {
    const { preds } = buildAdjacency(cfg);
    const idoms: Record<string, string | null> = {};

    // Initialize
    cfg.blocks.forEach(b => idoms[b] = null);
    idoms[cfg.entry] = cfg.entry; // Entry dominates itself structurally for algo

    let changed = true;

    // Post-order traversal usually speeds it up, but simple order works for convergence
    // We need a defined order for intersection 
    // Usually RPO (Reverse Post Order)
    const rpo = getReversePostOrder(cfg);

    while (changed) {
        changed = false;
        for (const b of rpo) {
            if (b === cfg.entry) continue;

            const p = preds.get(b) || [];
            // Pick first processed predecessor
            let newIdom: string | null = null;
            let first = true;

            for (const pi of p) {
                if (idoms[pi] !== null) { // processed
                    if (first) {
                        newIdom = pi;
                        first = false;
                    } else {
                        newIdom = intersect(pi, newIdom!, idoms, rpo);
                    }
                }
            }

            if (newIdom !== null && idoms[b] !== newIdom) {
                idoms[b] = newIdom;
                changed = true;
            }
        }
    }

    // Fix entry idom to null for strictness? or keep self?
    // Usually idom(entry) is undefined/null.
    idoms[cfg.entry] = null;

    return idoms;
}

function intersect(b1: string, b2: string, idoms: Record<string, string | null>, rpo: string[]): string {
    const boMap = new Map(rpo.map((n, i) => [n, i])); // index map for fast comparison

    let finger1 = b1;
    let finger2 = b2;

    while (finger1 !== finger2) {
        // While finger1 > finger2 (in RPO index)
        while ((boMap.get(finger1) || 0) > (boMap.get(finger2) || 0)) {
            finger1 = idoms[finger1]!;
        }
        while ((boMap.get(finger2) || 0) > (boMap.get(finger1) || 0)) {
            finger2 = idoms[finger2]!;
        }
    }
    return finger1;
}

// DFS for RPO
export function getReversePostOrder(cfg: CFG): string[] {
    const visited = new Set<string>();
    const order: string[] = [];
    const { succs } = buildAdjacency(cfg);

    function dfs(u: string) {
        visited.add(u);
        const children = succs.get(u) || [];
        for (const v of children) {
            if (!visited.has(v)) dfs(v);
        }
        order.push(u); // Post-order
    }

    dfs(cfg.entry);
    return order.reverse(); // Reverse Post-Order
}


// 2. Compute Dominance Frontiers
// DF(b) = { x | b dominates a pred of x, but b does not strictly dominate x }
export function computeDominanceFrontiers(cfg: CFG, idoms: Record<string, string | null>): DominanceFrontiers {
    const { preds } = buildAdjacency(cfg);
    const frontiers: Record<string, string[]> = {};
    cfg.blocks.forEach(b => frontiers[b] = []);

    for (const b of cfg.blocks) {
        const predecessors = preds.get(b) || [];
        if (predecessors.length >= 2) { // Join point
            for (let p of predecessors) {
                let runner: string | null = p;
                while (runner !== idoms[b] && runner !== null) {
                    frontiers[runner]?.push(b);
                    runner = idoms[runner]!;
                }
            }
        }
    }
    // Dedupe
    for (const k in frontiers) {
        frontiers[k] = [...new Set(frontiers[k])];
    }
    return { frontiers };
}
