
export interface Instruction {
    id?: number;
    op: string;
    target?: string;
    value?: string | number;
    left?: string | number;
    right?: string | number;
    arg?: string;
}

export interface OptimizationStats {
    deadCodeRemoved: number;
    constantsPropagated: number;
    expressionsFolded: number;
}

/**
 * Performs Constant Propagation and Folding
 */
export function optimizeConstants(code: Instruction[]): { code: Instruction[], stats: OptimizationStats } {
    const stats: OptimizationStats = { deadCodeRemoved: 0, constantsPropagated: 0, expressionsFolded: 0 };
    let changed = true;
    let currentCode = [...code];

    // Map of variable -> constant value
    const constants = new Map<string, number>();

    while (changed) {
        changed = false;
        const nextCode: Instruction[] = [];

        for (const instr of currentCode) {
            let newInstr = { ...instr };

            // 1. Fold Arithmetic
            if (instr.op === '+' || instr.op === '-' || instr.op === '*') {
                const leftVal = typeof instr.left === 'string' ? constants.get(instr.left) : instr.left;
                const rightVal = typeof instr.right === 'string' ? constants.get(instr.right) : instr.right;

                if (typeof leftVal === 'number' && typeof rightVal === 'number') {
                    let result = 0;
                    if (instr.op === '+') result = leftVal + rightVal;
                    if (instr.op === '-') result = leftVal - rightVal;
                    if (instr.op === '*') result = leftVal * rightVal;

                    newInstr = { op: 'assign', target: instr.target, value: result };
                    stats.expressionsFolded++;
                    changed = true;
                }
            }

            // 2. Track Constants
            if (newInstr.op === 'assign' && typeof newInstr.value === 'number' && newInstr.target) {
                if (constants.get(newInstr.target) !== newInstr.value) {
                    constants.set(newInstr.target, newInstr.value);
                    changed = true; // State changed, might enable more folding
                }
            }

            // 3. Propagate Constants into Operands
            if (newInstr.op === 'assign' && typeof newInstr.value === 'string' && constants.has(newInstr.value)) {
                newInstr.value = constants.get(newInstr.value);
                stats.constantsPropagated++;
                changed = true;
            }
            if (['+', '-', '*'].includes(newInstr.op)) {
                if (typeof newInstr.left === 'string' && constants.has(newInstr.left)) {
                    newInstr.left = constants.get(newInstr.left);
                    stats.constantsPropagated++;
                    changed = true;
                }
                if (typeof newInstr.right === 'string' && constants.has(newInstr.right)) {
                    newInstr.right = constants.get(newInstr.right);
                    stats.constantsPropagated++;
                    changed = true;
                }
            }
             if (newInstr.op === 'call' && typeof newInstr.arg === 'string' && constants.has(newInstr.arg)) {
                 // Usually we don't propagate constants into calls unless we can inline, but for now let's keep it symbolic?
                 // Actually, let's propagate for things like log(5)
                 // newInstr.arg = constants.get(newInstr.arg); // Type mismatch usually, arg is string. But let's assume arg can be number/string
             }

            nextCode.push(newInstr);
        }
        currentCode = nextCode;
    }

    return { code: currentCode, stats };
}

/**
 * Performs Dead Code Elimination
 */
export function optimizeDeadCode(code: Instruction[]): { code: Instruction[], stats: OptimizationStats } {
    const stats: OptimizationStats = { deadCodeRemoved: 0, constantsPropagated: 0, expressionsFolded: 0 };
    let changed = true;
    let currentCode = [...code];

    while (changed) {
        changed = false;
        
        // 1. Identify Used Variables
        const used = new Set<string>();
        // Assume 'return' or 'call' (sinks) use variables
        for (const instr of currentCode) {
            if (instr.op === 'return' && instr.value) used.add(String(instr.value));
            if (instr.op === 'call' && instr.arg) used.add(String(instr.arg));
            if (instr.op === 'assign' && typeof instr.value === 'string') used.add(instr.value);
            if (['+', '-', '*'].includes(instr.op)) {
                if (typeof instr.left === 'string') used.add(instr.left);
                if (typeof instr.right === 'string') used.add(instr.right);
            }
            // Branch conditions
            if (instr.op === 'branch' && instr.value) used.add(String(instr.value));
        }

        // 2. Remove Unused Assignments
        const nextCode: Instruction[] = [];
        for (const instr of currentCode) {
            let isDead = false;
            if ((instr.op === 'assign' || ['+', '-', '*'].includes(instr.op)) && instr.target) {
                if (!used.has(instr.target)) {
                    isDead = true;
                }
            }

            if (isDead) {
                stats.deadCodeRemoved++;
                changed = true;
            } else {
                nextCode.push(instr);
            }
        }
        currentCode = nextCode;
    }

    return { code: currentCode, stats };
}

export function runOptimizationPass(code: Instruction[]): { code: Instruction[], stats: OptimizationStats } {
    let currentCode = code;
    const totalStats: OptimizationStats = { deadCodeRemoved: 0, constantsPropagated: 0, expressionsFolded: 0 };
    
    // Iterate until stable (simplified)
    for (let i = 0; i < 5; i++) {
        const r1 = optimizeConstants(currentCode);
        currentCode = r1.code;
        totalStats.constantsPropagated += r1.stats.constantsPropagated;
        totalStats.expressionsFolded += r1.stats.expressionsFolded;

        const r2 = optimizeDeadCode(currentCode);
        currentCode = r2.code;
        totalStats.deadCodeRemoved += r2.stats.deadCodeRemoved;

        if (r1.stats.constantsPropagated === 0 && r1.stats.expressionsFolded === 0 && r2.stats.deadCodeRemoved === 0) {
            break;
        }
    }

    return { code: currentCode, stats: totalStats };
}
