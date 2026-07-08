function getMessageText(content) {
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part?.type === 'text' && typeof part.text === 'string') return part.text;
        if (typeof part?.text === 'string') return part.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  if (typeof content?.text === 'string') return content.text;
  return '';
}

function getLastUserMessage(messages = []) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') {
      return getMessageText(messages[i].content).trim();
    }
  }
  return '';
}

function collectProsodyCandidates(body) {
  const candidates = [
    body?.metadata?.prosody,
    body?.metadata?.models?.prosody?.scores,
    body?.prosody,
    body?.models?.prosody?.scores,
  ];

  for (const message of body?.messages || []) {
    candidates.push(
      message?.metadata?.prosody,
      message?.metadata?.models?.prosody?.scores,
      message?.models?.prosody?.scores,
    );
  }

  return candidates.filter((candidate) => candidate && typeof candidate === 'object');
}

function topEmotionFromScores(scores, threshold) {
  let best = null;

  for (const [name, rawScore] of Object.entries(scores)) {
    const score = Number(rawScore);
    if (!Number.isFinite(score)) continue;
    if (!best || score > best.score) best = { name, score };
  }

  if (!best || best.score < threshold) return null;
  return best;
}

export function parseRequest(body = {}, options = {}) {
  const threshold = Number.isFinite(options.emotionThreshold)
    ? options.emotionThreshold
    : 0.5;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const text = getLastUserMessage(messages);

  let emotion = null;
  for (const candidate of collectProsodyCandidates(body)) {
    emotion = topEmotionFromScores(candidate, threshold);
    if (emotion) break;
  }

  return {
    text,
    emotion,
    messages,
    stream: body.stream !== false,
  };
}

export function withVoiceContext(text, emotion) {
  const cleanText = String(text || '').trim();
  if (!emotion) return cleanText;

  return `[VOICE CONTEXT: ${emotion.name}, ${emotion.score.toFixed(2)}]\n${cleanText}`;
}
