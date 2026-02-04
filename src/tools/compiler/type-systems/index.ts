
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// ============================================================================
// 1. Hindley-Milner Type Inference (Algorithm W)
// ============================================================================

// AST Definitions
// AST Definitions
export type Expr =
    | { tag: 'Var', name: string }
    | { tag: 'App', func: Expr, arg: Expr }
    | { tag: 'Abs', param: string, body: Expr }
    | { tag: 'Let', name: string, value: Expr, body: Expr }
    | { tag: 'Lit', value: string | number | boolean }
    | { tag: 'If', cond: Expr, then: Expr, else: Expr };

// Type Definitions
export type Type =
    | { tag: 'TVar', name: string }
    | { tag: 'TCon', name: string, args: Type[] };

export type Scheme = { tag: 'Scheme', vars: string[], type: Type };

// Standard Types
export const tInt: Type = { tag: 'TCon', name: 'Int', args: [] };
export const tBool: Type = { tag: 'TCon', name: 'Bool', args: [] };
export function tFun(a: Type, b: Type): Type {
    return { tag: 'TCon', name: '->', args: [a, b] };
}

// Environment
export type Env = Map<string, Scheme>;

// Substitution
export type Subst = Map<string, Type>;

// Helper: Free Type Variables
export function ftv(t: Type): Set<string> {
    switch (t.tag) {
        case 'TVar': return new Set([t.name]);
        case 'TCon': return new Set(t.args.flatMap(a => Array.from(ftv(a))));
    }
}

function ftvScheme(s: Scheme): Set<string> {
    const vars = ftv(s.type);
    s.vars.forEach(v => vars.delete(v));
    return vars;
}

function ftvEnv(env: Env): Set<string> {
    const vars = new Set<string>();
    for (const s of env.values()) {
        ftvScheme(s).forEach(v => vars.add(v));
    }
    return vars;
}

// Helper: Apply Substitution
export function applySubst(s: Subst, t: Type): Type {
    switch (t.tag) {
        case 'TVar': return s.get(t.name) || t;
        case 'TCon': return { tag: 'TCon', name: t.name, args: t.args.map(a => applySubst(s, a)) };
    }
}

function applySubstScheme(s: Subst, sc: Scheme): Scheme {
    const newSubst = new Map(s);
    sc.vars.forEach(v => newSubst.delete(v));
    return { tag: 'Scheme', vars: sc.vars, type: applySubst(newSubst, sc.type) };
}

function applySubstEnv(s: Subst, env: Env): Env {
    const newEnv = new Map<string, Scheme>();
    for (const [k, v] of env.entries()) {
        newEnv.set(k, applySubstScheme(s, v));
    }
    return newEnv;
}

function composeSubst(s1: Subst, s2: Subst): Subst {
    const result = new Map<string, Type>();
    for (const [k, v] of s2.entries()) result.set(k, v);
    for (const [k, v] of s1.entries()) result.set(k, applySubst(s2, v));
    return result;
}

// Helper: Generalization and Instantiation
let supply = 0;
export function resetSupply() { supply = 0; }
export function newTVar(): Type {
    return { tag: 'TVar', name: 'a' + (supply++) };
}

function instantiate(sc: Scheme): Type {
    const newVars = new Map<string, Type>();
    sc.vars.forEach(v => newVars.set(v, newTVar()));
    return applySubst(newVars, sc.type);
}

function generalize(env: Env, t: Type): Scheme {
    const vars = Array.from(ftv(t)).filter(v => !ftvEnv(env).has(v));
    return { tag: 'Scheme', vars, type: t };
}

// Unification
export function mgu(t1: Type, t2: Type): Subst {
    if (t1.tag === 'TVar') {
        if (t2.tag === 'TVar' && t1.name === t2.name) return new Map();
        if (ftv(t2).has(t1.name)) throw new Error(`Occurs check fails: ${t1.name} in ${JSON.stringify(t2)}`);
        return new Map([[t1.name, t2]]);
    }
    if (t2.tag === 'TVar') return mgu(t2, t1);

    if (t1.tag === 'TCon' && t2.tag === 'TCon') {
        if (t1.name !== t2.name || t1.args.length !== t2.args.length) {
            throw new Error(`Type mismatch: ${t1.name} vs ${t2.name}`);
        }
        let s: Subst = new Map();
        for (let i = 0; i < t1.args.length; i++) {
            const s1 = mgu(applySubst(s, t1.args[i]!), applySubst(s, t2.args[i]!));
            s = composeSubst(s, s1);
        }
        return s;
    }
    throw new Error("Unification error");
}

// Algorithm W
export function infer(env: Env, expr: Expr): [Subst, Type] {
    switch (expr.tag) {
        case 'Lit':
            if (typeof expr.value === 'number') return [new Map(), tInt];
            if (typeof expr.value === 'boolean') return [new Map(), tBool];
            return [new Map(), { tag: 'TCon', name: 'String', args: [] }];

        case 'Var':
            const sc = env.get(expr.name);
            if (!sc) throw new Error(`Unbound variable: ${expr.name}`);
            return [new Map(), instantiate(sc)];

        case 'Abs':
            const tv = newTVar();
            const newEnv = new Map(env);
            newEnv.set(expr.param, { tag: 'Scheme', vars: [], type: tv });
            const [s1, t1] = infer(newEnv, expr.body);
            return [s1, tFun(applySubst(s1, tv), t1)];

        case 'App':
            const tvResult = newTVar();
            const [sFun, tFunTy] = infer(env, expr.func);
            const [sArg, tArg] = infer(applySubstEnv(sFun, env), expr.arg);
            const s3 = mgu(applySubst(sArg, tFunTy), tFun(tArg, tvResult));
            return [composeSubst(sFun, composeSubst(sArg, s3)), applySubst(s3, tvResult)];

        case 'Let':
            const [sVal, tVal] = infer(env, expr.value);
            const env2 = applySubstEnv(sVal, env);
            const scVal = generalize(env2, tVal);
            const env3 = new Map(env2);
            env3.set(expr.name, scVal);
            const [sBody, tBody] = infer(env3, expr.body);
            return [composeSubst(sVal, sBody), tBody];

        case 'If':
            const [sCond, tCond] = infer(env, expr.cond);
            const sBool = mgu(tCond, tBool);
            const s2 = composeSubst(sCond, sBool);
            const envIf = applySubstEnv(s2, env);
            const [sThen, tThen] = infer(envIf, expr.then);
            const [sElse, tElse] = infer(applySubstEnv(sThen, envIf), expr.else);
            const sMatch = mgu(applySubst(sElse, tThen), tElse);
            const sFinal = composeSubst(s2, composeSubst(sThen, composeSubst(sElse, sMatch)));
            return [sFinal, applySubst(sMatch, tElse)];
    }
}

// Pretty Printer
export function typeToString(t: Type): string {
    if (t.tag === 'TVar') return t.name;
    if (t.tag === 'TCon') {
        if (t.name === '->') {
            const left = t.args[0]!.tag === 'TCon' && t.args[0]!.name === '->'
                ? `(${typeToString(t.args[0]!)})`
                : typeToString(t.args[0]!);
            return `${left} -> ${typeToString(t.args[1]!)}`;
        }
        if (t.args.length === 0) return t.name;
        return `${t.name} ${t.args.map(typeToString).join(' ')}`;
    }
    return "?";
}

// Parser (Simplified recursive descent for demonstration)
function parseSimpleExpr(code: string): Expr {
    // Very basic parser for s-expressions or simplified syntax
    // (let x = 5 in x)
    // Not implementing full parser here to keep it reliable.
    // Instead, we accept a JSON representation of AST in the tool.
    return JSON.parse(code) as Expr;
}

// ============================================================================
// Tool Registration
// ============================================================================

export function registerTypeSystemTools(server: McpServer): void {

    // reset supply for fresh runs
    server.tool(
        'type_hindley_milner',
        'Infer types for lambda calculus expression using Hindley-Milner Algorithm W.',
        { ast: z.string().describe("JSON string of Expr AST") },
        async ({ ast }) => {
            supply = 0; // Reset vars
            try {
                const expr = JSON.parse(ast) as Expr;
                const env = new Map<string, Scheme>();
                // Standard basis
                env.set('plus', { tag: 'Scheme', vars: [], type: tFun(tInt, tFun(tInt, tInt)) });
                env.set('eq', { tag: 'Scheme', vars: [], type: tFun(tInt, tFun(tInt, tBool)) });

                const [subst, type] = infer(env, expr);
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            inferredType: typeToString(type),
                            structure: type
                        }, null, 2)
                    }]
                };
            } catch (e: any) {
                return {
                    content: [{ type: 'text', text: `Type Error: ${e.message}` }]
                };
            }
        }
    );
}
