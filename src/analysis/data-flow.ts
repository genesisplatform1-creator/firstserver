
// ============================================================================
// 1. Abstract Interpretation (Interval Domain)
// ============================================================================

export interface Interval {
    min: number;
    max: number;
}

const Bottom: Interval = { min: Infinity, max: -Infinity };
const Top: Interval = { min: -Infinity, max: Infinity };

function meet(a: Interval, b: Interval): Interval {
    return {
        min: Math.max(a.min, b.min),
        max: Math.min(a.max, b.max)
    };
}

function join(a: Interval, b: Interval): Interval {
    return {
        min: Math.min(a.min, b.min),
        max: Math.max(a.max, b.max)
    };
}

function add(a: Interval, b: Interval): Interval {
    if (a === Bottom || b === Bottom) return Bottom; // Strict?
    return { min: a.min + b.min, max: a.max + b.max };
}

function sub(a: Interval, b: Interval): Interval {
    if (a === Bottom || b === Bottom) return Bottom;
    return { min: a.min - b.max, max: a.max - b.min };
}

// Simple expression abstract eval
export type AbstractEnv = Map<string, Interval>;

export function evalAbstract(expr: any, env: AbstractEnv): Interval {
    if (typeof expr === 'number') return { min: expr, max: expr };
    if (typeof expr === 'string') return env.get(expr) || Top; // Uninitialized is Top (Unsafe) or Bottom (Unreachable)? Top for safety.

    if (expr.op === '+') return add(evalAbstract(expr.left, env), evalAbstract(expr.right, env));
    if (expr.op === '-') return sub(evalAbstract(expr.left, env), evalAbstract(expr.right, env));

    return Top;
}

// ============================================================================
// 2. Taint Analysis (Data Flow)
// ============================================================================

export interface TaintConfig {
    sources: string[];
    sinks: string[];
}

export interface TaintFlow {
    from: string;
    to: string;
}

export function analyzeTaint(code: any[], config: TaintConfig): TaintFlow[] {
    // Simplified Instruction processing
    // instructions: { op: 'assign', target: 'x', value: 'y' }

    const tainted = new Set<string>(config.sources);
    const flows = new Map<string, TaintFlow>(); // Key: "from->to" to dedupe

    let changed = true;
    while (changed) {
        changed = false;
        for (const instr of code) {
            if (instr.op === 'assign') {
                // target = value
                if (tainted.has(instr.value)) {
                    if (!tainted.has(instr.target)) {
                        tainted.add(instr.target);
                        changed = true;
                    }
                }
            }
            if (instr.op === 'call') {
                // call(sink, arg)
                if (config.sinks.includes(instr.target)) { // target is function name here?
                    if (tainted.has(instr.arg)) {
                        const key = `${instr.arg}->${instr.target}`;
                        if (!flows.has(key)) {
                            flows.set(key, { from: instr.arg, to: instr.target });
                            // Don't set changed=true for just reporting, only for state updates
                        }
                    }
                }
            }
        }
    }
    return Array.from(flows.values());
}
