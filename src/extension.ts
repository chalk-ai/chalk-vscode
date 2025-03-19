import * as path from 'path';
import { workspace, ExtensionContext, commands, window } from 'vscode';
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
      const { stdout, stderr } = await execAsync('chalk config');
      
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
  
  context.subscriptions.push(hiChalkCommand, showConfigCommand);

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
    // Register the server for all documents
    documentSelector: [{ scheme: 'file', language: '*' }],
    synchronize: {
      // Notify the server about file changes to '.clientrc files contained in the workspace
      fileEvents: workspace.createFileSystemWatcher('**/.clientrc')
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