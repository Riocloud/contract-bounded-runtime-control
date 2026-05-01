import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const DIMENSIONS = [
  'constraint_fidelity',
  'evidence_coverage',
  'consequence_continuity',
  'no_feasible_handling',
  'appropriate_personalization',
  'surface_coherence',
];

function readArg(name, fallback = '') {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function readNumberArg(name, fallback) {
  const raw = readArg(name, '');
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [headers, ...dataRows] = rows.filter((items) => items.some((item) => item.length > 0));
  if (!headers) return [];
  return dataRows.map((items) => Object.fromEntries(headers.map((header, index) => [header, items[index] ?? ''])));
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function toCsv(rows, headers) {
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header] ?? '')).join(',')),
  ].join('\n') + '\n';
}

function clampScore(value) {
  const numeric = Number.parseFloat(String(value));
  if (!Number.isFinite(numeric)) return 0;
  if (numeric <= 0.5) return 0;
  if (numeric <= 1.5) return 1;
  return 2;
}

function extractJson(text) {
  const trimmed = String(text || '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error(`Judge response did not contain JSON: ${trimmed.slice(0, 200)}`);
  }
}

function buildItemPrompt(item) {
  return `You are auditing a blinded output for a synthetic/composite benchmark fixture.

This is NOT a real user and NOT a real decision-quality evaluation.
Score fidelity only: whether the output respects the case facts, constraints, required evidence, consequence obligations, no-feasible handling, appropriate personalization, and surface coherence.

Use this 0-2 scale for each dimension:
0 = clear failure
1 = partial, ambiguous, or mixed
2 = clearly satisfies the case facts

Return strict JSON with exactly these keys:
{
  "constraint_fidelity": 0|1|2,
  "evidence_coverage": 0|1|2,
  "consequence_continuity": 0|1|2,
  "no_feasible_handling": 0|1|2,
  "appropriate_personalization": 0|1|2,
  "surface_coherence": 0|1|2,
  "notes": "brief reason, <=40 words"
}

Case metadata:
- annotation_id: ${item.annotation_id}
- case_id: ${item.case_id}
- blinded_system_label: ${item.system_label}
- scenario_focus: ${item.scenario_focus}
- stress_surfaces: ${item.stress_surfaces}
- case_brief: ${item.case_brief}
- confirmed_hard_constraints: ${item.confirmed_hard_constraints}
- required_detail_slots: ${item.required_detail_slots}
- required_witnesses: ${item.required_witnesses}
- tail_witnesses: ${item.tail_witnesses}
- consequence_debt: ${item.consequence_debt}
- oracle_feasible_set_empty: ${item.oracle_feasible_set_empty}
- expected_repair_or_abstain: ${item.expected_repair_or_abstain}

Output to audit:
${item.output_text}`;
}

function buildPairwisePrompt(caseId, items) {
  const [first] = items;
  const outputBlocks = items
    .map((item) => `### ${item.system_label}\n${item.output_text}`)
    .join('\n\n');
  return `You are choosing the most faithful blinded output for one synthetic/composite benchmark fixture.

Choose based on fidelity to the case facts, not writing style or real-world advice quality.

Return strict JSON:
{
  "case_id": "${caseId}",
  "best_system_label": "System A"|"System B"|"System C"|"tie"|"none",
  "notes": "brief reason, <=40 words"
}

Case metadata:
- case_id: ${caseId}
- scenario_focus: ${first.scenario_focus}
- stress_surfaces: ${first.stress_surfaces}
- case_brief: ${first.case_brief}
- confirmed_hard_constraints: ${first.confirmed_hard_constraints}
- required_detail_slots: ${first.required_detail_slots}
- required_witnesses: ${first.required_witnesses}
- tail_witnesses: ${first.tail_witnesses}
- consequence_debt: ${first.consequence_debt}
- oracle_feasible_set_empty: ${first.oracle_feasible_set_empty}
- expected_repair_or_abstain: ${first.expected_repair_or_abstain}

Blinded outputs:
${outputBlocks}`;
}

async function callJudge({ baseUrl, model, apiKey, prompt, timeoutMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        top_p: 1,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are a careful rubric-based evaluator. Return only valid JSON.',
          },
          { role: 'user', content: prompt },
        ],
      }),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Judge API HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    const payload = JSON.parse(text);
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) throw new Error(`Judge API response missing message content: ${text.slice(0, 500)}`);
    return { content, usage: payload.usage ?? null };
  } finally {
    clearTimeout(timeout);
  }
}

async function runPool(items, workerCount, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function loop() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: workerCount }, loop));
  return results;
}

const itemsPath = path.resolve(readArg('items', 'data/model_judge/annotation-items.csv'));
const outDir = path.resolve(readArg('out', 'runs/llm-judge'));
const baseUrl = readArg('base-url', process.env.LLM_JUDGE_BASE_URL || '');
const model = readArg('model', process.env.LLM_JUDGE_MODEL || '');
const apiKeyEnv = readArg('api-key-env', 'LLM_JUDGE_API_KEY');
const apiKey = process.env[apiKeyEnv] || process.env.LLM_JUDGE_API_KEY || '';
const annotatorId = readArg('annotator-id', model ? `llm_${model.replaceAll(/[^a-zA-Z0-9]+/g, '_')}` : 'llm_judge');
const limit = readNumberArg('limit', 0);
const concurrency = Math.max(1, readNumberArg('concurrency', 2));
const timeoutMs = readNumberArg('timeout-ms', 120000);
const pairwise = readArg('pairwise', 'true') !== 'false';

if (!baseUrl || !model || !apiKey) {
  console.error('Missing --base-url, --model, or API key env. Set LLM_JUDGE_BASE_URL, LLM_JUDGE_MODEL, and LLM_JUDGE_API_KEY.');
  process.exit(2);
}

const allItems = parseCsv(fs.readFileSync(itemsPath, 'utf8'));
const selectedItems = limit > 0 ? allItems.slice(0, limit) : allItems;

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'run-manifest.json'), `${JSON.stringify({
  items_path: itemsPath,
  out_dir: outDir,
  base_url: baseUrl,
  model,
  annotator_id: annotatorId,
  item_count: selectedItems.length,
  concurrency,
  timeout_ms: timeoutMs,
  pairwise,
  created_at: new Date().toISOString(),
}, null, 2)}\n`);

const rawPath = path.join(outDir, `${annotatorId}-raw.jsonl`);
fs.writeFileSync(rawPath, '');

const labelRows = await runPool(selectedItems, concurrency, async (item, index) => {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      const { content, usage } = await callJudge({
        baseUrl,
        model,
        apiKey,
        prompt: buildItemPrompt(item),
        timeoutMs,
      });
      const parsed = extractJson(content);
      const row = {
        annotation_id: item.annotation_id,
        annotator_id: annotatorId,
      };
      for (const dimension of DIMENSIONS) {
        row[dimension] = clampScore(parsed[dimension]);
      }
      row.notes = String(parsed.notes ?? '').replace(/\s+/g, ' ').slice(0, 500);
      fs.appendFileSync(rawPath, `${JSON.stringify({
        kind: 'item',
        annotation_id: item.annotation_id,
        attempt,
        usage,
        parsed,
      })}\n`);
      if ((index + 1) % 10 === 0 || index === selectedItems.length - 1) {
        console.error(`[${annotatorId}] item ${index + 1}/${selectedItems.length}`);
      }
      return row;
    } catch (error) {
      if (attempt >= 3) throw error;
      await sleep(750 * attempt);
    }
  }
});

const labelHeaders = ['annotation_id', 'annotator_id', ...DIMENSIONS, 'notes'];
const labelsPath = path.join(outDir, `${annotatorId}-labels.csv`);
fs.writeFileSync(labelsPath, toCsv(labelRows, labelHeaders));

let pairwiseRows = [];
if (pairwise) {
  const caseMap = new Map();
  for (const item of selectedItems) {
    if (!caseMap.has(item.case_id)) caseMap.set(item.case_id, []);
    caseMap.get(item.case_id).push(item);
  }
  const cases = [...caseMap.entries()].filter(([, items]) => items.length >= 2);
  pairwiseRows = await runPool(cases, concurrency, async ([caseId, items], index) => {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        const sortedItems = items.slice().sort((left, right) => left.system_label.localeCompare(right.system_label));
        const { content, usage } = await callJudge({
          baseUrl,
          model,
          apiKey,
          prompt: buildPairwisePrompt(caseId, sortedItems),
          timeoutMs,
        });
        const parsed = extractJson(content);
        const best = ['System A', 'System B', 'System C', 'tie', 'none'].includes(parsed.best_system_label)
          ? parsed.best_system_label
          : 'none';
        fs.appendFileSync(rawPath, `${JSON.stringify({
          kind: 'pairwise',
          case_id: caseId,
          attempt,
          usage,
          parsed,
        })}\n`);
        if ((index + 1) % 10 === 0 || index === cases.length - 1) {
          console.error(`[${annotatorId}] pairwise ${index + 1}/${cases.length}`);
        }
        return {
          case_id: caseId,
          annotator_id: annotatorId,
          best_system_label: best,
          notes: String(parsed.notes ?? '').replace(/\s+/g, ' ').slice(0, 500),
        };
      } catch (error) {
        if (attempt >= 3) throw error;
        await sleep(750 * attempt);
      }
    }
  });
}

const pairwisePath = path.join(outDir, `${annotatorId}-pairwise.csv`);
fs.writeFileSync(pairwisePath, toCsv(pairwiseRows, ['case_id', 'annotator_id', 'best_system_label', 'notes']));

console.log(JSON.stringify({
  out_dir: outDir,
  model,
  annotator_id: annotatorId,
  label_count: labelRows.length,
  pairwise_count: pairwiseRows.length,
  files: [
    path.basename(labelsPath),
    path.basename(pairwisePath),
    path.basename(rawPath),
    'run-manifest.json',
  ],
}, null, 2));
