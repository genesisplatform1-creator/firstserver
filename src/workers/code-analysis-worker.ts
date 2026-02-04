import { BaseWorker } from './base-worker.js';
import type { ExecuteRequest } from '../types/worker-types.js';
import { parseCode } from '../analysis/parser.js';
import { analyzeCode } from '../analysis/analyzer.js';
import { scanForVulnerabilities } from '../analysis/security-scanner.js';
import { computeDominators, computeDominanceFrontiers } from '../analysis/cfa.js';
import type { CFG } from '../analysis/cfa.js';
import { evalAbstract, analyzeTaint } from '../analysis/data-flow.js';
import type { AbstractEnv, TaintConfig } from '../analysis/data-flow.js';
import { runOptimizationPass } from '../analysis/optimizer.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';

export class CodeAnalysisWorker extends BaseWorker {
    protected getCapabilities() {
        return {
            tools: [
                'parse', 'analyze', 'scan_vulnerabilities',
                'cfa_ssa', 'analysis_abstract_interp', 'analysis_taint',
                'compiler_optimize',
                'compute_matrix_chunk'
            ],
            languages: ['javascript', 'typescript'],
            max_concurrent: 1,
            warm_start_ms: 50,
            features: []
        };
    }

    protected async handleExecute(request: ExecuteRequest): Promise<void> {
        try {
            if (request.tool === 'parse') {
                const params = request.params as { code: string; language?: string };
                if (!params.code) {
                    this.sendError(request.id, 'INVALID_PARAMS', 'Missing "code" parameter');
                    return;
                }

                const result = parseCode(params.code, params.language);
                this.sendSuccess(request.id, result);
            } else if (request.tool === 'analyze') {
                const params = request.params as { code: string; language?: string };
                if (!params.code) {
                    this.sendError(request.id, 'INVALID_PARAMS', 'Missing "code" parameter');
                    return;
                }

                const result = analyzeCode(params.code, params.language || 'typescript');
                this.sendSuccess(request.id, result);
            } else if (request.tool === 'scan_vulnerabilities') {
                const params = request.params as { code: string };
                if (!params.code) {
                    this.sendError(request.id, 'INVALID_PARAMS', 'Missing "code" parameter');
                    return;
                }

                const result = scanForVulnerabilities(params.code);
                this.sendSuccess(request.id, result);
            } else if (request.tool === 'cfa_ssa') {
                const params = request.params as { blocks: string[]; edges: { from: string; to: string }[]; entry: string };
                const cfg: CFG = { blocks: params.blocks, edges: params.edges, entry: params.entry };
                const idoms = computeDominators(cfg);
                const { frontiers } = computeDominanceFrontiers(cfg, idoms);
                const treeEdges = Object.entries(idoms)
                    .filter(([n, p]) => p !== null)
                    .map(([n, p]) => ({ from: p!, to: n }));
                
                this.sendSuccess(request.id, {
                    immediateDominators: idoms,
                    dominanceFrontiers: frontiers,
                    dominatorTreeEdges: treeEdges
                });
            } else if (request.tool === 'analysis_abstract_interp') {
                const params = request.params as { assignments: { var: string; min: number; max: number }[]; expression: any };
                const env = new Map<string, any>();
                params.assignments.forEach(a => env.set(a.var, { min: a.min, max: a.max }));
                const result = evalAbstract(params.expression, env);
                this.sendSuccess(request.id, { interval: result });
            } else if (request.tool === 'analysis_taint') {
                const params = request.params as { code: any[]; sources: string[]; sinks: string[] };
                const flows = analyzeTaint(params.code, { sources: params.sources, sinks: params.sinks });
                this.sendSuccess(request.id, { detectedFlows: flows });
            } else if (request.tool === 'compiler_optimize') {
                const params = request.params as { code: any[] };
                const result = runOptimizationPass(params.code);
                this.sendSuccess(request.id, result);
            } else if (request.tool === 'compute_matrix_chunk') {
                const params = request.params as { matrixA: number[][], matrixB: number[][] };
                // Simple Naive Multiplication for now (O(N^3))
                // For a chunk, this is fine.
                const A = params.matrixA;
                const B = params.matrixB;
                const rowsA = A.length;
                if (rowsA === 0) throw new Error("Matrix A is empty");
                const colsA = A[0]!.length;

                const rowsB = B.length;
                if (rowsB === 0) throw new Error("Matrix B is empty");
                const colsB = B[0]!.length;

                if (colsA !== rowsB) {
                    throw new Error(`Matrix dimensions mismatch: ${rowsA}x${colsA} vs ${rowsB}x${colsB}`);
                }

                const result = new Array(rowsA).fill(0).map(() => new Array(colsB).fill(0));

                for (let i = 0; i < rowsA; i++) {
                    for (let j = 0; j < colsB; j++) {
                        let sum = 0;
                        for (let k = 0; k < colsA; k++) {
                            sum += A[i]![k]! * B[k]![j]!;
                        }
                        result[i]![j] = sum;
                    }
                }

                // Check size for optimization
                const totalElements = rowsA * colsB;
                const THRESHOLD = 10000; // 100x100

                if (totalElements > THRESHOLD) {
                    // Offload to file to avoid IPC/Context limits
                    const tmpDir = os.tmpdir();
                    const fileName = `mcp-matrix-${randomUUID()}.json`;
                    const filePath = path.join(tmpDir, fileName);
                    
                    fs.writeFileSync(filePath, JSON.stringify(result));
                    
                    this.sendSuccess(request.id, { 
                        resultRef: {
                            type: 'file',
                            path: filePath,
                            rows: rowsA,
                            cols: colsB,
                            summary: `Large matrix (${rowsA}x${colsB}) stored off-process.`
                        }
                    });
                } else {
                    this.sendSuccess(request.id, { result });
                }

            } else {
                this.sendError(request.id, 'UNKNOWN_TOOL', `Tool "${request.tool}" not supported`);
            }
        } catch (error) {
            this.sendError(request.id, 'EXECUTION_FAILED', error instanceof Error ? error.message : String(error));
        }
    }
}

import { pathToFileURL } from 'url';

// Start the worker if this file is executed directly
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    new CodeAnalysisWorker();
}
