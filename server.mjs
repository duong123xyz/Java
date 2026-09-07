import express from 'express';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes, scryptSync, timingSafeEqual} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(process.env.NRO_DB_PATH || path.join(root, 'nro-users.sqlite'));
db.exec(`
  PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
`);

const app = express();
app.disable('x-powered-by');
app.use(express.json({limit: '32kb'}));

const cookie = (request, name) => (request.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1);
const tokenHash = (token) => scryptSync(token, 'nro-session-v1', 32).toString('hex');
const passwordHash = (password, salt = randomBytes(16).toString('hex')) => `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
const validPassword = (password, stored) => { const [salt, hash] = stored.split(':'); const actual = scryptSync(password, salt, 64); const expected = Buffer.from(hash, 'hex'); return actual.length === expected.length && timingSafeEqual(actual, expected); };
const cleanUsername = (value) => String(value || '').trim();

function currentUser(request) {
  const token = cookie(request, 'nro_session');
  if (!token) return null;
  return db.prepare(`SELECT users.id, users.username FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>?`).get(tokenHash(token), Date.now()) || null;
}
function startSession(response, userId) {
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(tokenHash(token), userId, Date.now() + 30 * 86400_000);
  response.setHeader('Set-Cookie', `nro_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}

app.post('/api/auth/register', (request, response) => {
  const username = cleanUsername(request.body?.username); const password = String(request.body?.password || '');
  if (!/^[\p{L}\p{N}_-]{3,24}$/u.test(username)) return response.status(400).json({error: 'Tên tài khoản cần 3–24 ký tự, chỉ dùng chữ, số, _ hoặc -.'});
  if (password.length < 8 || password.length > 128) return response.status(400).json({error: 'Mật khẩu cần từ 8 đến 128 ký tự.'});
  try { const result = db.prepare('INSERT INTO users(username,password_hash,created_at) VALUES(?,?,?)').run(username, passwordHash(password), Date.now()); startSession(response, Number(result.lastInsertRowid)); return response.json({user: {id: Number(result.lastInsertRowid), username}}); }
  catch (error) { return response.status(409).json({error: String(error).includes('UNIQUE') ? 'Tên tài khoản đã tồn tại.' : 'Không tạo được tài khoản.'}); }
});
app.post('/api/auth/login', (request, response) => {
  const username = cleanUsername(request.body?.username); const password = String(request.body?.password || '');
  const user = db.prepare('SELECT id,username,password_hash FROM users WHERE username=?').get(username);
  if (!user || !validPassword(password, user.password_hash)) return response.status(401).json({error: 'Sai tài khoản hoặc mật khẩu.'});
  startSession(response, user.id); return response.json({user: {id: user.id, username: user.username}});
});
app.get('/api/auth/me', (request, response) => { const user = currentUser(request); return user ? response.json({user}) : response.status(401).json({error: 'Chưa đăng nhập.'}); });
app.post('/api/auth/logout', (request, response) => { const token = cookie(request, 'nro_session'); if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token)); response.setHeader('Set-Cookie', 'nro_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'); response.json({ok: true}); });

app.use(express.static(path.join(root, 'dist'), {index: false}));
app.get(/^\/play(?:\/.*)?$/, (_request, response) => response.sendFile(path.join(root, 'dist', 'index.html')));
app.get(/.*/, (_request, response) => response.sendFile(path.join(root, 'dist', 'index.html')));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`NRO web running at http://localhost:${port}/play`));
