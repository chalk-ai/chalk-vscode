import * as crypto from 'crypto';
import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import AdmZip from 'adm-zip';
import * as tar from 'tar';
import { ExtensionContext, ProgressLocation, window } from 'vscode';

const artifactRegistry = 'https://artifactregistry.googleapis.com';
const versionsUrl = `${artifactRegistry}/v1/projects/chalk-prod/locations/us/repositories/chalk-lsp/packages/chalk-lsp/versions?pageSize=1000`;

interface InstalledServer {
  version: string;
  target: string;
}

export class ServerManager {
  private installPromise: Promise<string> | undefined;

  constructor(private readonly context: ExtensionContext) {}

  get binaryPath(): string {
    return path.join(this.context.globalStorageUri.fsPath, 'server', process.platform === 'win32' ? 'chalk-lsp.exe' : 'chalk-lsp');
  }

  async installedVersion(): Promise<string | undefined> {
    return (await this.recoverInstallation())?.version;
  }

  ensureInstalled(force = false): Promise<string> {
    if (!this.installPromise) {
      this.installPromise = this.install(force).finally(() => {
        this.installPromise = undefined;
      });
    }
    return this.installPromise;
  }

  private async recoverInstallation(): Promise<InstalledServer | undefined> {
    const serverDirectory = path.dirname(this.binaryPath);
    const backupDirectory = `${serverDirectory}.old`;
    const readInstallation = async (directory: string): Promise<InstalledServer | undefined> => {
      try {
        const metadata = JSON.parse(await fs.promises.readFile(path.join(directory, 'installed.json'), 'utf8')) as InstalledServer;
        if (!metadata || typeof metadata.version !== 'string' || !/^v\d/.test(metadata.version)) return undefined;
        const binary = path.join(directory, path.basename(this.binaryPath));
        if (!(await fs.promises.stat(binary)).isFile()) return undefined;
        await fs.promises.access(
          binary,
          process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK,
        );
        return metadata;
      } catch {
        return undefined;
      }
    };

    const installed = await readInstallation(serverDirectory);
    const backup = await readInstallation(backupDirectory);
    if (backup && (!installed || compareVersions(backup.version, installed.version) > 0)) {
      await fs.promises.rm(serverDirectory, { recursive: true, force: true });
      await fs.promises.rename(backupDirectory, serverDirectory);
      return backup;
    }
    await fs.promises.rm(backupDirectory, { recursive: true, force: true });
    return installed;
  }

  private async install(force: boolean): Promise<string> {
    const installed = await this.recoverInstallation();
    if (!force && installed) {
      return this.binaryPath;
    }

    return window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: force ? 'Updating Chalk language server' : 'Installing Chalk language server',
        cancellable: false,
      },
      async progress => {
        const target = this.target();
        progress.report({ message: 'Resolving the latest release…' });
        const versions = JSON.parse((await request(versionsUrl)).toString('utf8')) as { versions?: Array<{ name?: string }> };
        const version = versions.versions
          ?.map(item => item.name?.split('/versions/').pop())
          .filter((item): item is string => Boolean(item && /^v\d/.test(item)))
          .sort(compareVersions)
          .pop();
        if (!version) {
          throw new Error(`Could not determine the latest chalk-lsp release from ${versionsUrl}`);
        }

        const extension = process.platform === 'win32' ? 'zip' : 'tar.gz';
        const archiveName = `chalk-lsp-${version}-${target}.${extension}`;
        const fileBase = `${artifactRegistry}/download/v1/projects/chalk-prod/locations/us/repositories/chalk-lsp/files/chalk-lsp:${version}:`;
        const downloadUrl = `${fileBase}${archiveName}:download?alt=media`;
        const checksumUrl = `${fileBase}${archiveName}.sha256:download?alt=media`;
        await fs.promises.mkdir(this.context.globalStorageUri.fsPath, { recursive: true });
        const temporaryRoot = await fs.promises.mkdtemp(path.join(this.context.globalStorageUri.fsPath, 'chalk-lsp-'));

        try {
          const archivePath = path.join(temporaryRoot, archiveName);
          progress.report({ message: `Downloading ${version}…` });
          await download(downloadUrl, archivePath);
          const expected = (await request(checksumUrl)).toString('utf8').trim().split(/\s+/)[0];
          const actual = crypto.createHash('sha256').update(await fs.promises.readFile(archivePath)).digest('hex');
          if (!expected || expected !== actual) {
            throw new Error(`Checksum mismatch for ${archiveName}`);
          }

          progress.report({ message: 'Installing…' });
          if (extension === 'zip') {
            new AdmZip(archivePath).extractAllTo(temporaryRoot, true);
          } else {
            await tar.x({ file: archivePath, cwd: temporaryRoot });
          }

          const extracted = path.join(temporaryRoot, `chalk-lsp-${version}-${target}`, process.platform === 'win32' ? 'chalk-lsp.exe' : 'chalk-lsp');
          const serverDirectory = path.dirname(this.binaryPath);
          const replacementDirectory = path.join(temporaryRoot, 'replacement-server');
          const backupDirectory = `${serverDirectory}.old`;
          const replacement = path.join(replacementDirectory, path.basename(this.binaryPath));
          await fs.promises.mkdir(replacementDirectory, { recursive: true });
          await fs.promises.copyFile(extracted, replacement);
          if (process.platform !== 'win32') {
            await fs.promises.chmod(replacement, 0o755);
          }
          await fs.promises.writeFile(
            path.join(replacementDirectory, 'installed.json'),
            JSON.stringify({ version, target }, null, 2) + '\n',
          );

          await this.recoverInstallation();
          let preservedExisting = false;
          try {
            await fs.promises.rename(serverDirectory, backupDirectory);
            preservedExisting = true;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
              throw error;
            }
          }
          try {
            await fs.promises.rename(replacementDirectory, serverDirectory);
          } catch (error) {
            await fs.promises.rm(replacementDirectory, { recursive: true, force: true });
            if (preservedExisting) {
              await fs.promises.rename(backupDirectory, serverDirectory);
            }
            throw error;
          }
          await fs.promises.rm(backupDirectory, { recursive: true, force: true }).catch(() => undefined);
          return this.binaryPath;
        } finally {
          await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
        }
      },
    );
  }

  private target(): string {
    if (process.platform === 'darwin' && process.arch === 'x64') return 'x86_64-apple-darwin';
    if (process.platform === 'darwin' && process.arch === 'arm64') return 'aarch64-apple-darwin';
    if (process.platform === 'linux' && process.arch === 'x64') return 'x86_64-unknown-linux-gnu';
    if (process.platform === 'linux' && process.arch === 'arm64') return 'aarch64-unknown-linux-gnu';
    if (process.platform === 'win32' && process.arch === 'x64') return 'x86_64-pc-windows-gnu';
    throw new Error(`chalk-lsp does not publish a binary for ${process.platform}/${process.arch}`);
  }
}

function compareVersions(left: string, right: string): number {
  const a = left.slice(1).split(/[.-]/).map(part => Number.parseInt(part, 10) || 0);
  const b = right.slice(1).split(/[.-]/).map(part => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference !== 0) return difference;
  }
  return left.localeCompare(right);
}

function request(url: string, redirects = 5): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    https.get(url, response => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirects > 0) {
        response.resume();
        void request(new URL(response.headers.location, url).toString(), redirects - 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed with HTTP ${response.statusCode}: ${url}`));
        return;
      }
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    }).on('error', reject);
  });
}

function download(url: string, destination: string, redirects = 5): Promise<void> {
  return new Promise((resolve, reject) => {
    https.get(url, response => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirects > 0) {
        response.resume();
        void download(new URL(response.headers.location, url).toString(), destination, redirects - 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed with HTTP ${response.statusCode}: ${url}`));
        return;
      }
      void pipeline(response, fs.createWriteStream(destination)).then(() => resolve(), reject);
    }).on('error', reject);
  });
}
