import { Block, Element } from '@angular/compiler';
import type { Node } from '@angular/compiler';
import ts from 'typescript';
import type { FormatConfig } from './config';
import { formatHtml, parse as parseHtml } from './html';
import { diagnostics, formatTs, parse as parseTs } from './ts';

/** Replaces lines `[startLine, endLine)` of the source; `text` uses `\n` line breaks. */
export interface LineEdit {
  startLine: number;
  endLine: number;
  text: string;
}

/** Zero-based lines, both ends included. */
export interface LineRange {
  startLine: number;
  endLine: number;
}

export type FormatEdits = { edits: LineEdit[] } | { error: string };

/**
 * Formats the whole file and returns the changed lines. With a range, only the edits inside the smallest element
 * (HTML) or statement or class member (TypeScript) around it, from a run that leaves class members in place.
 */
export function format(source: string, filePath: string, config: FormatConfig, range?: LineRange): FormatEdits {
  const text = source.replace(/\r\n?/g, '\n');
  const html = filePath.endsWith('.html');
  if (!html && !filePath.endsWith('.ts')) {
    return { error: `${filePath} is neither HTML nor TypeScript` };
  }
  const result = html ? formatHtml(text, filePath, config) : formatTs(text, filePath, config, { reorder: !range });
  if ('error' in result) {
    return result;
  }
  const before = splitLines(text);
  const edits = diffLines(before, splitLines(result.text));
  if (!range) {
    return { edits };
  }

  const region = html ? htmlRegion(text, filePath, range) : tsRegion(text, range);
  const inside = edits.filter(edit => edit.startLine >= region.startLine && edit.endLine <= region.endLine + 1);
  const partial = applyLineEdits(before, inside);
  const broken = html ? 'error' in parseHtml(partial, filePath) : diagnostics(parseTs(partial)).length > 0;
  if (broken) {
    return { error: 'the edits inside the selection do not stand on their own; format the whole file' };
  }
  return { edits: inside };
}

/** Lines with their line breaks, so that joining them gives the text back. */
function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function applyLineEdits(lines: string[], edits: LineEdit[]): string {
  const result = [...lines];
  for (const edit of [...edits].sort((a, b) => b.startLine - a.startLine)) {
    result.splice(edit.startLine, edit.endLine - edit.startLine, edit.text);
  }
  return result.join('');
}

/** The changed runs of lines between `a` and `b`, by longest common subsequence. */
function diffLines(a: string[], b: string[]): LineEdit[] {
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
    prefix++;
  }
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a.at(-1 - suffix) === b.at(-1 - suffix)) {
    suffix++;
  }
  const x = a.slice(prefix, a.length - suffix);
  const y = b.slice(prefix, b.length - suffix);

  // lengths[i * (m + 1) + j]: the common subsequence length of x[i..] and y[j..].
  const n = x.length;
  const m = y.length;
  if (n * m > 4_000_000) {
    return n || m ? [{ startLine: prefix, endLine: prefix + n, text: y.join('') }] : [];
  }
  const lengths = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lengths[i * (m + 1) + j] = x[i] === y[j]
        ? lengths[(i + 1) * (m + 1) + j + 1] + 1
        : Math.max(lengths[(i + 1) * (m + 1) + j], lengths[i * (m + 1) + j + 1]);
    }
  }

  const edits: LineEdit[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) {
      i++;
      j++;
      continue;
    }
    const start = i;
    const added: string[] = [];
    while ((i < n || j < m) && !(i < n && j < m && x[i] === y[j])) {
      if (j < m && (i === n || lengths[i * (m + 1) + j + 1] >= lengths[(i + 1) * (m + 1) + j])) {
        added.push(y[j++]);
      } else {
        i++;
      }
    }
    // A run that swaps lines one for one is an edit per line, so a selection can take part of it.
    if (added.length === i - start) {
      edits.push(...added.map((line, k) => ({ startLine: prefix + start + k, endLine: prefix + start + k + 1, text: line })));
    } else {
      edits.push({ startLine: prefix + start, endLine: prefix + i, text: added.join('') });
    }
  }
  return edits;
}

function tsRegion(text: string, range: LineRange): LineRange {
  const sf = parseTs(text);
  const lineOf = (pos: number): number => sf.getLineAndCharacterOfPosition(pos).line;
  const isUnit = (node: ts.Node): boolean => ts.isClassElement(node) || ts.isTypeElement(node)
    || ts.isSourceFile(node.parent) || ts.isBlock(node.parent) || ts.isModuleBlock(node.parent)
    || ts.isCaseClause(node.parent) || ts.isDefaultClause(node.parent);
  let region = range;
  const visit = (node: ts.Node): void => {
    const startLine = lineOf(node.getStart(sf));
    const endLine = lineOf(node.end);
    if (startLine > range.startLine || endLine < range.endLine) {
      return;
    }
    if (isUnit(node)) {
      region = { startLine, endLine };
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return region;
}

function htmlRegion(text: string, filePath: string, range: LineRange): LineRange {
  const tree = parseHtml(text, filePath);
  let region = range;
  const visit = (nodes: Node[]): void => {
    for (const node of nodes) {
      if (!(node instanceof Element || node instanceof Block)) {
        continue;
      }
      const startLine = node.sourceSpan.start.line;
      const endLine = node.sourceSpan.end.line;
      if (startLine <= range.startLine && endLine >= range.endLine) {
        region = { startLine, endLine };
        visit(node.children);
        return;
      }
    }
  };
  if (!('error' in tree)) {
    visit(tree.nodes);
  }
  return region;
}
