// JSON cleanup for OpenAI-compatible model responses:
// strip markdown code fences, strip complete/incomplete <think> blocks, then
// try strict JSON, common repairs, and truncated-object repair. The parser is
// intentionally generic and does not add benchmark-specific parsing semantics.

export function stripCodeFences(text) {
  return String(text ?? '').replace(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/g, '$1');
}

export function stripThinkBlocks(text) {
  return String(text ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*/i, '')
    .trim();
}

export function repairCommonJson(raw) {
  if (!raw) return null;
  return raw
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/'/g, '"')
    .replace(/([{,]\s*)(\w+)"\s*:/g, '$1"$2":')
    .replace(/\n/g, '\\n')
    .replace(/\\n\s*([}\]])/g, '$1')
    .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":');
}

export function repairTruncatedJson(text, dropTrailingField = false) {
  const match = String(text ?? '').match(/\{[\s\S]*/);
  if (!match) return null;
  let json = match[0];
  if (dropTrailingField) {
    json = json.replace(/,\s*"[^"]*"?\s*:\s*"[^"]*$/, '');
    json = json.replace(/,\s*"[^"]*$/, '');
  }
  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let escape = false;

  for (const ch of json) {
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') openBraces += 1;
    else if (ch === '}') openBraces -= 1;
    else if (ch === '[') openBrackets += 1;
    else if (ch === ']') openBrackets -= 1;
  }

  if (inString) json += '"';
  json = json.replace(/,\s*$/, '');
  for (let i = 0; i < openBrackets; i += 1) json += ']';
  for (let i = 0; i < openBraces; i += 1) json += '}';
  return json;
}

export function findJsonObjectCandidates(text) {
  const source = String(text ?? '');
  const candidates = [];
  let outerInString = false;
  let outerEscape = false;
  for (let start = 0; start < source.length; start += 1) {
    const outerCh = source[start];
    if (outerEscape) {
      outerEscape = false;
      continue;
    }
    if (outerCh === '\\' && outerInString) {
      outerEscape = true;
      continue;
    }
    if (outerCh === '"') {
      outerInString = !outerInString;
      continue;
    }
    if (outerInString) continue;
    if (source[start] !== '{') continue;
    let openBraces = 0;
    let openBrackets = 0;
    let inString = false;
    let escape = false;
    for (let index = start; index < source.length; index += 1) {
      const ch = source[index];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\' && inString) {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === '{') openBraces += 1;
      else if (ch === '}') openBraces -= 1;
      else if (ch === '[') openBrackets += 1;
      else if (ch === ']') openBrackets -= 1;
      if (openBraces === 0 && openBrackets === 0) {
        candidates.push(source.slice(start, index + 1));
        start = index;
        break;
      }
      if (openBraces < 0 || openBrackets < 0) break;
    }
  }
  return [...new Set(candidates)];
}

export function extractJsonObject(text) {
  const cleaned = stripCodeFences(stripThinkBlocks(text)).trim();
  const cleanedObjects = findJsonObjectCandidates(cleaned);
  const rawObjects = findJsonObjectCandidates(stripCodeFences(text));
  const candidates = [
    cleaned,
    ...cleanedObjects.slice().reverse(),
    ...rawObjects.slice().reverse(),
    repairCommonJson(cleanedObjects.at(-1) ?? rawObjects.at(-1) ?? cleaned),
    repairTruncatedJson(cleaned),
    repairTruncatedJson(cleaned, true),
    repairTruncatedJson(stripCodeFences(text)),
    repairTruncatedJson(stripCodeFences(text), true),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try next generic cleanup candidate
    }
  }
  throw new Error('json_parse_failed');
}
