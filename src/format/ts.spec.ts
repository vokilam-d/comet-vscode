import { defaultConfig } from './config';
import { formatTs } from './ts';

function format(source: string): string {
  const result = formatTs(source, 'test.ts', defaultConfig);
  if ('error' in result) {
    throw new Error(result.error);
  }
  return result.text;
}

const long = 'x'.repeat(40);

describe('formatTs', () => {
  it('joins a multi-line arrow body that fits on one line', () => {
    expect(format([
      'class A {',
      '  readonly total = computed(() =>',
      '    this.a() + this.b()',
      '  );',
      '}',
      '',
    ].join('\n'))).toBe([
      'class A {',
      '  readonly total = computed(() => this.a() + this.b());',
      '}',
      '',
    ].join('\n'));
  });

  it('gives a multi-line arrow body that does not fit braces and a return', () => {
    expect(format([
      'const total = computed(() =>',
      `  this.${long}() + this.${long}()`,
      ');',
      '',
    ].join('\n'))).toBe([
      'const total = computed(() => {',
      `  return this.${long}() + this.${long}();`,
      '});',
      '',
    ].join('\n'));
  });

  it('turns a multi-line ({ … }) body into a return of the object', () => {
    expect(format([
      'const make = (id: number) => ({',
      `  id,`,
      `  first: '${long}',`,
      `  second: '${long}',`,
      '});',
      '',
    ].join('\n'))).toBe([
      'const make = (id: number) => {',
      '  return {',
      '    id,',
      `    first: '${long}',`,
      `    second: '${long}',`,
      '  };',
      '};',
      '',
    ].join('\n'));
  });

  it('joins a short object body and drops its trailing comma', () => {
    expect(format('const make = (id: number) => ({\n  id,\n  name: "x",\n});\n')).toBe("const make = (id: number) => ({ id, name: 'x' });\n");
  });

  it('keeps arrow bodies that hold comments', () => {
    const source = 'const f = () =>\n  // why\n  g();\n';
    expect(format(source)).toBe(source);
  });

  it('splits long call arguments one per line', () => {
    expect(format(`foo(${long}, ${long}, ${long});\n`)).toBe(`foo(\n  ${long},\n  ${long},\n  ${long},\n);\n`);
  });

  it('splits a lone object argument itself', () => {
    expect(format(`foo({ first: ${long}, second: ${long}, third: ${long} });\n`))
      .toBe(`foo({\n  first: ${long},\n  second: ${long},\n  third: ${long},\n});\n`);
  });

  it('breaks long binary expressions before the operator', () => {
    expect(format(`const ok = ${long} && ${long} && ${long};\n`)).toBe(`const ok = ${long}\n  && ${long}\n  && ${long};\n`);
  });

  it('leaves long lines with strings to max-len', () => {
    const source = `foo('${long}', '${long}', '${long}');\n`;
    expect(format(source)).toBe(source);
  });

  it('moves lifecycle hooks after the fields, in call order', () => {
    expect(format([
      'class A {',
      '  private service = inject(Service);',
      '',
      '  doSomething() {}',
      '',
      '  /** Cleans up. */',
      '  ngOnDestroy() {}',
      '',
      '  ngOnInit() {}',
      '}',
      '',
    ].join('\n'))).toBe([
      'class A {',
      '  private service = inject(Service);',
      '',
      '  ngOnInit() {}',
      '',
      '  /** Cleans up. */',
      '  ngOnDestroy() {}',
      '',
      '  doSomething() {}',
      '}',
      '',
    ].join('\n'));
  });

  it('puts hooks before the first method, not after a field declared later', () => {
    expect(format([
      'class A {',
      '  private service = inject(Service);',
      '',
      '  doSomething() {}',
      '',
      '  private back = viewChild(Back);',
      '',
      '  ngOnInit() {}',
      '}',
      '',
    ].join('\n'))).toBe([
      'class A {',
      '  private service = inject(Service);',
      '',
      '  ngOnInit() {}',
      '',
      '  doSomething() {}',
      '',
      '  private back = viewChild(Back);',
      '}',
      '',
    ].join('\n'));
  });

  it('adds a trailing comma when it splits a nested call', () => {
    expect(format(`const x = a.pipe(map(group => ({ ${long}, group })), take(${long}));\n`))
      .toBe(`const x = a.pipe(\n  map(group => ({ ${long}, group })),\n  take(${long}),\n);\n`);
  });

  it('applies the stylistic rules', () => {
    expect(format('const a = {b:1}\nif(a){ console.log("x") }\n')).toBe("const a = { b: 1 };\nif (a) { console.log('x'); }\n");
  });

  it('is idempotent', () => {
    const source = `class A {\n  ngOnInit() {}\n  readonly x = computed(() =>\n    foo(${long}, ${long}, ${long})\n  );\n}\n`;
    const once = format(source);
    expect(format(once)).toBe(once);
  });

  it('refuses files with syntax errors', () => {
    expect(formatTs('const = ;', 'test.ts', defaultConfig)).toHaveProperty('error');
  });
});
