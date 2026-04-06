import * as fs from 'fs';
import * as path from 'path';

export function ensureDirectoryExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function readJsonFile<T>(filePath: string): T {
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

export function writeJsonFile(filePath: string, data: any): void {
  const dirPath = path.dirname(filePath);
  ensureDirectoryExists(dirPath);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

export function getRepoFileName(org: string, repo: string): string {
  return `${org}__${repo}.json`;
}

export function getMaxRepos(): number | undefined {
  const maxRepos = process.env.MAX_REPOS;
  return maxRepos ? parseInt(maxRepos, 10) : undefined;
}

export function shouldForceRefetch(): boolean {
  const forceRefetch = process.env.FORCE_REFETCH;
  return forceRefetch === 'true' || forceRefetch === '1';
}

export function shouldSkipExistingFile(filePath: string): boolean {
  // If FORCE_REFETCH is enabled, never skip (always re-fetch)
  if (shouldForceRefetch()) {
    return false;
  }
  // Otherwise, skip if file already exists
  return fileExists(filePath);
}
