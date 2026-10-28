# comet-vscode formatter: Angular templates and TypeScript

## Goal

One formatter, run in VS Code when the user asks for it, that writes HTML templates and
TypeScript the way `docs/conventions/html-formatting.md`, `docs/conventions/typescript-formatting.md`,
`.editorconfig` and the `@stylistic/*` rules in `.oxlintrc.json` require. After formatting, a file
has no `@stylistic` errors from `npm run lint`, and formatting it again changes nothing.

It works in every repository opened in VS Code, on every machine, with no setup in the repository:
the rules a repository declares win, and built-in defaults (this repository's conventions) cover the
rest.

## Where Prettier falls short

Checked against `.prettierrc.json` (Prettier 3.9.10) and the conventions:

| Convention | Prettier today |
| --- | --- |
| A tag with 3+ attributes puts one attribute per line | `singleAttributePerLine` only breaks when the line is over `printWidth`; short tags stay on one line |
| Text is never hard-wrapped | the `angular` parser fills text to `printWidth` |
| When attributes are multi-line, content starts on its own line | inline elements (`label`, `span`, `a`) hug: `>Meta заголовок</label>` |
| Components with no content self-close | leaves `<x></x>` and `<ng-container ...></ng-container>` as they are |
| Void elements are written `<img ...>` | prints `<img ... />` |
| A multi-line arrow body gets braces and `return` | prints the exact form the convention calls bad |
| Lifecycle hooks come first | does not reorder members |
| `operator-linebreak: before` | puts `&&`, `+`, `\|\|` at the end of the line |
| `indent` with `ObjectExpression/ArrayExpression: "first"`, `parameters: "first"` | always uses block indentation |
| Trailing whitespace is trimmed | leaves whitespace-only lines inside templates (see `split-button.component.html`) |

`oxfmt` (the Oxc formatter) aims to match Prettier's output, so it has the same gaps.

Prettier is not used at all. Prettier reprints the whole file from its own tree, so its layout always
wins and the other passes have to undo it. The engines below keep the source's layout and change
only what a rule requires.

## Approach

It formats one file (Format Document) or one selection (Format Selection), and only when the user
runs one of them, or saves with `editor.formatOnSave` on. There is no command-line tool, no git hook
and no CI check, and the repository is never formatted as a whole.

The formatter is the first feature of a standalone repository `comet-vscode` (outside this one), an
extension that will also hold other editor features (navigation between a template and its styles,
for example). The formatter lives in `src/format/` and has two layers:

1. **core** is a pure function `format(text, filePath, config, range?) → { text } | { error }`. It
   never writes files.
2. **extension** is a thin VS Code wrapper that registers a `DocumentFormattingEditProvider` and a
   `DocumentRangeFormattingEditProvider` for `html` and `typescript`.

### Dependencies are bundled

The extension bundles `typescript`, `eslint`, `@typescript-eslint/parser`,
`@stylistic/eslint-plugin` and `@angular/compiler` with esbuild. A repository needs none of them
installed, so the formatter also works in a repository that has no `node_modules` yet. Updating a
bundled dependency is a new release of `comet-vscode`.

`@angular/compiler` is pinned to the newest major the repositories use. A newer template syntax than
the bundled parser knows is a parse error (H12), which gives no edit, so an outdated parser never
damages a template.

### Configuration

For each file, the configuration is built from, in order (later wins):

1. **Built-in defaults**: the rules of this repository as they are now (`@stylistic/*` from
   `.oxlintrc.json`, the HTML rules below, 2-space indent, 120 columns).
2. **`.oxlintrc.json`** found by walking up from the file: its `@stylistic/*` rules replace the
   built-in TypeScript rules as a whole.
3. **`.cmt-format.json`** found by walking up from the file: the HTML options and exceptions, and
   the T1/T2 switches, for example:

   ```json
   {
     "html": {
       "inlineAttributes": ["for"]
     }
   }
   ```

4. **`.editorconfig`**: `indent_size`, `end_of_line`, `insert_final_newline`,
   `trim_trailing_whitespace`.

A repository with none of these files is formatted with the built-in defaults. The VS Code setting
`comet.format.enable` (on by default) turns the formatter off for a workspace, and the extension only
formats when it is chosen as `editor.defaultFormatter` for the language.

Rules a repository adds to `.oxlintrc.json` are also enforced by lint there, so lint and format
always agree. To keep that true without Prettier, this repository adds two rules Prettier used to
cover: `"@stylistic/quotes": ["error", "single", { "avoidEscape": true }]` and
`"@stylistic/comma-dangle": ["error", "always-multiline"]`, which is the rule of
`comet-backend/docs/conventions/trailing-comma.md` (trailing commas in every multi-line structure).

### HTML engine: its own printer on Angular's parser

The engine parses with `@angular/compiler`'s `HtmlParser` (`tokenizeBlocks`, `tokenizeLet` and
`tokenizeExpansionForms` on) and prints the tree itself. The rules are:

- H1. 2-space indentation; children and `@if/@for/@switch/@defer/@let` block bodies get +2; closing
  tags and `}` line up with their opener. `} @else {` and `} @empty {` stay on one line.
- H2. 0 or 1 attribute: the opening tag stays on one line. 2 or more: one attribute per line at +2,
  and `>` (or `/>`) on its own line, aligned with `<`. The source's layout doesn't matter.
- H2a. Attributes named in `html.inlineAttributes` (default `["for"]`) don't count towards H2, so
  `<label class="field-label" for="price">` (one counted attribute) is always one line. When the
  tag splits anyway, they go one per line like the rest. The list is per repository, in
  `.cmt-format.json`.
- H3. Attribute values are copied from the source unchanged, including multi-line bound
  expressions; only their indentation follows the tag. Attribute order is never changed.
- H4. With multi-line attributes the content starts on a new line, never right after `>`.
- H5. A custom element (its name has a `-`) or `ng-container`/`ng-content` with no children is
  printed self-closing as ` />`. Native elements are never self-closed.
- H6. Void elements (`img`, `input`, `br`, `hr`, `meta`, `link`, ...) are printed without `/`.
- H7. Text is never wrapped. Line breaks inside a text node collapse to one space, so text that is
  already hard-wrapped is joined back. Interpolations become `{{ expr }}`, with the expression text
  kept.
- H8. Whitespace safety: a line break is added only where the source already has whitespace, or at
  the start or end of an element's content (which H4 requires). Two siblings that touch with no
  whitespace between them (`</b><i>`, `text<span>`) stay touching, because whitespace between inline
  elements renders as a space.
- H9. An element whose content is only text and interpolations, and whose opening tag is on one
  line, stays on one line if it was on one line in the source; otherwise its content goes on its own
  indented line. With a multi-line opening tag, H4 always applies:
  `>Редактировать атрибуты</cmt-button>` becomes `>`, the text on its own line at +2, then
  `</cmt-button>`.
- H10. Blank lines between siblings are kept, at most one in a row. Trailing whitespace is trimmed
  and the file ends with one newline.
- H11. `<pre>`, `<textarea>`, `<script>`, `<style>` and comments are copied verbatim; only the
  indentation of a comment's first line follows its parent.
- H12. If parsing reports any error, the engine returns that error and no edit.

Scope: `*.html` files that are Angular templates. `index.html` (a file with `<!doctype` or `<html>`)
is skipped. Inline `template:` strings are out of scope; templates live in their own files (see
`component-files.md`).

### TypeScript engine: passes over the source, no reprinting

Every pass is a list of text edits on the source found with the TypeScript compiler API, so comments,
blank lines and the author's line breaks survive unless a rule says otherwise.

1. **T0, long lines**: a line over 120 columns (counted the way `@stylistic/max-len` counts, so
   strings, template literals and comments are ignored) is split at the outermost node on that line
   that can be broken, in this order: call arguments and parameters (one per line), array and object
   literals (one element per line), union and intersection types, then binary and ternary
   expressions (a break before the operator, which `operator-linebreak: before` requires). A node is
   split only as far as needed: if its parts fit after one break, it stops there. A line that still
   doesn't fit is left as it is and stays a `max-len` error for a person to resolve.
2. **T1, arrow bodies**: an arrow with an expression body that spans more than one line becomes a
   one-liner if it fits in 120 columns, and otherwise becomes `{ return …; }`. A body `=> ({ … })` is
   allowed on one line only: over several lines it becomes `{ return { … }; }` like any other.
3. **T2, lifecycle order**: in classes that declare Angular lifecycle hooks, those methods are
   moved, with their decorators and leading comments, directly after the last field or the
   constructor, in Angular's call order (`ngOnChanges`, `ngOnInit`, `ngDoCheck`,
   `ngAfterContentInit`, `ngAfterContentChecked`, `ngAfterViewInit`, `ngAfterViewChecked`,
   `ngOnDestroy`). Everything else keeps its order.
4. **Stylistic fixes**: ESLint's `Linter.verifyAndFix` runs in-process with `@stylistic/eslint-plugin`
   and only the `@stylistic/*` rules from the configuration. This sets indentation, spacing,
   semicolons, quotes, brace style and where operators and parentheses go. It runs in memory, unlike
   `oxlint --fix`, which can only fix files on disk and has no stdin mode.
5. **Fixpoint check**: run steps 1–4 a second time. If the output changes again, the passes are
   fighting each other: return the error, name the rule, and make no edit. These cases go into the
   fixtures and get fixed in the engine. It runs on every format that changed something; if it turns
   out slow, it is removed and these bugs are left to the fixtures and the test run.

### Speed

Measured on `src/app/pages/product/product.component.ts` (936 lines), warm, Node 26:

| Step | Time |
| --- | --- |
| Loading `eslint` + `@stylistic` + parser, once when the extension starts | 511 ms |
| TypeScript parse | 5 ms |
| `verifyAndFix` with the 21 `@stylistic` rules | ~40 ms |
| (Prettier `format`, for comparison) | ~45 ms |

A large file therefore formats in about 50 ms with one run of steps 1–4, and in about 100 ms with
the second run of the fixpoint check. To keep formatting fast:

- the extension loads the engines once, in the background when it activates, not on the first format;
- the `Linter`, its configuration and the parsed `.oxlintrc.json` are cached per repository and
  rebuilt when that file changes;
- the fixpoint run (step 5) is skipped when step 4 reported no fixes on the first run;
- HTML formatting has no ESLint step and takes a few milliseconds per template.

### Format selection

"Format Selection" formats the whole file in memory, then returns only the edits inside the
smallest elements (HTML) or statements and class members (TypeScript) that contain the selection.
Formatting a fragment on its own would be wrong: its indentation depends on its parents, and a
selection can start or end inside a tag. If the edits inside the selection depend on lines outside
it (T2 moving a hook, for example), those edits are left out.

### Safety

- The extension never applies a partial result. Any error leaves the document as it is and writes
  the reason to a "Comet" output channel.
- HTML check: the formatted template is parsed again and its tree is compared with the original,
  with whitespace-only text ignored and text whitespace collapsed. A mismatch is a bug and gives no
  edit.
- TS check: the formatted file must parse with no new diagnostics, and its token stream (comments
  and whitespace aside, trailing commas and `{ return …; }` from T1 accounted for) must equal the
  original's.

## Steps

1. Commit this plan (`docs/plans/cmt_format_vscode_extension.plan.md`) with the first change, and
   add the H2a exception (`for`, extendable in `.cmt-format.json`) to the attribute rule in
   `docs/conventions/html-formatting.md`, so the convention and the formatter agree. Copy
   `comet-backend/docs/conventions/fire-and-forget.md` into `docs/conventions/`, with examples from
   this repository (`void this.router.navigate(…)`), and add its line to the conventions list in
   `AGENTS.md`. It is a convention for people and agents only: the formatter never adds or removes
   `void`, `await` or `.catch()`, because each of those changes what the code does.
2. Scaffold `comet-vscode`: `package.json` (`engines.vscode`, `main`, `contributes`), `tsconfig`, an esbuild bundle for the extension, and Vitest specs next to the
   sources.
3. Configuration loader: built-in defaults, `.oxlintrc.json` (JSONC), `.cmt-format.json`,
   `.editorconfig`, the walk up from the file, and the per-repository cache.
4. HTML engine with a fixture per rule: every Bad/Good pair in `html-formatting.md` becomes an
   `*.in.html` / `*.out.html` fixture, plus real templates (`split-button.component.html`,
   `stock-field-actions.component.html`). Every fixture also checks idempotence and the tree
   comparison. `src/app/pages/product/product.component.html` is the reference template: its
   expected output is the file itself with only these changes: the breadcrumbs `<label>` re-indented
   (H1), the `@for` body at +2 instead of +4 (H1), the empty `<cmt-button class="attribute-remove" …>`
   self-closed (H5), `>Редактировать атрибуты</cmt-button>` split onto three lines (H4), and the
   one-line tags with 2 counted attributes split one per line (H2), such as
   `<div class="product-field field" [matTooltip]="…">` and `<fields-group class="block-fields-group" id="…">`.
5. TS engine: T0, T1, T2, the stylistic pass and the fixpoint check, with fixtures from
   `typescript-formatting.md` and from real files that have long lines.
6. Range formatting in core, with fixtures for selections that start or end inside a tag.
7. Extension: activation on `html`/`typescript`, `comet.format.enable`, output channel, "Format
   Document" and "Format Selection". Published to the VS Code Marketplace, so Settings Sync installs
   and updates it on every machine (the code is public). Users set `editor.defaultFormatter` for `[html]` and
   `[typescript]` to it in their user settings, which Settings Sync carries too.
8. In this repository: add `@stylistic/quotes` and `@stylistic/comma-dangle` to `.oxlintrc.json`,
   remove the `*.ts`/`*.html` overrides from `.prettierrc.json` (Prettier keeps SCSS, JSON and
   Markdown), and add `.cmt-format.json` if the defaults ever differ from this repository's rules.
9. Test run of the engine on a throwaway copy of this repository (151 templates, 376 TS files
   outside `src/api-client`), from a dev script in `comet-vscode` that is not published: a report of
   files changed, errors and fixpoint failures, reviewed until the engine is clean, and
   `npm run lint`, `npx ng build` and `npm run test:ci` passing on the copy. The copy is deleted and
   nothing from it is committed; it only shows the formatter is safe on real files.
10. Docs: `README.md` in `comet-vscode` (install, settings, `.cmt-format.json`, how to add a rule).

## Out of scope

- SCSS, JSON and Markdown: they stay with Prettier and `.editorconfig`.
- Lint rules that are not about formatting (`eqeqeq`, `no-explicit-any`, ...): `oxlint` keeps reporting them.
- Inline component templates and `styles:` strings.
- JavaScript, JSX and TSX files.
- Formatting files nobody asked to format: no command-line tool, git hook, CI check or
  whole-repository commit.
- Conventions about what code does rather than how it is laid out (`fire-and-forget.md`): rewriting
  them would change behaviour.
