import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const distDir = path.join(repoRoot, 'dist');
const websiteDir = path.resolve(repoRoot, '..', 'eric-Website');
const outputZipPath = path.join(websiteDir, 'PMToolKit.zip');
const stagingRoot = path.join(repoRoot, '.tmp', 'pmtoolkit-website-package');
const packageFolderName = 'PMToolKit';
const stagedPackageDir = path.join(stagingRoot, packageFolderName);

async function ensureDirectoryExists(targetPath, label) {
    try {
        const stats = await fs.stat(targetPath);
        if (!stats.isDirectory()) {
            throw new Error(`${label} exists but is not a directory: ${targetPath}`);
        }
    } catch (error) {
        if (error?.code === 'ENOENT') {
            throw new Error(`${label} not found: ${targetPath}`);
        }
        throw error;
    }
}

async function main() {
    await ensureDirectoryExists(distDir, 'dist folder');
    await ensureDirectoryExists(websiteDir, 'Website project folder');

    await fs.rm(stagingRoot, { recursive: true, force: true });
    await fs.mkdir(stagedPackageDir, { recursive: true });
    await fs.cp(distDir, stagedPackageDir, { recursive: true });
    await fs.rm(outputZipPath, { force: true });

    const zipResult = spawnSync('zip', ['-qr', outputZipPath, packageFolderName], {
        cwd: stagingRoot,
        encoding: 'utf8',
    });

    if (zipResult.status !== 0) {
        throw new Error((zipResult.stderr || zipResult.stdout || 'zip command failed').trim());
    }

    await fs.rm(stagingRoot, { recursive: true, force: true });
    console.log(`Created ${outputZipPath}`);
}

main().catch(async error => {
    await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
    console.error(`PMsToolKit packaging failed: ${error.message}`);
    process.exitCode = 1;
});
