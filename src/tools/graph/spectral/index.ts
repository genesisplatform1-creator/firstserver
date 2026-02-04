
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getEventStore } from '../../../durability/event-store.js';

// ============================================================================
// Types & Schemas
// ============================================================================

const AdjacencyMatrixSchema = z.array(z.array(z.number()));

const SpectralInputSchema = z.object({
    adjacencyMatrix: AdjacencyMatrixSchema.describe('Square adjacency matrix. A_ij = weight.'),
    numEigenvalues: z.number().default(2).describe('Number of smallest eigenvalues to return'),
    normalize: z.boolean().default(false).describe('Use Normalized Laplacian'),
});

type SpectralInput = z.infer<typeof SpectralInputSchema>;

interface EigenResult {
    eigenvalues: number[];
    eigenvectors: number[][]; // Rows are eigenvectors
}

// ============================================================================
// Algorithms
// ============================================================================

/**
 * Computes the Laplacian Matrix L = D - A
 * Or Normalized L_sym = I - D^(-1/2) A D^(-1/2)
 */
function computeLaplacian(adj: number[][], normalize: boolean): number[][] {
    const n = adj.length;
    if (n === 0) return [];

    const degree = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            degree[i] += adj[i]?.[j] ?? 0;
        }
    }

    const P = Array.from({ length: n }, () => new Array(n).fill(0));

    if (normalize) {
        // L_sym = I - D^(-1/2) A D^(-1/2)
        // or L_rw = I - D^(-1) A
        // Usually spectral clustering uses L_sym or L_rw. L_sym is symmetric.
        // Element (i, j): 
        // if i==j: 1 - A_ii/d_i (usually A_ii=0 -> 1)
        // if i!=j: - A_ij / sqrt(d_i * d_j)

        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (i === j) {
                    P[i]![j] = 1; // Assuming simple graphs where A_ii = 0. If not, 1 - A_ii/d_i
                    if (degree[i] !== 0 && adj[i]?.[i]) {
                        P[i]![j] = 1 - (adj[i]![i]! / degree[i]);
                    }
                } else {
                    if (degree[i] === 0 || degree[j] === 0) {
                        P[i]![j] = 0;
                    } else {
                        P[i]![j] = -(adj[i]?.[j] ?? 0) / Math.sqrt(degree[i] * degree[j]);
                    }
                }
            }
        }
    } else {
        // L = D - A
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (i === j) {
                    P[i]![j] = degree[i] - (adj[i]?.[j] ?? 0);
                } else {
                    P[i]![j] = -(adj[i]?.[j] ?? 0);
                }
            }
        }
    }
    return P;
}

/**
 * Jacobi Eigenvalue Algorithm for Symmetric Matrices
 * Computes all eigenvalues and eigenvectors.
 * O(n^3) - acceptable for small graphs (n < 100).
 * For larger graphs, we should use Lanczos (not implemented here).
 */
function jacobiEigen(matrix: number[][], maxIter = 100, tol = 1e-9): EigenResult {
    const n = matrix.length;
    if (n === 0) return { eigenvalues: [], eigenvectors: [] };

    // Deep copy matrix A
    const A = matrix.map(row => [...row]);

    // Initialize V as identity matrix
    const V = Array.from({ length: n }, (_, i) => {
        const row = new Array(n).fill(0);
        row[i] = 1;
        return row;
    });

    for (let iter = 0; iter < maxIter; iter++) {
        // Find max off-diagonal element
        let maxVal = 0;
        let p = 0, q = 0;

        for (let i = 0; i < n - 1; i++) {
            for (let j = i + 1; j < n; j++) {
                if (Math.abs(A[i]![j]!) > maxVal) {
                    maxVal = Math.abs(A[i]![j]!);
                    p = i;
                    q = j;
                }
            }
        }

        if (maxVal < tol) break;

        // Calculate rotation parameters
        const App = A[p]![p]!;
        const Aqq = A[q]![q]!;
        const Apq = A[p]![q]!;

        // Correct Jacobi rotation angle for symmetric matrix
        // We want to annihilate A[p][q]
        // theta = 0.5 * atan2(2*Apq, Aqq - App)
        // BUT, we need to be careful with ranges to ensure convergence.
        // Standard formula:
        let theta = 0;
        if (Math.abs(Aqq - App) < tol) {
            theta = Math.PI / 4; // 45 degrees if diagonal elements equal
        } else {
            theta = 0.5 * Math.atan2(2 * Apq, Aqq - App);
        }
        
        // However, standard Jacobi often uses:
        // tau = (Aqq - App) / (2 * Apq)
        // t = sign(tau) / (|tau| + sqrt(1 + tau^2))
        // c = 1 / sqrt(1 + t^2)
        // s = c * t
        // This is more numerically stable. Let's switch to that.
        
        let c = 0, s = 0;
        if (Math.abs(Apq) < tol) {
             // Already zero, shouldn't happen due to maxVal check, but safe guard
             c = 1; s = 0;
        } else {
             const tau = (Aqq - App) / (2 * Apq);
             let t = 0;
             if (tau >= 0) {
                 t = 1 / (tau + Math.sqrt(1 + tau * tau));
             } else {
                 t = -1 / (-tau + Math.sqrt(1 + tau * tau));
             }
             c = 1 / Math.sqrt(1 + t * t);
             s = t * c;
        }

        // Update A (Diagonal elements)
        // A'[p,p] = A[p,p] - t * A[p,q]
        // A'[q,q] = A[q,q] + t * A[p,q]
        // But the previous rotation update logic was simpler to read, albeit potentially less stable.
        // Let's stick to the explicit rotation update but use the calculated stable c, s
        
        // Wait, the previous logic derived c, s from atan2. 
        // Let's stick to the previous update formula but use the stable c, s calculated above.
        // Actually, let's keep the explicit update logic consistent with c/s derivation.
        
        A[p]![p] = c * c * App - 2 * s * c * Apq + s * s * Aqq;
        A[q]![q] = s * s * App + 2 * s * c * Apq + c * c * Aqq;
        A[p]![q] = 0;
        A[q]![p] = 0;

        for (let i = 0; i < n; i++) {
            if (i !== p && i !== q) {
                const Aip = A[i]![p]!;
                const Aiq = A[i]![q]!;
                A[i]![p] = c * Aip - s * Aiq;
                A[p]![i] = A[i]![p]!;
                A[i]![q] = s * Aip + c * Aiq;
                A[q]![i] = A[i]![q]!;
            }
        }

        // Update eigenvectors V
        // V' = V * R(p, q, phi)
        for (let i = 0; i < n; i++) {
            const Vip = V[i]![p]!;
            const Viq = V[i]![q]!;
            V[i]![p] = c * Vip - s * Viq;
            V[i]![q] = s * Vip + c * Viq;
        }
    }

    // Sort eigenvalues and eigenvectors
    const eigen = A.map((_, i) => ({
        val: A[i]![i]!,
        vec: V.map(row => row[i]!) // V columns are eigenvectors
    }));

    eigen.sort((a, b) => a.val - b.val);

    return {
        eigenvalues: eigen.map(e => e.val),
        eigenvectors: eigen.map(e => e.vec) // Returns list of eigenvectors (each is number[])
    };
}

// ============================================================================
// Tool Registration
// ============================================================================

export function registerSpectralTools(server: McpServer): void {
    server.tool(
        'spectral_laplacian',
        'Compute Laplacian matrix and its eigenvalues/vectors.',
        {
            adjacencyMatrix: AdjacencyMatrixSchema,
            normalize: z.boolean().default(false),
            numEigenvalues: z.number().default(Number.MAX_SAFE_INTEGER),
        },
        async ({ adjacencyMatrix, normalize, numEigenvalues }) => {
            const L = computeLaplacian(adjacencyMatrix, normalize);
            const eigen = jacobiEigen(L);

            // Filter top k (smallest k for Laplacian)
            const k = Math.min(numEigenvalues, eigen.eigenvalues.length);

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        eigenvalues: eigen.eigenvalues.slice(0, k),
                        eigenvectors: eigen.eigenvectors.slice(0, k), // Smallest eigenvals -> vectors
                        algebraicConnectivity: eigen.eigenvalues[1] // Fiedler value (lambda 2)
                    }, null, 2)
                }]
            };
        }
    );

    server.tool(
        'spectral_fiedler',
        'Compute Fiedler vector (eigenvector of 2nd smallest eigenvalue) for graph partitioning.',
        {
            adjacencyMatrix: AdjacencyMatrixSchema,
        },
        async ({ adjacencyMatrix }) => {
            const L = computeLaplacian(adjacencyMatrix, false); // Fiedler usually on unnormalized L
            const eigen = jacobiEigen(L);

            // Fiedler vector is eigenvector corresponding to 2nd smallest eigenvalue
            // Since sorted asc: index 1
            const fiedlerValue = eigen.eigenvalues[1];
            // Access the 2nd eigenvector (which is an array of numbers)
            const fiedlerVector = eigen.eigenvectors[1];

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        fiedlerValue,
                        fiedlerVector
                    }, null, 2)
                }]
            };
        }
    );

    server.tool(
        'spectral_community',
        'Perform spectral clustering (bisection) using Fiedler vector (Sign Cut).',
        {
            adjacencyMatrix: AdjacencyMatrixSchema,
            method: z.enum(['sign', 'cheeger']).default('sign'),
        },
        async ({ adjacencyMatrix, method }) => {
            const L = computeLaplacian(adjacencyMatrix, false);
            const eigen = jacobiEigen(L);

            const fiedlerVector = eigen.eigenvectors[1];
            if (!fiedlerVector) {
                return {
                    content: [{ type: 'text', text: "Graph too small or error computing eigenvectors" }]
                };
            }

            // Sign Cut: Partition based on sign of components
            const clusterA: number[] = [];
            const clusterB: number[] = [];

            // fiedlerVector is number[]
            fiedlerVector.forEach((val, idx) => {
                if (val >= 0) clusterA.push(idx);
                else clusterB.push(idx);
            });

            // Calculate conductance/cut size? (Optional)

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        method,
                        clusterA,
                        clusterB,
                        eigenvalues: eigen.eigenvalues.slice(0, 5), // Return top 5 eigenvalues
                        ratio: clusterA.length / (clusterA.length + clusterB.length)
                    }, null, 2)
                }]
            };
        }
    );

    // Cheeger constant tool
    server.tool(
        'spectral_cheeger',
        'Estimate Cheeger constant (isoperimetric number) via spectral gap.',
        {
            adjacencyMatrix: AdjacencyMatrixSchema,
        },
        async ({ adjacencyMatrix }) => {
            const L = computeLaplacian(adjacencyMatrix, true); // Normalized for Cheeger bounds usually
            const eigen = jacobiEigen(L);

            const lambda2 = eigen.eigenvalues[1];

            // Cheeger inequality: lambda2 / 2 <= h(G) <= sqrt(2 * lambda2)
            // We return the bounds.
            if (lambda2 === undefined) {
                return { content: [{ type: 'text', text: "Error" }] };
            }

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        lambda2,
                        lowerBound: lambda2 / 2,
                        upperBound: Math.sqrt(2 * lambda2),
                        explanation: "Cheeger constant h(G) is bounded by Normalized Laplacian spectral gap."
                    }, null, 2)
                }]
            };
        }
    );
}
