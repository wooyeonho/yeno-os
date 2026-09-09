import fs from 'node:fs';
import path from 'node:path';

const DISK_FILESYSTEMS = new Set(['ext2', 'ext3', 'ext4', 'xfs', 'btrfs', 'zfs']);
const decodeMountPath = value => value.replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));

export function verifyHostedDisk(config, mountInfo = fs.readFileSync('/proc/self/mountinfo', 'utf8')) {
  if (process.platform !== 'linux') throw new Error('Hosted persistent startup requires Linux mount information.');
  const { diskRoot, dataDir } = config;
  let root;
  try { root = fs.lstatSync(diskRoot); }
  catch { throw new Error('The persistent disk mount does not exist. Attach the disk before starting YENO.'); }
  if (!root.isDirectory() || root.isSymbolicLink() || fs.realpathSync(diskRoot) !== diskRoot) throw new Error('The persistent disk mount must be a real directory without symlink components.');
  const mounts = mountInfo.trim().split('\n').map(line => {
    const [left, right] = line.split(' - ');
    const fields = left.split(' ');
    return { mountPath: decodeMountPath(fields[4] ?? ''), options: fields[5]?.split(',') ?? [], filesystem: right?.split(' ')[0] };
  });
  // Require this exact mount point, not merely an existing directory on the
  // ephemeral application filesystem. Fail closed for RAM, overlay and network
  // filesystems; actual provider disk attachment remains a deployment acceptance.
  const mount = mounts.findLast(value => value.mountPath === diskRoot);
  if (!mount || !mount.options.includes('rw') || !DISK_FILESYSTEMS.has(mount.filesystem)) throw new Error('YENO requires a writable, separately mounted local persistent disk; ephemeral or unsupported mounts are refused.');
  const coveringMount = mounts.filter(value => dataDir === value.mountPath || dataDir.startsWith(`${value.mountPath}/`))
    .sort((left, right) => right.mountPath.length - left.mountPath.length)[0];
  if (coveringMount?.mountPath !== diskRoot) throw new Error('A nested mount hides the persistent disk at the YENO data path.');
  let ancestor = dataDir;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  if (fs.realpathSync(ancestor) !== ancestor) throw new Error('The persistent data path must not contain symlink components.');
  if (!fs.statSync(ancestor).isDirectory()) throw new Error('The persistent data path must be a directory.');
  try { fs.accessSync(ancestor, fs.constants.W_OK | fs.constants.X_OK); }
  catch { throw new Error('The mounted data directory is not writable by the service user. Verify volume ownership; YENO will not chown existing data or run the core as root.'); }
}
