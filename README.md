# Chalk for VS Code and Cursor

The Chalk extension downloads and runs `chalk-lsp` for projects containing `chalk.yml` or `chalk.yaml`. `chalk-lsp` provides Python semantic analysis and typechecking, Chalk SQL resolver support, and Chalk configuration diagnostics. Updating it matters because those language features and their fixes ship in the server independently of extension releases.

## Install

Install **Chalk** (`ChalkAI.chalk-lsp`) from the Visual Studio Marketplace or Open VSX. Cursor can install the same extension.

The first Chalk project you open downloads the latest server for your platform, verifies its SHA-256 checksum, and stores it in VS Code's extension data directory. Later activations do not look up releases, update automatically, or prompt you. The extension and `chalk-lsp` have independent versions.

The status bar always shows the installed `chalk-lsp` version. To update manually, open the Command Palette and run **Chalk: Update Language Server**, or click that status item. This downloads and verifies the latest release, replaces the installed server, and restarts every Chalk client.

Supported binaries are macOS and Linux on x86-64/ARM64 and Windows on x86-64.

## Commands

- **Chalk: Show Configuration** shows the active environment and server endpoints in the Chalk output channel. It never displays client credentials.
- **Chalk: Update Language Server** explicitly downloads the latest release, verifies it, installs it, and restarts every Chalk client.
- **Chalk: Restart Language Server** restarts the installed server without checking for updates.
- **Chalk: Show Language Server Output** opens server logs.
- **Chalk: Configure Workspace** disables known competing Python language services when the active Chalk root is a VS Code workspace folder. For a Chalk root nested under a workspace folder, it shows the exact settings to merge without changing anything. Ruff formatting remains enabled. New `chalk init` projects already contain these settings.

The extension starts one client for each top-level Chalk root in single-folder and multi-root workspaces. Nested Chalk projects are not supported. It does not change language-server settings in non-Chalk projects.

The extension runs in the workspace extension host so remote workspaces install and run the server on the remote platform. It is disabled for untrusted and virtual workspaces because it downloads and executes a native language-server process and requires a filesystem-backed project.

## Python language-server conflicts

`chalk-lsp` is Chalk's semantic and typechecking authority; it is not intended to run beside Pylance, Pyright, basedpyright, ty, pylsp/Jedi, or Ruff LSP. The extension reports likely conflicts but only changes an existing project when you invoke **Chalk: Configure Workspace**.

VS Code has window-scoped settings that cannot fully isolate every mixed multi-root layout. Use separate windows when a workspace combines Chalk and non-Chalk Python roots and the status bar reports a conflict.

## Development and publication

```bash
npm install
npm run build
npm run package
```

Run `./release.sh` (or `just release`) and select a semantic-version bump. The shared Chalk release script creates the next GitHub release and bare semantic-version tag; the tag triggers the publication workflow, which uses that tag as the extension version. The workflow installs the locked dependencies with Node.js 22, builds one VSIX, and publishes that same package independently to the Visual Studio Marketplace and Open VSX using the repository-local `vsce` and `ovsx` versions. Configure the `VSCE_PAT` and `OVSX_PAT` repository secrets before releasing. Cursor receives the Open VSX publication; it does not use a separate package.

## Troubleshooting

Open **Chalk: Show Language Server Output** for installation and startup failures. A failed update leaves the previous binary installed. Use **Chalk: Update Language Server** to retry.
