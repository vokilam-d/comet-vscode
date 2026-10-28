# comet-vscode

Editor tools for the Comet repositories. It holds one tool so far: a formatter for Angular templates (`.html`) and TypeScript (`.ts`). It follows the repository's `.oxlintrc.json` and `docs/conventions/`, and covers what Prettier cannot.

## Install

From the Marketplace: [vokilam.comet-vscode](https://marketplace.visualstudio.com/items?itemName=vokilam.comet-vscode), or **Extensions** → search "Comet Tools".

From a local build:

```bash
npm install
npm run package
code --install-extension comet-vscode-0.1.0.vsix
```

Then make Comet the formatter for both languages, in the workspace's `.vscode/settings.json` or the user settings:

```json
{
  "[html]": { "editor.defaultFormatter": "vokilam.comet-vscode" },
  "[typescript]": { "editor.defaultFormatter": "vokilam.comet-vscode" }
}
```

Formatting runs only on request: **Format Document** (`Shift+Alt+F`) or **Format Selection** (`Ctrl+K Ctrl+F`), and on save when `editor.formatOnSave` is on. There is no CLI and no whole-repository run.

| Setting | Default | |
| --- | --- | --- |
| `comet.format.enable` | `true` | Turns the formatter off for a workspace or folder without unsetting the default formatter. |

Errors and refusals go to the **Comet** output channel (a log channel), with a short status bar message. Each format's edit count and time are logged at debug level: **Developer: Set Log Level…** → Comet → Debug.

## What it formats

**HTML** (`docs/conventions/html-formatting.md`):

- one attribute stays on the tag line, two or more go one per line at +2, with `>` aligned to `<`;
- attributes listed in `inlineAttributes` (default `for`, `id` and `aria-*`; a trailing `*` matches a prefix) do not count towards that limit;
- content at +2 inside elements and `@if` / `@for` / `@switch` blocks, closing tags aligned to opening ones;
- content of a split tag starts on its own line;
- empty components self-close (`<cmt-foo />`);
- text is never wrapped across lines.

**TypeScript** (`docs/conventions/typescript-formatting.md` and the `@stylistic` rules):

- Angular lifecycle hooks are ordered and placed before the first method;
- an arrow body that does not fit is braced; a long call, parameter list, array or object is split one item per line with a trailing comma;
- every configured `@stylistic` rule with an autofix is applied.

It never adds or removes `void`, `await` or `.catch()` (`docs/conventions/fire-and-forget.md`).

**Format Selection** formats the smallest statement, class member, element or block that holds the selected lines, and keeps lifecycle hooks where they are.

## Configuration

Read from the file's folder upwards, in this order, each one over the last:

1. built-in defaults: comet-web-admin's `@stylistic` rules plus single quotes and `always-multiline` trailing commas;
2. `.oxlintrc.json`: its `@stylistic/*` rules replace the default set, and `@stylistic/indent` and `@stylistic/max-len` set the indent and line width. Single quotes and trailing commas still apply on top, so the lint config does not have to flag them; a `@stylistic/quotes` or `@stylistic/comma-dangle` rule there wins;
3. `.cmt-format.json`: overrides any key below;
4. `.editorconfig`: `indent_size` and `max_line_length`.

A change to any of these files is picked up without a reload.

```json
{
  "indent": 2,
  "printWidth": 120,
  "inlineAttributes": ["for", "id", "aria-*"],
  "stylistic": {
    "@stylistic/quotes": ["error", "single", { "avoidEscape": true }]
  }
}
```

`stylistic` replaces the whole rule set, like `.oxlintrc.json` does, so list every rule you want.

## Safety

A file is changed only when the result is safe to keep; otherwise the formatter reports an error and leaves it as it is:

- the output must parse, with no new syntax errors;
- the TypeScript tokens must stay the same, apart from semicolons, trailing commas, quote style and the `{ return …; }` of a braced arrow body;
- a second run over the output must change nothing.

## Adding a rule

- **HTML**: `src/format/html.ts` prints the parsed template; add the rule to the printer and a case to `html.spec.ts`.
- **TypeScript**: a rule that `@stylistic` has goes in the config. A rule it lacks is a pass in `src/format/ts.ts` (added to `PASSES`) that returns edited text, with a case in `ts.spec.ts`.

## Development

| Script | |
| --- | --- |
| `build` / `watch` | Bundle `src/extension.ts` into `dist/extension.js` with esbuild. |
| `test` | Vitest specs in `src/format/`. |
| `typecheck` | `tsc --noEmit`. |
| `package` | Build minified (`vscode:prepublish`) and create `comet-vscode-<version>.vsix`. |
