import {
  Block,
  Comment,
  Element,
  Expansion,
  getHtmlTagDefinition,
  HtmlParser,
  LetDeclaration,
  Text,
} from '@angular/compiler';
import type { Node } from '@angular/compiler';
import type { FormatConfig } from './config';

export type FormatResult = { text: string } | { error: string };

/** Marks a line printed exactly as it is: no indentation added, no trailing whitespace trimmed. */
const RAW = '\u0000';

/** Whitespace as Angular collapses it; `\s` would also match the no-break space. */
const WS = /[ \t\n\r\f]+/g;
const ONLY_WS = /^[ \t\n\r\f]*$/;

/** `LexerTokenType` values; the enum is `const` and has no runtime object. */
const TEXT_TOKEN = 5;
const INTERPOLATION_TOKEN = 8;
const ENTITY_TOKEN = 9;

const VERBATIM_ELEMENTS = new Set(['pre', 'textarea', 'script', 'style']);
const SELF_CLOSING = new Set(['ng-container', 'ng-content']);
const CONNECTED_BLOCKS = new Set(['else', 'else if', 'empty', 'placeholder', 'loading', 'error']);

/** What separated an item from the one before it in the source. */
type Sep = '' | ' ' | '\n' | '\n\n';

interface Item {
  sep: Sep;
  lines: string[];
  /** Blocks and `@let` take lines of their own wherever whitespace allows. */
  block: boolean;
  /** A block that continues the previous one: `} @else {`. */
  connected: boolean;
}

export function formatHtml(source: string, filePath: string, config: FormatConfig): FormatResult {
  const text = source.replace(/\r\n?/g, '\n');
  if (/<!doctype/i.test(text)) {
    return { error: 'documents with a doctype are not formatted' };
  }
  const tree = parse(text, filePath);
  if ('error' in tree) {
    return tree;
  }
  if (tree.nodes.some(node => node instanceof Element && node.name === 'html')) {
    return { error: 'documents with an <html> element are not formatted' };
  }

  const unit = ' '.repeat(config.indent);
  const printer = new Printer(unit, config.inlineAttributes);
  const lines = layout(printer.items(tree.nodes));
  const output = lines.map(line => (line.startsWith(RAW) ? line.slice(1) : line.trimEnd())).join('\n') + '\n';

  const check = parse(output, filePath);
  if ('error' in check) {
    return { error: `formatted output does not parse: ${check.error}` };
  }
  if (shape(check.nodes) !== shape(tree.nodes)) {
    return { error: 'formatted output does not match the source tree' };
  }
  return { text: output };
}

export function parse(text: string, filePath: string): { nodes: Node[] } | { error: string } {
  const result = new HtmlParser().parse(text, filePath, {
    tokenizeExpansionForms: true,
    tokenizeBlocks: true,
    tokenizeLet: true,
  });
  if (result.errors.length) {
    return { error: result.errors.map(error => error.toString()).join('\n') };
  }
  return { nodes: result.rootNodes };
}

class Printer {
  constructor(
    private readonly unit: string,
    private readonly inlineAttributes: string[],
  ) {}

  items(nodes: Node[]): Item[] {
    const items: Item[] = [];
    let pending: Sep = '';
    let previous: Node | undefined;
    for (const node of nodes) {
      if (node instanceof Text) {
        const { lead, body, trail } = splitText(node);
        pending = widest(pending, lead);
        if (body) {
          items.push({ sep: pending, lines: rawSplit(body), block: false, connected: false });
          pending = trail;
          previous = node;
        }
        continue;
      }
      const block = node instanceof Block || node instanceof LetDeclaration;
      const connected = node instanceof Block && previous instanceof Block && CONNECTED_BLOCKS.has(node.name);
      items.push({ sep: pending, lines: this.node(node), block, connected });
      pending = '';
      previous = node;
    }
    return items;
  }

  private node(node: Node): string[] {
    if (node instanceof Element) {
      return this.element(node);
    }
    if (node instanceof Block) {
      return this.block(node);
    }
    if (node instanceof LetDeclaration) {
      return rawSplit(`@let ${node.name} = ${node.value.trim()};`);
    }
    if (node instanceof Comment || node instanceof Expansion) {
      return rawSplit(node.sourceSpan.toString());
    }
    return rawSplit(node.sourceSpan.toString());
  }

  private element(el: Element): string[] {
    if (VERBATIM_ELEMENTS.has(el.name)) {
      return rawSplit(el.sourceSpan.toString());
    }
    const name = /^<([^\s/>]+)/.exec(el.startSourceSpan.toString())![1];
    const empty = el.children.every(child => child instanceof Text && ONLY_WS.test(child.value));
    const isVoid = getHtmlTagDefinition(el.name).isVoid;
    const selfClose = el.isSelfClosing || (empty && (name.includes('-') || SELF_CLOSING.has(name)));

    const attrs = el.attrs.map(attr => attr.sourceSpan.toString());
    const counted = el.attrs.filter(attr => !this.inlineAttributes.includes(attr.name)).length;
    const verbatimTag = el.comments.length > 0 || el.directives.length > 0;
    const multiAttr = !verbatimTag && counted >= 2;

    let open: string[];
    if (verbatimTag) {
      open = rawSplit(el.startSourceSpan.toString().replace(/\s*\/?>$/, ''));
    } else if (multiAttr) {
      open = [`<${name}`, ...attrs.flatMap(attr => this.indent(rawSplit(attr))), ''];
    } else {
      open = rawSplit([`<${name}`, ...attrs].join(' '));
    }
    const close = (end: string): string[] => {
      const lines = [...open];
      const last = lines.length - 1;
      lines[last] += multiAttr ? end.trimStart() : end;
      return lines;
    };

    if (isVoid) {
      return close('>');
    }
    if (selfClose) {
      return close(' />');
    }
    if (empty) {
      return close(`></${name}>`);
    }

    const items = this.items(el.children);
    const oneLine = !multiAttr
      && el.sourceSpan.start.line === el.sourceSpan.end.line
      && open.length === 1
      && items.every(item => item.lines.length === 1 && (item.sep === '' || item.sep === ' '));
    if (oneLine) {
      const content = items.map((item, i) => (i === 0 ? '' : item.sep) + item.lines[0]).join('');
      return [`${open[0]}>${content}</${name}>`];
    }
    return [...close('>'), ...this.indent(layout(items)), `</${name}>`];
  }

  private block(block: Block): string[] {
    const params = block.parameters.map(param => param.expression.trim()).join('; ');
    const head = `@${block.name}${params ? ` (${params})` : ''} {`;
    const items = this.items(block.children);
    if (!items.length) {
      return rawSplit(`${head}}`);
    }
    // Whitespace inside a block renders, so a body that touches `{` or `}` keeps touching it.
    const lead = items[0].sep === '' ? '' : ' ';
    const last = block.children.at(-1);
    const trail = last instanceof Text && /[ \t\n\r\f]$/.test(last.value) ? ' ' : '';
    const oneLine = block.sourceSpan.start.line === block.sourceSpan.end.line
      && items.every(item => item.lines.length === 1 && (item.sep === '' || item.sep === ' '));
    if (oneLine) {
      const content = items.map((item, i) => (i === 0 ? '' : item.sep) + item.lines[0]).join('');
      return rawSplit(`${head}${lead}${content}${trail}}`);
    }
    const body = this.indent(layout(items));
    const lines = lead ? [...rawSplit(head), ...body] : [...rawSplit(head + layout(items)[0]), ...body.slice(1)];
    if (trail) {
      return [...lines, '}'];
    }
    lines[lines.length - 1] += '}';
    return lines;
  }

  private indent(lines: string[]): string[] {
    return lines.map(line => (line === '' || line.startsWith(RAW) ? line : this.unit + line));
  }
}

/** Joins items into lines, breaking only where the source had whitespace. */
function layout(items: Item[]): string[] {
  const lines: string[] = [];
  let previousMulti = false;
  for (const [i, item] of items.entries()) {
    const multi = item.lines.length > 1 || item.block;
    const sep = item.connected ? ' ' : item.sep;
    const join = item.connected || sep === '' || (sep === ' ' && !multi && !previousMulti);
    if (i > 0 && join) {
      lines[lines.length - 1] += sep + item.lines[0];
      lines.push(...item.lines.slice(1));
    } else {
      if (i > 0 && sep === '\n\n') {
        lines.push('');
      }
      lines.push(...item.lines);
    }
    previousMulti = multi;
  }
  return lines;
}

/** Splits text into its body, with whitespace runs collapsed, and the separators around it. */
function splitText(node: Text): { lead: Sep; body: string; trail: Sep } {
  let raw = '';
  for (const token of node.tokens) {
    if ((token.type as number) === TEXT_TOKEN) {
      raw += token.parts[0];
    } else if ((token.type as number) === INTERPOLATION_TOKEN) {
      raw += `\u0001${interpolation(token.parts[1] ?? '')}\u0002`;
    } else if ((token.type as number) === ENTITY_TOKEN) {
      raw += token.parts[1];
    } else {
      raw += token.sourceSpan.toString();
    }
  }
  const lead = /^[ \t\n\r\f]*/.exec(raw)![0];
  const trail = /[ \t\n\r\f]*$/.exec(raw.slice(lead.length))![0];
  const inner = raw.slice(lead.length, raw.length - trail.length);
  const body = inner
    .split(/(\u0001[^\u0002]*\u0002)/)
    .map(part => (part.startsWith('\u0001') ? part.slice(1, -1) : part.replace(WS, ' ')))
    .join('');
  return { lead: separator(lead), body, trail: separator(trail) };
}

/** `{{x}}` becomes `{{ x }}`; a multi-line expression is joined unless it holds a string literal. */
function interpolation(expression: string): string {
  let expr = expression.trim();
  if (expr.includes('\n') && !/['"`]/.test(expr)) {
    expr = expr.replace(/\s*\n\s*/g, ' ');
  }
  return `{{ ${expr} }}`;
}

function separator(whitespace: string): Sep {
  const newlines = whitespace.split('\n').length - 1;
  return newlines >= 2 ? '\n\n' : newlines === 1 ? '\n' : whitespace ? ' ' : '';
}

const SEP_ORDER: Sep[] = ['', ' ', '\n', '\n\n'];

function widest(a: Sep, b: Sep): Sep {
  return SEP_ORDER.indexOf(a) >= SEP_ORDER.indexOf(b) ? a : b;
}

/** Splits source text into lines; every line after the first keeps its own indentation. */
function rawSplit(text: string): string[] {
  const [first, ...rest] = text.split('\n');
  return [first, ...rest.map(line => RAW + line)];
}

/** The tree with whitespace differences removed, for comparing source and output. */
function shape(nodes: Node[]): string {
  const parts: string[] = [];
  for (const node of nodes) {
    if (node instanceof Text) {
      const value = node.value.replace(WS, ' ').replace(/\{\{ ?/g, '{{').replace(/ ?\}\}/g, '}}').trim();
      if (value) {
        parts.push(JSON.stringify(value));
      }
    } else if (node instanceof Element) {
      const attrs = node.attrs.map(attr => `${attr.name}=${JSON.stringify(attr.value)}`).join(' ');
      parts.push(`<${node.name} ${attrs}>${shape(node.children)}</>`);
    } else if (node instanceof Block) {
      const params = node.parameters.map(param => param.expression.replace(WS, ' ').trim()).join(';');
      parts.push(`@${node.name}(${params}){${shape(node.children)}}`);
    } else if (node instanceof LetDeclaration) {
      parts.push(`@let ${node.name}=${node.value.replace(WS, ' ').trim()}`);
    } else {
      parts.push(node.sourceSpan.toString().replace(WS, ' '));
    }
  }
  return parts.join(',');
}
