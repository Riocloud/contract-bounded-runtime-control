#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const SKIP_ANY_DIRS = new Set(['.git', 'node_modules']);
const SKIP_ROOT_DIRS = new Set(['results', 'runs']);
const SKIP_FILES = new Set(['scripts/check-privacy-boundary.mjs']);
const DENY_PATTERNS = [
  /sk-[A-Za-z0-9_-]{16,}/,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  /M2\.7-[A-Za-z0-9_-]+/i,
  /session_token/i,
  /password/i,
  /payment record/i,
  /exact payment/i,
];

function relativeParts(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).filter(Boolean);
}

function shouldSkipRelativePath(relativePath) {
  const parts = relativePath.split(path.sep).filter(Boolean);
  if (parts.some((part) => SKIP_ANY_DIRS.has(part))) return true;
  return parts.length > 0 && SKIP_ROOT_DIRS.has(parts[0]);
}

function shouldSkipDirectory(dirPath) {
  const parts = relativeParts(dirPath);
  if (parts.some((part) => SKIP_ANY_DIRS.has(part))) return true;
  return parts.length === 1 && SKIP_ROOT_DIRS.has(parts[0]);
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDirectory(fullPath)) return [];
      return walk(fullPath);
    }
    if (!entry.isFile()) return [];
    return [fullPath];
  });
}

function candidateFiles() {
  try {
    return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split(/\r?\n/)
      .filter(Boolean)
      .map((file) => path.resolve(ROOT, file))
      .filter((file) => fs.existsSync(file) && fs.statSync(file).isFile())
      .filter((file) => !shouldSkipRelativePath(path.relative(ROOT, file)));
  } catch {
    return walk(ROOT);
  }
}

const findings = [];
const files = candidateFiles();
for (const filePath of files) {
  const relativePath = path.relative(ROOT, filePath);
  if (SKIP_FILES.has(relativePath)) continue;
  if (shouldSkipRelativePath(relativePath)) continue;
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const pattern of DENY_PATTERNS) {
      if (pattern.test(line)) {
        findings.push(`${relativePath}:${index + 1}: ${pattern}`);
      }
    }
  });
}

if (findings.length > 0) {
  console.error(findings.join('\n'));
  process.exit(1);
}

console.log(JSON.stringify({ privacy_boundary_check: 'passed', files_checked: files.length }, null, 2));
