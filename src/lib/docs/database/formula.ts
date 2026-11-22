import { addDays, diffDays, localDay, parseDateCell } from "./date-cells";
import type { ComputedResultType, PropertyDefinition } from "./types";

export type FormulaValue = string | number | boolean | null;

type TokenKind =
  | "number"
  | "string"
  | "ident"
  | "op"
  | "lparen"
  | "rparen"
  | "comma"
  | "question"
  | "colon"
  | "eof";

interface Token {
  kind: TokenKind;
  value: string;
  pos: number;
}

type Expr =
  | { type: "literal"; value: FormulaValue }
  | { type: "ident"; name: string }
  | { type: "unary"; op: "!" | "-"; arg: Expr }
  | { type: "binary"; op: string; left: Expr; right: Expr }
  | { type: "ternary"; cond: Expr; thenBranch: Expr; elseBranch: Expr }
  | { type: "call"; name: string; args: Expr[] };

const MAX_EXPRESSION_LENGTH = 2000;
const MAX_AST_NODES = 300;

function tokenize(input: string): Token[] {
  if (input.length > MAX_EXPRESSION_LENGTH) {
    throw new Error(`公式长度不能超过 ${MAX_EXPRESSION_LENGTH} 字符`);
  }
  const tokens: Token[] = [];
  let i = 0;
  const n = input.length;

  while (i < n) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: "lparen", value: "(", pos: i++ });
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen", value: ")", pos: i++ });
      continue;
    }
    if (ch === ",") {
      tokens.push({ kind: "comma", value: ",", pos: i++ });
      continue;
    }
    if (ch === "?") {
      tokens.push({ kind: "question", value: "?", pos: i++ });
      continue;
    }
    if (ch === ":") {
      tokens.push({ kind: "colon", value: ":", pos: i++ });
      continue;
    }

    // Two-character operators
    const two = input.slice(i, i + 2);
    if (two === "==" || two === "!=" || two === "<=" || two === ">=" || two === "&&" || two === "||") {
      tokens.push({ kind: "op", value: two, pos: i });
      i += 2;
      continue;
    }
    if ("+-*/%<>!".includes(ch)) {
      tokens.push({ kind: "op", value: ch, pos: i++ });
      continue;
    }

    // Strings ("..." or '...')
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = i++;
      let out = "";
      let closed = false;
      while (i < n) {
        const c = input[i++];
        if (c === "\\") {
          if (i >= n) throw new Error(`位置 ${start + 1} 处字符串转义未结束`);
          const esc = input[i++];
          if (esc === "n") out += "\n";
          else if (esc === "t") out += "\t";
          else if (esc === "r") out += "\r";
          else out += esc;
        } else if (c === quote) {
          closed = true;
          break;
        } else {
          out += c;
        }
      }
      if (!closed) throw new Error(`位置 ${start + 1} 处字符串缺少闭合引号`);
      tokens.push({ kind: "string", value: out, pos: start });
      continue;
    }

    // Numbers
    if (/[0-9]/.test(ch) || (ch === "." && i + 1 < n && /[0-9]/.test(input[i + 1]))) {
      const start = i;
      let dot = false;
      while (i < n && (/[0-9]/.test(input[i]) || (!dot && input[i] === "."))) {
        if (input[i] === ".") dot = true;
        i++;
      }
      tokens.push({ kind: "number", value: input.slice(start, i), pos: start });
      continue;
    }

    // Identifiers
    if (/[a-zA-Z_]/.test(ch)) {
      const start = i;
      while (i < n && /[a-zA-Z0-9_]/.test(input[i])) i++;
      tokens.push({ kind: "ident", value: input.slice(start, i), pos: start });
      continue;
    }

    throw new Error(`位置 ${i + 1} 处出现无法识别的字符「${ch}」`);
  }

  tokens.push({ kind: "eof", value: "", pos: n });
  return tokens;
}

class Parser {
  private pos = 0;
  private nodes = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private next(): Token {
    return this.tokens[this.pos++];
  }

  private bump(): void {
    this.nodes++;
    if (this.nodes > MAX_AST_NODES) throw new Error("公式过于复杂");
  }

  parse(): Expr {
    const expr = this.parseTernary();
    if (this.peek().kind !== "eof") {
      throw new Error(`位置 ${this.peek().pos + 1} 处有多余内容「${this.peek().value}」`);
    }
    return expr;
  }

  private parseTernary(): Expr {
    let expr = this.parseOr();
    if (this.peek().kind === "question") {
      this.next();
      const thenBranch = this.parseTernary();
      if (this.peek().kind !== "colon") throw new Error("三元表达式缺少冒号 :");
      this.next();
      const elseBranch = this.parseTernary();
      this.bump();
      expr = { type: "ternary", cond: expr, thenBranch, elseBranch };
    }
    return expr;
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.peek().kind === "op" && this.peek().value === "||") {
      const op = this.next().value;
      const right = this.parseAnd();
      this.bump();
      left = { type: "binary", op, left, right };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseEquality();
    while (this.peek().kind === "op" && this.peek().value === "&&") {
      const op = this.next().value;
      const right = this.parseEquality();
      this.bump();
      left = { type: "binary", op, left, right };
    }
    return left;
  }

  private parseEquality(): Expr {
    let left = this.parseCompare();
    while (this.peek().kind === "op" && (this.peek().value === "==" || this.peek().value === "!=")) {
      const op = this.next().value;
      const right = this.parseCompare();
      this.bump();
      left = { type: "binary", op, left, right };
    }
    return left;
  }

  private parseCompare(): Expr {
    let left = this.parseAdd();
    while (this.peek().kind === "op" && ["<", "<=", ">", ">="].includes(this.peek().value)) {
      const op = this.next().value;
      const right = this.parseAdd();
      this.bump();
      left = { type: "binary", op, left, right };
    }
    return left;
  }

  private parseAdd(): Expr {
    let left = this.parseMul();
    while (this.peek().kind === "op" && (this.peek().value === "+" || this.peek().value === "-")) {
      const op = this.next().value;
      const right = this.parseMul();
      this.bump();
      left = { type: "binary", op, left, right };
    }
    return left;
  }

  private parseMul(): Expr {
    let left = this.parseUnary();
    while (this.peek().kind === "op" && (this.peek().value === "*" || this.peek().value === "/" || this.peek().value === "%")) {
      const op = this.next().value;
      const right = this.parseUnary();
      this.bump();
      left = { type: "binary", op, left, right };
    }
    return left;
  }

  private parseUnary(): Expr {
    if (this.peek().kind === "op" && (this.peek().value === "!" || this.peek().value === "-")) {
      const op = this.next().value as "!" | "-";
      const arg = this.parseUnary();
      this.bump();
      return { type: "unary", op, arg };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const tok = this.peek();
    if (tok.kind === "number") {
      this.next();
      this.bump();
      return { type: "literal", value: Number(tok.value) };
    }
    if (tok.kind === "string") {
      this.next();
      this.bump();
      return { type: "literal", value: tok.value };
    }
    if (tok.kind === "ident") {
      this.next();
      if (tok.value === "true") {
        this.bump();
        return { type: "literal", value: true };
      }
      if (tok.value === "false") {
        this.bump();
        return { type: "literal", value: false };
      }
      if (tok.value === "null" || tok.value === "emptyValue") {
        this.bump();
        return { type: "literal", value: null };
      }
      if (this.peek().kind === "lparen") {
        this.next();
        const args: Expr[] = [];
        if (this.peek().kind !== "rparen") {
          while (true) {
            args.push(this.parseTernary());
            if (this.peek().kind === "comma") {
              this.next();
              continue;
            }
            break;
          }
        }
        if (this.peek().kind !== "rparen") {
          throw new Error(`函数 ${tok.value} 缺少右括号 )`);
        }
        this.next();
        this.bump();
        return { type: "call", name: tok.value, args };
      }
      this.bump();
      return { type: "ident", name: tok.value };
    }
    if (tok.kind === "lparen") {
      this.next();
      const inner = this.parseTernary();
      if (this.peek().kind !== "rparen") throw new Error("缺少闭合右括号 )");
      this.next();
      return inner;
    }
    throw new Error(`位置 ${tok.pos + 1} 处表达式不完整`);
  }
}

export function parseFormula(expression: string): Expr {
  const trimmed = expression.trim();
  if (!trimmed) throw new Error("公式不能为空");
  return new Parser(tokenize(trimmed)).parse();
}

export function extractFormulaDependencies(expression: string): string[] {
  const out = new Set<string>();
  const walk = (node: Expr) => {
    switch (node.type) {
      case "call":
        if (node.name === "prop" && node.args.length === 1 && node.args[0].type === "literal" && typeof node.args[0].value === "string") {
          out.add(node.args[0].value);
        }
        node.args.forEach(walk);
        break;
      case "unary":
        walk(node.arg);
        break;
      case "binary":
        walk(node.left);
        walk(node.right);
        break;
      case "ternary":
        walk(node.cond);
        walk(node.thenBranch);
        walk(node.elseBranch);
        break;
      default:
        break;
    }
  };
  try {
    walk(parseFormula(expression));
  } catch {
    // Fallback regex if syntax is currently incomplete
    for (const m of expression.matchAll(/\bprop\(\s*["']([^"']+)["']\s*\)/g)) {
      out.add(m[1]);
    }
  }
  return [...out];
}

/** Convert stored prop("<id>") expressions to readable prop("<name>") for UI editing */
export function formulaIdsToNames(expression: string, properties: readonly PropertyDefinition[]): string {
  const byId = new Map(properties.map((p) => [p.id, p.name]));
  return expression.replace(/\bprop\(\s*(["'])([^"']+)\1\s*\)/g, (full, q: string, key: string) => {
    const name = byId.get(key);
    if (!name) return full;
    const escaped = name.replace(/\\/g, "\\\\").replace(new RegExp(q, "g"), `\\${q}`);
    return `prop(${q}${escaped}${q})`;
  });
}

/** Convert UI prop("<name>") expressions to stable prop("<id>") for storage */
export function formulaNamesToIds(expression: string, properties: readonly PropertyDefinition[]): string {
  const active = properties.filter((p) => !p.deletedAt);
  const byId = new Set(properties.map((p) => p.id));
  const byName = new Map(active.map((p) => [p.name, p.id]));
  return expression.replace(/\bprop\(\s*(["'])((?:\\.|[^"'\\])*)\1\s*\)/g, (full, q: string, raw: string) => {
    const unescaped = raw.replace(/\\(.)/g, "$1");
    if (byId.has(unescaped)) return full;
    const id = byName.get(unescaped);
    if (!id) return full;
    return `prop("${id}")`;
  });
}

function isEmptyVal(v: FormulaValue): boolean {
  return v === null || v === "" || (typeof v === "number" && Number.isNaN(v));
}

function toBool(v: FormulaValue): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0 && !Number.isNaN(v);
  if (typeof v === "string") return v.length > 0;
  return false;
}

function toNum(v: FormulaValue): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toStr(v: FormulaValue): string {
  if (v === null) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

const KNOWN_FUNCTIONS = new Set([
  "prop",
  "if",
  "empty",
  "and",
  "or",
  "not",
  "abs",
  "round",
  "floor",
  "ceil",
  "min",
  "max",
  "pow",
  "sqrt",
  "concat",
  "join",
  "length",
  "lower",
  "upper",
  "trim",
  "contains",
  "replace",
  "slice",
  "toNumber",
  "format",
  "now",
  "today",
  "dateBetween",
  "dateAdd",
  "year",
  "month",
  "day",
  "formatDate",
]);

export const FORMULA_FUNCTIONS_HELP: { name: string; sig: string; desc: string }[] = [
  { name: "prop", sig: 'prop("字段名")', desc: "读取当前行指定字段的值" },
  { name: "if", sig: "if(条件, 真值, 假值)", desc: "条件分支判断" },
  { name: "empty", sig: "empty(值)", desc: "判断值是否为空" },
  { name: "round", sig: "round(数字, 小数位)", desc: "四舍五入" },
  { name: "abs / floor / ceil", sig: "abs(x) / floor(x) / ceil(x)", desc: "绝对值/向下/向上取整" },
  { name: "min / max", sig: "min(a, b, ...) / max(a, b, ...)", desc: "最小值/最大值" },
  { name: "concat / join", sig: 'concat(a, b) / join("-", a, b)', desc: "拼接文本" },
  { name: "length / lower / upper / trim", sig: "length(文本)", desc: "文本长度与大小写/去空格" },
  { name: "contains / replace / slice", sig: 'contains(文本, 子串)', desc: "包含、替换、截取文本" },
  { name: "toNumber / format", sig: "toNumber(文本) / format(值)", desc: "转数字或转文本" },
  { name: "today / now", sig: "today() / now()", desc: "当前日期 (YYYY-MM-DD) 或时间戳" },
  { name: "dateBetween / dateAdd", sig: "dateBetween(日期A, 日期B)", desc: "日期相差天数 / 加减天数" },
  { name: "year / month / day", sig: "year(日期)", desc: "提取年、月、日数字" },
];

export function validateFormulaSyntax(expression: string): string | null {
  try {
    const ast = parseFormula(expression);
    const check = (node: Expr): string | null => {
      if (node.type === "call") {
        if (!KNOWN_FUNCTIONS.has(node.name)) {
          return `不支持的函数「${node.name}」`;
        }
        if (node.name === "prop") {
          if (node.args.length !== 1 || node.args[0].type !== "literal" || typeof node.args[0].value !== "string") {
            return 'prop() 需要传入一个字段名称字符串，例如 prop("金额")';
          }
        }
        for (const a of node.args) {
          const err = check(a);
          if (err) return err;
        }
      } else if (node.type === "unary") {
        return check(node.arg);
      } else if (node.type === "binary") {
        return check(node.left) ?? check(node.right);
      } else if (node.type === "ternary") {
        return check(node.cond) ?? check(node.thenBranch) ?? check(node.elseBranch);
      } else if (node.type === "ident") {
        return `未知标识符「${node.name}」（读取字段请使用 prop("${node.name}")）`;
      }
      return null;
    };
    return check(ast);
  } catch (e) {
    return e instanceof Error ? e.message : "公式语法无效";
  }
}

export interface FormulaEvalContext {
  getProperty: (idOrName: string) => FormulaValue;
  now?: Date;
}

function evalExpr(node: Expr, ctx: FormulaEvalContext): FormulaValue {
  switch (node.type) {
    case "literal":
      return node.value;
    case "ident":
      return ctx.getProperty(node.name);
    case "unary": {
      const v = evalExpr(node.arg, ctx);
      if (node.op === "!") return !toBool(v);
      const n = toNum(v);
      return n === null ? null : -n;
    }
    case "ternary":
      return toBool(evalExpr(node.cond, ctx)) ? evalExpr(node.thenBranch, ctx) : evalExpr(node.elseBranch, ctx);
    case "binary": {
      if (node.op === "&&") return toBool(evalExpr(node.left, ctx)) && toBool(evalExpr(node.right, ctx));
      if (node.op === "||") return toBool(evalExpr(node.left, ctx)) || toBool(evalExpr(node.right, ctx));
      const l = evalExpr(node.left, ctx);
      const r = evalExpr(node.right, ctx);
      switch (node.op) {
        case "+": {
          if (typeof l === "string" || typeof r === "string") return toStr(l) + toStr(r);
          const ln = toNum(l);
          const rn = toNum(r);
          if (ln === null && rn === null) return null;
          return (ln ?? 0) + (rn ?? 0);
        }
        case "-": {
          const ln = toNum(l);
          const rn = toNum(r);
          return ln === null || rn === null ? null : ln - rn;
        }
        case "*": {
          const ln = toNum(l);
          const rn = toNum(r);
          return ln === null || rn === null ? null : ln * rn;
        }
        case "/": {
          const ln = toNum(l);
          const rn = toNum(r);
          return ln === null || rn === null || rn === 0 ? null : ln / rn;
        }
        case "%": {
          const ln = toNum(l);
          const rn = toNum(r);
          return ln === null || rn === null || rn === 0 ? null : ln % rn;
        }
        case "==":
          return l === r || (l !== null && r !== null && String(l) === String(r));
        case "!=":
          return !(l === r || (l !== null && r !== null && String(l) === String(r)));
        case "<":
        case "<=":
        case ">":
        case ">=": {
          if (l === null || r === null) return false;
          const ln = toNum(l);
          const rn = toNum(r);
          const cmp = ln !== null && rn !== null ? ln - rn : toStr(l).localeCompare(toStr(r));
          if (node.op === "<") return cmp < 0;
          if (node.op === "<=") return cmp <= 0;
          if (node.op === ">") return cmp > 0;
          return cmp >= 0;
        }
        default:
          return null;
      }
    }
    case "call": {
      const fn = node.name;
      if (fn === "prop") {
        const key = node.args[0] ? evalExpr(node.args[0], ctx) : null;
        return typeof key === "string" ? ctx.getProperty(key) : null;
      }
      if (fn === "if") {
        if (node.args.length < 2) return null;
        return toBool(evalExpr(node.args[0], ctx))
          ? evalExpr(node.args[1], ctx)
          : node.args[2]
            ? evalExpr(node.args[2], ctx)
            : null;
      }
      if (fn === "and") return node.args.every((a) => toBool(evalExpr(a, ctx)));
      if (fn === "or") return node.args.some((a) => toBool(evalExpr(a, ctx)));
      const args = node.args.map((a) => evalExpr(a, ctx));
      switch (fn) {
        case "not":
          return !toBool(args[0] ?? null);
        case "empty":
          return isEmptyVal(args[0] ?? null);
        case "abs": {
          const n = toNum(args[0] ?? null);
          return n === null ? null : Math.abs(n);
        }
        case "round": {
          const n = toNum(args[0] ?? null);
          if (n === null) return null;
          const digits = toNum(args[1] ?? 0) ?? 0;
          const factor = 10 ** Math.max(0, Math.min(8, Math.trunc(digits)));
          return Math.round(n * factor) / factor;
        }
        case "floor": {
          const n = toNum(args[0] ?? null);
          return n === null ? null : Math.floor(n);
        }
        case "ceil": {
          const n = toNum(args[0] ?? null);
          return n === null ? null : Math.ceil(n);
        }
        case "min": {
          const nums = args.map(toNum).filter((x): x is number => x !== null);
          return nums.length ? Math.min(...nums) : null;
        }
        case "max": {
          const nums = args.map(toNum).filter((x): x is number => x !== null);
          return nums.length ? Math.max(...nums) : null;
        }
        case "pow": {
          const a = toNum(args[0] ?? null);
          const b = toNum(args[1] ?? null);
          if (a === null || b === null) return null;
          const res = Math.pow(a, b);
          return Number.isFinite(res) ? res : null;
        }
        case "sqrt": {
          const a = toNum(args[0] ?? null);
          return a === null || a < 0 ? null : Math.sqrt(a);
        }
        case "concat":
          return args.map(toStr).join("");
        case "join": {
          const sep = toStr(args[0] ?? "");
          return args
            .slice(1)
            .map(toStr)
            .filter((s) => s !== "")
            .join(sep);
        }
        case "length":
          return toStr(args[0] ?? null).length;
        case "lower":
          return toStr(args[0] ?? null).toLowerCase();
        case "upper":
          return toStr(args[0] ?? null).toUpperCase();
        case "trim":
          return toStr(args[0] ?? null).trim();
        case "contains":
          return toStr(args[0] ?? null).includes(toStr(args[1] ?? null));
        case "replace":
          return toStr(args[0] ?? null).replaceAll(toStr(args[1] ?? null), toStr(args[2] ?? null));
        case "slice": {
          const s = toStr(args[0] ?? null);
          const start = toNum(args[1] ?? 0) ?? 0;
          const end = args[2] !== undefined ? (toNum(args[2]) ?? undefined) : undefined;
          return s.slice(start, end);
        }
        case "toNumber":
          return toNum(args[0] ?? null);
        case "format":
          return toStr(args[0] ?? null);
        case "today":
          return localDay(ctx.now ?? new Date());
        case "now":
          return (ctx.now ?? new Date()).toISOString();
        case "dateBetween": {
          const a = parseDateCell(args[0]);
          const b = parseDateCell(args[1]);
          return a && b ? diffDays(a.start, b.start) : null;
        }
        case "dateAdd": {
          const d = parseDateCell(args[0]);
          const delta = toNum(args[1] ?? null);
          return d && delta !== null ? addDays(d.start, Math.trunc(delta)) : null;
        }
        case "year": {
          const d = parseDateCell(args[0]);
          return d ? Number(d.start.slice(0, 4)) : null;
        }
        case "month": {
          const d = parseDateCell(args[0]);
          return d ? Number(d.start.slice(5, 7)) : null;
        }
        case "day": {
          const d = parseDateCell(args[0]);
          return d ? Number(d.start.slice(8, 10)) : null;
        }
        case "formatDate": {
          const d = parseDateCell(args[0]);
          return d ? d.start : "";
        }
        default:
          return null;
      }
    }
  }
}

export function coerceComputedResult(
  raw: FormulaValue,
  resultType: ComputedResultType,
): string | number | boolean | undefined {
  if (raw === null) return undefined;
  switch (resultType) {
    case "number": {
      const n = toNum(raw);
      return n === null ? undefined : Math.round(n * 1_000_000) / 1_000_000;
    }
    case "checkbox":
      return toBool(raw);
    case "date": {
      const p = parseDateCell(raw);
      return p ? p.start : undefined;
    }
    case "text":
    default: {
      const s = toStr(raw);
      return s === "" ? undefined : s;
    }
  }
}

export function evaluateFormula(
  expression: string,
  resultType: ComputedResultType,
  ctx: FormulaEvalContext,
): string | number | boolean | undefined {
  try {
    const ast = parseFormula(expression);
    const val = evalExpr(ast, ctx);
    return coerceComputedResult(val, resultType);
  } catch {
    return undefined;
  }
}
