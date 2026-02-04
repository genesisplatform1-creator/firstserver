/**
 * Lattice Theory Module
 * 
 * Implements lattice-theoretic algorithms for program analysis:
 * - Complete Partial Order (CPO) analysis
 * - Scott domain construction for lazy evaluation semantics
 * - Galois connections for abstract interpretation
 * - Kleene/Tarski fixpoint computation
 * 
 * @module tools/math/lattice-theory
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createEntity, EntityType, serializeEntity } from '../../../ecs/entities.js';
import { getEventStore } from '../../../durability/event-store.js';
import { getL1Cache } from '../../../cache/l1-cache.js';

// ============================================================================
// Types & Interfaces
// ============================================================================

interface LatticeElement {
    id: string;
    label?: string;
    metadata?: Record<string, unknown>;
}

interface OrderingPair {
    lower: string;
    upper: string;
}

interface LatticeStructure {
    elements: LatticeElement[];
    ordering: OrderingPair[];
}

interface HasseDiagram {
    nodes: Array<{ id: string; label: string; level: number }>;
    edges: Array<{ from: string; to: string }>;
}

interface CPOAnalysisResult {
    isPartialOrder: boolean;
    isChainComplete: boolean;
    isCompleteLattice: boolean;
    isCPO: boolean;
    bottom?: string;
    top?: string;
    directedSets: string[][];
    lubsExist: boolean;
    hasseDiagram: HasseDiagram;
    chains: string[][];
    antichains: string[][];
}

interface ScottDomainResult {
    isCPO: boolean;
    isAlgebraic: boolean;
    isScottDomain: boolean;
    compactElements: string[];
    basis: string[];
    approximationOrder: Record<string, string[]>;
    scottTopology: {
        openSets: string[][];
        basicOpenSets: string[][];
    };
}

interface GaloisConnectionResult {
    isGaloisConnection: boolean;
    isGaloisInsertion: boolean;
    alpha: Record<string, string>;  // Abstraction function
    gamma: Record<string, string>;  // Concretization function
    closureOperator: Record<string, string>;
    fixedPoints: string[];
    soundnessProof: {
        forAll: Array<{ concrete: string; abstract: string; holds: boolean }>;
    };
}

interface FixpointResult {
    algorithm: 'kleene' | 'tarski' | 'worklist';
    iterations: number;
    fixpoint: string;
    trace: Array<{ iteration: number; value: string; stable: boolean }>;
    isLeastFixpoint: boolean;
    isGreatestFixpoint: boolean;
    convergenceRate: number;
}

// ============================================================================
// Core Lattice Operations
// ============================================================================

/**
 * Build adjacency list from ordering pairs
 */
function buildAdjacencyList(
    elements: string[],
    ordering: OrderingPair[]
): Map<string, Set<string>> {
    const adj = new Map<string, Set<string>>();
    elements.forEach(e => adj.set(e, new Set()));

    for (const { lower, upper } of ordering) {
        adj.get(lower)?.add(upper);
    }

    return adj;
}

/**
 * Compute transitive closure using Floyd-Warshall
 */
function transitiveReduction(
    elements: string[],
    ordering: OrderingPair[]
): OrderingPair[] {
    const n = elements.length;
    const idx = new Map(elements.map((e, i) => [e, i]));

    // Reachability matrix
    const reach = Array.from({ length: n }, () => Array(n).fill(false));

    for (const { lower, upper } of ordering) {
        const i = idx.get(lower)!;
        const j = idx.get(upper)!;
        reach[i]![j] = true;
    }

    // Floyd-Warshall for transitive closure
    for (let k = 0; k < n; k++) {
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (reach[i]![k] && reach[k]![j]) {
                    reach[i]![j] = true;
                }
            }
        }
    }

    // Remove transitive edges (keep only covering relations)
    const reduced: OrderingPair[] = [];
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            if (reach[i]![j]) {
                let isCovering = true;
                for (let k = 0; k < n; k++) {
                    if (k !== i && k !== j && reach[i]![k] && reach[k]![j]) {
                        isCovering = false;
                        break;
                    }
                }
                if (isCovering) {
                    reduced.push({ lower: elements[i]!, upper: elements[j]! });
                }
            }
        }
    }

    return reduced;
}

/**
 * Check if ordering is reflexive, antisymmetric, transitive
 */
function isPartialOrder(
    elements: string[],
    ordering: OrderingPair[]
): boolean {
    const pairs = new Set(ordering.map(p => `${p.lower}:${p.upper}`));

    // Reflexivity: ∀x. x ≤ x
    for (const e of elements) {
        if (!pairs.has(`${e}:${e}`)) {
            return false;
        }
    }

    // Antisymmetry: x ≤ y ∧ y ≤ x → x = y
    for (const p of ordering) {
        if (p.lower !== p.upper && pairs.has(`${p.upper}:${p.lower}`)) {
            return false;
        }
    }

    // Transitivity: x ≤ y ∧ y ≤ z → x ≤ z
    for (const p1 of ordering) {
        for (const p2 of ordering) {
            if (p1.upper === p2.lower) {
                if (!pairs.has(`${p1.lower}:${p2.upper}`)) {
                    return false;
                }
            }
        }
    }

    return true;
}

/**
 * Find all chains (totally ordered subsets)
 */
function findChains(
    elements: string[],
    ordering: OrderingPair[]
): string[][] {
    const adj = buildAdjacencyList(elements, ordering);
    const chains: string[][] = [];

    // Find maximal chains using DFS
    function dfs(current: string, chain: string[]): void {
        const successors = adj.get(current) || new Set();
        let isMaximal = true;

        for (const next of successors) {
            if (next !== current) {
                isMaximal = false;
                dfs(next, [...chain, next]);
            }
        }

        if (isMaximal && chain.length > 0) {
            chains.push(chain);
        }
    }

    // Start from minimal elements
    const hasLower = new Set(ordering.filter(p => p.lower !== p.upper).map(p => p.upper));
    const minimals = elements.filter(e => !hasLower.has(e));

    for (const min of minimals) {
        dfs(min, [min]);
    }

    return chains;
}

/**
 * Find all antichains (pairwise incomparable subsets)
 */
function findAntichains(
    elements: string[],
    ordering: OrderingPair[]
): string[][] {
    const comparable = new Set<string>();

    for (const p of ordering) {
        if (p.lower !== p.upper) {
            comparable.add(`${p.lower}:${p.upper}`);
            comparable.add(`${p.upper}:${p.lower}`);
        }
    }

    function areIncomparable(a: string, b: string): boolean {
        return !comparable.has(`${a}:${b}`);
    }

    // Find maximal antichains using Dilworth-style enumeration
    const antichains: string[][] = [];

    function backtrack(index: number, current: string[]): void {
        if (index === elements.length) {
            if (current.length > 0) {
                // Check if maximal
                const remaining = elements.filter(
                    e => !current.includes(e) && current.every(c => areIncomparable(c, e))
                );
                if (remaining.length === 0) {
                    antichains.push([...current]);
                }
            }
            return;
        }

        const elem = elements[index]!;
        const canAdd = current.every(c => areIncomparable(c, elem));

        if (canAdd) {
            current.push(elem);
            backtrack(index + 1, current);
            current.pop();
        }

        backtrack(index + 1, current);
    }

    backtrack(0, []);
    return antichains;
}

/**
 * Compute least upper bound (join) of a set
 */
function computeLUB(
    elements: string[],
    ordering: OrderingPair[],
    subset: string[]
): string | null {
    const pairs = new Set(ordering.map(p => `${p.lower}:${p.upper}`));

    // Find all upper bounds
    const upperBounds = elements.filter(e =>
        subset.every(s => pairs.has(`${s}:${e}`))
    );

    if (upperBounds.length === 0) return null;

    // Find least among upper bounds
    for (const ub of upperBounds) {
        const isLeast = upperBounds.every(
            other => ub === other || pairs.has(`${ub}:${other}`)
        );
        if (isLeast) return ub;
    }

    return null;
}

/**
 * Compute greatest lower bound (meet) of a set
 */
function computeGLB(
    elements: string[],
    ordering: OrderingPair[],
    subset: string[]
): string | null {
    const pairs = new Set(ordering.map(p => `${p.lower}:${p.upper}`));

    // Find all lower bounds
    const lowerBounds = elements.filter(e =>
        subset.every(s => pairs.has(`${e}:${s}`))
    );

    if (lowerBounds.length === 0) return null;

    // Find greatest among lower bounds
    for (const lb of lowerBounds) {
        const isGreatest = lowerBounds.every(
            other => lb === other || pairs.has(`${other}:${lb}`)
        );
        if (isGreatest) return lb;
    }

    return null;
}

/**
 * Build Hasse diagram from lattice structure
 */
function buildHasseDiagram(
    elements: string[],
    ordering: OrderingPair[]
): HasseDiagram {
    const reduced = transitiveReduction(elements, ordering);

    // Compute levels (topological sort)
    const inDegree = new Map(elements.map(e => [e, 0]));
    const adj = buildAdjacencyList(elements, reduced);

    for (const { upper } of reduced) {
        inDegree.set(upper, (inDegree.get(upper) || 0) + 1);
    }

    const levels = new Map<string, number>();
    const queue = elements.filter(e => inDegree.get(e) === 0);

    for (const e of queue) {
        levels.set(e, 0);
    }

    let idx = 0;
    while (idx < queue.length) {
        const current = queue[idx++]!;
        const currentLevel = levels.get(current) || 0;

        for (const next of adj.get(current) || []) {
            const remaining = (inDegree.get(next) || 1) - 1;
            inDegree.set(next, remaining);

            const nextLevel = Math.max(levels.get(next) || 0, currentLevel + 1);
            levels.set(next, nextLevel);

            if (remaining === 0) {
                queue.push(next);
            }
        }
    }

    return {
        nodes: elements.map(e => ({
            id: e,
            label: e,
            level: levels.get(e) || 0,
        })),
        edges: reduced
            .filter(p => p.lower !== p.upper)
            .map(p => ({ from: p.lower, to: p.upper })),
    };
}

// ============================================================================
// Tool Implementations
// ============================================================================

/**
 * Analyze a lattice for Complete Partial Order (CPO) properties
 */
async function analyzeCPO(
    lattice: LatticeStructure
): Promise<CPOAnalysisResult> {
    const elements = lattice.elements.map(e => e.id);
    const ordering = lattice.ordering;

    // Check partial order
    const isPO = isPartialOrder(elements, ordering);

    // Find bottom element
    const bottom = elements.find(e =>
        elements.every(other =>
            ordering.some(p => p.lower === e && p.upper === other)
        )
    );

    // Find top element
    const top = elements.find(e =>
        elements.every(other =>
            ordering.some(p => p.lower === other && p.upper === e)
        )
    );

    // Find all chains
    const chains = findChains(elements, ordering);

    // Check chain completeness (every chain has LUB)
    let chainComplete = true;
    const directedSets: string[][] = [];

    for (const chain of chains) {
        const lub = computeLUB(elements, ordering, chain);
        if (!lub) {
            chainComplete = false;
        } else {
            directedSets.push(chain);
        }
    }

    // Check if complete lattice (every subset has LUB and GLB)
    let isCompleteLattice = isPO && !!bottom && !!top;
    if (isCompleteLattice) {
        // Sample check: verify binary joins/meets exist
        for (let i = 0; i < elements.length && isCompleteLattice; i++) {
            for (let j = i + 1; j < elements.length && isCompleteLattice; j++) {
                const pair = [elements[i]!, elements[j]!];
                if (!computeLUB(elements, ordering, pair) || !computeGLB(elements, ordering, pair)) {
                    isCompleteLattice = false;
                }
            }
        }
    }

    // CPO = partial order + bottom + directed-complete
    const isCPO = isPO && !!bottom && chainComplete;

    // Find antichains
    const antichains = findAntichains(elements, ordering);

    // Build Hasse diagram
    const hasseDiagram = buildHasseDiagram(elements, ordering);

    return {
        isPartialOrder: isPO,
        isChainComplete: chainComplete,
        isCompleteLattice,
        isCPO,
        ...(bottom ? { bottom } : {}),
        ...(top ? { top } : {}),
        directedSets,
        lubsExist: chainComplete,
        hasseDiagram,
        chains,
        antichains,
    };
}

/**
 * Construct Scott domain for lazy evaluation semantics
 */
async function constructScottDomain(
    lattice: LatticeStructure
): Promise<ScottDomainResult> {
    const elements = lattice.elements.map(e => e.id);
    const ordering = lattice.ordering;
    const pairs = new Set(ordering.map(p => `${p.lower}:${p.upper}`));

    // First check CPO
    const cpoResult = await analyzeCPO(lattice);

    if (!cpoResult.isCPO) {
        return {
            isCPO: false,
            isAlgebraic: false,
            isScottDomain: false,
            compactElements: [],
            basis: [],
            approximationOrder: {},
            scottTopology: { openSets: [], basicOpenSets: [] },
        };
    }

    // Identify compact (finite) elements
    // An element k is compact if: k ⊑ ⊔D implies k ⊑ d for some d ∈ D
    const compactElements: string[] = [];

    for (const k of elements) {
        let isCompact = true;

        // Check against all directed sets
        for (const chain of cpoResult.chains) {
            const lub = computeLUB(elements, ordering, chain);
            if (lub && pairs.has(`${k}:${lub}`)) {
                // k ⊑ ⊔D, check if k ⊑ d for some d in chain
                const approximated = chain.some(d => pairs.has(`${k}:${d}`));
                if (!approximated) {
                    isCompact = false;
                    break;
                }
            }
        }

        if (isCompact) {
            compactElements.push(k);
        }
    }

    // Check algebraicity: every element is sup of compact elements below it
    let isAlgebraic = true;
    const approximationOrder: Record<string, string[]> = {};

    for (const e of elements) {
        const compactBelow = compactElements.filter(k => pairs.has(`${k}:${e}`));
        approximationOrder[e] = compactBelow;

        const lub = computeLUB(elements, ordering, compactBelow);
        if (lub !== e) {
            isAlgebraic = false;
        }
    }

    // Scott topology: open sets are upward-closed and inaccessible by directed limits
    const scottOpenSets: string[][] = [];
    const basicOpenSets: string[][] = [];

    // Basic open sets: ↑k for compact k
    for (const k of compactElements) {
        const upSet = elements.filter(e => pairs.has(`${k}:${e}`));
        basicOpenSets.push(upSet);
    }

    // Generate some Scott-open sets (unions of basic opens)
    scottOpenSets.push(...basicOpenSets);

    // Is Scott domain: algebraic CPO with countable basis
    const isScottDomain = cpoResult.isCPO && isAlgebraic;

    return {
        isCPO: true,
        isAlgebraic,
        isScottDomain,
        compactElements,
        basis: compactElements,  // For Scott domains, basis = compact elements
        approximationOrder,
        scottTopology: {
            openSets: scottOpenSets,
            basicOpenSets,
        },
    };
}

/**
 * Analyze Galois connection between concrete and abstract domains
 */
async function analyzeGaloisConnection(
    concrete: LatticeStructure,
    abstract: LatticeStructure,
    alpha: Record<string, string>,  // Abstraction: C → A
    gamma: Record<string, string>   // Concretization: A → C
): Promise<GaloisConnectionResult> {
    const concreteElements = concrete.elements.map(e => e.id);
    const abstractElements = abstract.elements.map(e => e.id);
    const concretePairs = new Set(concrete.ordering.map(p => `${p.lower}:${p.upper}`));
    const abstractPairs = new Set(abstract.ordering.map(p => `${p.lower}:${p.upper}`));

    // Verify Galois connection: α(c) ⊑_A a ⟺ c ⊑_C γ(a)
    const soundnessProof: Array<{ concrete: string; abstract: string; holds: boolean }> = [];
    let isGaloisConnection = true;

    for (const c of concreteElements) {
        for (const a of abstractElements) {
            const alphaC = alpha[c];
            const gammaA = gamma[a];

            if (!alphaC || !gammaA) {
                isGaloisConnection = false;
                soundnessProof.push({ concrete: c, abstract: a, holds: false });
                continue;
            }

            const leftSide = abstractPairs.has(`${alphaC}:${a}`);
            const rightSide = concretePairs.has(`${c}:${gammaA}`);

            const holds = leftSide === rightSide;
            soundnessProof.push({ concrete: c, abstract: a, holds });

            if (!holds) {
                isGaloisConnection = false;
            }
        }
    }

    // Check for Galois insertion: γ ∘ α = id (abstraction is exact)
    let isGaloisInsertion = isGaloisConnection;
    if (isGaloisConnection) {
        for (const c of concreteElements) {
            const alphaC = alpha[c];
            const gammaAlphaC = alphaC ? gamma[alphaC] : undefined;
            if (gammaAlphaC !== c) {
                isGaloisInsertion = false;
                break;
            }
        }
    }

    // Compute closure operator: γ ∘ α
    const closureOperator: Record<string, string> = {};
    for (const c of concreteElements) {
        const alphaC = alpha[c];
        closureOperator[c] = alphaC ? (gamma[alphaC] || c) : c;
    }

    // Find fixed points of closure operator
    const fixedPoints = concreteElements.filter(c => closureOperator[c] === c);

    return {
        isGaloisConnection,
        isGaloisInsertion,
        alpha,
        gamma,
        closureOperator,
        fixedPoints,
        soundnessProof: { forAll: soundnessProof },
    };
}

/**
 * Compute fixpoint using Kleene or Tarski iteration
 */
async function computeFixpoint(
    lattice: LatticeStructure,
    monotoneFunction: Record<string, string>,
    algorithm: 'kleene' | 'tarski' | 'worklist' = 'kleene'
): Promise<FixpointResult> {
    const elements = lattice.elements.map(e => e.id);
    const ordering = lattice.ordering;
    const pairs = new Set(ordering.map(p => `${p.lower}:${p.upper}`));

    // Find bottom element
    const bottom = elements.find(e =>
        elements.every(other => pairs.has(`${e}:${other}`))
    ) || elements[0];

    // Find top element
    const top = elements.find(e =>
        elements.every(other => pairs.has(`${other}:${e}`))
    ) || elements[elements.length - 1];

    const trace: Array<{ iteration: number; value: string; stable: boolean }> = [];
    let current: string;
    let iterations = 0;
    const maxIterations = elements.length * 2;

    if (algorithm === 'kleene' || algorithm === 'worklist') {
        // Kleene iteration: start from bottom, apply f until fixpoint
        current = bottom!;

        while (iterations < maxIterations) {
            iterations++;
            const next = monotoneFunction[current] || current;
            const stable = next === current;

            trace.push({ iteration: iterations, value: current, stable });

            if (stable) break;
            current = next;
        }
    } else {
        // Tarski iteration: start from top, descend
        current = top!;

        while (iterations < maxIterations) {
            iterations++;
            const next = monotoneFunction[current] || current;
            const stable = next === current;

            trace.push({ iteration: iterations, value: current, stable });

            if (stable) break;
            current = next;
        }
    }

    // Check if least/greatest fixpoint
    const isLeast = algorithm === 'kleene' &&
        elements.every(e => {
            if (monotoneFunction[e] === e) {
                return pairs.has(`${current}:${e}`);
            }
            return true;
        });

    const isGreatest = algorithm === 'tarski' &&
        elements.every(e => {
            if (monotoneFunction[e] === e) {
                return pairs.has(`${e}:${current}`);
            }
            return true;
        });

    // Convergence rate (iterations / elements)
    const convergenceRate = iterations / elements.length;

    return {
        algorithm,
        iterations,
        fixpoint: current,
        trace,
        isLeastFixpoint: isLeast,
        isGreatestFixpoint: isGreatest,
        convergenceRate,
    };
}

// ============================================================================
// Tool Registration
// ============================================================================

const LatticeElementSchema = z.object({
    id: z.string().describe('Unique identifier for the element'),
    label: z.string().optional().describe('Human-readable label'),
    metadata: z.record(z.unknown()).optional().describe('Additional metadata'),
});

const OrderingPairSchema = z.object({
    lower: z.string().describe('Lower element in the ordering'),
    upper: z.string().describe('Upper element in the ordering'),
});

const LatticeStructureSchema = z.object({
    elements: z.array(LatticeElementSchema).describe('Elements of the lattice'),
    ordering: z.array(OrderingPairSchema).describe('Ordering relations (lower ≤ upper)'),
});

export function registerLatticeTheoryTools(server: McpServer): void {
    const store = getEventStore();
    const cache = getL1Cache();

    // -------------------------------------------------------------------------
    // Tool: lattice_cpo_analysis
    // -------------------------------------------------------------------------
    server.tool(
        'lattice_cpo_analysis',
        'Analyze a lattice structure for Complete Partial Order (CPO) properties. ' +
        'Determines if the structure is a partial order, chain-complete, or complete lattice. ' +
        'Generates Hasse diagram and identifies chains/antichains.',
        {
            lattice: LatticeStructureSchema.describe('The lattice structure to analyze'),
        },
        async ({ lattice }) => {
            const entity = createEntity(EntityType.TASK);
            const entityId = serializeEntity(entity);

            // Cache key based on lattice structure
            const cacheKey = `cpo:${JSON.stringify(lattice)}`;
            const cached = cache.get<CPOAnalysisResult>(cacheKey);
            if (cached) {
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ ...cached, fromCache: true }, null, 2),
                    }],
                };
            }

            const result = await analyzeCPO(lattice as any as LatticeStructure);

            cache.set(cacheKey, result, 3600000); // 1 hour TTL

            store.append(
                entityId,
                'lattice.cpo.analyzed',
                {
                    elementCount: lattice.elements.length,
                    isCPO: result.isCPO,
                    isCompleteLattice: result.isCompleteLattice,
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
    // Tool: lattice_scott_domains
    // -------------------------------------------------------------------------
    server.tool(
        'lattice_scott_domains',
        'Construct Scott domain for lazy evaluation semantics. ' +
        'Identifies compact elements, builds algebraic basis, and computes Scott topology. ' +
        'Essential for denotational semantics of lazy functional languages.',
        {
            lattice: LatticeStructureSchema.describe('The lattice structure to analyze'),
        },
        async ({ lattice }) => {
            const entity = createEntity(EntityType.TASK);
            const entityId = serializeEntity(entity);

            const cacheKey = `scott:${JSON.stringify(lattice)}`;
            const cached = cache.get<ScottDomainResult>(cacheKey);
            if (cached) {
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ ...cached, fromCache: true }, null, 2),
                    }],
                };
            }

            const result = await constructScottDomain(lattice as any as LatticeStructure);

            cache.set(cacheKey, result, 3600000);

            store.append(
                entityId,
                'lattice.scott.constructed',
                {
                    elementCount: lattice.elements.length,
                    isScottDomain: result.isScottDomain,
                    compactCount: result.compactElements.length,
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
    // Tool: lattice_galois_connection
    // -------------------------------------------------------------------------
    server.tool(
        'lattice_galois_connection',
        'Analyze Galois connection between concrete and abstract domains. ' +
        'Verifies soundness of abstraction, computes closure operators, and identifies fixed points. ' +
        'Foundation for abstract interpretation in program analysis.',
        {
            concrete: LatticeStructureSchema.describe('Concrete domain lattice'),
            abstract: LatticeStructureSchema.describe('Abstract domain lattice'),
            alpha: z.record(z.string()).describe('Abstraction function mapping (concrete → abstract)'),
            gamma: z.record(z.string()).describe('Concretization function mapping (abstract → concrete)'),
        },
        async ({ concrete, abstract, alpha, gamma }) => {
            const entity = createEntity(EntityType.TASK);
            const entityId = serializeEntity(entity);

            const result = await analyzeGaloisConnection(
                concrete as any as LatticeStructure,
                abstract as any as LatticeStructure,
                alpha,
                gamma
            );

            store.append(
                entityId,
                'lattice.galois.analyzed',
                {
                    concreteSize: concrete.elements.length,
                    abstractSize: abstract.elements.length,
                    isGaloisConnection: result.isGaloisConnection,
                    isGaloisInsertion: result.isGaloisInsertion,
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
    // Tool: lattice_fixpoint
    // -------------------------------------------------------------------------
    server.tool(
        'lattice_fixpoint',
        'Compute fixpoint of a monotone function using Kleene or Tarski iteration. ' +
        'Traces iteration sequence and verifies least/greatest fixpoint properties. ' +
        'Used for dataflow analysis, type inference, and abstract interpretation.',
        {
            lattice: LatticeStructureSchema.describe('The lattice structure'),
            monotoneFunction: z.record(z.string()).describe('Monotone function as element → element mapping'),
            algorithm: z.enum(['kleene', 'tarski', 'worklist']).optional()
                .describe('Iteration algorithm (default: kleene)'),
        },
        async ({ lattice, monotoneFunction, algorithm }) => {
            const entity = createEntity(EntityType.TASK);
            const entityId = serializeEntity(entity);

            const result = await computeFixpoint(
                lattice as any as LatticeStructure,
                monotoneFunction,
                algorithm || 'kleene'
            );

            store.append(
                entityId,
                'lattice.fixpoint.computed',
                {
                    algorithm: result.algorithm,
                    iterations: result.iterations,
                    fixpoint: result.fixpoint,
                    convergenceRate: result.convergenceRate,
                }
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

export default { registerLatticeTheoryTools };

