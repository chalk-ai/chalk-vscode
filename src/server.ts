import {
  createConnection,
  TextDocuments,
  Diagnostic,
  DiagnosticSeverity,
  ProposedFeatures,
  InitializeParams,
  TextDocumentSyncKind,
  InitializeResult,
  DiagnosticRelatedInformation,
  Location
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

interface ChalkJsonResponse {
  error?: string;
  message?: string;
}

interface ChalkDiagnosticData {
  uri: string;
  diagnostics: {
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
    message: string;
    severity: string;
    code: string;
    codeDescription: any;
    relatedInformation?: {
      location: {
        uri: string;
        range: {
          start: { line: number; character: number };
          end: { line: number; character: number };
        };
      };
      message: string;
    }[];
  }[];
}

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  try {
    // Convert the URI to a file path
    const fileUri = URI.parse(textDocument.uri);
    const filePath = fileUri.fsPath;
    const workspaceFolder = path.dirname(filePath);
    
    let stdout = '';
    let stderr = '';
    
    try {
      // Execute chalk lint command with JSON format in the workspace folder
      const result = await execAsync(`chalk lint --json`, {
        cwd: workspaceFolder
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (execError: any) {
      // Chalk lint command may exit with code 1 when it finds linting errors
      // We still want to process its output in this case
      if (execError.code === 1 && execError.stdout) {
        stdout = execError.stdout;
        if (execError.stderr) {
          stderr = execError.stderr;
        }
      } else {
        // For other errors, log and return
        console.error(`chalk lint execution error:`, execError);
        return;
      }
    }
    
    if (stderr) {
      console.error(`chalk lint stderr: ${stderr}`);
    }
    
    let diagnostics: Diagnostic[] = [];
    
    if (stdout) {
      try {
        const jsonResponse: ChalkJsonResponse = JSON.parse(stdout);
        
        if (jsonResponse.error) {
          // Parse the nested JSON in the error field
          const errorData = JSON.parse(jsonResponse.error);
          
          if (errorData.lsp && errorData.lsp.diagnostics) {
            // Loop through all diagnostic groups
            for (const diagnosticGroup of errorData.lsp.diagnostics) {
              // Only process diagnostics for the current file
              if (diagnosticGroup.uri === filePath) {
                diagnostics = diagnosticGroup.diagnostics.map((diag: any) => {
                  const severity = diag.severity === 'Error' 
                    ? DiagnosticSeverity.Error 
                    : DiagnosticSeverity.Warning;
                  
                  // Create related information if available
                  const relatedInformation: DiagnosticRelatedInformation[] = [];
                  if (diag.relatedInformation && diag.relatedInformation.length > 0) {
                    for (const info of diag.relatedInformation) {
                      relatedInformation.push({
                        location: {
                          uri: info.location.uri,
                          range: info.location.range
                        },
                        message: info.message
                      });
                    }
                  }
                  
                  return {
                    severity,
                    range: diag.range,
                    message: diag.message,
                    code: diag.code,
                    source: 'chalk',
                    relatedInformation: relatedInformation.length > 0 ? relatedInformation : undefined
                  };
                });
              }
            }
          }
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