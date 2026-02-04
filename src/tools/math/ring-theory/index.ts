/**
 * Ring Theory Module
 * 
 * Implements ring-theoretic algorithms for program analysis:
 * - Polynomial hash functions over Z/nZ
 * - Ideal theory for module dependency resolution
 * - Chinese Remainder Theorem for distributed algorithms
 * 
 * @module tools/math/ring-theory
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createEntity, EntityType, serializeEntity } from '../../../ecs/entities.js';
import { getEventStore } from '../../../durability/event-store.js';
import { getL1Cache } from '../../../cache/l1-cache.js';

// ============================================================================
// Types & Interfaces
// ============================================================================

interface Polynomial {
    coefficients: bigint[];  // coefficients[i] = coefficient of x^i
    modulus?: bigint;        // For polynomial rings over Z/nZ
}

interface PolynomialHashResult {
    hashFunction: {
        polynomial: string;
        modulus: bigint;
        base: bigint;
    };
    collisionResistance: 'weak' | 'moderate' | 'strong';
    distributionAnalysis: {
        uniformity: number;      // 0-1
        avalanche: number;       // Bit flip propagation
        periodEstimate?: bigint;
    };
    hashValue: bigint;
    recommendations: string[];
}

interface ModuleDependency {
    name: string;
    version: string;
    dependencies: string[];
}

interface IdealResolutionResult {
    resolved: boolean;
    resolutionOrder: string[];
    cycles: string[][];
    idealStructure: {
        generators: string[];
        quotientDimension: number;
        primaryDecomposition: string[][];
    };
    conflicts: Array<{
        modules: string[];
        type: 'version' | 'circular' | 'missing';
    }>;
    grobnerBasis?: string[];
}

interface CRTInput {
    remainders: bigint[];
    moduli: bigint[];
}

interface CRTResult {
    solution: bigint;
    modulus: bigint;              // Product of coprime moduli
    exists: boolean;
    coprime: boolean;
    steps: Array<{
        partialSolution: bigint;
        partialModulus: bigint;
    }>;
    applications: {
        parallelComputation: boolean;
        secretSharing: boolean;
        errorCorrection: boolean;
    };
}

// ============================================================================
// Arithmetic Helpers
// ============================================================================

/**
 * Greatest common divisor
 */
function gcd(a: bigint, b: bigint): bigint {
    a = a < 0n ? -a : a;
    b = b < 0n ? -b : b;
    while (b !== 0n) {
        const t = b;
        b = a % b;
        a = t;
    }
    return a;
}

/**
 * Extended Euclidean algorithm
 * Returns [gcd, x, y] such that ax + by = gcd(a, b)
 */
function extendedGcd(a: bigint, b: bigint): [bigint, bigint, bigint] {
    if (b === 0n) {
        return [a, 1n, 0n];
    }
    const [g, x, y] = extendedGcd(b, a % b);
    return [g, y, x - (a / b) * y];
}

/**
 * Modular inverse using extended Euclidean algorithm
 */
function modInverse(a: bigint, m: bigint): bigint | null {
    const [g, x] = extendedGcd(a, m);
    if (g !== 1n) return null;
    return ((x % m) + m) % m;
}

/**
 * Modular exponentiation
 */
function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
    let result = 1n;
    base = ((base % mod) + mod) % mod;

    while (exp > 0n) {
        if (exp % 2n === 1n) {
            result = (result * base) % mod;
        }
        exp = exp / 2n;
        base = (base * base) % mod;
    }

    return result;
}

/**
 * Check if n is probably prime (Miller-Rabin)
 */
function isProbablePrime(n: bigint, k: number = 10): boolean {
    if (n < 2n) return false;
    if (n === 2n || n === 3n) return true;
    if (n % 2n === 0n) return false;

    // Write n-1 as 2^r * d
    let d = n - 1n;
    let r = 0n;
    while (d % 2n === 0n) {
        d = d / 2n;
        r++;
    }

    // Witness loop
    const witnesses = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];

    for (let i = 0; i < Math.min(k, witnesses.length); i++) {
        const a = witnesses[i]!;
        if (a >= n) continue;

        let x = modPow(a, d, n);

        if (x === 1n || x === n - 1n) continue;

        let composite = true;
        for (let j = 0n; j < r - 1n; j++) {
            x = (x * x) % n;
            if (x === n - 1n) {
                composite = false;
                break;
            }
        }

        if (composite) return false;
    }

    return true;
}

// ============================================================================
// Polynomial Operations
// ============================================================================

/**
 * Evaluate polynomial at a point
 */
function evaluatePolynomial(poly: Polynomial, x: bigint): bigint {
    let result = 0n;
    let power = 1n;
    const mod = poly.modulus || 0n;

    for (const coeff of poly.coefficients) {
        const term = coeff * power;
        result = mod > 0n ? (result + term) % mod : result + term;
        power = mod > 0n ? (power * x) % mod : power * x;
    }

    return result;
}

/**
 * Polynomial multiplication in Z/nZ[x]
 */
function multiplyPolynomials(p1: Polynomial, p2: Polynomial, mod?: bigint): Polynomial {
    const n = p1.coefficients.length;
    const m = p2.coefficients.length;
    const result = new Array(n + m - 1).fill(0n);

    for (let i = 0; i < n; i++) {
        for (let j = 0; j < m; j++) {
            const product = p1.coefficients[i]! * p2.coefficients[j]!;
            if (mod !== undefined) {
                result[i + j] = (result[i + j] + product) % mod;
            } else {
                result[i + j] = result[i + j] + product;
            }
        }
    }

    return { coefficients: result, ...(mod !== undefined ? { modulus: mod } : {}) };
}

/**
 * Generate polynomial hash function
 */
function generatePolynomialHash(
    data: string,
    base: bigint,
    modulus: bigint
): PolynomialHashResult {
    // Convert string to coefficients
    const coefficients = Array.from(data).map(c => BigInt(c.charCodeAt(0)));
    const poly: Polynomial = { coefficients, modulus };

    // Compute hash value
    const hashValue = evaluatePolynomial(poly, base);

    // Analyze collision resistance
    const modulusBits = modulus.toString(2).length;
    let collisionResistance: 'weak' | 'moderate' | 'strong';

    if (modulusBits < 32) {
        collisionResistance = 'weak';
    } else if (modulusBits < 64) {
        collisionResistance = 'moderate';
    } else {
        collisionResistance = 'strong';
    }

    // Estimate uniformity (simplified)
    const uniformity = isProbablePrime(modulus) ? 0.95 : 0.8;

    // Estimate avalanche effect
    const avalanche = base > 256n ? 0.9 : 0.7;

    // Recommendations
    const recommendations: string[] = [];

    if (!isProbablePrime(modulus)) {
        recommendations.push('Use a prime modulus for better uniformity');
    }
    if (base < 256n) {
        recommendations.push('Use a larger base for better avalanche effect');
    }
    if (modulusBits < 64) {
        recommendations.push('Consider 64+ bit modulus for cryptographic applications');
    }

    return {
        hashFunction: {
            polynomial: `Σ c_i * ${base}^i mod ${modulus}`,
            modulus,
            base,
        },
        collisionResistance,
        distributionAnalysis: {
            uniformity,
            avalanche,
            periodEstimate: modulus,
        },
        hashValue,
        recommendations,
    };
}

// ============================================================================
// Ideal Theory for Dependencies
// ============================================================================

/**
 * Tarjan's algorithm for strongly connected components
 */
function findSCCs(modules: ModuleDependency[]): string[][] {
    const graph = new Map<string, string[]>();
    const nodeIndex = new Map<string, number>();
    const lowLink = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const sccs: string[][] = [];
    let index = 0;

    for (const mod of modules) {
        graph.set(mod.name, mod.dependencies);
    }

    function strongConnect(node: string): void {
        nodeIndex.set(node, index);
        lowLink.set(node, index);
        index++;
        stack.push(node);
        onStack.add(node);

        const neighbors = graph.get(node) || [];
        for (const neighbor of neighbors) {
            if (!nodeIndex.has(neighbor)) {
                strongConnect(neighbor);
                lowLink.set(node, Math.min(lowLink.get(node)!, lowLink.get(neighbor)!));
            } else if (onStack.has(neighbor)) {
                lowLink.set(node, Math.min(lowLink.get(node)!, nodeIndex.get(neighbor)!));
            }
        }

        // Root of SCC
        if (lowLink.get(node) === nodeIndex.get(node)) {
            const scc: string[] = [];
            let w: string;
            do {
                w = stack.pop()!;
                onStack.delete(w);
                scc.push(w);
            } while (w !== node);

            if (scc.length > 1) {
                sccs.push(scc);
            }
        }
    }

    for (const mod of modules) {
        if (!nodeIndex.has(mod.name)) {
            strongConnect(mod.name);
        }
    }

    return sccs;
}

/**
 * Topological sort for dependency resolution
 */
function topologicalSort(modules: ModuleDependency[]): string[] | null {
    const inDegree = new Map<string, number>();
    const graph = new Map<string, string[]>();

    // Initialize
    for (const mod of modules) {
        inDegree.set(mod.name, 0);
        graph.set(mod.name, []);
    }

    // Build graph
    for (const mod of modules) {
        for (const dep of mod.dependencies) {
            graph.get(dep)?.push(mod.name);
            inDegree.set(mod.name, (inDegree.get(mod.name) || 0) + 1);
        }
    }

    // Process nodes with no incoming edges
    const queue = Array.from(inDegree.entries())
        .filter(([_, deg]) => deg === 0)
        .map(([name]) => name);

    const result: string[] = [];

    while (queue.length > 0) {
        const node = queue.shift()!;
        result.push(node);

        for (const neighbor of graph.get(node) || []) {
            const newDegree = (inDegree.get(neighbor) || 1) - 1;
            inDegree.set(neighbor, newDegree);
            if (newDegree === 0) {
                queue.push(neighbor);
            }
        }
    }

    return result.length === modules.length ? result : null;
}

/**
 * Resolve module dependencies using ideal-theoretic approach
 */
function resolveDependencies(modules: ModuleDependency[]): IdealResolutionResult {
    const cycles = findSCCs(modules);
    const hasCycles = cycles.length > 0;

    let resolutionOrder = topologicalSort(modules);
    const resolved = resolutionOrder !== null;

    if (!resolved) {
        resolutionOrder = modules.map(m => m.name);
    }

    // Analyze ideal structure
    const allDeps = new Set<string>();
    for (const mod of modules) {
        for (const dep of mod.dependencies) {
            allDeps.add(dep);
        }
    }

    const generators = Array.from(allDeps).filter(
        dep => !modules.some(m => m.name === dep)
    );

    // Find conflicts
    const conflicts: IdealResolutionResult['conflicts'] = [];

    if (hasCycles) {
        for (const cycle of cycles) {
            conflicts.push({
                modules: cycle,
                type: 'circular',
            });
        }
    }

    // Check for missing dependencies
    const moduleNames = new Set(modules.map(m => m.name));
    for (const gen of generators) {
        conflicts.push({
            modules: [gen],
            type: 'missing',
        });
    }

    // Primary decomposition (simplified: partition by SCC)
    const primaryDecomposition = cycles.length > 0
        ? cycles
        : [modules.map(m => m.name)];

    return {
        resolved,
        resolutionOrder: resolutionOrder || [],
        cycles,
        idealStructure: {
            generators,
            quotientDimension: modules.length - cycles.flat().length,
            primaryDecomposition,
        },
        conflicts,
        ...(resolved ? { grobnerBasis: resolutionOrder as string[] } : {}),
    };
}

// ============================================================================
// Chinese Remainder Theorem
// ============================================================================

/**
 * Solve system of congruences using CRT
 */
function chineseRemainderTheorem(input: CRTInput): CRTResult {
    const { remainders, moduli } = input;
    const n = remainders.length;

    if (n === 0) {
        return {
            solution: 0n,
            modulus: 1n,
            exists: true,
            coprime: true,
            steps: [],
            applications: {
                parallelComputation: true,
                secretSharing: true,
                errorCorrection: true,
            },
        };
    }

    // Check pairwise coprimality
    let coprime = true;
    for (let i = 0; i < n && coprime; i++) {
        for (let j = i + 1; j < n && coprime; j++) {
            if (gcd(moduli[i]!, moduli[j]!) !== 1n) {
                coprime = false;
            }
        }
    }

    const steps: CRTResult['steps'] = [];

    // Iterative CRT
    let solution = remainders[0]!;
    let modulus = moduli[0]!;

    steps.push({ partialSolution: solution, partialModulus: modulus });

    for (let i = 1; i < n; i++) {
        const r = remainders[i]!;
        const m = moduli[i]!;

        // Find solution to: x ≡ solution (mod modulus), x ≡ r (mod m)
        const g = gcd(modulus, m);

        // Check existence
        if ((r - solution) % g !== 0n) {
            return {
                solution: 0n,
                modulus: 0n,
                exists: false,
                coprime,
                steps,
                applications: {
                    parallelComputation: false,
                    secretSharing: false,
                    errorCorrection: false,
                },
            };
        }

        const newModulus = (modulus * m) / g;
        const inv = modInverse(modulus / g, m / g);

        if (inv === null) {
            return {
                solution: 0n,
                modulus: 0n,
                exists: false,
                coprime,
                steps,
                applications: {
                    parallelComputation: false,
                    secretSharing: false,
                    errorCorrection: false,
                },
            };
        }

        solution = solution + modulus * inv * ((r - solution) / g);
        solution = ((solution % newModulus) + newModulus) % newModulus;
        modulus = newModulus;

        steps.push({ partialSolution: solution, partialModulus: modulus });
    }

    return {
        solution,
        modulus,
        exists: true,
        coprime,
        steps,
        applications: {
            parallelComputation: coprime,
            secretSharing: coprime && n >= 3,
            errorCorrection: coprime,
        },
    };
}

// ============================================================================
// Tool Registration
// ============================================================================

const ModuleDependencySchema = z.object({
    name: z.string(),
    version: z.string(),
    dependencies: z.array(z.string()),
});

export function registerRingTheoryTools(server: McpServer): void {
    const store = getEventStore();
    const cache = getL1Cache();

    // -------------------------------------------------------------------------
    // Tool: ring_polynomial_hash
    // -------------------------------------------------------------------------
    server.tool(
        'ring_polynomial_hash',
        'Generate polynomial hash function over Z/nZ. ' +
        'Analyzes collision resistance, uniformity, and avalanche effect.',
        {
            data: z.string().describe('Data to hash'),
            base: z.string().describe('Base for polynomial evaluation (as decimal string)'),
            modulus: z.string().describe('Modulus for ring Z/nZ (as decimal string)'),
        },
        async ({ data, base, modulus }) => {
            const entity = createEntity(EntityType.TASK);
            const entityId = serializeEntity(entity);

            const result = generatePolynomialHash(
                data,
                BigInt(base),
                BigInt(modulus)
            );

            // Convert bigints to strings for JSON serialization
            const jsonResult = {
                ...result,
                hashFunction: {
                    ...result.hashFunction,
                    modulus: result.hashFunction.modulus.toString(),
                    base: result.hashFunction.base.toString(),
                },
                hashValue: result.hashValue.toString(),
                distributionAnalysis: {
                    ...result.distributionAnalysis,
                    periodEstimate: result.distributionAnalysis.periodEstimate?.toString(),
                },
            };

            store.append(
                entityId,
                'ring.polynomial.hashed',
                {
                    dataLength: data.length,
                    collisionResistance: result.collisionResistance,
                },
                Date.now()
            );

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify(jsonResult, null, 2),
                }],
            };
        }
    );

    // -------------------------------------------------------------------------
    // Tool: ring_ideal_resolution
    // -------------------------------------------------------------------------
    server.tool(
        'ring_ideal_resolution',
        'Resolve module dependencies using ideal-theoretic approach. ' +
        'Detects cycles, computes resolution order, and identifies conflicts.',
        {
            modules: z.array(ModuleDependencySchema).describe('Modules with dependencies'),
        },
        async ({ modules }) => {
            const entity = createEntity(EntityType.TASK);
            const entityId = serializeEntity(entity);

            const cacheKey = `ideal:${JSON.stringify(modules.map(m => m.name))}`;
            const cached = cache.get<IdealResolutionResult>(cacheKey);
            if (cached) {
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ ...cached, fromCache: true }, null, 2),
                    }],
                };
            }

            const result = resolveDependencies(modules);

            cache.set(cacheKey, result, 3600000);

            store.append(
                entityId,
                'ring.ideal.resolved',
                {
                    moduleCount: modules.length,
                    resolved: result.resolved,
                    cycleCount: result.cycles.length,
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
    // Tool: ring_crt_consensus
    // -------------------------------------------------------------------------
    server.tool(
        'ring_crt_consensus',
        'Solve system of congruences using Chinese Remainder Theorem. ' +
        'Used for distributed consensus, secret sharing, and parallel computation.',
        {
            remainders: z.array(z.string()).describe('Remainders (as decimal strings)'),
            moduli: z.array(z.string()).describe('Moduli (as decimal strings)'),
        },
        async ({ remainders, moduli }) => {
            const entity = createEntity(EntityType.TASK);
            const entityId = serializeEntity(entity);

            const result = chineseRemainderTheorem({
                remainders: remainders.map(r => BigInt(r)),
                moduli: moduli.map(m => BigInt(m)),
            });

            // Convert bigints to strings for JSON
            const jsonResult = {
                ...result,
                solution: result.solution.toString(),
                modulus: result.modulus.toString(),
                steps: result.steps.map(s => ({
                    partialSolution: s.partialSolution.toString(),
                    partialModulus: s.partialModulus.toString(),
                })),
            };

            store.append(
                entityId,
                'ring.crt.computed',
                {
                    congruenceCount: remainders.length,
                    exists: result.exists,
                    coprime: result.coprime,
                },
                Date.now()
            );

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify(jsonResult, null, 2),
                }],
            };
        }
    );
}

export default { registerRingTheoryTools };
