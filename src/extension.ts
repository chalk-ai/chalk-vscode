import * as path from 'path';
import { 
  workspace, 
  ExtensionContext, 
  commands, 
  window, 
  Terminal, 
  Uri, 
  TreeDataProvider,
  Event,
  EventEmitter,
  TreeItem,
  TreeItemCollapsibleState
} from 'vscode';
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

// Interface for chalk environment data
interface ChalkEnvironment {
  name: string;
  project_id: string;
  id: string;
  team_id: string;
}

// Class representing a Chalk environment in the tree view
class ChalkEnvironmentItem extends TreeItem {
  constructor(
    public readonly environment: ChalkEnvironment
  ) {
    super(environment.name, TreeItemCollapsibleState.None);
    this.tooltip = `ID: ${environment.id}\nProject ID: ${environment.project_id}\nTeam ID: ${environment.team_id}`;
    this.description = `(${environment.project_id})`;
    this.iconPath = new ThemeIcon('server-environment');
    
    // Command to open the environment when clicked
    this.command = {
      command: 'chalk-lsp.selectEnvironment',
      title: 'Select Environment',
      arguments: [this.environment]
    };
  }
}

// Tree data provider for Chalk environments
class ChalkEnvironmentsProvider implements TreeDataProvider<ChalkEnvironmentItem> {
  private _onDidChangeTreeData: EventEmitter<ChalkEnvironmentItem | undefined | null | void> = new EventEmitter<ChalkEnvironmentItem | undefined | null | void>();
  readonly onDidChangeTreeData: Event<ChalkEnvironmentItem | undefined | null | void> = this._onDidChangeTreeData.event;
  
  private environments: ChalkEnvironment[] = [];
  
  constructor() {
    this.refreshEnvironments();
  }
  
  refresh(): void {
    this.refreshEnvironments();
    this._onDidChangeTreeData.fire();
  }
  
  getTreeItem(element: ChalkEnvironmentItem): TreeItem {
    return element;
  }
  
  getChildren(element?: ChalkEnvironmentItem): Thenable<ChalkEnvironmentItem[]> {
    if (element) {
      // We don't have child elements
      return Promise.resolve([]);
    } else {
      return Promise.resolve(this.environments.map(env => new ChalkEnvironmentItem(env)));
    }
  }
  
  private async refreshEnvironments(): Promise<void> {
    try {
      // Get the workspace folder paths
      const workspaceFolders = workspace.workspaceFolders;
      
      if (!workspaceFolders || workspaceFolders.length === 0) {
        return;
      }
      
      // Use the first workspace folder as the current working directory
      const cwd = workspaceFolders[0].uri.fsPath;
      
      try {
        // Run the chalk env --json command
        const { stdout } = await execAsync('chalk env --json', { cwd });
        
        if (stdout) {
          const result = JSON.parse(stdout);
          if (result.environments && Array.isArray(result.environments)) {
            this.environments = result.environments;
          }
        }
      } catch (execError: any) {
        // If command fails, reset environments and continue
        this.environments = [];
        console.error('Failed to load chalk environments:', execError);
      }
    } catch (error) {
      console.error('Error refreshing environments:', error);
    }
  }
}

// Import ThemeIcon separately because of TypeScript parsing issues
import { ThemeIcon } from 'vscode';

export function activate(context: ExtensionContext) {
  // Create the environment tree data provider
  const environmentsProvider = new ChalkEnvironmentsProvider();
  
  // Register the environments view
  const environmentsTreeView = window.createTreeView('chalk-environments', {
    treeDataProvider: environmentsProvider,
    showCollapseAll: false
  });
  
  // Register refresh command
  const refreshEnvironmentsCommand = commands.registerCommand('chalk-lsp.refreshEnvironments', () => {
    environmentsProvider.refresh();
  });
  
  // Register select environment command
  const selectEnvironmentCommand = commands.registerCommand('chalk-lsp.selectEnvironment', (env: ChalkEnvironment) => {
    window.showInformationMessage(`Selected environment: ${env.name}`);
    // In a future enhancement, this could set the environment in .env or a config file
  });
  
  // Register the tree view for cleanup
  context.subscriptions.push(environmentsTreeView, refreshEnvironmentsCommand, selectEnvironmentCommand);
  
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