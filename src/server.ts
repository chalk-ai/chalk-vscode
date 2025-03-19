import {
  createConnection,
  TextDocuments,
  Diagnostic,
  DiagnosticSeverity,
  ProposedFeatures,
  InitializeParams,
  TextDocumentSyncKind,
  InitializeResult
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { URI } from 'vscode-uri';

const execAsync = promisify(exec);

// Create a connection for the server, using Node's IPC as a transport
// Also include all preview / proposed LSP features
const connection = createConnection(ProposedFeatures.all);

// Create a text document manager
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

connection.onInitialize((params: InitializeParams) => {
  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Full
    }
  };
  
  return result;
});

// The content of a text document has changed.
documents.onDidChangeContent(change => {
  validateTextDocument(change.document);
});

interface ChalkError {
  message: string;
  severity: 'error' | 'warning';
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

interface ChalkResponse {
  errors: ChalkError[];
}

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  try {
    // Convert the URI to a file path
    const fileUri = URI.parse(textDocument.uri);
    const filePath = fileUri.fsPath;
    
    // Execute chalk lint command with LSP format
    const { stdout, stderr } = await execAsync(`chalk lint --format=lsp "${filePath}"`);
    
    if (stderr) {
      console.error(`chalk lint stderr: ${stderr}`);
    }
    
    let diagnostics: Diagnostic[] = [];
    
    if (stdout) {
      try {
        const response: ChalkResponse = JSON.parse(stdout);
        
        if (response.errors && Array.isArray(response.errors)) {
          diagnostics = response.errors.map(error => {
            return {
              severity: error.severity === 'error' ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
              range: error.range,
              message: error.message,
              source: 'chalk'
            };
          });
        }
      } catch (e) {
        console.error('Failed to parse chalk lint output:', e);
      }
    }
    
    // Send the computed diagnostics to VS Code
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
  } catch (error) {
    console.error('Error running chalk lint:', error);
  }
}

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();