import stylisticPlugin from '@stylistic/eslint-plugin';
import * as tsParser from '@typescript-eslint/parser';
import { Linter } from 'eslint/universal';
import ts from 'typescript';
import type { FormatConfig } from './config';
import type { FormatResult } from './html';

const LIFECYCLE_HOOKS = [
  'ngOnChanges',
  'ngOnInit',
  'ngDoCheck',
  'ngAfterContentInit',
  'ngAfterContentChecked',
  'ngAfterViewInit',
  'ngAfterViewChecked',
  'ngOnDestroy',
];

/** A file name the lint config matches; the real path only matters for messages. */
const LINT_FILE = 'file.ts';

interface Edit {
  start: number;
  end: number;
  text: string;
}

interface Context {
  config: FormatConfig;
  unit: string;
  linter: Linter;
  fixConfig: Linter.Config[];
  maxLenConfig: Linter.Config[];
}

type Pass = [name: string, run: (text: string, ctx: Context) => string];

const PASSES: Pass[] = [
  ['lifecycle order', lifecycleOrder],
  ['arrow bodies', arrowBodies],
  ['long lines', longLines],
  ['arrow bodies', arrowBodies],
  ['stylistic', stylistic],
];

/** `reorder: false` leaves class members where they are, so every edit stays near the code it formats. */
export function formatTs(source: string, filePath: string, config: FormatConfig, { reorder = true } = {}): FormatResult {
  const text = source.replace(/\r\n?/g, '\n');
  const before = parse(text);
  if (diagnostics(before).length) {
    return { error: `${filePath} has syntax errors` };
  }
  const ctx = context(config);
  const passes = reorder ? PASSES : PASSES.filter(([name]) => name !== 'lifecycle order');

  const first = runPasses(text, ctx, passes);
  if ('error' in first) {
    return first;
  }
  if (first.stylisticFixed) {
    const second = runPasses(first.text, ctx, passes);
    if ('error' in second) {
      return second;
    }
    if (second.text !== first.text) {
      return { error: `the "${second.changedBy}" pass changes the output again on a second run` };
    }
  }

  const after = parse(first.text);
  if (diagnostics(after).length) {
    return { error: 'formatted output has syntax errors' };
  }
  const reordered = reorder ? parse(lifecycleOrder(text, ctx)) : before;
  if (tokens(reordered).sort().join('\n') !== tokens(before).sort().join('\n')) {
    return { error: 'the lifecycle order pass changed the tokens' };
  }
  if (normalize(tokens(after)).join('\n') !== normalize(tokens(reordered)).join('\n')) {
    return { error: 'formatted output does not match the source tokens' };
  }
  return { text: first.text.endsWith('\n') ? first.text : `${first.text}\n` };
}

function runPasses(
  text: string,
  ctx: Context,
  passes: Pass[],
): { text: string; stylisticFixed: boolean; changedBy?: string } | { error: string } {
  let changedBy: string | undefined;
  let stylisticFixed = false;
  for (const [name, run] of passes) {
    let next: string;
    try {
      next = run(text, ctx);
    } catch (error) {
      return { error: `the "${name}" pass failed: ${error instanceof Error ? error.message : error}` };
    }
    if (next !== text) {
      changedBy ??= name;
      stylisticFixed ||= name === 'stylistic';
    }
    text = next;
  }
  return { text, stylisticFixed, changedBy };
}

const contexts = new Map<string, Context>();

function context(config: FormatConfig): Context {
  const key = JSON.stringify(config);
  const cached = contexts.get(key);
  if (cached) {
    return cached;
  }
  const plugin = stylisticPlugin as unknown as { rules: Record<string, unknown> };
  const rules = Object.fromEntries(Object.entries(config.stylistic)
    .filter(([name]) => name !== '@stylistic/max-len' && name.slice('@stylistic/'.length) in plugin.rules));
  const maxLen = config.stylistic['@stylistic/max-len'] ?? ['error', { code: config.printWidth }];
  const base = {
    files: ['**/*.ts'],
    languageOptions: { parser: tsParser },
    plugins: { '@stylistic': stylisticPlugin },
  } as Linter.Config;
  const ctx: Context = {
    config,
    unit: ' '.repeat(config.indent),
    linter: new Linter({ configType: 'flat' }),
    fixConfig: [{ ...base, rules: rules as Linter.RulesRecord }],
    maxLenConfig: [{ ...base, rules: { '@stylistic/max-len': maxLen as Linter.RuleEntry } }],
  };
  contexts.set(key, ctx);
  return ctx;
}

export function parse(text: string): ts.SourceFile {
  return ts.createSourceFile(LINT_FILE, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

export function diagnostics(sf: ts.SourceFile): readonly ts.Diagnostic[] {
  return (sf as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics;
}

function applyEdits(text: string, edits: Edit[]): string {
  let result = text;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return result;
}

function lineIndent(sf: ts.SourceFile, pos: number): string {
  const line = sf.getLineAndCharacterOfPosition(pos).line;
  const start = sf.getLineStarts()[line];
  return /^[ \t]*/.exec(sf.text.slice(start))![0];
}

function lineOf(sf: ts.SourceFile, pos: number): number {
  return sf.getLineAndCharacterOfPosition(pos).line;
}

/** The leaf tokens under a node, JSDoc left out. */
function leaves(node: ts.Node, sf: ts.SourceFile, out: ts.Node[] = []): ts.Node[] {
  if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) {
    return out;
  }
  const children = node.getChildren(sf);
  if (!children.length) {
    if (node.kind !== ts.SyntaxKind.EndOfFileToken && node.end > node.getStart(sf)) {
      out.push(node);
    }
    return out;
  }
  for (const child of children) {
    leaves(child, sf, out);
  }
  return out;
}

/** Whether only whitespace lies between consecutive tokens of a node. */
function hasComments(node: ts.Node, sf: ts.SourceFile): boolean {
  const list = leaves(node, sf);
  return list.some((leaf, i) => i > 0 && !/^\s*$/.test(sf.text.slice(list[i - 1].end, leaf.getStart(sf))));
}

function tokens(sf: ts.SourceFile): string[] {
  return leaves(sf, sf).map(leaf => (ts.isStringLiteral(leaf) || ts.isNoSubstitutionTemplateLiteral(leaf)
    ? `S${JSON.stringify(leaf.text)}`
    : leaf.getText(sf)));
}

const CLOSERS = new Set([')', ']', '}', '>']);

/** Leaves out what the passes may add or remove: semicolons, trailing commas, `{ return …; }` and `({ … })`. */
function normalize(list: string[]): string[] {
  const out = list.filter((token, i) => token !== ';' && !(token === ',' && CLOSERS.has(list[i + 1])));
  for (let i = 0; i < out.length; i++) {
    if (out[i] !== '=>') {
      continue;
    }
    if (out[i + 1] === '{' && out[i + 2] === 'return') {
      const close = matching(out, i + 1, '{', '}');
      out.splice(close, 1);
      out.splice(i + 1, 2);
    }
    if (out[i + 1] === '(' && out[i + 2] === '{') {
      const close = matching(out, i + 1, '(', ')');
      if (out[close - 1] === '}' && matching(out, i + 2, '{', '}') === close - 1) {
        out.splice(close, 1);
        out.splice(i + 1, 1);
      }
    }
  }
  return out;
}

function matching(list: string[], open: number, opener: string, closer: string): number {
  let depth = 0;
  for (let i = open; i < list.length; i++) {
    depth += list[i] === opener ? 1 : list[i] === closer ? -1 : 0;
    if (depth === 0) {
      return i;
    }
  }
  return list.length;
}

// Lifecycle order

function lifecycleOrder(text: string, ctx: Context): string {
  const sf = parse(text);
  const edits: Edit[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      const edit = reorderClass(node, sf);
      if (edit) {
        edits.push(edit);
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return edits.length ? lifecycleOrder(applyEdits(text, edits), ctx) : text;
}

function hookName(member: ts.ClassElement): string | undefined {
  return ts.isMethodDeclaration(member) && ts.isIdentifier(member.name) && LIFECYCLE_HOOKS.includes(member.name.text)
    ? member.name.text
    : undefined;
}

function reorderClass(node: ts.ClassLikeDeclaration, sf: ts.SourceFile): Edit | undefined {
  const members = [...node.members];
  const hooks = members.filter(hookName);
  if (!hooks.length || new Set(hooks.map(hookName)).size !== hooks.length) {
    return undefined;
  }
  // Hooks go after the fields and constructor that open the class, before its first other method.
  const isField = (member: ts.ClassElement): boolean => ts.isPropertyDeclaration(member) || ts.isConstructorDeclaration(member)
    || ts.isIndexSignatureDeclaration(member) || ts.isSemicolonClassElement(member) || ts.isClassStaticBlockDeclaration(member);
  const firstMethod = members.findIndex(member => !hookName(member) && !isField(member));
  const split = firstMethod === -1 ? members.length : firstMethod;
  const head = members.slice(0, split).filter(member => !hookName(member));
  const sorted = [...hooks].sort((a, b) => LIFECYCLE_HOOKS.indexOf(hookName(a)!) - LIFECYCLE_HOOKS.indexOf(hookName(b)!));
  const tail = members.slice(split).filter(member => !hookName(member));
  const order = [...head, ...sorted, ...tail];
  if (order.every((member, i) => member === members[i])) {
    return undefined;
  }

  // Each member keeps its comments and decorators; the blank lines before it stay with its position.
  const lead = (member: ts.ClassElement): string => /^\s*/.exec(sf.text.slice(member.getFullStart(), member.end))![0];
  const newlines = (member: ts.ClassElement): string => lead(member).replace(/[^\n]/g, '');
  const body = (member: ts.ClassElement): string => {
    const full = sf.text.slice(member.getFullStart(), member.end);
    return full.slice(full.lastIndexOf('\n', lead(member).length - 1) + 1);
  };
  const text = order.map((member, i) => {
    const sep = newlines(members[i]) || '\n';
    return sep + body(member);
  }).join('');
  return { start: members[0].getFullStart(), end: members.at(-1)!.end, text };
}

// Arrow bodies

function arrowBodies(text: string, ctx: Context): string {
  for (let round = 0; round < 20; round++) {
    const sf = parse(text);
    const edits: Edit[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
        const edit = arrowEdit(node, node.body, sf, ctx);
        if (edit) {
          edits.push(edit);
          return;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    if (!edits.length) {
      return text;
    }
    text = applyEdits(text, edits);
  }
  return text;
}

const GLUE_AFTER = new Set(['(', '[']);
const GLUE_BEFORE = new Set([')', ']', ',', '.', '?.', ';']);

function arrowEdit(arrow: ts.ArrowFunction, body: ts.Expression, sf: ts.SourceFile, ctx: Context): Edit | undefined {
  const text = sf.text;
  const arrowToken = arrow.equalsGreaterThanToken;
  const bodyStart = body.getStart(sf);
  if (lineOf(sf, arrowToken.getStart(sf)) === lineOf(sf, body.end)) {
    return undefined;
  }
  if (!/^\s*$/.test(text.slice(arrowToken.end, bodyStart)) || hasComments(body, sf)) {
    return undefined;
  }
  const list = leaves(body, sf);
  if (list.some(leaf => leaf.getText(sf).includes('\n'))) {
    return undefined;
  }

  // A closing bracket or comma on the line after the body moves up to it.
  const gapAfter = /^\s*/.exec(text.slice(body.end))![0];
  const next = text[body.end + gapAfter.length];
  const end = gapAfter.includes('\n') && /[)\],;]/.test(next ?? '') ? body.end + gapAfter.length : body.end;

  let joined = '';
  for (const [i, leaf] of list.entries()) {
    const token = leaf.getText(sf);
    if (i > 0) {
      const previous = list[i - 1].getText(sf);
      const gap = text.slice(list[i - 1].end, leaf.getStart(sf));
      if (!gap.includes('\n')) {
        joined += gap;
      } else if (!GLUE_AFTER.has(previous) && !GLUE_BEFORE.has(token)) {
        joined += ' ';
      }
    }
    const trailingComma = token === ',' && CLOSERS.has(list[i + 1]?.getText(sf) ?? '')
      && text.slice(leaf.end, list[i + 1].getStart(sf)).includes('\n');
    if (!trailingComma) {
      joined += token;
    }
  }
  const lineStart = sf.getLineStarts()[lineOf(sf, arrowToken.getStart(sf))];
  const restEnd = text.indexOf('\n', end);
  const line = text.slice(lineStart, arrowToken.end) + ' ' + joined + text.slice(end, restEnd === -1 ? text.length : restEnd);
  if (line.length <= ctx.config.printWidth) {
    return { start: arrowToken.end, end, text: ` ${joined}` };
  }

  const inner = ts.isParenthesizedExpression(body) && ts.isObjectLiteralExpression(body.expression)
    ? body.expression
    : body;
  const base = lineIndent(sf, arrowToken.getStart(sf));
  const returnIndent = base + ctx.unit;
  const delta = returnIndent.length - lineIndent(sf, inner.getStart(sf)).length;
  const lines = text.slice(inner.getStart(sf), inner.end).split('\n');
  const shifted = [lines[0], ...lines.slice(1).map(line => shift(line, delta))].join('\n');
  return { start: arrowToken.end, end, text: ` {\n${returnIndent}return ${shifted};\n${base}}` };
}

function shift(line: string, delta: number): string {
  if (delta >= 0) {
    return line.trim() ? ' '.repeat(delta) + line : line;
  }
  const remove = Math.min(-delta, /^ */.exec(line)![0].length);
  return line.slice(remove);
}

// Long lines

function longLines(text: string, ctx: Context): string {
  for (let round = 0; round < 50; round++) {
    const long = ctx.linter.verify(text, ctx.maxLenConfig, { filename: LINT_FILE })
      .filter(message => message.ruleId === '@stylistic/max-len')
      .map(message => message.line - 1);
    if (!long.length) {
      return text;
    }
    const sf = parse(text);
    const edits = long.map(line => splitLine(sf, line, ctx)).filter(edit => edit !== undefined);
    const kept = edits.filter((edit, i) => !edits.some((other, j) => j < i && other.start < edit.end && edit.start < other.end));
    if (!kept.length) {
      return text;
    }
    text = applyEdits(text, kept);
  }
  return text;
}

interface Candidate {
  rank: number;
  depth: number;
  edit: Edit;
}

function splitLine(sf: ts.SourceFile, line: number, ctx: Context): Edit | undefined {
  let best: Candidate | undefined;
  const consider = (rank: number, depth: number, edit: Edit | undefined): void => {
    if (edit && (!best || rank < best.rank || (rank === best.rank && depth < best.depth))) {
      best = { rank, depth, edit };
    }
  };
  const onLine = (start: number, end: number): boolean => lineOf(sf, start) === line && lineOf(sf, end) === line;

  const visit = (node: ts.Node, depth: number): void => {
    if (node.end < sf.getLineStarts()[line] || node.getStart(sf) > (sf.getLineStarts()[line + 1] ?? sf.text.length)) {
      return;
    }
    const list = listOf(node);
    if (list && list.elements.length && onLine(list.open.getStart(sf), list.close.end)) {
      consider(list.rank, depth, splitList(sf, list.open, list.elements, list.close, ctx));
    }
    const chain = chainOf(node);
    if (chain && onLine(node.getStart(sf), node.end)) {
      consider(chain.rank, depth, splitChain(sf, node, chain.operands, chain.operators, ctx));
    }
    ts.forEachChild(node, child => visit(child, depth + 1));
  };
  visit(sf, 0);
  return best?.edit;
}

interface List {
  rank: number;
  open: ts.Node;
  elements: readonly ts.Node[];
  close: ts.Node;
}

function listOf(node: ts.Node): List | undefined {
  const children = node.getChildren();
  const open = (kind: ts.SyntaxKind): ts.Node | undefined => children.find(child => child.kind === kind);
  const close = (kind: ts.SyntaxKind): ts.Node | undefined => children.findLast(child => child.kind === kind);
  const make = (rank: number, elements: readonly ts.Node[], openKind: ts.SyntaxKind, closeKind: ts.SyntaxKind) => {
    const first = open(openKind);
    const last = close(closeKind);
    return first && last ? { rank, open: first, elements, close: last } : undefined;
  };

  // A lone object or array argument is split itself, not moved onto a line of its own.
  const hugged = (elements: readonly ts.Node[]): boolean => elements.length === 1
    && (ts.isObjectLiteralExpression(elements[0]) || ts.isArrayLiteralExpression(elements[0]));

  if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && node.arguments && !hugged(node.arguments)) {
    return make(1, node.arguments, ts.SyntaxKind.OpenParenToken, ts.SyntaxKind.CloseParenToken);
  }
  if (ts.isFunctionLike(node) && 'body' in node && node.parameters.length) {
    if (ts.isArrowFunction(node) && !open(ts.SyntaxKind.OpenParenToken)) {
      return undefined;
    }
    return make(1, node.parameters, ts.SyntaxKind.OpenParenToken, ts.SyntaxKind.CloseParenToken);
  }
  if (ts.isArrayLiteralExpression(node)) {
    return make(2, node.elements, ts.SyntaxKind.OpenBracketToken, ts.SyntaxKind.CloseBracketToken);
  }
  if (ts.isObjectLiteralExpression(node)) {
    return make(2, node.properties, ts.SyntaxKind.OpenBraceToken, ts.SyntaxKind.CloseBraceToken);
  }
  return undefined;
}

function splitList(sf: ts.SourceFile, open: ts.Node, elements: readonly ts.Node[], close: ts.Node, ctx: Context): Edit | undefined {
  const text = sf.text;
  const between = [
    text.slice(open.end, elements[0].getStart(sf)),
    ...elements.slice(1).map((element, i) => text.slice(elements[i].end, element.getStart(sf))),
    text.slice(elements.at(-1)!.end, close.getStart(sf)),
  ];
  if (!between.every(gap => /^[\s,]*$/.test(gap))) {
    return undefined;
  }
  const base = lineIndent(sf, open.getStart(sf));
  const inner = base + ctx.unit;
  const body = elements.map(element => inner + element.getText(sf)).join(',\n');
  // Trailing commas in every multi-line list, except after a rest parameter, where they are a syntax error.
  const last = elements.at(-1)!;
  const comma = ts.isParameter(last) && last.dotDotDotToken ? '' : ',';
  return { start: open.end, end: close.getStart(sf), text: `\n${body}${comma}\n${base}` };
}

interface Chain {
  rank: number;
  operands: ts.Node[];
  operators: ts.Node[];
}

const ASSIGNMENTS = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.CommaToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

function chainOf(node: ts.Node): Chain | undefined {
  if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) {
    const operators = node.getChildren().flatMap(child => [child, ...child.getChildren()])
      .filter(child => child.kind === ts.SyntaxKind.BarToken || child.kind === ts.SyntaxKind.AmpersandToken);
    return operators.length === node.types.length - 1 ? { rank: 3, operands: [...node.types], operators } : undefined;
  }
  if (ts.isBinaryExpression(node) && !ASSIGNMENTS.has(node.operatorToken.kind)) {
    const kind = node.operatorToken.kind;
    const operands: ts.Node[] = [node.right];
    const operators: ts.Node[] = [node.operatorToken];
    let left: ts.Expression = node.left;
    while (ts.isBinaryExpression(left) && left.operatorToken.kind === kind) {
      operands.unshift(left.right);
      operators.unshift(left.operatorToken);
      left = left.left;
    }
    operands.unshift(left);
    return { rank: 4, operands, operators };
  }
  if (ts.isConditionalExpression(node)) {
    return { rank: 4, operands: [node.condition, node.whenTrue, node.whenFalse], operators: [node.questionToken, node.colonToken] };
  }
  return undefined;
}

/** Breaks before each operator: `operator-linebreak: before`. */
function splitChain(sf: ts.SourceFile, node: ts.Node, operands: ts.Node[], operators: ts.Node[], ctx: Context): Edit | undefined {
  const text = sf.text;
  const gaps = operators.flatMap((operator, i) => [
    text.slice(operands[i].end, operator.getStart(sf)),
    text.slice(operator.end, operands[i + 1].getStart(sf)),
  ]);
  if (!gaps.every(gap => /^\s*$/.test(gap))) {
    return undefined;
  }
  const inner = lineIndent(sf, node.getStart(sf)) + ctx.unit;
  const rest = operators.map((operator, i) => `\n${inner}${operator.getText(sf)} ${operands[i + 1].getText(sf)}`).join('');
  return { start: operands[0].getStart(sf), end: operands.at(-1)!.end, text: operands[0].getText(sf) + rest };
}

// Stylistic

function stylistic(text: string, ctx: Context): string {
  const result = ctx.linter.verifyAndFix(text, ctx.fixConfig, { filename: LINT_FILE });
  const fatal = result.messages.find(message => message.fatal);
  if (fatal) {
    throw new Error(fatal.message);
  }
  return result.output;
}
