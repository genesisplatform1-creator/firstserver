
import { parse } from '@babel/parser';

// ============================================================================
// IR Definitions
// ============================================================================

export type IRInstruction = 
    | { id: number; op: 'assign'; target: string; value: string | number }
    | { id: number; op: 'binary'; target: string; left: string | number; operator: string; right: string | number }
    | { id: number; op: 'return'; value?: string }
    | { id: number; op: 'label'; label: string }
    | { id: number; op: 'branch'; condition: string; trueTarget: string; falseTarget: string }
    | { id: number; op: 'goto'; target: string }
    | { id: number; op: 'call'; target: string; func: string; args: string[] }
    | { id: number; op: 'phi'; target: string; args: string[] };

export interface IRBlock {
    id: string;
    instructions: IRInstruction[];
    predecessors: string[];
    successors: string[];
}

export interface IRFunction {
    name: string;
    blocks: IRBlock[];
    entry: string;
}

type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;

// ============================================================================
// Helpers (Mocking Babel Types/Traverse)
// ============================================================================

function walkAST(node: any, visitor: any) {
    if (!node) return;
    
    // Visit current node
    if (visitor[node.type]) {
        visitor[node.type](node);
    }

    for (const key in node) {
        if (key === 'loc' || key === 'start' || key === 'end' || key === 'comments') continue;
        const val = node[key];
        if (Array.isArray(val)) {
            val.forEach(child => {
                if (child && typeof child.type === 'string') walkAST(child, visitor);
            });
        } else if (typeof val === 'object' && val !== null && typeof val.type === 'string') {
            walkAST(val, visitor);
        }
    }
}

const t = {
    isIdentifier: (node: any): node is { type: 'Identifier', name: string } => node?.type === 'Identifier',
    isNumericLiteral: (node: any): node is { type: 'NumericLiteral', value: number } => node?.type === 'NumericLiteral',
    isStringLiteral: (node: any): node is { type: 'StringLiteral', value: string } => node?.type === 'StringLiteral',
    isBinaryExpression: (node: any): node is { type: 'BinaryExpression', left: any, right: any, operator: string } => node?.type === 'BinaryExpression',
    isCallExpression: (node: any): node is { type: 'CallExpression', callee: any, arguments: any[] } => node?.type === 'CallExpression',
    isVariableDeclaration: (node: any): node is { type: 'VariableDeclaration', declarations: any[] } => node?.type === 'VariableDeclaration',
    isReturnStatement: (node: any): node is { type: 'ReturnStatement', argument: any } => node?.type === 'ReturnStatement',
    isIfStatement: (node: any): node is { type: 'IfStatement', test: any, consequent: any, alternate: any } => node?.type === 'IfStatement',
    isBlockStatement: (node: any): node is { type: 'BlockStatement', body: any[] } => node?.type === 'BlockStatement',
    isExpressionStatement: (node: any): node is { type: 'ExpressionStatement', expression: any } => node?.type === 'ExpressionStatement',
    isFunctionDeclaration: (node: any): node is { type: 'FunctionDeclaration', id: any, body: any } => node?.type === 'FunctionDeclaration'
};

// ============================================================================
// Lowering Logic (AST -> Linear IR)
// ============================================================================

export function lowerToIR(code: string): IRFunction {
    const ast = parse(code, { sourceType: 'module', plugins: ['typescript'] });
    const instructions: IRInstruction[] = [];
    let instructionIdCounter = 0;
    let tempVarCounter = 0;
    let labelCounter = 0;

    function nextId() { return instructionIdCounter++; }
    function newTemp() { return `t${tempVarCounter++}`; }
    function newLabel(prefix = 'lbl') { return `${prefix}_${labelCounter++}`; }

    function emit(instr: DistributiveOmit<IRInstruction, 'id'>) {
        instructions.push({ id: nextId(), ...instr } as IRInstruction);
    }

    let entryFunction: any = null;
    
    // Find first function
    walkAST(ast, {
        FunctionDeclaration(node: any) {
            if (!entryFunction) {
                entryFunction = node;
            }
        }
    });

    if (!entryFunction) {
        throw new Error("No function found to lower");
    }

    // Process Body
    const body = entryFunction.body;
    if (t.isBlockStatement(body)) {
        processBlock(body.body);
    }

    function processBlock(statements: any[]) {
        for (const stmt of statements) {
            if (t.isVariableDeclaration(stmt)) {
                for (const decl of stmt.declarations) {
                    if (t.isIdentifier(decl.id) && decl.init) {
                        const val = processExpression(decl.init);
                        emit({ op: 'assign', target: decl.id.name, value: val });
                    }
                }
            } else if (t.isReturnStatement(stmt)) {
                let val: string | undefined = undefined;
                if (stmt.argument) {
                    val = String(processExpression(stmt.argument));
                }
                if (val !== undefined) {
                    emit({ op: 'return', value: val });
                } else {
                    emit({ op: 'return' });
                }
            } else if (t.isIfStatement(stmt)) {
                const test = processExpression(stmt.test);
                const thenLabel = newLabel('then');
                const elseLabel = newLabel('else');
                const endLabel = newLabel('end');

                emit({ op: 'branch', condition: String(test), trueTarget: thenLabel, falseTarget: stmt.alternate ? elseLabel : endLabel });

                emit({ op: 'label', label: thenLabel });
                if (t.isBlockStatement(stmt.consequent)) {
                    processBlock(stmt.consequent.body);
                } else {
                    processBlock([stmt.consequent]);
                }
                emit({ op: 'goto', target: endLabel });

                if (stmt.alternate) {
                    emit({ op: 'label', label: elseLabel });
                    if (t.isBlockStatement(stmt.alternate)) {
                        processBlock(stmt.alternate.body);
                    } else {
                        processBlock([stmt.alternate]);
                    }
                    emit({ op: 'goto', target: endLabel });
                }

                emit({ op: 'label', label: endLabel });
            } else if (t.isExpressionStatement(stmt)) {
                processExpression(stmt.expression);
            }
        }
    }

    function processExpression(expr: any): string | number {
        if (t.isNumericLiteral(expr)) return expr.value;
        if (t.isStringLiteral(expr)) return expr.value;
        if (t.isIdentifier(expr)) return expr.name;

        if (t.isBinaryExpression(expr)) {
            const left = processExpression(expr.left);
            const right = processExpression(expr.right);
            const temp = newTemp();
            emit({ op: 'binary', target: temp, left: String(left), operator: expr.operator, right: String(right) });
            return temp;
        }
        
        if (t.isCallExpression(expr)) {
             const args = expr.arguments.map((arg: any) => {
                 return String(processExpression(arg));
             });
             const temp = newTemp();
             let funcName = "unknown";
             if (t.isIdentifier(expr.callee)) funcName = expr.callee.name;
             
             emit({ op: 'call', target: temp, func: funcName, args });
             return temp;
        }

        return "unknown";
    }

    // Convert flat list to Blocks (Basic Block construction)
    const blocks: IRBlock[] = [];
    let currentBlock: IRInstruction[] = [];
    let currentLabel = 'entry';

    for (const instr of instructions) {
        if (instr.op === 'label') {
            if (currentBlock.length > 0) {
                blocks.push({ id: currentLabel, instructions: currentBlock, predecessors: [], successors: [] });
            }
            currentLabel = instr.label;
            currentBlock = [];
        } else {
            currentBlock.push(instr);
            if (instr.op === 'branch' || instr.op === 'goto' || instr.op === 'return') {
                 // End of block
                 // But wait for next label to push
            }
        }
    }
    if (currentBlock.length > 0) {
        blocks.push({ id: currentLabel, instructions: currentBlock, predecessors: [], successors: [] });
    }

    return {
        name: entryFunction?.id?.name || 'anonymous',
        blocks,
        entry: 'entry'
    };
}

// ============================================================================
// Helpers for Diagnostics Validation (Self-Correction)
// ============================================================================

export function validateInstruction(instr: IRInstruction) {
    if (instr.op === 'assign') {
        // Safe access
        const t = instr.target;
    } else if (instr.op === 'label') {
        // Safe access
        const l = instr.label;
    } else if (instr.op === 'branch') {
        // Safe access
        const t = instr.trueTarget;
    } else if (instr.op === 'return') {
        // Safe access
        const v = instr.value;
    }
}
