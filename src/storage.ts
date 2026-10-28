import type { EngineConfig } from './sim/types';
import { defaultConfig } from './data/presets';
import { validateConfig } from './sim';
export function readLocal<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
}
export function writeLocal(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
function validSource(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password
    );
  } catch {
    return false;
  }
}
export function importConfig(text: string, preserveId = false): EngineConfig {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Choose an Engine Lab configuration object.');
  const input = parsed.engine ?? parsed;
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Choose an Engine Lab configuration object.');
  if (Object.hasOwn(parsed, 'schemaVersion') && parsed.schemaVersion !== 1)
    throw new Error('This configuration version is not supported.');
  const next = { ...defaultConfig };
  for (const key of Object.keys(defaultConfig) as (keyof EngineConfig)[]) {
    const value = input[key];
    if (value === undefined) continue;
    const expected = defaultConfig[key];
    if (typeof expected === 'number' && (typeof value !== 'number' || !Number.isFinite(value)))
      throw new Error(`${key} must be a finite number.`);
    if (typeof expected === 'string' && (typeof value !== 'string' || value.length > 2000))
      throw new Error(`${key} must be text.`);
    if (Array.isArray(expected)) {
      if (!Array.isArray(value) || value.length > 64)
        throw new Error(`${key} must be a valid list.`);
      if (key === 'sources') {
        if (
          value.some(
            (s) =>
              !s || typeof s.label !== 'string' || typeof s.url !== 'string' || !validSource(s.url),
          )
        )
          throw new Error('Source links must be HTTP or HTTPS URLs.');
      } else if (value.some((n) => typeof n !== 'number' || !Number.isFinite(n)))
        throw new Error(`${key} must contain numbers.`);
    }
    (next as unknown as Record<string, unknown>)[key] = value;
  }
  if (
    !['inline', 'v', 'boxer', 'single'].includes(next.layout) ||
    !['natural', 'turbo', 'supercharged'].includes(next.aspiration) ||
    !['gasoline', 'ethanol', 'diesel'].includes(next.fuel)
  )
    throw new Error('Unknown engine layout, fuel, or aspiration.');
  const errors = validateConfig(next).filter((x) => x.level === 'error');
  if (errors.length) throw new Error(errors.map((e) => e.message).join(' '));
  next.id = preserveId ? next.id : `custom-${Date.now()}`;
  next.name = next.name.trim() || 'Imported engine';
  return next;
}
export function downloadFile(filename: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
