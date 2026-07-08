import { existsSync, readFileSync } from 'node:fs';

const DEFAULT_SECTION_NAMES = [
  'Identity',
  'How I Communicate',
  'Communication Style',
  'Voice',
  'Personality',
  'Self-Awareness',
];

function normalizeMarkdown(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sectionMatches(heading, sectionNames) {
  return sectionNames.some((name) => heading.toLowerCase().includes(name.toLowerCase()));
}

export function extractAgentPersona(markdown, {
  sectionNames = DEFAULT_SECTION_NAMES,
  maxChars = 4500,
} = {}) {
  const text = normalizeMarkdown(markdown);
  if (!text) return '';

  const lines = text.split('\n');
  const selected = [];
  let collecting = false;

  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      collecting = sectionMatches(heading[1], sectionNames);
    }
    if (collecting) selected.push(line);
  }

  const persona = normalizeMarkdown(selected.join('\n'));
  return persona.length > maxChars ? `${persona.slice(0, maxChars).trim()}\n...` : persona;
}

export function loadAgentPersona({
  agentVoicePersonaPath = '',
  agentVoicePersonaMaxChars = 4500,
} = {}) {
  if (!agentVoicePersonaPath || !existsSync(agentVoicePersonaPath)) return '';

  const markdown = readFileSync(agentVoicePersonaPath, 'utf8');
  return extractAgentPersona(markdown, { maxChars: agentVoicePersonaMaxChars });
}
