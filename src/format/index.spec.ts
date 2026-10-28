import { defaultConfig } from './config';
import { format } from './index';
import type { LineEdit, LineRange } from './index';

function apply(source: string, filePath: string, range?: LineRange): string {
  const result = format(source, filePath, defaultConfig, range);
  if ('error' in result) {
    throw new Error(result.error);
  }
  const lines = source.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  for (const edit of [...result.edits].sort((a: LineEdit, b: LineEdit) => b.startLine - a.startLine)) {
    lines.splice(edit.startLine, edit.endLine - edit.startLine, edit.text);
  }
  return lines.join('');
}

describe('format', () => {
  it('returns only the changed lines', () => {
    const result = format('const a = 1;\nconst b = {c:1}\nconst d = 2;\n', 'a.ts', defaultConfig);
    expect(result).toEqual({ edits: [{ startLine: 1, endLine: 2, text: 'const b = { c: 1 };\n' }] });
  });

  it('adds the final line break', () => {
    expect(apply('<b>x</b>', 'a.html')).toBe('<b>x</b>\n');
    expect(apply('const a = 1;', 'a.ts')).toBe('const a = 1;\n');
  });

  it('formats only the statement around the selection', () => {
    const source = 'const a = {b:1}\nfunction f() {\n  const c = {d:1}\n  return c\n}\n';
    expect(apply(source, 'a.ts', { startLine: 2, endLine: 2 })).toBe('const a = {b:1}\nfunction f() {\n  const c = { d: 1 };\n  return c\n}\n');
  });

  it('does not move lifecycle hooks when formatting a selection', () => {
    const source = 'class A {\n  f() {}\n  ngOnInit() {}\n}\n';
    expect(apply(source, 'a.ts', { startLine: 1, endLine: 2 })).toBe(source);
    expect(apply(source, 'a.ts')).toBe('class A {\n  ngOnInit() {}\n  f() {}\n}\n');
  });

  it('formats only the element around the selection in a template', () => {
    const source = '<div>\n<span  class="a">x</span>\n</div>\n<p  class="b">y</p>\n';
    expect(apply(source, 'a.html', { startLine: 1, endLine: 1 })).toBe('<div>\n  <span class="a">x</span>\n</div>\n<p  class="b">y</p>\n');
  });

  it('refuses other file types', () => {
    expect(format('x', 'a.css', defaultConfig)).toHaveProperty('error');
  });
});
