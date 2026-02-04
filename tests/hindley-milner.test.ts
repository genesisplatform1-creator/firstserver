
import { describe, it, expect } from 'vitest';
import { infer, resetSupply, Expr, Env, Scheme, tInt, tBool, tFun, typeToString } from '../src/tools/compiler/type-systems/index';

describe('Compiler Theory: Hindley-Milner', () => {

    it('should infer identity function \\x.x as a -> a', () => {
        resetSupply();
        const env: Env = new Map();

        // (x) -> x
        const abs: Expr = { tag: 'Abs', param: 'x', body: { tag: 'Var', name: 'x' } };

        const [s, t] = infer(env, abs);
        const str = typeToString(t);
        // Expect a0 -> a0
        expect(str).toMatch(/a\d+ -> a\d+/);
    });

    it('should infer let x = 5 in x as Int', () => {
        resetSupply();
        const env: Env = new Map();

        // let x = 5 in x
        const letExpr: Expr = {
            tag: 'Let',
            name: 'x',
            value: { tag: 'Lit', value: 5 },
            body: { tag: 'Var', name: 'x' }
        };

        const [s, t] = infer(env, letExpr);
        expect(typeToString(t)).toBe('Int');
    });

    it('should infer generic function app: let id = \\x.x in id 5', () => {
        resetSupply();
        const env: Env = new Map();

        // let id = \x -> x in id 5
        const expr: Expr = {
            tag: 'Let',
            name: 'id',
            value: { tag: 'Abs', param: 'x', body: { tag: 'Var', name: 'x' } },
            body: {
                tag: 'App',
                func: { tag: 'Var', name: 'id' },
                arg: { tag: 'Lit', value: 5 }
            }
        };

        const [s, t] = infer(env, expr);
        expect(typeToString(t)).toBe('Int');
    });

    it('should detect type mismatch', () => {
        resetSupply();
        const env: Env = new Map();
        env.set('plus', { tag: 'Scheme', vars: [], type: tFun(tInt, tFun(tInt, tInt)) });

        // plus 5 true
        const expr: Expr = {
            tag: 'App',
            func: {
                tag: 'App',
                func: { tag: 'Var', name: 'plus' },
                arg: { tag: 'Lit', value: 5 }
            },
            arg: { tag: 'Lit', value: true } // Error: expected Int
        };

        expect(() => infer(env, expr)).toThrow();
    });
});
