/**
 * A tiny, sandboxed expression language used for every numeric value in the
 * rule editor. It never touches eval/Function: source is tokenised, parsed to
 * an AST against a whitelist of identifiers and functions, and interpreted
 * with an instruction budget so a rule can't hang the simulation.
 *
 *   self.mass * 2 + rand(-10, 10)
 *   other.speed > 300 ? 1 : 0
 *   $score + 1          (global variable)
 *   self.$charges - 1   (per-entity variable)
 *   count('replicator') (entities carrying a tag)
 */

export type Ast =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'ref'; root: 'self' | 'other' | 'world' | 'event' | 'global' | 'const'; prop: string }
  | { k: 'call'; fn: string; args: Ast[] }
  | { k: 'un'; op: '-' | '!' | '+'; a: Ast }
  | { k: 'bin'; op: string; a: Ast; b: Ast }
  | { k: 'tern'; c: Ast; a: Ast; b: Ast };

export const ENTITY_PROPS = [
  'x', 'y', 'vx', 'vy', 'speed', 'mass', 'temp', 'temperature', 'radius', 'age', 'angle', 'av', 'charge',
  'id', 'restitution', 'friction', 'lifetime', 'gravityScale', 'drag', 'heading',
] as const;
export const WORLD_PROPS = [
  'time', 'step', 'count', 'gx', 'gy', 'ambient', 'timeScale', 'width', 'height', 'windX', 'windY', 'dt',
] as const;
export const EVENT_PROPS = ['impulse', 'depth', 'x', 'y', 'relSpeed', 'distance'] as const;
export const CONSTANTS: Record<string, number> = { pi: Math.PI, PI: Math.PI, e: Math.E, tau: Math.PI * 2 };

interface FnSpec {
  min: number;
  max: number;
  /** argument indices that must be string literals */
  strArgs?: number[];
}
export const FUNCTIONS: Record<string, FnSpec> = {
  rand: { min: 0, max: 2 },
  randint: { min: 2, max: 2 },
  sin: { min: 1, max: 1 },
  cos: { min: 1, max: 1 },
  tan: { min: 1, max: 1 },
  atan2: { min: 2, max: 2 },
  abs: { min: 1, max: 1 },
  sqrt: { min: 1, max: 1 },
  floor: { min: 1, max: 1 },
  ceil: { min: 1, max: 1 },
  round: { min: 1, max: 1 },
  sign: { min: 1, max: 1 },
  min: { min: 1, max: 8 },
  max: { min: 1, max: 8 },
  clamp: { min: 3, max: 3 },
  pow: { min: 2, max: 2 },
  hypot: { min: 2, max: 2 },
  lerp: { min: 3, max: 3 },
  log: { min: 1, max: 1 },
  exp: { min: 1, max: 1 },
  count: { min: 0, max: 1, strArgs: [0] },
  countMat: { min: 1, max: 1, strArgs: [0] },
};

const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** Names that must never be used as variable keys (prototype pollution guards). */
export const FORBIDDEN_NAMES = new Set(['__proto__', 'constructor', 'prototype', 'hasOwnProperty', 'toString', 'valueOf']);

/** Own-property numeric read; never walks the prototype chain. */
export function readVar(vars: Record<string, number>, k: string): number {
  if (!own(vars, k)) return 0;
  const v = vars[k];
  return typeof v === 'number' ? v : 0;
}

export class ExprError extends Error {
  constructor(
    message: string,
    public pos: number,
  ) {
    super(message);
  }
}

export class BudgetExceeded extends Error {
  constructor() {
    super('instruction budget exceeded');
  }
}

type Tok =
  | { t: 'num'; v: number; p: number }
  | { t: 'str'; v: string; p: number }
  | { t: 'id'; v: string; p: number }
  | { t: 'op'; v: string; p: number }
  | { t: 'eof'; p: number };

const OPS = ['&&', '||', '==', '!=', '<=', '>=', '+', '-', '*', '/', '%', '^', '<', '>', '!', '?', ':', '(', ')', ',', '.'];

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  if (src.length > 400) throw new ExprError('expression is too long (max 400 characters)', 0);
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n') {
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new ExprError('bad number', i);
      out.push({ t: 'num', v: parseFloat(m[0]), p: i });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const m = /^\$?[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
      if (!m) throw new ExprError(`unexpected '${c}'`, i);
      out.push({ t: 'id', v: m[0], p: i });
      i += m[0].length;
      continue;
    }
    if (c === "'" || c === '"') {
      const end = src.indexOf(c, i + 1);
      if (end < 0) throw new ExprError('unterminated string', i);
      const v = src.slice(i + 1, end);
      if (!/^[\w\- ]*$/.test(v)) throw new ExprError('strings may only contain letters, digits, - and _', i);
      out.push({ t: 'str', v, p: i });
      i = end + 1;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ExprError(`unexpected character '${c}'`, i);
    out.push({ t: 'op', v: op, p: i });
    i += op.length;
  }
  out.push({ t: 'eof', p: src.length });
  return out;
}

class Parser {
  i = 0;
  constructor(private toks: Tok[]) {}
  peek(): Tok {
    return this.toks[this.i];
  }
  next(): Tok {
    return this.toks[this.i++];
  }
  isOp(v: string): boolean {
    const t = this.peek();
    return t.t === 'op' && t.v === v;
  }
  expect(v: string): void {
    const t = this.next();
    if (t.t !== 'op' || t.v !== v) throw new ExprError(`expected '${v}'`, t.p);
  }

  parse(): Ast {
    const a = this.ternary();
    const t = this.peek();
    if (t.t !== 'eof') throw new ExprError('unexpected trailing input', t.p);
    return a;
  }

  ternary(): Ast {
    const c = this.binary(0);
    if (this.isOp('?')) {
      this.next();
      const a = this.ternary();
      this.expect(':');
      const b = this.ternary();
      return { k: 'tern', c, a, b };
    }
    return c;
  }

  static PREC: Record<string, number> = {
    '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6,
  };

  binary(minPrec: number): Ast {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      if (t.t !== 'op') break;
      const prec = Parser.PREC[t.v];
      if (prec === undefined || prec <= minPrec) break;
      this.next();
      const right = this.binary(prec);
      left = { k: 'bin', op: t.v, a: left, b: right };
    }
    return left;
  }

  unary(): Ast {
    const t = this.peek();
    if (t.t === 'op' && (t.v === '-' || t.v === '!' || t.v === '+')) {
      this.next();
      return { k: 'un', op: t.v as '-' | '!' | '+', a: this.unary() };
    }
    return this.power();
  }

  power(): Ast {
    const base = this.primary();
    if (this.isOp('^')) {
      this.next();
      return { k: 'bin', op: '^', a: base, b: this.unary() };
    }
    return base;
  }

  primary(): Ast {
    const t = this.next();
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.t === 'op' && t.v === '(') {
      const e = this.ternary();
      this.expect(')');
      return e;
    }
    if (t.t === 'id') {
      const name = t.v;
      if (name.startsWith('$')) {
        if (FORBIDDEN_NAMES.has(name.slice(1))) throw new ExprError(`'${name}' is not a valid variable name`, t.p);
        return { k: 'ref', root: 'global', prop: name.slice(1) };
      }
      if (this.isOp('(')) {
        const spec = own(FUNCTIONS, name) ? FUNCTIONS[name] : undefined;
        if (!spec) throw new ExprError(`unknown function '${name}'`, t.p);
        this.next();
        const args: Ast[] = [];
        if (!this.isOp(')')) {
          for (;;) {
            args.push(this.ternary());
            if (this.isOp(',')) {
              this.next();
              continue;
            }
            break;
          }
        }
        this.expect(')');
        if (args.length < spec.min || args.length > spec.max) {
          throw new ExprError(
            `${name}() takes ${spec.min === spec.max ? spec.min : `${spec.min}-${spec.max}`} argument(s), got ${args.length}`,
            t.p,
          );
        }
        args.forEach((a, idx) => {
          const wantsStr = spec.strArgs?.includes(idx);
          if (wantsStr && a.k !== 'str') throw new ExprError(`${name}() argument ${idx + 1} must be a quoted name`, t.p);
          if (!wantsStr && a.k === 'str') throw new ExprError(`${name}() argument ${idx + 1} must be a number`, t.p);
        });
        return { k: 'call', fn: name, args };
      }
      if (own(CONSTANTS, name)) return { k: 'ref', root: 'const', prop: name };
      if (name === 'self' || name === 'other' || name === 'world' || name === 'event') {
        this.expect('.');
        const p = this.next();
        if (p.t !== 'id') throw new ExprError(`expected property after '${name}.'`, p.p);
        const prop = p.v;
        if (name === 'world') {
          if (!(WORLD_PROPS as readonly string[]).includes(prop))
            throw new ExprError(`unknown world property '${prop}' (try: ${WORLD_PROPS.join(', ')})`, p.p);
        } else if (name === 'event') {
          if (!(EVENT_PROPS as readonly string[]).includes(prop))
            throw new ExprError(`unknown event property '${prop}' (try: ${EVENT_PROPS.join(', ')})`, p.p);
        } else if (prop.startsWith('$') && FORBIDDEN_NAMES.has(prop.slice(1))) {
          throw new ExprError(`'${prop}' is not a valid variable name`, p.p);
        } else if (!prop.startsWith('$') && !(ENTITY_PROPS as readonly string[]).includes(prop)) {
          throw new ExprError(`unknown property '${prop}' (try: ${ENTITY_PROPS.join(', ')} or $variable)`, p.p);
        }
        return { k: 'ref', root: name, prop };
      }
      if (name === 'dt' || name === 't' || name === 'time') return { k: 'ref', root: 'world', prop: name === 'dt' ? 'dt' : 'time' };
      throw new ExprError(`unknown name '${name}' (use self., other., world., event., $variable)`, t.p);
    }
    if (t.t === 'eof') throw new ExprError('unexpected end of expression', t.p);
    throw new ExprError(`unexpected '${(t as { v?: unknown }).v ?? '?'}'`, t.p);
  }
}

export interface Compiled {
  ok: true;
  ast: Ast;
  src: string;
  /** True if the expression is a plain number literal. */
  constant: boolean;
  usesSelf: boolean;
  usesOther: boolean;
}
export interface CompileError {
  ok: false;
  error: string;
  pos: number;
  src: string;
}

const cache = new Map<string, Compiled | CompileError>();

export function compile(src: string | number): Compiled | CompileError {
  const s = typeof src === 'number' ? String(src) : src;
  const hit = cache.get(s);
  if (hit) return hit;
  let res: Compiled | CompileError;
  try {
    if (s.trim() === '') throw new ExprError('empty expression', 0);
    const ast = new Parser(tokenize(s)).parse();
    if (ast.k === 'str') throw new ExprError('expression must be numeric', 0);
    let usesSelf = false;
    let usesOther = false;
    walk(ast, (n) => {
      if (n.k === 'ref' && n.root === 'self') usesSelf = true;
      if (n.k === 'ref' && n.root === 'other') usesOther = true;
    });
    res = { ok: true, ast, src: s, constant: ast.k === 'num', usesSelf, usesOther };
  } catch (e) {
    const err = e instanceof ExprError ? e : new ExprError(String(e), 0);
    res = { ok: false, error: err.message, pos: err.pos, src: s };
  }
  if (cache.size > 2000) cache.clear();
  cache.set(s, res);
  return res;
}

function walk(n: Ast, f: (n: Ast) => void): void {
  f(n);
  switch (n.k) {
    case 'call':
      n.args.forEach((a) => walk(a, f));
      break;
    case 'un':
      walk(n.a, f);
      break;
    case 'bin':
      walk(n.a, f);
      walk(n.b, f);
      break;
    case 'tern':
      walk(n.c, f);
      walk(n.a, f);
      walk(n.b, f);
      break;
  }
}

/** Minimal view of an entity readable from expressions. */
export interface ExprEntity {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  mass: number;
  temperature: number;
  radius: number;
  age: number;
  angle: number;
  av: number;
  charge: number;
  restitution: number;
  friction: number;
  lifetime: number;
  gravityScale: number;
  drag: number;
  vars: Record<string, number>;
}

export interface ExprEnv {
  self: ExprEntity | null;
  other: ExprEntity | null;
  event: Partial<Record<(typeof EVENT_PROPS)[number], number>>;
  world: (prop: string) => number;
  global: (name: string) => number;
  count: (tag?: string) => number;
  countMat: (mat: string) => number;
  random: () => number;
  budget: { left: number };
}

function entityProp(e: ExprEntity | null, prop: string): number {
  if (!e) return 0;
  if (prop.startsWith('$')) return readVar(e.vars, prop.slice(1));
  switch (prop) {
    case 'speed':
      return Math.hypot(e.vx, e.vy);
    case 'heading':
      return Math.atan2(e.vy, e.vx);
    case 'temp':
    case 'temperature':
      return e.temperature;
    default:
      return (e as unknown as Record<string, number>)[prop] ?? 0;
  }
}

const truthy = (v: number) => v !== 0 && !Number.isNaN(v);

export function evaluate(ast: Ast, env: ExprEnv): number {
  if (--env.budget.left < 0) throw new BudgetExceeded();
  switch (ast.k) {
    case 'num':
      return ast.v;
    case 'str':
      return 0;
    case 'ref':
      switch (ast.root) {
        case 'self':
          return entityProp(env.self, ast.prop);
        case 'other':
          return entityProp(env.other, ast.prop);
        case 'world':
          return env.world(ast.prop);
        case 'event':
          return env.event[ast.prop as (typeof EVENT_PROPS)[number]] ?? 0;
        case 'global':
          return env.global(ast.prop);
        case 'const':
          return own(CONSTANTS, ast.prop) ? CONSTANTS[ast.prop] : 0;
      }
      return 0;
    case 'un': {
      const a = evaluate(ast.a, env);
      return ast.op === '-' ? -a : ast.op === '!' ? (truthy(a) ? 0 : 1) : a;
    }
    case 'tern':
      return truthy(evaluate(ast.c, env)) ? evaluate(ast.a, env) : evaluate(ast.b, env);
    case 'bin': {
      if (ast.op === '&&') return truthy(evaluate(ast.a, env)) && truthy(evaluate(ast.b, env)) ? 1 : 0;
      if (ast.op === '||') return truthy(evaluate(ast.a, env)) || truthy(evaluate(ast.b, env)) ? 1 : 0;
      const a = evaluate(ast.a, env);
      const b = evaluate(ast.b, env);
      switch (ast.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return b === 0 ? 0 : a / b;
        case '%': return b === 0 ? 0 : a % b;
        case '^': return Math.pow(a, b);
        case '==': return a === b ? 1 : 0;
        case '!=': return a !== b ? 1 : 0;
        case '<': return a < b ? 1 : 0;
        case '<=': return a <= b ? 1 : 0;
        case '>': return a > b ? 1 : 0;
        case '>=': return a >= b ? 1 : 0;
      }
      return 0;
    }
    case 'call': {
      const strArg = ast.args[0]?.k === 'str' ? (ast.args[0] as { v: string }).v : undefined;
      if (ast.fn === 'count') return env.count(strArg);
      if (ast.fn === 'countMat') return env.countMat(strArg ?? '');
      const v = ast.args.map((a) => evaluate(a, env));
      switch (ast.fn) {
        case 'rand':
          if (v.length === 0) return env.random();
          if (v.length === 1) return env.random() * v[0];
          return v[0] + (v[1] - v[0]) * env.random();
        case 'randint':
          return Math.floor(v[0] + (v[1] - v[0] + 1) * env.random());
        case 'sin': return Math.sin(v[0]);
        case 'cos': return Math.cos(v[0]);
        case 'tan': return Math.tan(v[0]);
        case 'atan2': return Math.atan2(v[0], v[1]);
        case 'abs': return Math.abs(v[0]);
        case 'sqrt': return Math.sqrt(Math.max(0, v[0]));
        case 'floor': return Math.floor(v[0]);
        case 'ceil': return Math.ceil(v[0]);
        case 'round': return Math.round(v[0]);
        case 'sign': return Math.sign(v[0]);
        case 'min': return Math.min(...v);
        case 'max': return Math.max(...v);
        case 'clamp': return Math.min(Math.max(v[0], v[1]), v[2]);
        case 'pow': return Math.pow(v[0], v[1]);
        case 'hypot': return Math.hypot(v[0], v[1]);
        case 'lerp': return v[0] + (v[1] - v[0]) * v[2];
        case 'log': return v[0] > 0 ? Math.log(v[0]) : 0;
        case 'exp': return Math.exp(Math.min(v[0], 50));
      }
      return 0;
    }
  }
}

/** Compile+evaluate convenience; returns NaN on compile errors. Results are sanitised. */
export function evalSource(src: string | number, env: ExprEnv): number {
  if (typeof src === 'number') return src;
  const c = compile(src);
  if (!c.ok) return NaN;
  const v = evaluate(c.ast, env);
  if (!Number.isFinite(v)) return 0;
  return v;
}
