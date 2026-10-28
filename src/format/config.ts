import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';

export interface FormatConfig {
  indent: number;
  printWidth: number;
  /** Attributes left out of the "two or more attributes go one per line" count. */
  inlineAttributes: string[];
  /** `@stylistic/*` rules in ESLint form, keyed by full rule name. */
  stylistic: Record<string, unknown>;
}

/**
 * Style the formatter applies on top of any `.oxlintrc.json`, so the lint config does not have to flag it.
 * A rule of the same name in `.oxlintrc.json` or `.cmt-format.json` wins.
 */
const formatterRules: Record<string, unknown> = {
  '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
  '@stylistic/comma-dangle': ['error', 'always-multiline'],
};

/** The `@stylistic` rules of comet-web-admin's `.oxlintrc.json`, plus `formatterRules`. */
export const defaultConfig: FormatConfig = {
  indent: 2,
  printWidth: 120,
  inlineAttributes: ['for'],
  stylistic: {
    '@stylistic/max-len': ['error', { code: 120, ignoreStrings: true, ignoreTemplateLiterals: true, ignoreComments: true }],
    '@stylistic/array-bracket-newline': ['error', 'consistent'],
    '@stylistic/array-element-newline': ['error', 'consistent'],
    '@stylistic/function-call-argument-newline': ['error', 'consistent'],
    '@stylistic/function-paren-newline': ['error', 'multiline-arguments'],
    '@stylistic/block-spacing': ['error', 'always'],
    '@stylistic/multiline-ternary': ['error', 'always-multiline'],
    '@stylistic/operator-linebreak': ['error', 'before'],
    '@stylistic/key-spacing': 'error',
    '@stylistic/space-infix-ops': 'error',
    '@stylistic/space-before-blocks': ['error', 'always'],
    '@stylistic/object-property-newline': ['error', { allowAllPropertiesOnSameLine: true }],
    '@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: true }],
    '@stylistic/type-annotation-spacing': 'error',
    '@stylistic/function-call-spacing': 'error',
    '@stylistic/indent': ['error', 2, {
      SwitchCase: 1,
      MemberExpression: 1,
      FunctionDeclaration: { parameters: 'first' },
      ArrayExpression: 'first',
      ObjectExpression: 'first',
    }],
    '@stylistic/keyword-spacing': 'error',
    '@stylistic/no-extra-semi': 'error',
    '@stylistic/object-curly-spacing': ['error', 'always', { arraysInObjects: true }],
    '@stylistic/semi': 'error',
    '@stylistic/space-before-function-paren': ['error', { anonymous: 'always', named: 'never', asyncArrow: 'always' }],
    ...formatterRules,
  },
};

const cache = new Map<string, FormatConfig>();

export function clearConfigCache(): void {
  cache.clear();
}

/** Built-in defaults, then `.oxlintrc.json`, then `.cmt-format.json`, then `.editorconfig`; later wins. */
export function loadConfig(filePath: string): FormatConfig {
  const dir = path.dirname(path.resolve(filePath));
  const ext = path.extname(filePath);
  const key = `${dir}|${ext}`;
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const config: FormatConfig = { ...defaultConfig, stylistic: { ...defaultConfig.stylistic } };

  const oxlint = readJsonc(findUp(dir, '.oxlintrc.json'));
  const rules = oxlint?.rules as Record<string, unknown> | undefined;
  if (rules) {
    const stylistic = Object.fromEntries(Object.entries(rules).filter(([name]) => name.startsWith('@stylistic/')));
    if (Object.keys(stylistic).length) {
      config.stylistic = { ...formatterRules, ...stylistic };
    }
  }
  applyStylisticSizes(config);

  const own = readJsonc(findUp(dir, '.cmt-format.json')) as Partial<FormatConfig> | undefined;
  Object.assign(config, own);

  const editorConfigPath = findUp(dir, '.editorconfig');
  if (editorConfigPath) {
    Object.assign(config, readEditorConfig(fs.readFileSync(editorConfigPath, 'utf8'), ext));
  }

  cache.set(key, config);
  return config;
}

function applyStylisticSizes(config: FormatConfig): void {
  const indent = config.stylistic['@stylistic/indent'];
  if (Array.isArray(indent) && typeof indent[1] === 'number') {
    config.indent = indent[1];
  }
  const maxLen = config.stylistic['@stylistic/max-len'];
  if (Array.isArray(maxLen) && typeof maxLen[1]?.code === 'number') {
    config.printWidth = maxLen[1].code;
  }
}

function findUp(dir: string, name: string): string | undefined {
  for (let current = dir; ; current = path.dirname(current)) {
    const candidate = path.join(current, name);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    if (path.dirname(current) === current) {
      return undefined;
    }
  }
}

function readJsonc(filePath: string | undefined): Record<string, unknown> | undefined {
  if (!filePath) {
    return undefined;
  }
  const { config, error } = ts.parseConfigFileTextToJson(filePath, fs.readFileSync(filePath, 'utf8'));
  if (error) {
    throw new Error(`${filePath}: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`);
  }
  return config;
}

/** Reads `indent_size` and `max_line_length` from the sections that match a file with this extension. */
export function readEditorConfig(text: string, ext: string): Partial<FormatConfig> {
  const result: Partial<FormatConfig> = {};
  let matches = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const section = /^\[(.*)\]$/.exec(line);
    if (section) {
      matches = sectionMatches(section[1], ext);
      continue;
    }
    const pair = /^([\w-]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!matches || !pair) {
      continue;
    }
    const value = Number(pair[2]);
    if (pair[1] === 'indent_size' && value > 0) {
      result.indent = value;
    } else if (pair[1] === 'max_line_length' && value > 0) {
      result.printWidth = value;
    }
  }
  return result;
}

function sectionMatches(glob: string, ext: string): boolean {
  if (glob === '*' || glob === '**') {
    return true;
  }
  const name = ext.slice(1);
  const braces = /^\*\.\{(.*)\}$/.exec(glob);
  if (braces) {
    return braces[1].split(',').map(part => part.trim()).includes(name);
  }
  return glob === `*${ext}`;
}
