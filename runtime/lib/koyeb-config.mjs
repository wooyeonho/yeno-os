import path from 'node:path';

function hostname(value) {
  if (typeof value !== 'string' || !value || /[\s/@\\#?*]/.test(value)) throw new Error('Koyeb requires an exact public hostname.');
  let url;
  try { url = new URL(`https://${value}`); } catch { throw new Error('Koyeb requires an exact public hostname.'); }
  if (url.host !== value.toLowerCase() || !url.hostname.includes('.')) throw new Error('Koyeb requires an exact public hostname.');
  return url.host;
}

export function koyebConfig(env) {
  if (!env.KOYEB_SERVICE_ID) throw new Error('The Koyeb launcher requires KOYEB_SERVICE_ID from the Koyeb runtime.');
  const publicHost = hostname(env.KOYEB_PUBLIC_DOMAIN);
  if (!publicHost.endsWith('.koyeb.app') || publicHost.includes(':')) throw new Error('KOYEB_PUBLIC_DOMAIN must be the assigned koyeb.app hostname.');
  const allowedHosts = [...new Set([
    ...(env.YENO_ALLOWED_HOSTS?.trim() ? env.YENO_ALLOWED_HOSTS.split(',').map(value => hostname(value.trim())) : []),
    publicHost,
  ])].join(',');
  const port = env.YENO_PORT ?? env.PORT ?? '8790';
  if (!/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65535) throw new Error('Koyeb HTTP port must be between 1 and 65535.');
  if (env.PORT && env.PORT !== port) throw new Error('Koyeb PORT and YENO_PORT must match the exposed HTTP port (8790 by default).');
  const diskRoot = env.YENO_DISK_MOUNT_PATH ?? '/var/lib/yeno';
  const dataDir = env.YENO_DATA_DIR ?? '/var/lib/yeno/data';
  if (!path.isAbsolute(diskRoot) || path.resolve(diskRoot) === '/' || !path.isAbsolute(dataDir)) throw new Error('Koyeb disk and data paths must be absolute, with a separate disk mount.');
  const root = path.resolve(diskRoot), data = path.resolve(dataDir);
  if (!data.startsWith(`${root}${path.sep}`)) throw new Error('YENO_DATA_DIR must be a subdirectory of the Koyeb volume mount.');
  return { diskRoot: root, dataDir: data, env: { ...env, YENO_HOST: '0.0.0.0', YENO_PORT: port, YENO_DATA_DIR: data, YENO_ALLOWED_HOSTS: allowedHosts } };
}
