export function normalizeJarvisAddress(value) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value)) throw new TypeError('Invalid Jarvis address');
  const address = value.normalize('NFC').trim();
  if (!address || [...address].length > 32) throw new TypeError('Invalid Jarvis address');
  return address;
}

export const initialJarvisSettings = () => ({version: 1, address: null});

export function validateJarvisSettings(value) {
  if (!value || Array.isArray(value) || Object.keys(value).sort().join() !== 'address,version' || value.version !== 1 || (value.address !== null && normalizeJarvisAddress(value.address) !== value.address)) throw new TypeError('Invalid Jarvis settings');
  return true;
}

export function jarvisAddress(settings, env = {}) {
  validateJarvisSettings(settings);
  if (settings.address !== null) return settings.address;
  try { return normalizeJarvisAddress(env.YENO_JARVIS_ADDRESS ?? '주인님'); }
  catch { return '주인님'; }
}
