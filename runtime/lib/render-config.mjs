import fs from 'node:fs';
import path from 'node:path';

const DISK_FILESYSTEMS = new Set(['ext2', 'ext3', 'ext4', 'xfs', 'btrfs', 'zfs']);
const decodeMountPath = value => value.replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));

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

export function verifyRenderDisk(config, mountInfo = fs.readFileSync('/proc/self/mountinfo', 'utf8')) {
  if (process.platform !== 'linux') throw new Error('Render persistent startup requires Linux mount information.');
  const { diskRoot, dataDir } = config;
  let root;
  try { root = fs.lstatSync(diskRoot); }
  catch { throw new Error('The Render persistent disk mount does not exist. Attach the disk before starting YENO.'); }
  if (!root.isDirectory() || root.isSymbolicLink() || fs.realpathSync(diskRoot) !== diskRoot) throw new Error('The persistent disk mount must be a real directory without symlink components.');
  const mounts = mountInfo.trim().split('\n').map(line => {
    const [left, right] = line.split(' - ');
    const fields = left.split(' ');
    return { mountPath: decodeMountPath(fields[4] ?? ''), options: fields[5]?.split(',') ?? [], filesystem: right?.split(' ')[0] };
  });
  // Require this exact mount point, not merely an existing directory on the
  // ephemeral application filesystem. Fail closed for RAM, overlay and network
  // filesystems; actual Render disk attachment remains a deployment acceptance.
  const mount = mounts.findLast(value => value.mountPath === diskRoot);
  if (!mount || !mount.options.includes('rw') || !DISK_FILESYSTEMS.has(mount.filesystem)) throw new Error('YENO requires a writable, separately mounted local persistent disk; ephemeral or unsupported mounts are refused.');
  const coveringMount = mounts.filter(value => dataDir === value.mountPath || dataDir.startsWith(`${value.mountPath}/`))
    .sort((left, right) => right.mountPath.length - left.mountPath.length)[0];
  if (coveringMount?.mountPath !== diskRoot) throw new Error('A nested mount hides the persistent disk at the YENO data path.');
  let ancestor = dataDir;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  if (fs.realpathSync(ancestor) !== ancestor) throw new Error('The persistent data path must not contain symlink components.');
  if (!fs.statSync(ancestor).isDirectory()) throw new Error('The persistent data path must be a directory.');
  fs.accessSync(ancestor, fs.constants.W_OK | fs.constants.X_OK);
}
