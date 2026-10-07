export class DeviceAdminError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const DEVICE_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function registry(state) {
  const devices = state?.devices;
  if (!devices || typeof devices !== 'object' || Array.isArray(devices)) throw new Error('Invalid device registry.');
  return devices;
}

function metadata(device, id) {
  // Fail closed on malformed stored metadata instead of exposing nested values
  // or silently hiding a device the owner may need to revoke.
  if (!device || typeof device !== 'object' || Array.isArray(device) ||
      !DEVICE_ID.test(id) || device.id !== id ||
      ['name', 'platform', 'createdAt', 'lastSeenAt'].some(field => typeof device[field] !== 'string') ||
      (device.revokedAt !== null && typeof device.revokedAt !== 'string')) {
    throw new Error('Invalid device record.');
  }
  return {
    id: device.id, name: device.name, platform: device.platform,
    createdAt: device.createdAt, lastSeenAt: device.lastSeenAt, revokedAt: device.revokedAt,
  };
}

// Authorization belongs to the owner-only HTTP route. No credential, hash,
// enrollment receipt, or unknown stored field is included in this projection.
export function publicDevices(state) {
  return Object.entries(registry(state)).map(([id, device]) => metadata(device, id));
}

// This changes only in-memory revocation state. The caller must authenticate
// the owner, persist it through mutation(), and acknowledge only after save.
export function revokeDevice(state, id) {
  if (typeof id !== 'string' || !DEVICE_ID.test(id)) throw new DeviceAdminError(400, 'A valid device ID is required.');
  const devices = registry(state);
  if (!Object.hasOwn(devices, id)) throw new DeviceAdminError(404, 'Device not found.');
  const device = devices[id];
  metadata(device, id);
  const alreadyRevoked = device.revokedAt !== null;
  if (!alreadyRevoked) device.revokedAt = new Date().toISOString();
  return { revoked: true, deviceId: id, alreadyRevoked };
}
