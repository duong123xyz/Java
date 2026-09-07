import net from 'node:net';
import http from 'node:http';
import os from 'node:os';

const VERSION = 1;
const MSG_HELLO = 1;
const MSG_WELCOME = 2;
const MSG_STATE = 3;
const MSG_LEAVE = 4;
const MSG_CHAT = 5;

const HOST = process.env.MP_HOST || '0.0.0.0';
const PORT = Number(process.env.MP_PORT || 14445);
const HTTP_PORT = Number(process.env.MP_HTTP_PORT || 14446);
const MAX_FRAME = 8192;
const STALE_MS = 15000;

let nextId = 1;
const clients = new Map();

function now() { return Date.now(); }
function safeName(value) {
  const text = String(value || '').trim();
  return text.slice(0, 40) || 'Player';
}
function writeUtf8(text) {
  const buf = Buffer.from(String(text || ''), 'utf8');
  const length = Math.min(buf.length, 2048);
  const out = Buffer.allocUnsafe(2 + length);
  out.writeUInt16BE(length, 0);
  buf.copy(out, 2, 0, length);
  return out;
}
function readUtf8(buffer, offset) {
  if (offset + 2 > buffer.length) throw new Error('string header truncated');
  const length = buffer.readUInt16BE(offset); offset += 2;
  if (length > 2048 || offset + length > buffer.length) throw new Error('invalid string length');
  return { value: buffer.subarray(offset, offset + length).toString('utf8'), offset: offset + length };
}
function makeFrame(payload) {
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, payload]);
}
function send(socket, payload) {
  if (!socket || socket.destroyed) return;
  socket.write(makeFrame(payload));
}
function welcomePayload(id) {
  const payload = Buffer.allocUnsafe(6);
  payload.writeUInt8(VERSION, 0); payload.writeUInt8(MSG_WELCOME, 1); payload.writeInt32BE(id, 2);
  return payload;
}
function statePayload(player) {
  const name = writeUtf8(player.name);
  const payload = Buffer.allocUnsafe(19);
  payload.writeUInt8(VERSION, 0); payload.writeUInt8(MSG_STATE, 1);
  payload.writeInt32BE(player.id, 2);
  payload.writeInt32BE(player.map, 6);
  payload.writeInt32BE(player.x, 10);
  payload.writeInt32BE(player.y, 14);
  payload.writeInt8(player.dir || 0, 18);
  return Buffer.concat([payload, name]);
}
function leavePayload(id) {
  const payload = Buffer.allocUnsafe(6);
  payload.writeUInt8(VERSION, 0); payload.writeUInt8(MSG_LEAVE, 1); payload.writeInt32BE(id, 2);
  return payload;
}
function chatPayload(id, message) {
  const text = writeUtf8(message);
  const payload = Buffer.allocUnsafe(6);
  payload.writeUInt8(VERSION, 0); payload.writeUInt8(MSG_CHAT, 1); payload.writeInt32BE(id, 2);
  return Buffer.concat([payload, text]);
}
function broadcast(payload, exceptSocket = null) {
  for (const client of clients.values()) {
    if (
      client.ready &&
      client.socket !== exceptSocket &&
      !client.socket.destroyed
    ) {
      send(client.socket, payload);
    }
  }
}
function broadcastAllStates(targetSocket) {
  for (const client of clients.values()) if (client.ready) send(targetSocket, statePayload(client));
}
function parseHello(payload) {
  if (payload.length < 16) throw new Error('HELLO too short');
  let offset = 2;
  const map = payload.readInt32BE(offset); offset += 4;
  const x = payload.readInt32BE(offset); offset += 4;
  const y = payload.readInt32BE(offset); offset += 4;
  const dir = payload.readInt8(offset); offset += 1;
  const name = readUtf8(payload, offset);
  return { map, x, y, dir, name: safeName(name.value) };
}
function parseState(payload) {
  if (payload.length < 19) throw new Error('STATE too short');
  let offset = 2;
  const claimedId = payload.readInt32BE(offset); offset += 4;
  const map = payload.readInt32BE(offset); offset += 4;
  const x = payload.readInt32BE(offset); offset += 4;
  const y = payload.readInt32BE(offset); offset += 4;
  const dir = payload.readInt8(offset); offset += 1;
  const name = readUtf8(payload, offset);
  return { claimedId, map, x, y, dir, name: safeName(name.value) };
}
function handlePayload(client, payload) {
  if (payload.length < 2) return;
  const version = payload.readUInt8(0);
  const type = payload.readUInt8(1);
  if (version !== VERSION) throw new Error(`unsupported protocol ${version}`);

  if (type === MSG_HELLO) {
    const hello = parseHello(payload);
    Object.assign(client, hello, { ready: true, lastSeen: now() });
    send(client.socket, welcomePayload(client.id));
    broadcastAllStates(client.socket);
    broadcast(statePayload(client), client.socket);
    console.log(`[join] #${client.id} ${client.name} map=${client.map} (${client.x},${client.y})`);
    return;
  }
  if (!client.ready) return;
  if (type === MSG_STATE) {
    const state = parseState(payload);
    client.map = state.map; client.x = state.x; client.y = state.y;
    client.dir = state.dir; client.name = state.name; client.lastSeen = now();
    broadcast(statePayload(client), client.socket);
    return;
  }
  if (type === MSG_LEAVE) client.socket.end();
}
function destroyClient(client, reason = 'disconnect') {
  if (!client || !clients.has(client.id)) return;
  clients.delete(client.id);
  if (client.ready) {
    broadcast(leavePayload(client.id));
    console.log(`[leave] #${client.id} ${client.name} (${reason})`);
  }
}
function installFrameParser(client) {
  let buffer = Buffer.alloc(0);
  client.socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32BE(0);
      if (length <= 0 || length > MAX_FRAME) {
        client.socket.destroy(new Error(`bad frame length ${length}`)); return;
      }
      if (buffer.length < 4 + length) return;
      const payload = buffer.subarray(4, 4 + length);
      buffer = buffer.subarray(4 + length);
      try { handlePayload(client, payload); }
      catch (error) {
        console.warn(`[protocol] #${client.id}: ${error.message}`); client.socket.destroy(); return;
      }
    }
  });
}

const tcpServer = net.createServer((socket) => {
  socket.setNoDelay(true); socket.setKeepAlive(true, 5000);
  const client = {
    id: nextId++, socket, ready: false, name: 'Player',
    map: 0, x: 0, y: 0, dir: 0, lastSeen: now(), connectedAt: now(),
  };
  clients.set(client.id, client);
  installFrameParser(client);
  socket.on('error', (error) => console.warn(`[socket] #${client.id}: ${error.message}`));
  socket.on('close', () => destroyClient(client, 'socket closed'));
  socket.on('end', () => destroyClient(client, 'socket ended'));
});

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
}
function statusJson() {
  const players = Array.from(clients.values()).filter((c) => c.ready).map((c) => ({
    id: c.id, name: c.name, map: c.map, x: c.x, y: c.y, dir: c.dir,
    lastSeen: c.lastSeen, connectedAt: c.connectedAt,
  }));
  return { ok: true, protocol: VERSION, tcpHost: HOST, tcpPort: PORT, httpPort: HTTP_PORT, online: players.length, players };
}
const httpServer = http.createServer((req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: true, protocol: VERSION, online: statusJson().online })); return;
  }
  if (req.method === 'GET' && url.pathname === '/status') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(statusJson())); return;
  }
  if (req.method === 'POST' && url.pathname === '/chat') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; if (body.length > 8192) req.destroy(); });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const playerId = Number(parsed.playerId);
        const message = String(parsed.message || '').trim().slice(0, 120);
        if (!Number.isInteger(playerId) || !clients.has(playerId) || !message) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'playerId/message không hợp lệ' })); return;
        }
        broadcast(chatPayload(playerId, message));
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: true }));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: error.message }));
      }
    });
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: false, error: 'not found' }));
});

setInterval(() => {
  const cutoff = now() - STALE_MS;
  for (const client of clients.values()) {
    if (client.ready && client.lastSeen < cutoff) {
      client.socket.destroy(); destroyClient(client, 'stale');
    }
  }
}, 3000).unref();

function lanAddresses() {
  const result = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) result.push(entry.address);
    }
  }
  return result;
}
tcpServer.listen(PORT, HOST, () => {
  console.log('\\nNRO Multiplayer Lite server');
  console.log(`TCP : ${HOST}:${PORT}`);
  console.log(`HTTP: http://127.0.0.1:${HTTP_PORT}/status`);
  for (const ip of lanAddresses()) console.log(`LAN : ${ip}:${PORT}  |  status http://${ip}:${HTTP_PORT}/status`);
  console.log('');
});
httpServer.listen(HTTP_PORT, HOST);

function shutdown() {
  for (const client of clients.values()) client.socket.destroy();
  tcpServer.close(); httpServer.close();
  setTimeout(() => process.exit(0), 300).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
