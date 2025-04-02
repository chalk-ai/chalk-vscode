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
  validation?: any;
  lsp?: any;
  lsp_proto?: {
    diagnostics?: {
      uri: string;
      diagnostics: {
        range: {
          start: { line: number; character: number };
          end: { line: number; character: number };
        };
        message: string;
        severity: number;
        code: string;
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
    }[];
  };
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
      // Execute chalk lint command with LSP and JSON format in the project root
      const projectRoot = path.resolve(workspaceFolder, '../');
      console.log("Running chalk lint command: ", {projectRoot});
      const result = await execAsync(`chalk lint --lsp --json`, {
        cwd: projectRoot
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (execError: any) {
      console.error("Error executing chalk lint:", execError);
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
        
        // Process diagnostics from error.lsp field if present
        if (jsonResponse.error) {
          try {
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
          } catch (parseError) {
            console.error('Failed to parse error field:', parseError);
            console.error("Error field: ", {error: jsonResponse.error})
          }
        }
        
        // Process diagnostics from lsp_proto field if present
        if (jsonResponse.lsp_proto && jsonResponse.lsp_proto.diagnostics) {
          for (const diagnosticGroup of jsonResponse.lsp_proto.diagnostics) {
            // Extract file path from the uri
            const diagnosticFilePath = diagnosticGroup.uri;
            
            // Only process diagnostics for the current file (case-insensitive comparison)
            if (diagnosticFilePath.toLowerCase() === filePath.toLowerCase() || 
                // Also try to match just the basename
                path.basename(diagnosticFilePath).toLowerCase() === path.basename(filePath).toLowerCase()) {
              
              const diagsFromLspProto = diagnosticGroup.diagnostics.map(diag => {
                // Convert severity number to DiagnosticSeverity enum
                let severity: DiagnosticSeverity;
                switch (diag.severity) {
                  case 1: severity = DiagnosticSeverity.Error; break;
                  case 2: severity = DiagnosticSeverity.Warning; break;
                  case 3: severity = DiagnosticSeverity.Information; break;
                  case 4: severity = DiagnosticSeverity.Hint; break;
                  default: severity = DiagnosticSeverity.Error;
                }
                
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
              
              // Add the diagnostics from lsp_proto to our collection
              diagnostics = [...diagnostics, ...diagsFromLspProto];
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