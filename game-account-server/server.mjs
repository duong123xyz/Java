import net from 'node:net';
import {randomBytes, scryptSync, timingSafeEqual, createHash} from 'node:crypto';
import {applicationDefault, initializeApp} from 'firebase-admin/app';
import {getFirestore, FieldValue} from 'firebase-admin/firestore';

const VERSION = 1;
const REGISTER = 10;
const LOGIN = 11;
const AUTH_RESULT = 12;
const HOST = process.env.ACCOUNT_HOST || '0.0.0.0';
const PORT = Number(process.env.ACCOUNT_PORT || 14445);
const MAX_FRAME = 4096;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

initializeApp({
  credential: applicationDefault(),
  projectId: process.env.FIREBASE_PROJECT_ID,
});
const db = getFirestore();

function readText(buffer, offset) {
  if (offset + 2 > buffer.length) throw new Error('Chuỗi bị cắt header.');
  const length = buffer.readUInt16BE(offset); offset += 2;
  if (length > 1024 || offset + length > buffer.length) throw new Error('Độ dài chuỗi không hợp lệ.');
  return {value: buffer.subarray(offset, offset + length).toString('utf8'), offset: offset + length};
}
function writeText(value) {
  const raw = Buffer.from(String(value || ''), 'utf8');
  const output = Buffer.allocUnsafe(2 + raw.length);
  output.writeUInt16BE(raw.length, 0); raw.copy(output, 2); return output;
}
function frame(payload) {
  const header = Buffer.allocUnsafe(4); header.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, payload]);
}
function resultPayload(ok, code, message, token = '') {
  return Buffer.concat([
    Buffer.from([VERSION, AUTH_RESULT, ok ? 1 : 0, code & 0xff]),
    writeText(message), writeText(token),
  ]);
}
function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}
function validateUsername(value) {
  return /^[a-z0-9_-]{3,24}$/.test(value);
}
function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
function passwordMatches(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}
async function createSession(accountId) {
  const token = randomBytes(32).toString('base64url');
  await db.collection('gameSessions').doc(tokenHash(token)).set({
    accountId,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return token;
}
async function register(usernameRaw, password) {
  const username = normalizeUsername(usernameRaw);
  if (!validateUsername(username)) return resultPayload(false, 1, 'Tài khoản chỉ gồm a-z, 0-9, _ hoặc -, dài 3-24 ký tự.');
  if (password.length < 8 || password.length > 128) return resultPayload(false, 2, 'Mật khẩu phải dài 8-128 ký tự.');

  const accountRef = db.collection('gameAccounts').doc(username);
  try {
    await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(accountRef);
      if (existing.exists) throw new Error('ACCOUNT_EXISTS');
      transaction.create(accountRef, {
        username,
        passwordHash: hashPassword(password),
        createdAt: FieldValue.serverTimestamp(),
        disabled: false,
      });
      transaction.create(db.collection('characters').doc(username), {
        accountId: username,
        createdAt: FieldValue.serverTimestamp(),
        revision: 1,
        data: {},
      });
    });
  } catch (error) {
    if (error.message === 'ACCOUNT_EXISTS') return resultPayload(false, 3, 'Tài khoản đã tồn tại.');
    throw error;
  }
  return resultPayload(true, 0, 'Đăng ký thành công.', await createSession(username));
}
async function login(usernameRaw, password) {
  const username = normalizeUsername(usernameRaw);
  const snapshot = await db.collection('gameAccounts').doc(username).get();
  const account = snapshot.data();
  if (!snapshot.exists || account?.disabled || !passwordMatches(password, account?.passwordHash)) {
    return resultPayload(false, 4, 'Sai tài khoản hoặc mật khẩu.');
  }
  return resultPayload(true, 0, 'Đăng nhập thành công.', await createSession(username));
}
async function handlePayload(payload) {
  if (payload.length < 2 || payload[0] !== VERSION) return resultPayload(false, 5, 'Protocol không hợp lệ.');
  const type = payload[1]; let offset = 2;
  const username = readText(payload, offset); offset = username.offset;
  const password = readText(payload, offset);
  if (type === REGISTER) return register(username.value, password.value);
  if (type === LOGIN) return login(username.value, password.value);
  return resultPayload(false, 6, 'Loại request không được hỗ trợ.');
}

const server = net.createServer((socket) => {
  socket.setNoDelay(true); let buffered = Buffer.alloc(0);
  socket.on('data', async (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    while (buffered.length >= 4) {
      const length = buffered.readUInt32BE(0);
      if (length < 2 || length > MAX_FRAME) return socket.destroy(new Error('Frame không hợp lệ.'));
      if (buffered.length < length + 4) return;
      const payload = buffered.subarray(4, length + 4); buffered = buffered.subarray(length + 4);
      try { socket.write(frame(await handlePayload(payload))); }
      catch (error) { console.error('[account]', error); socket.write(frame(resultPayload(false, 7, 'Lỗi server.'))); }
    }
  });
  socket.on('error', (error) => console.warn('[socket]', error.message));
});

server.listen(PORT, HOST, () => console.log(`NRO account server listening on ${HOST}:${PORT}`));
