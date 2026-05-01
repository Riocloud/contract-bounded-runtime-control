export const PRODUCTION_JSON_RETRY_PREFIX = '你的上一条回复格式不正确，无法被解析。请严格按照 JSON 格式重新输出';

export function buildBenchmarkJsonRetryMessage() {
  return [
    `${PRODUCTION_JSON_RETRY_PREFIX}。`,
    '请保留原始 benchmark 请求要求的 JSON object schema，只重新输出最终 JSON 对象。',
    '不要输出 <think>、思考过程、markdown 代码块、analysis 文本或任何 JSON 外文字。',
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
