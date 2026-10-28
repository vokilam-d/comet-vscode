import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { clearConfigCache, loadConfig } from './config';

describe('loadConfig', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-config-'));
    clearConfigCache();
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('keeps the quote and comma style next to the rules of .oxlintrc.json', () => {
    fs.writeFileSync(path.join(dir, '.oxlintrc.json'), '{ "rules": { "@stylistic/semi": "error" } }');

    expect(Object.keys(loadConfig(path.join(dir, 'a.ts')).stylistic).sort())
      .toEqual(['@stylistic/comma-dangle', '@stylistic/quotes', '@stylistic/semi']);
  });

  it('lets .oxlintrc.json set the quote style', () => {
    fs.writeFileSync(path.join(dir, '.oxlintrc.json'), '{ "rules": { "@stylistic/quotes": ["error", "double"] } }');

    expect(loadConfig(path.join(dir, 'a.ts')).stylistic['@stylistic/quotes']).toEqual(['error', 'double']);
  });
});
