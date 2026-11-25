/**
 * Photo storage. Bytes are NEVER stored in MongoDB. The default 'local' driver writes to UPLOAD_DIR (default server/uploads), which is
 * fine for development and for a single server with a persistent disk. For production point UPLOAD_DIR at a persistent volume, or add an
 * object-storage driver implementing { save, read, remove } below (credentials stay in server environment variables, never in the client).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { bad } = require('../utils/ApiError');

const MAX_BYTES = Number(process.env.UPLOAD_MAX_BYTES) || 8 * 1024 * 1024;
const ALLOWED = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const baseDir = () => path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'));

/** Identify the real image type from its first bytes (never trust the client's Content-Type alone). */
function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buf.slice(0, 4).toString('ascii') === 'GIF8') return 'image/gif';
  return null;
}
const local = {
  name: 'local',
  async save(key, buf) { const f = path.join(baseDir(), key); if (!f.startsWith(baseDir() + path.sep)) throw bad('Invalid file key'); await fs.promises.mkdir(path.dirname(f), { recursive: true }); await fs.promises.writeFile(f, buf, { flag: 'wx' }); },
  async read(key) { const f = path.join(baseDir(), key); if (!f.startsWith(baseDir() + path.sep)) throw bad('Invalid file key'); return fs.promises.readFile(f); },
  async remove(key) { const f = path.join(baseDir(), key); if (f.startsWith(baseDir() + path.sep)) await fs.promises.rm(f, { force: true }); },
};
const driver = () => local; // STORAGE_DRIVER is reserved for a future object-storage driver

function validateImage(buf, claimed) {
  if (!Buffer.isBuffer(buf) || !buf.length) throw bad('No image received. Send the photo as the request body with an image Content-Type.');
  if (buf.length > MAX_BYTES) throw bad(`Photo is too large (max ${Math.round(MAX_BYTES / 1048576)} MB)`);
  const real = sniff(buf);
  if (!real || !ALLOWED[real]) throw bad('Only JPEG, PNG, WebP or GIF photos are accepted');
  if (claimed && ALLOWED[claimed] && claimed !== real) throw bad('The file does not match its declared type');
  return real;
}
async function store(buf, mime) {
  const d = new Date(); const key = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.${ALLOWED[mime]}`;
  await driver().save(key, buf); return key;
}
module.exports = { MAX_BYTES, ALLOWED, sniff, validateImage, store, read: (k) => driver().read(k), remove: (k) => driver().remove(k), driver };
