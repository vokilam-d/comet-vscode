import { defaultConfig } from './config';
import { formatHtml } from './html';

function format(source: string): string {
  const result = formatHtml(source, 'test.html', defaultConfig);
  if ('error' in result) {
    throw new Error(result.error);
  }
  return result.text;
}

describe('formatHtml', () => {
  it('puts two or more attributes one per line, with > under <', () => {
    expect(format('<img src="a.png" alt="A" width="10" height="10">')).toBe([
      '<img',
      '  src="a.png"',
      '  alt="A"',
      '  width="10"',
      '  height="10"',
      '>',
      '',
    ].join('\n'));
  });

  it('keeps one attribute on the tag line', () => {
    expect(format('<button   type="button">Save</button>')).toBe('<button type="button">Save</button>\n');
  });

  it('does not count for toward the attribute limit', () => {
    expect(format('<label class="field" for="name">\nName\n</label>')).toBe([
      '<label class="field" for="name">',
      '  Name',
      '</label>',
      '',
    ].join('\n'));
  });

  it('puts content on its own lines when attributes span several lines', () => {
    expect(format('<button type="button" class="primary">Save</button>')).toBe([
      '<button',
      '  type="button"',
      '  class="primary"',
      '>',
      '  Save',
      '</button>',
      '',
    ].join('\n'));
  });

  it('indents control-flow blocks and keeps } @else { on one line', () => {
    expect(format('@if (a) {\n<span>x</span>\n}\n@else {\n<span>y</span>\n}')).toBe([
      '@if (a) {',
      '  <span>x</span>',
      '} @else {',
      '  <span>y</span>',
      '}',
      '',
    ].join('\n'));
  });

  it('normalizes @for parameters and @let', () => {
    expect(format('@for (item of items;track item.id) {\n{{item}}\n}\n@let total = a +  b ;')).toBe([
      '@for (item of items; track item.id) {',
      '  {{ item }}',
      '}',
      '@let total = a +  b;',
      '',
    ].join('\n'));
  });

  it('self-closes empty custom elements, ng-container and ng-content', () => {
    expect(format('<cmt-rating-stars [value]="3"></cmt-rating-stars>\n<ng-content></ng-content>\n<div></div>')).toBe([
      '<cmt-rating-stars [value]="3" />',
      '<ng-content />',
      '<div></div>',
      '',
    ].join('\n'));
  });

  it('writes void elements without a slash', () => {
    expect(format('<br/>\n<input type="text" />')).toBe('<br>\n<input type="text">\n');
  });

  it('joins hard-wrapped text into one line', () => {
    expect(format('<p class="hint">\n  First part\n  second part.\n</p>')).toBe([
      '<p class="hint">',
      '  First part second part.',
      '</p>',
      '',
    ].join('\n'));
  });

  it('spaces interpolations', () => {
    expect(format('<span>{{name}}  and {{  other }}</span>')).toBe('<span>{{ name }} and {{ other }}</span>\n');
  });

  it('never adds whitespace where there was none', () => {
    expect(format('<b>a</b><i>b</i>text')).toBe('<b>a</b><i>b</i>text\n');
  });

  it('keeps a one-line block on one line, touching what it touched', () => {
    expect(format('<span>Filters@if (count) { ({{count}})}</span>')).toBe('<span>Filters@if (count) { ({{ count }})}</span>\n');
  });

  it('keeps a block body glued to } when the source had no whitespace there', () => {
    expect(format('@if (a) {\n<b>x</b>\n<i>y</i>}')).toBe('@if (a) {\n  <b>x</b>\n  <i>y</i>}\n');
  });

  it('keeps pre, comments and entities as written', () => {
    const pre = '<pre>\n  keep   this\n</pre>';
    expect(format(`${pre}\n<!--  note  -->\n<span>&amp;&nbsp;x</span>`)).toBe(`${pre}\n<!--  note  -->\n<span>&amp;&nbsp;x</span>\n`);
  });

  it('collapses blank lines and trims trailing whitespace', () => {
    expect(format('<div>a</div>   \n\n\n\n<div>b</div>  ')).toBe('<div>a</div>\n\n<div>b</div>\n');
  });

  it('keeps multi-line attribute values verbatim', () => {
    const source = '<div\n  class="a"\n  [ngClass]="{\n    x: y,\n  }"\n>\n  z\n</div>\n';
    expect(format(source)).toBe(source);
  });

  it('is idempotent', () => {
    const source = '<div class="a" id="b">\n@if (x) {\n<span>{{y}}</span>\n} @else if (z) {\ntext\n}\n</div>';
    const once = format(source);
    expect(format(once)).toBe(once);
  });

  it('refuses documents and broken markup', () => {
    expect(formatHtml('<!doctype html><p>x</p>', 'test.html', defaultConfig)).toHaveProperty('error');
    expect(formatHtml('<div><span></div>', 'test.html', defaultConfig)).toHaveProperty('error');
  });
});
