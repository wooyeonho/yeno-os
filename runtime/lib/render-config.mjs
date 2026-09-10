import path from 'node:path';


function hostname(value) {
  if (typeof value !== 'string' || !value || /[\s/@\\#?*]/.test(value)) throw new Error('Render requires an exact public hostname.');
  let url;
  try { url = new URL(`https://${value}`); } catch { throw new Error('Render requires an exact public hostname.'); }
  if (url.host !== value.toLowerCase() || !url.hostname.includes('.')) throw new Error('Render requires an exact public hostname.');
  return url.host;
}

export function renderConfig(env) {
  if (env.RENDER !== 'true') throw new Error('The Render launcher requires RENDER=true from the Render runtime.');
  const externalHost = hostname(env.RENDER_EXTERNAL_HOSTNAME);
  if (!externalHost.endsWith('.onrender.com') || externalHost.includes(':')) throw new Error('RENDER_EXTERNAL_HOSTNAME must be the assigned onrender.com hostname.');
  // Render may probe the assigned hostname even when a custom domain is also
  // configured. Keep it alongside the owner's explicit additional hosts.
  const allowedHosts = [...new Set([
    ...(env.YENO_ALLOWED_HOSTS?.trim() ? env.YENO_ALLOWED_HOSTS.split(',').map(value => hostname(value.trim())) : []),
    externalHost,
  ])].join(',');
  const port = env.PORT ?? '10000';
  if (!/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65535) throw new Error('Render PORT must be between 1 and 65535.');
  const diskRoot = env.YENO_DISK_MOUNT_PATH ?? '/var/data';
  const dataDir = env.YENO_DATA_DIR ?? '/var/data/yeno';
  if (!path.isAbsolute(diskRoot) || path.resolve(diskRoot) === '/' || !path.isAbsolute(dataDir)) throw new Error('Render disk and data paths must be absolute, with a separate disk mount.');
  const root = path.resolve(diskRoot), data = path.resolve(dataDir);
  if (!data.startsWith(`${root}${path.sep}`)) throw new Error('YENO_DATA_DIR must be a subdirectory of the persistent disk mount.');
  return { diskRoot: root, dataDir: data, env: { ...env, YENO_HOST: '0.0.0.0', YENO_PORT: port, YENO_DATA_DIR: data, YENO_ALLOWED_HOSTS: allowedHosts } };
}

export { verifyHostedDisk as verifyRenderDisk } from './hosted-disk.mjs';
