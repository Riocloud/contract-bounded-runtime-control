#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['.git', 'node_modules', 'runs']);
const SKIP_FILES = new Set(['scripts/check-privacy-boundary.mjs']);
const DENY_PATTERNS = [
  /sk-[A-Za-z0-9]{16,}/,
  /\/opt\/prediction/,
  /Prediction-cn-backend/,
  /decisionsandbox\.cn/,
  /minimax-turn/i,
  /MiniMax-M2\.7-highspeed/i,
  /session_token/i,
  /SUPABASE/i,
  /MINIMAX_API_KEY/i,
  /DEEPSEEK_API_KEY/i,
  /QWEN_API_KEY/i,
  /DASHSCOPE/i,
  /password/i,
  /payment record/i,
  /exact payment/i,
];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    if (SKIP_DIRS.has(entry.name)) return [];
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    if (!entry.isFile()) return [];
    return [fullPath];
  });
}

const findings = [];
for (const filePath of walk(ROOT)) {
  const relativePath = path.relative(ROOT, filePath);
  if (SKIP_FILES.has(relativePath)) continue;
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

console.log(JSON.stringify({ privacy_boundary_check: 'passed', files_checked: walk(ROOT).length }, null, 2));
