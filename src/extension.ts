import * as vscode from 'vscode';
import { clearConfigCache, defaultConfig, loadConfig } from './format/config';
import { format } from './format/index';
import type { LineRange } from './format/index';

const SELECTOR: vscode.DocumentSelector = [
  { language: 'html', scheme: 'file' },
  { language: 'typescript', scheme: 'file' },
];

export function activate(context: vscode.ExtensionContext): void {
  // A log channel: timestamped, levelled lines, filtered by "Developer: Set Log Level…".
  const output = vscode.window.createOutputChannel('Comet', { log: true });
  output.info(`Comet ${context.extension.packageJSON.version} activated`);

  const provide = (document: vscode.TextDocument, range?: vscode.Range): vscode.TextEdit[] => {
    if (!vscode.workspace.getConfiguration('comet.format', document).get<boolean>('enable', true)) {
      return [];
    }
    const lines: LineRange | undefined = range && {
      startLine: range.start.line,
      // A selection that ends at the start of a line does not take that line.
      endLine: range.end.character === 0 && range.end.line > range.start.line ? range.end.line - 1 : range.end.line,
    };
    const started = performance.now();
    let result: ReturnType<typeof format>;
    try {
      result = format(document.getText(), document.fileName, loadConfig(document.fileName), lines);
    } catch (error) {
      output.error(`${document.fileName}:`, error);
      vscode.window.setStatusBarMessage('$(warning) Comet failed on this file; see the Comet output', 5000);
      return [];
    }
    if ('error' in result) {
      output.warn(`${document.fileName}: left unformatted: ${result.error}`);
      vscode.window.setStatusBarMessage('$(warning) Comet could not format this file; see the Comet output', 5000);
      return [];
    }
    output.debug(`${document.fileName}: ${result.edits.length} edits in ${Math.round(performance.now() - started)} ms`);
    const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    return result.edits.map(edit => vscode.TextEdit.replace(
      document.validateRange(new vscode.Range(edit.startLine, 0, edit.endLine, 0)),
      edit.text.replaceAll('\n', eol),
    ));
  };

  const watcher = vscode.workspace.createFileSystemWatcher('**/{.oxlintrc.json,.cmt-format.json,.editorconfig}');
  const reloadConfig = (uri: vscode.Uri): void => {
    output.debug(`${uri.fsPath} changed; config reloads on the next format`);
    clearConfigCache();
  };
  watcher.onDidChange(reloadConfig);
  watcher.onDidCreate(reloadConfig);
  watcher.onDidDelete(reloadConfig);

  context.subscriptions.push(
    output,
    watcher,
    vscode.languages.registerDocumentFormattingEditProvider(SELECTOR, {
      provideDocumentFormattingEdits: document => provide(document),
    }),
    vscode.languages.registerDocumentRangeFormattingEditProvider(SELECTOR, {
      provideDocumentRangeFormattingEdits: (document, range) => provide(document, range),
    }),
  );

  // The first TypeScript run builds the linter; doing it now keeps the first format quick.
  setTimeout(() => {
    try {
      format('const a = 1;\n', 'warm-up.ts', defaultConfig);
    } catch (error) {
      output.error('warm-up failed:', error);
    }
  }, 0);
}

export function deactivate(): void {}
