import { execFile } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';
import {
  commands,
  ConfigurationTarget,
  ExtensionContext,
  extensions,
  RelativePattern,
  StatusBarAlignment,
  Uri,
  window,
  workspace,
  WorkspaceFolder,
} from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions } from 'vscode-languageclient/node';
import { ServerManager } from './serverManager';

const execFileAsync = promisify(execFile);
const clients = new Map<string, LanguageClient>();
let knownRoots = new Set<string>();
const output = window.createOutputChannel('Chalk Language Server');
let serverManager: ServerManager;
let serverStatus: ReturnType<typeof window.createStatusBarItem>;
let reconcilePromise: Promise<void> = Promise.resolve();
const workspaceConfiguration: Record<string, unknown> = {
  'python.languageServer': 'None',
  'pyright.disableLanguageServices': true,
  'basedpyright.disableLanguageServices': true,
  'ty.disableLanguageServices': true,
  'ty.diagnosticMode': 'off',
  'ruff.lint.enable': false,
};

export async function activate(context: ExtensionContext): Promise<void> {
  serverManager = new ServerManager(context);
  context.subscriptions.push(output);

  serverStatus = window.createStatusBarItem(StatusBarAlignment.Left, 49);
  serverStatus.command = 'chalk-lsp.updateServer';
  context.subscriptions.push(serverStatus);
  await refreshServerStatus();

  const conflicts = window.createStatusBarItem(StatusBarAlignment.Left, 50);
  conflicts.command = 'chalk-lsp.configureWorkspace';
  context.subscriptions.push(conflicts);

  context.subscriptions.push(
    commands.registerCommand('chalk-lsp.showConfig', () => runChalkConfig()),
    commands.registerCommand('chalk-lsp.updateServer', async () => {
      await stopClients();
      try {
        await serverManager.ensureInstalled(true);
        await reconcile();
        window.showInformationMessage(`Chalk language server updated to ${await serverManager.installedVersion()}`);
      } catch (error) {
        output.appendLine(`Update failed: ${String(error)}`);
        output.show(true);
        window.showErrorMessage(`Failed to update Chalk language server: ${message(error)}`);
        await reconcile();
      } finally {
        await refreshServerStatus();
      }
    }),
    commands.registerCommand('chalk-lsp.restartServer', async () => {
      await stopClients();
      await reconcile();
    }),
    commands.registerCommand('chalk-lsp.showOutput', () => output.show()),
    commands.registerCommand('chalk-lsp.configureWorkspace', configureWorkspace),
  );

  const markerWatcher = workspace.createFileSystemWatcher('**/{chalk.yml,chalk.yaml}');
  markerWatcher.onDidCreate(queueReconcile);
  markerWatcher.onDidDelete(queueReconcile);
  context.subscriptions.push(markerWatcher, workspace.onDidChangeWorkspaceFolders(queueReconcile));

  await reconcile();
  await refreshServerStatus();
  await updateConflictStatus(conflicts);
  context.subscriptions.push(workspace.onDidChangeConfiguration(() => void updateConflictStatus(conflicts)));
}

async function refreshServerStatus(): Promise<void> {
  const version = await serverManager.installedVersion();
  serverStatus.text = `$(server) Chalk LSP: ${version || 'not installed'}`;
  serverStatus.tooltip = version
    ? `Installed chalk-lsp version: ${version}. Click to run Chalk: Update Language Server.`
    : 'chalk-lsp is not installed. It installs when a Chalk project opens; click to install the latest release now.';
  serverStatus.show();
}

export async function deactivate(): Promise<void> {
  await stopClients();
}

function queueReconcile(): void {
  reconcilePromise = reconcilePromise.then(async () => {
    await stopClients();
    await reconcile();
    await refreshServerStatus();
  }, async () => {
    await stopClients();
    await reconcile();
    await refreshServerStatus();
  });
}

async function reconcile(): Promise<void> {
  const roots = await findChalkRoots();
  knownRoots = new Set(roots.keys());
  for (const [root, client] of clients) {
    if (!roots.has(root)) {
      await client.stop();
      clients.delete(root);
    }
  }
  if (roots.size === 0) return;

  let binary: string;
  try {
    binary = await serverManager.ensureInstalled();
  } catch (error) {
    output.appendLine(`Installation failed: ${String(error)}`);
    output.show(true);
    window.showErrorMessage(`Failed to install Chalk language server: ${message(error)}`);
    return;
  }

  for (const [root, folder] of roots) {
    if (clients.has(root)) continue;
    const serverOptions: ServerOptions = { command: binary, args: ['lsp'], options: { cwd: root } };
    const documentSelector = [
      { scheme: 'file', language: 'python', pattern: new RelativePattern(folder, '**/*.py') },
      { scheme: 'file', pattern: new RelativePattern(folder, '**/*.chalk.sql') },
      { scheme: 'file', pattern: new RelativePattern(folder, 'chalk.yml') },
      { scheme: 'file', pattern: new RelativePattern(folder, 'chalk.yaml') },
    ];
    const clientOptions: LanguageClientOptions = {
      workspaceFolder: folder,
      // vscode-languageclient types patterns as LSP string globs, but passes
      // selectors through to VS Code, whose API supports root-scoped patterns.
      documentSelector: documentSelector as unknown as LanguageClientOptions['documentSelector'],
      outputChannel: output,
    };
    const client = new LanguageClient(`chalk-lsp:${root}`, `Chalk (${folder.name})`, serverOptions, clientOptions);
    clients.set(root, client);
    try {
      await client.start();
    } catch (error) {
      clients.delete(root);
      output.appendLine(`Failed to start Chalk for ${root}: ${String(error)}`);
    }
  }
}

async function findChalkRoots(): Promise<Map<string, WorkspaceFolder>> {
  const candidates: Array<{ root: string; workspaceFolder: WorkspaceFolder }> = [];
  for (const workspaceFolder of workspace.workspaceFolders || []) {
    let rootMarkerFound = false;
    for (const markerName of ['chalk.yml', 'chalk.yaml']) {
      try {
        await workspace.fs.stat(Uri.joinPath(workspaceFolder.uri, markerName));
        candidates.push({ root: path.resolve(workspaceFolder.uri.fsPath), workspaceFolder });
        rootMarkerFound = true;
        break;
      } catch {
        // This workspace folder is not itself a Chalk root under this marker name.
      }
    }
    if (rootMarkerFound) continue;

    const markers = await workspace.findFiles(
      new RelativePattern(workspaceFolder, '**/{chalk.yml,chalk.yaml}'),
      new RelativePattern(workspaceFolder, '**/{.git,.venv,venv,node_modules,target,dist,build}/**'),
    );
    for (const marker of markers) {
      candidates.push({ root: path.resolve(path.dirname(marker.fsPath)), workspaceFolder });
    }
  }

  candidates.sort((left, right) => {
    const depth = left.root.split(path.sep).length - right.root.split(path.sep).length;
    return depth || left.root.localeCompare(right.root);
  });

  const roots = new Map<string, WorkspaceFolder>();
  for (const { root, workspaceFolder } of candidates) {
    if ([...roots.keys()].some(parent => isPathInRoot(root, parent))) continue;
    roots.set(root, {
      uri: Uri.file(root),
      name: path.basename(root),
      index: workspaceFolder.index,
    });
  }
  return roots;
}

async function stopClients(): Promise<void> {
  const stopping = [...clients.values()].map(client => client.stop().catch(error => output.appendLine(`Failed to stop client: ${String(error)}`)));
  clients.clear();
  knownRoots.clear();
  await Promise.all(stopping);
}

async function configureWorkspace(): Promise<void> {
  const activeFile = window.activeTextEditor?.document.uri.fsPath;
  const root = activeFile && chalkRootForPath(activeFile);
  if (!root) {
    window.showWarningMessage('Open a file in a known Chalk root before configuring its Python language servers.');
    return;
  }
  const folder = workspace.workspaceFolders?.find(candidate => path.resolve(candidate.uri.fsPath) === root);
  if (!folder) {
    window.showWarningMessage(
      `Chalk did not change any settings because ${root} is not a VS Code workspace folder. Add that directory to the workspace, then merge this into its folder settings: ${JSON.stringify(workspaceConfiguration, null, 2)}`,
      { modal: true },
    );
    return;
  }
  const target = ConfigurationTarget.WorkspaceFolder;
  const failed: string[] = [];
  for (const [setting, value] of Object.entries(workspaceConfiguration)) {
    const separator = setting.indexOf('.');
    const section = setting.slice(0, separator);
    const key = setting.slice(separator + 1);
    try {
      await workspace.getConfiguration(section, folder.uri).update(key, value, target);
    } catch (error) {
      failed.push(`${section}.${key}`);
      output.appendLine(`Could not set ${section}.${key} for ${folder.name}: ${String(error)}`);
    }
  }
  if (failed.length === 0) {
    window.showInformationMessage(`Configured ${folder.name} to use Chalk as its Python language server.`);
  } else {
    window.showWarningMessage(`Some Python LSP settings are not folder-scoped (${failed.join(', ')}). Chalk did not change window-wide settings; see the status indicator.`);
  }
}

async function updateConflictStatus(status: ReturnType<typeof window.createStatusBarItem>): Promise<void> {
  if (knownRoots.size === 0) {
    status.hide();
    return;
  }
  const conflicts = new Set<string>();
  for (const root of knownRoots) {
    const resource = Uri.file(root);
    const pythonServer = workspace.getConfiguration('python', resource).get<string>('languageServer');
    if (pythonServer !== 'None' && (extensions.getExtension('ms-python.python') || extensions.getExtension('ms-python.vscode-pylance'))) {
      conflicts.add('Python/Pylance/Jedi');
    }
    if (extensions.getExtension('ms-pyright.pyright') && !workspace.getConfiguration('pyright', resource).get<boolean>('disableLanguageServices')) {
      conflicts.add('Pyright');
    }
    if (extensions.getExtension('detachhead.basedpyright') && !workspace.getConfiguration('basedpyright', resource).get<boolean>('disableLanguageServices')) {
      conflicts.add('basedpyright');
    }
    if (extensions.getExtension('astral-sh.ty')
        && (!workspace.getConfiguration('ty', resource).get<boolean>('disableLanguageServices')
          || workspace.getConfiguration('ty', resource).get<string>('diagnosticMode') !== 'off')) {
      conflicts.add('ty');
    }
    if (extensions.getExtension('charliermarsh.ruff') && workspace.getConfiguration('ruff', resource).get<boolean>('lint.enable') !== false) {
      conflicts.add('Ruff');
    }
  }
  if (conflicts.size === 0) {
    status.hide();
    return;
  }
  status.text = '$(warning) Chalk: check Python LSP conflicts';
  status.tooltip = `Potential competing language servers remain active: ${[...conflicts].join(', ')}. Click to configure this workspace.`;
  status.show();
}

async function runChalkConfig(): Promise<void> {
  const root = activeChalkRoot() || [...clients.keys()][0];
  if (!root) {
    window.showWarningMessage('No Chalk project is open.');
    return;
  }
  try {
    const { stdout, stderr } = await execFileAsync('chalk', ['config', '--format', 'json'], { cwd: root });
    if (stderr.trim()) output.appendLine(stderr.trim());
    const config = JSON.parse(stdout) as Record<string, { value?: unknown }>;
    const fields = [
      ['Environment name', 'environmentName'],
      ['Environment ID', 'environment'],
      ['API server', 'apiServer'],
      ['gRPC API server', 'grpcApiServer'],
      ['Query server', 'queryServer'],
    ] as const;
    output.appendLine('');
    output.appendLine(`Chalk configuration for ${root}`);
    for (const [label, key] of fields) {
      const value = config[key]?.value;
      output.appendLine(`${label}: ${typeof value === 'string' && value ? value : '(not set)'}`);
    }
    output.show();
  } catch (error) {
    window.showErrorMessage(`Failed to run chalk config: ${message(error)}`);
  }
}

function activeChalkRoot(): string | undefined {
  const file = window.activeTextEditor?.document.uri.fsPath;
  if (!file) return undefined;
  return chalkRootForPath(file);
}

function chalkRootForPath(file: string): string | undefined {
  return [...knownRoots].find(root => isPathInRoot(file, root));
}

function isPathInRoot(file: string, root: string): boolean {
  const relative = path.relative(root, file);
  return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
