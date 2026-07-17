// ============================================================================
// DORMANT SYSTEM 2 PATH — Deepgram/Piper deterministic STT/TTS baseline only.
// The live product/demo path is OpenAI Realtime in public/index.html.
// Keep for benchmarks and compatibility; do not add live Realtime behavior here.
// ============================================================================
export function formatForVoice(text) {
  const withoutMarkdown = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/```[\s\S]*?```/g, (block) => block
      .replace(/```[a-zA-Z0-9_-]*\n?/g, '')
      .replace(/```/g, ''))
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/[ \t]*#{1,6}[ \t]*/g, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/gm, '');

  const withoutTables = withoutMarkdown
    .split('\n')
    .map((line) => {
      if (!line.includes('|')) return line;
      const cells = line.split('|').map((cell) => cell.trim()).filter(Boolean);
      const lowerCells = cells.map((cell) => cell.toLowerCase());
      if (lowerCells.join(' ') === 'what status') return '';
      if (lowerCells.join(' ') === 'file status') return '';
      return cells.join(' - ');
    })
    .join('\n');

  const clean = withoutTables
    .replace(/^---\s*Tip: (Cal|Agent) seems unresponsive\.[\s\S]*$/gmi, '')
    .replace(/^Tip: (Cal|Agent) seems unresponsive\.[\s\S]*$/gmi, '')
    .replace(/[<>]/g, '')
    .replace(/\u2705/g, 'done')
    .replace(/\u2192/g, ' to ')
    .replace(/\u2014/g, ' - ')
    .replace(/\u2013/g, ' - ')
    .replace(/\u2022/g, '')
    .replace(/#{2,}/g, '')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');

  return clean || 'I got a response from the agent, but it was not speakable.';
}

function splitSentences(text) {
  return String(text || '')
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function extractFollowUps(text) {
  const headings = [];
  for (const line of String(text || '').split('\n')) {
    const heading = line.match(/^\s{0,3}#{1,4}\s+(.+?)\s*$/);
    if (heading) headings.push(heading[1].replace(/[*_`]/g, '').trim());
  }
  return headings.slice(0, 4);
}

// DORMANT SYSTEM 2: legacy Deepgram/Piper speech rendering; not live Realtime.
export function renderSpokenResponse(calText, options = {}) {
  const mode = options.mode || 'brief';
  const clean = formatForVoice(calText);
  const sentences = splitSentences(clean);
  const maxSentences = mode === 'detailed' ? 6 : 3;
  const selected = sentences.slice(0, maxSentences).join(' ');
  const followUps = extractFollowUps(calText);
  const suffix = followUps.length > 1
    ? ` I can go deeper on ${followUps.slice(0, 3).join(', ')}.`
    : '';

  return {
    spoken: `${selected}${suffix}`.trim() || clean,
    fullText: calText,
    cleanText: clean,
    followUps,
    mode,
  };
}
