import * as path from 'path';
import { workspace, ExtensionContext, commands, window, Terminal, Uri } from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind
} from 'vscode-languageclient/node';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

let client: LanguageClient;

export function activate(context: ExtensionContext) {
  // Register the "Hi Chalk" command
  const hiChalkCommand = commands.registerCommand('chalk-lsp.hiChalk', () => {
    window.showInformationMessage('Hello world');
  });
  
  // Register the "Chalk: Show Configuration" command
  const showConfigCommand = commands.registerCommand('chalk-lsp.showConfig', async () => {
    try {
      // Get the workspace folder paths
      const workspaceFolders = workspace.workspaceFolders;
      
      if (!workspaceFolders || workspaceFolders.length === 0) {
        window.showWarningMessage('No workspace folder is open.');
        return;
      }
      
      // Use the first workspace folder as the current working directory
      const cwd = workspaceFolders[0].uri.fsPath;
      
      const { stdout, stderr } = await execAsync('chalk config', { cwd });
      
      if (stderr) {
        window.showErrorMessage(`Error running chalk config: ${stderr}`);
        return;
      }
      
      if (stdout.trim()) {
        window.showInformationMessage(`Chalk Config: ${stdout.trim()}`);
      } else {
        window.showInformationMessage('No chalk configuration found.');
      }
    } catch (error) {
      window.showErrorMessage(`Failed to run chalk config: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  
  // Terminal for running chalk commands
  let chalkTerminal: Terminal | undefined;
  
  // Register the "Chalk: Lint" command
  const runLintCommand = commands.registerCommand('chalk-lsp.runLint', async () => {
    try {
      // Get the workspace folder paths
      const workspaceFolders = workspace.workspaceFolders;
      
      if (!workspaceFolders || workspaceFolders.length === 0) {
        window.showWarningMessage('No workspace folder is open.');
        return;
      }
      
      // Get the active text editor
      const editor = window.activeTextEditor;
      const filePath = editor?.document.uri.fsPath;
      
      // Use the first workspace folder as the current working directory
      const workspacePath = workspaceFolders[0].uri.fsPath;
      
      // Create or show a dedicated terminal for chalk commands
      if (!chalkTerminal || chalkTerminal.exitStatus !== undefined) {
        chalkTerminal = window.createTerminal('Chalk');
      }
      
      chalkTerminal.show();
      
      // Change to the workspace directory
      chalkTerminal.sendText(`cd "${workspacePath}"`);
      
      // Run chalk lint command with || true to tolerate exit code 1
      // This way the terminal won't show an error message when the lint command finds issues
      if (filePath && filePath.endsWith('.py')) {
        chalkTerminal.sendText(`chalk lint "${filePath}" || echo "Completed with issues"`);
      } else {
        chalkTerminal.sendText('chalk lint || echo "Completed with issues"');
      }
    } catch (error) {
      window.showErrorMessage(`Failed to run chalk lint: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  
  context.subscriptions.push(hiChalkCommand, showConfigCommand, runLintCommand);

  // The server is implemented in node
  const serverModule = context.asAbsolutePath(
    path.join('dist', 'server.js')
  );
  
  // The debug options for the server
  // --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
  const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

  // If the extension is launched in debug mode then the debug server options are used
  // Otherwise the run options are used
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: debugOptions
    }
  };

  // Options to control the language client
  const clientOptions: LanguageClientOptions = {
    // Register the server for Python files
    documentSelector: [{ scheme: 'file', language: 'python' }],
    synchronize: {
      // Notify the server about file changes to Python files and chalk.yaml config
      fileEvents: workspace.createFileSystemWatcher('**/*.{py,yaml}')
    }
  };

  // Create and start the client
  client = new LanguageClient(
    'chalkLSP',
    'Chalk LSP',
    serverOptions,
    clientOptions
  );

  // Start the client. This will also launch the server
  client.start();
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}