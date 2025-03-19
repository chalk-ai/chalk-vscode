# Chalk LSP

Language Server Protocol implementation for Chalk.

## Features

- Provides real-time linting of Chalk files
- Displays errors and warnings directly in your editor
- Uses the `chalk lint` command to validate files

## Requirements

- Node.js
- `chalk` binary installed and available in your PATH

## Installation

1. Clone this repository
2. Run `npm install`
3. Run `npm run build`

## Usage

### VS Code Extension

Build this project and then link or install it into your VS Code extensions folder.

### Other Editors

This LSP can be used with any editor that supports the Language Server Protocol. See your editor's documentation for details on how to connect to an external language server.

## Configuration

By default, the LSP will run `chalk lint --format=lsp` on your files. The command assumes that the `chalk` binary is in your PATH.

## Development

- `npm run build` - Build the LSP server
- `npm run watch` - Watch for changes and rebuild
- `npm run start` - Start the LSP server