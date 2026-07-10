function cleanProgressText(text, maxLength = 120) {
  return String(text || '')
    .replace(/[`*_~#>|]/g, '')
    .replace(/\/Users\/[^\s]+/g, 'a local file')
    .replace(/[A-Za-z]:\\[^\s]+/g, 'a local file')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeActivity(input = {}) {
  const event = input.event || input.activity || input;
  const description = cleanProgressText(event.description || event.tool || 'working');
  const tool = String(event.tool || '').toLowerCase();
  const preview = cleanProgressText(
    event.inputSummary?.commandPreview ||
    event.inputSummary?.preview ||
    event.preview ||
    '',
    100,
  );

  return {
    kind: event.kind || event.type || 'step_started',
    tool,
    description,
    preview,
    isError: !!event.isError,
  };
}

function recentActivityText(recentActivities = []) {
  return recentActivities
    .map((item) => normalizeActivity(item).description)
    .filter(Boolean)
    .slice(-3)
    .join(' | ');
}

export function buildProgressNarrationInstruction(input = {}, config = {}) {
  if (config.progressNarrationEnabled === false) {
    return { shouldNarrate: false, reason: 'disabled' };
  }

  const activity = normalizeActivity(input);
  if (!activity.description) {
    return { shouldNarrate: false, reason: 'empty_activity' };
  }

  const agentName = config.agentName || input.agentName || 'the agent';
  const recent = recentActivityText(input.recentActivities || input.recent || []);
  const style = config.progressNarrationStyle || input.style || 'calm-commentator';

  const instructions = [
    `You are ${agentName}'s voice speaking naturally while ${agentName} is working.`,
    style === 'calm-commentator'
      ? 'Act like a calm game commentator: synthesize the action into a vivid, useful update instead of narrating every mechanical step.'
      : `Use the configured progress narration style: ${style}.`,
    'Paint a quick mental picture of progress, like "I found the right code path and I’m checking the handoff now," not a literal play-by-play.',
    'Use this activity event only as progress context; do not read it verbatim.',
    'Say at most one short, conversational sentence if it would help the user understand the wait.',
    'Do not say "tool call", "backend", "bash", "function", or "I am running a shell check".',
    'Avoid repetitive "I am checking..." phrasing across multiple events.',
    'If this event is vague, repetitive, or not user-meaningful, stay silent.',
    `Current activity: ${activity.description}.`,
    activity.tool ? `Internal tool type: ${activity.tool}.` : '',
    activity.preview ? `Raw hint: ${activity.preview}.` : '',
    recent ? `Recent activity context: ${recent}.` : '',
  ].filter(Boolean).join(' ');

  return {
    ok: true,
    shouldNarrate: true,
    style,
    activity,
    instructions,
  };
}

export { cleanProgressText };
