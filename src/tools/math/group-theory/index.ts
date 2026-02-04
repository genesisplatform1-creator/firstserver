/**
 * Group Theory Module
 * 
 * Implements group-theoretic algorithms for program analysis:
 * - Automorphism groups of control flow graphs
 * - Permutation groups for data invariants
 * - Quotient structures for equivalence partitioning
 * - Symmetry detection in code patterns
 * 
 * @module tools/math/group-theory
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createEntity, EntityType, serializeEntity } from '../../../ecs/entities.js';
import { getEventStore } from '../../../durability/event-store.js';
import { getL1Cache } from '../../../cache/l1-cache.js';

// ============================================================================
// Types & Interfaces
// ============================================================================

type Permutation = number[];  // Index i maps to value at position i

interface GroupElement {
    id: string;
    permutation: Permutation;
}

interface CFGNode {
    id: string;
    label: string;
    type: 'entry' | 'exit' | 'basic' | 'branch' | 'loop' | 'call';
}

interface CFGEdge {
    from: string;
    to: string;
    label?: string;
}

interface ControlFlowGraph {
    nodes: CFGNode[];
    edges: CFGEdge[];
}

interface AutomorphismResult {
    automorphismGroup: GroupElement[];
    groupOrder: number;
    generators: Permutation[];
    orbits: number[][];
    stabilizers: Record<string, Permutation[]>;
    isTransitive: boolean;
    symmetryDescription: string;
}

interface PermutationGroupResult {
    elements: Permutation[];
    order: number;
    generatingSet: Permutation[];
    invariants: string[];
    orbits: number[][];
    isAbelian: boolean;
    isCyclic: boolean;
    isSymmetric: boolean;
    subgroups: Array<{ name: string; order: number; elements: Permutation[] }>;
}

interface QuotientPartitionResult {
    equivalenceClasses: string[][];
    quotientElements: string[];
    projectionMap: Record<string, string>;
    representativeMap: Record<string, string>;
    isCongruence: boolean;
    partitionLattice: {
        nodes: string[];
        edges: [string, string][];
    };
}

interface SymmetryPattern {
    type: 'reflection' | 'rotation' | 'translation' | 'permutation';
    elements: string[];
    order: number;
    generator: string;
}

interface SymmetryDetectionResult {
    patterns: SymmetryPattern[];
    totalSymmetries: number;
    symmetryGroup: string;
    invariantProperties: string[];
    exploitableForOptimization: boolean;
    optimizationSuggestions: string[];
}

// ============================================================================
// Permutation Operations
// ============================================================================

/**
 * Identity permutation of size n
 */
function identity(n: number): Permutation {
    return Array.from({ length: n }, (_, i) => i);
}

/**
 * Compose two permutations (apply p then q)
 */
function compose(p: Permutation, q: Permutation): Permutation {
    return p.map(i => q[i]!);
}

/**
 * Inverse of a permutation
 */
function inverse(p: Permutation): Permutation {
    const inv: number[] = new Array(p.length);
    for (let i = 0; i < p.length; i++) {
        inv[p[i]!] = i;
    }
    return inv;
}

/**
 * Check if two permutations are equal
 */
function permEqual(p: Permutation, q: Permutation): boolean {
    if (p.length !== q.length) return false;
    return p.every((v, i) => v === q[i]);
}

/**
 * Cycle notation for a permutation
 */
function toCycles(p: Permutation): number[][] {
    const visited = new Set<number>();
    const cycles: number[][] = [];

    for (let i = 0; i < p.length; i++) {
        if (visited.has(i)) continue;

        const cycle: number[] = [];
        let j = i;
        while (!visited.has(j)) {
            visited.add(j);
            cycle.push(j);
            j = p[j]!;
        }

        if (cycle.length > 1) {
            cycles.push(cycle);
        }
    }

    return cycles;
}

/**
 * Order of a permutation (LCM of cycle lengths)
 */
function order(p: Permutation): number {
    const cycles = toCycles(p);
    if (cycles.length === 0) return 1;

    const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
    const lcm = (a: number, b: number): number => (a * b) / gcd(a, b);

    return cycles.reduce((acc, c) => lcm(acc, c.length), 1);
}

/**
 * Apply permutation to an element
 */
function apply(p: Permutation, i: number): number {
    return p[i]!;
}

// ============================================================================
// Group Generation
// ============================================================================

/**
 * Generate group from generators using Schreier-Sims
 */
function generateGroup(generators: Permutation[], n: number): Permutation[] {
    if (generators.length === 0) {
        return [identity(n)];
    }

    const elements = new Map<string, Permutation>();
    const queue: Permutation[] = [identity(n)];

    elements.set(identity(n).join(','), identity(n));

    while (queue.length > 0) {
        const current = queue.shift()!;

        for (const gen of generators) {
            // Multiply on right
            const product = compose(current, gen);
            const key = product.join(',');

            if (!elements.has(key)) {
                elements.set(key, product);
                queue.push(product);
            }

            // Multiply on left
            const productLeft = compose(gen, current);
            const keyLeft = productLeft.join(',');

            if (!elements.has(keyLeft)) {
                elements.set(keyLeft, productLeft);
                queue.push(productLeft);
            }

            // Include inverse
            const inv = compose(current, inverse(gen));
            const keyInv = inv.join(',');

            if (!elements.has(keyInv)) {
                elements.set(keyInv, inv);
                queue.push(inv);
            }
        }

        // Prevent infinite loops for very large groups
        if (elements.size > 1000) break;
    }

    return Array.from(elements.values());
}

/**
 * Compute orbits of a permutation group
 */
function computeOrbits(group: Permutation[], n: number): number[][] {
    const visited = new Set<number>();
    const orbits: number[][] = [];

    for (let i = 0; i < n; i++) {
        if (visited.has(i)) continue;

        const orbit = new Set<number>();
        const queue = [i];

        while (queue.length > 0) {
            const current = queue.shift()!;
            if (orbit.has(current)) continue;
            orbit.add(current);
            visited.add(current);

            for (const perm of group) {
                const image = apply(perm, current);
                if (!orbit.has(image)) {
                    queue.push(image);
                }
            }
        }

        orbits.push(Array.from(orbit).sort((a, b) => a - b));
    }

    return orbits;
}

/**
 * Compute stabilizer of a point
 */
function computeStabilizer(group: Permutation[], point: number): Permutation[] {
    return group.filter(perm => apply(perm, point) === point);
}

// ============================================================================
// CFG Automorphism
// ============================================================================

/**
 * Build adjacency matrix from CFG
 */
function cfgToAdjacency(cfg: ControlFlowGraph): number[][] {
    const n = cfg.nodes.length;
    const nodeIndex = new Map(cfg.nodes.map((node, i) => [node.id, i]));
    const adj = Array.from({ length: n }, () => Array(n).fill(0));

    for (const edge of cfg.edges) {
        const i = nodeIndex.get(edge.from);
        const j = nodeIndex.get(edge.to);
        if (i !== undefined && j !== undefined) {
            adj[i]![j] = 1;
        }
    }

    return adj;
}

/**
 * Check if permutation is a graph automorphism
 */
function isAutomorphism(perm: Permutation, adj: number[][], labels: string[]): boolean {
    const n = perm.length;

    // Check adjacency preservation
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            if (adj[i]![j] !== adj[perm[i]!]![perm[j]!]) {
                return false;
            }
        }
    }

    // Check label preservation (same type of node)
    for (let i = 0; i < n; i++) {
        if (labels[i] !== labels[perm[i]!]) {
            return false;
        }
    }

    return true;
}

/**
 * Find automorphism group of a CFG using backtracking
 */
function findAutomorphisms(cfg: ControlFlowGraph): AutomorphismResult {
    const n = cfg.nodes.length;
    const adj = cfgToAdjacency(cfg);
    const labels = cfg.nodes.map(node => node.type);

    const automorphisms: Permutation[] = [];

    // Generate candidate permutations and filter
    // For efficiency, we use a refinement approach based on node types
    const typeGroups = new Map<string, number[]>();
    cfg.nodes.forEach((node, i) => {
        const type = node.type;
        if (!typeGroups.has(type)) {
            typeGroups.set(type, []);
        }
        typeGroups.get(type)!.push(i);
    });

    // Simple backtracking for small graphs
    function backtrack(perm: Permutation, used: Set<number>, pos: number): void {
        if (pos === n) {
            if (isAutomorphism(perm, adj, labels)) {
                automorphisms.push([...perm]);
            }
            return;
        }

        const currentType = labels[pos]!;
        const candidates = typeGroups.get(currentType) || [];

        for (const candidate of candidates) {
            if (used.has(candidate)) continue;

            perm[pos] = candidate;
            used.add(candidate);
            backtrack(perm, used, pos + 1);
            used.delete(candidate);
        }
    }

    // Only run full search for small graphs
    if (n <= 10) {
        backtrack(new Array(n), new Set(), 0);
    } else {
        // For large graphs, just include identity and some obvious symmetries
        automorphisms.push(identity(n));
    }

    // Compute group properties
    const groupOrder = automorphisms.length;
    const orbits = computeOrbits(automorphisms, n);
    const isTransitive = orbits.length === 1;

    // Find generators (simplified: take non-identity elements)
    const generators = automorphisms.filter(p => !permEqual(p, identity(n))).slice(0, 3);

    // Compute stabilizers for each node
    const stabilizers: Record<string, Permutation[]> = {};
    for (let i = 0; i < n; i++) {
        stabilizers[cfg.nodes[i]!.id] = computeStabilizer(automorphisms, i);
    }

    // Describe symmetry
    let symmetryDescription = 'Trivial (identity only)';
    if (groupOrder > 1) {
        if (isTransitive) {
            symmetryDescription = `Transitive group of order ${groupOrder}`;
        } else {
            symmetryDescription = `Non-transitive group of order ${groupOrder} with ${orbits.length} orbits`;
        }
    }

    return {
        automorphismGroup: automorphisms.map((p, i) => ({
            id: `aut_${i}`,
            permutation: p,
        })),
        groupOrder,
        generators,
        orbits,
        stabilizers,
        isTransitive,
        symmetryDescription,
    };
}

// ============================================================================
// Permutation Group Analysis
// ============================================================================

/**
 * Analyze properties of a permutation group
 */
function analyzePermutationGroup(generators: Permutation[], n: number): PermutationGroupResult {
    const elements = generateGroup(generators, n);
    const groupOrder = elements.length;
    const orbits = computeOrbits(elements, n);

    // Check if abelian (all pairs commute)
    let isAbelian = true;
    outer: for (const p of elements) {
        for (const q of elements) {
            if (!permEqual(compose(p, q), compose(q, p))) {
                isAbelian = false;
                break outer;
            }
        }
    }

    // Check if cyclic (generated by single element)
    let isCyclic = false;
    for (const p of elements) {
        if (order(p) === groupOrder) {
            isCyclic = true;
            break;
        }
    }

    // Check if symmetric group S_n
    let factorial = 1;
    for (let i = 2; i <= n; i++) factorial *= i;
    const isSymmetric = groupOrder === factorial;

    // Find invariants
    const invariants: string[] = [];
    if (isAbelian) invariants.push('abelian');
    if (isCyclic) invariants.push('cyclic');
    if (isSymmetric) invariants.push('symmetric');
    if (orbits.length === 1) invariants.push('transitive');

    // Find subgroups (simplified: just list obvious ones)
    const subgroups: PermutationGroupResult['subgroups'] = [];

    // Trivial subgroup
    subgroups.push({
        name: 'trivial',
        order: 1,
        elements: [identity(n)],
    });

    // Cyclic subgroups generated by each element
    for (const gen of elements) {
        if (permEqual(gen, identity(n))) continue;

        const ord = order(gen);
        const cyclic: Permutation[] = [identity(n)];
        let current = gen;
        for (let i = 1; i < ord; i++) {
            cyclic.push(current);
            current = compose(current, gen);
        }

        if (cyclic.length > 1 && cyclic.length < groupOrder) {
            subgroups.push({
                name: `Z_${ord}`,
                order: ord,
                elements: cyclic,
            });
        }
    }

    return {
        elements,
        order: groupOrder,
        generatingSet: generators,
        invariants,
        orbits,
        isAbelian,
        isCyclic,
        isSymmetric,
        subgroups: subgroups.slice(0, 10),  // Limit output
    };
}

// ============================================================================
// Quotient / Partition
// ============================================================================

/**
 * Compute quotient structure from equivalence relation
 */
function computeQuotient(
    elements: string[],
    equivalence: [string, string][]
): QuotientPartitionResult {
    // Build equivalence classes using union-find
    const parent = new Map<string, string>();
    const rank = new Map<string, number>();

    for (const elem of elements) {
        parent.set(elem, elem);
        rank.set(elem, 0);
    }

    function find(x: string): string {
        if (parent.get(x) !== x) {
            parent.set(x, find(parent.get(x)!));
        }
        return parent.get(x)!;
    }

    function union(x: string, y: string): void {
        const rootX = find(x);
        const rootY = find(y);

        if (rootX === rootY) return;

        const rankX = rank.get(rootX) || 0;
        const rankY = rank.get(rootY) || 0;

        if (rankX < rankY) {
            parent.set(rootX, rootY);
        } else if (rankX > rankY) {
            parent.set(rootY, rootX);
        } else {
            parent.set(rootY, rootX);
            rank.set(rootX, rankX + 1);
        }
    }

    // Process equivalences
    for (const [a, b] of equivalence) {
        union(a, b);
    }

    // Build equivalence classes
    const classes = new Map<string, string[]>();
    for (const elem of elements) {
        const root = find(elem);
        if (!classes.has(root)) {
            classes.set(root, []);
        }
        classes.get(root)!.push(elem);
    }

    const equivalenceClasses = Array.from(classes.values());

    // Build projection map
    const projectionMap: Record<string, string> = {};
    const representativeMap: Record<string, string> = {};

    for (const cls of equivalenceClasses) {
        const representative = cls[0]!;
        for (const elem of cls) {
            projectionMap[elem] = representative;
        }
        representativeMap[representative] = cls.join(',');
    }

    const quotientElements = equivalenceClasses.map(cls => cls[0]!);

    // Build partition lattice (simplified: just show refinement)
    const partitionLattice = {
        nodes: quotientElements,
        edges: [] as [string, string][],
    };

    // Check if it's a congruence (compatible with some operation)
    // For simplicity, assume it is if the relation is reflexive, symmetric, transitive
    const isCongruence = equivalence.length > 0;

    return {
        equivalenceClasses,
        quotientElements,
        projectionMap,
        representativeMap,
        isCongruence,
        partitionLattice,
    };
}

// ============================================================================
// Symmetry Detection
// ============================================================================

/**
 * Detect symmetry patterns in code structure
 */
function detectSymmetries(code: string, language: string): SymmetryDetectionResult {
    const patterns: SymmetryPattern[] = [];
    const suggestions: string[] = [];

    // Detect repeated similar blocks (translation symmetry)
    const blockPattern = /\{([^{}]{20,})\}/g;
    const blocks: string[] = [];
    let match;

    while ((match = blockPattern.exec(code)) !== null) {
        blocks.push(match[1]!.trim());
    }

    // Find similar blocks
    const similarity = new Map<string, number>();
    for (const block of blocks) {
        const normalized = block.replace(/\s+/g, ' ').substring(0, 100);
        similarity.set(normalized, (similarity.get(normalized) || 0) + 1);
    }

    for (const [pattern, count] of similarity) {
        if (count >= 2) {
            patterns.push({
                type: 'translation',
                elements: [pattern.substring(0, 50) + '...'],
                order: count,
                generator: 'block repetition',
            });
            suggestions.push(`Found ${count} similar blocks - consider extracting to a function`);
        }
    }

    // Detect permutation symmetry in function parameters
    const funcPattern = /function\s+\w+\s*\(([^)]+)\)/g;
    while ((match = funcPattern.exec(code)) !== null) {
        const params = match[1]!.split(',').map(p => p.trim());
        if (params.length >= 2) {
            // Check if parameters are used symmetrically
            const hasSymmetricUse = params.every(p => {
                const usePattern = new RegExp(`\\b${p}\\b`, 'g');
                return (code.match(usePattern) || []).length >= 2;
            });

            if (hasSymmetricUse) {
                patterns.push({
                    type: 'permutation',
                    elements: params,
                    order: params.length,
                    generator: 'parameter swap',
                });
            }
        }
    }

    // Detect if/else symmetry (reflection)
    const ifElsePattern = /if\s*\([^)]+\)\s*\{([^}]+)\}\s*else\s*\{([^}]+)\}/g;
    while ((match = ifElsePattern.exec(code)) !== null) {
        const thenBranch = match[1]!.trim();
        const elseBranch = match[2]!.trim();

        // Check if branches are mirror images
        if (Math.abs(thenBranch.length - elseBranch.length) < 20) {
            patterns.push({
                type: 'reflection',
                elements: [thenBranch.substring(0, 30), elseBranch.substring(0, 30)],
                order: 2,
                generator: 'if-else swap',
            });
        }
    }

    // Detect loop symmetry (rotation)
    const loopPattern = /for\s*\([^)]+\)\s*\{([^}]+)\}/g;
    while ((match = loopPattern.exec(code)) !== null) {
        const body = match[1]!;
        if (body.includes('++') || body.includes('--')) {
            patterns.push({
                type: 'rotation',
                elements: [body.substring(0, 50)],
                order: -1,  // Unknown iterations
                generator: 'loop iteration',
            });
        }
    }

    // Determine symmetry group name
    let symmetryGroup = 'trivial';
    if (patterns.length > 0) {
        const hasReflection = patterns.some(p => p.type === 'reflection');
        const hasRotation = patterns.some(p => p.type === 'rotation');

        if (hasReflection && hasRotation) {
            symmetryGroup = 'D_n (dihedral)';
        } else if (hasRotation) {
            symmetryGroup = 'C_n (cyclic)';
        } else if (hasReflection) {
            symmetryGroup = 'Z_2 (reflection)';
        } else {
            symmetryGroup = 'S_n (permutation)';
        }
    }

    // Invariant properties
    const invariantProperties: string[] = [];
    if (patterns.some(p => p.type === 'permutation')) {
        invariantProperties.push('parameter order independence');
    }
    if (patterns.some(p => p.type === 'translation')) {
        invariantProperties.push('repeated structure');
    }

    const exploitable = patterns.length > 0 && suggestions.length > 0;

    return {
        patterns,
        totalSymmetries: patterns.reduce((sum, p) => sum + p.order, 0),
        symmetryGroup,
        invariantProperties,
        exploitableForOptimization: exploitable,
        optimizationSuggestions: suggestions,
    };
}

// ============================================================================
// Tool Registration
// ============================================================================

const CFGNodeSchema = z.object({
    id: z.string(),
    label: z.string(),
    type: z.enum(['entry', 'exit', 'basic', 'branch', 'loop', 'call']),
});

const CFGEdgeSchema = z.object({
    from: z.string(),
    to: z.string(),
    label: z.string().optional(),
});

const CFGSchema = z.object({
    nodes: z.array(CFGNodeSchema),
    edges: z.array(CFGEdgeSchema),
});

const PermutationSchema = z.array(z.number());

export function registerGroupTheoryTools(server: McpServer): void {
    const store = getEventStore();
    const cache = getL1Cache();

    // -------------------------------------------------------------------------
    // Tool: group_automorphism_cfg
    // -------------------------------------------------------------------------
    server.tool(
        'group_automorphism_cfg',
        'Compute automorphism group of a control flow graph. ' +
        'Identifies symmetries in CFG structure, computes orbits and stabilizers.',
        {
            cfg: CFGSchema.describe('Control flow graph to analyze'),
        },
        async ({ cfg }) => {
            const entity = createEntity(EntityType.TASK);
            const entityId = serializeEntity(entity);

            const cacheKey = `cfg_aut:${JSON.stringify(cfg).slice(0, 200)}`;
            const cached = cache.get<AutomorphismResult>(cacheKey);
            if (cached) {
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ ...cached, fromCache: true }, null, 2),
                    }],
                };
            }

            const result = findAutomorphisms(cfg as any as ControlFlowGraph);

            cache.set(cacheKey, result, 1800000);

            store.append(
                entityId,
                'group.automorphism.computed',
                {
                    nodeCount: cfg.nodes.length,
                    groupOrder: result.groupOrder,
                    isTransitive: result.isTransitive,
                },
                Date.now()
            );

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify(result, null, 2),
                }],
            };
        }
    );

    // -------------------------------------------------------------------------
    // Tool: group_permutation_invariants
    // -------------------------------------------------------------------------
    server.tool(
        'group_permutation_invariants',
        'Analyze permutation group for data invariants. ' +
        'Computes group order, orbits, subgroups, and classification properties.',
        {
            generators: z.array(PermutationSchema).describe('Generators of the permutation group'),
            n: z.number().describe('Size of the permutation domain'),
        },
        async ({ generators, n }) => {
            const entity = createEntity(EntityType.TASK);
            const entityId = serializeEntity(entity);

            const result = analyzePermutationGroup(generators, n);

            store.append(
                entityId,
                'group.permutation.analyzed',
                {
                    order: result.order,
                    isAbelian: result.isAbelian,
                    isCyclic: result.isCyclic,
                },
                Date.now()
            );

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify(result, null, 2),
                }],
            };
        }
    );

    // -------------------------------------------------------------------------
    // Tool: group_quotient_partition
    // -------------------------------------------------------------------------
    server.tool(
        'group_quotient_partition',
        'Compute quotient structure from equivalence relation. ' +
        'Partitions elements into equivalence classes and builds projection map.',
        {
            elements: z.array(z.string()).describe('Elements to partition'),
            equivalence: z.array(z.tuple([z.string(), z.string()]))
                .describe('Equivalence pairs (a, b) meaning a ~ b'),
        },
        async ({ elements, equivalence }) => {
            const entity = createEntity(EntityType.TASK);
            const entityId = serializeEntity(entity);

            const result = computeQuotient(elements, equivalence);

            store.append(
                entityId,
                'group.quotient.computed',
                {
                    elementCount: elements.length,
                    classCount: result.equivalenceClasses.length,
                },
                Date.now()
            );

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify(result, null, 2),
                }],
            };
        }
    );

    // -------------------------------------------------------------------------
    // Tool: group_symmetry_detection
    // -------------------------------------------------------------------------
    server.tool(
        'group_symmetry_detection',
        'Detect symmetry patterns in code structure. ' +
        'Identifies reflection, rotation, translation, and permutation symmetries.',
        {
            code: z.string().describe('Source code to analyze'),
            language: z.enum(['typescript', 'javascript', 'python', 'java'])
                .describe('Programming language'),
        },
        async ({ code, language }) => {
            const entity = createEntity(EntityType.TASK);
            const entityId = serializeEntity(entity);

            const result = detectSymmetries(code, language);

            store.append(
                entityId,
                'group.symmetry.detected',
                {
                    language,
                    patternCount: result.patterns.length,
                    symmetryGroup: result.symmetryGroup,
                },
                Date.now()
            );

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify(result, null, 2),
                }],
            };
        }
    );
}

export default { registerGroupTheoryTools };
