export const JSON_RETRY_PREFIX = 'The previous response could not be parsed. Return strict JSON only';

export function buildBenchmarkJsonRetryMessage() {
  return [
    `${JSON_RETRY_PREFIX}.`,
    'Preserve the JSON object schema requested by the benchmark prompt.',
    'Do not output <think>, chain-of-thought, markdown code fences, analysis text, or any text outside the JSON object.',
  ].join('');
}

export function buildRetryMessages({
  systemMessage,
  originalUserPrompt,
  failedAssistantText,
  retryMessage = buildBenchmarkJsonRetryMessage(),
}) {
  return [
    { role: 'system', content: systemMessage },
    { role: 'user', content: originalUserPrompt },
    { role: 'assistant', content: String(failedAssistantText ?? '') },
    { role: 'user', content: retryMessage },
  ];
}
