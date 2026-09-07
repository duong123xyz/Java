package patch;

import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.InputStream;
import java.util.Vector;
import javax.microedition.io.Connector;
import javax.microedition.io.SocketConnection;
import a.Q;
import a.L;
import a.c;
import a.am;
import a.ba;
import a.bP;

public final class MultiplayerLite implements Runnable {
    private static final byte VERSION = 1;
    private static final byte MSG_HELLO = 1;
    private static final byte MSG_WELCOME = 2;
    private static final byte MSG_STATE = 3;
    private static final byte MSG_LEAVE = 4;
    private static final byte MSG_CHAT = 5;
    private static final int SEND_INTERVAL = 120;
    private static final int TIMEOUT = 12000;

    private static boolean configLoaded;
    private static boolean enabled = true;
    private static String host = "127.0.0.1";
    private static int port = 14445;
    private static String configuredName = "";
    private static String status = "idle";
    private static MultiplayerLite instance;

    private final Vector players = new Vector();
    private SocketConnection socket;
    private DataInputStream in;
    private DataOutputStream out;
    private Thread thread;
    private boolean running;
    private int selfId;
    private long lastSend;
    private long lastHeartbeat;
    private int lastMap = -9999;
    private int lastX = -9999;
    private int lastY = -9999;
    private int lastDir = -9999;

    private MultiplayerLite() {}

    public static void afterWorld(Q g) {
        L.A(g);
        try {
            MultiplayerLite mp = get();
            if (!enabled) return;
            mp.ensureStarted();
            mp.tick();
            mp.draw(g);
        } catch (Throwable ignored) {
        }
    }

    private static synchronized MultiplayerLite get() {
        loadConfig();
        if (instance == null) instance = new MultiplayerLite();
        return instance;
    }

    private static void loadConfig() {
        if (configLoaded) return;
        configLoaded = true;
        InputStream input = null;
        try {
            input = MultiplayerLite.class.getResourceAsStream("/multiplayer.cfg");
            if (input == null) return;
            StringBuffer buf = new StringBuffer();
            int ch;
            while ((ch = input.read()) >= 0) buf.append((char) ch);
            String text = buf.toString();
            int start = 0;
            while (start < text.length()) {
                int end = text.indexOf('\n', start);
                if (end < 0) end = text.length();
                String line = text.substring(start, end).trim();
                int eq = line.indexOf('=');
                if (eq > 0) {
                    String key = line.substring(0, eq).trim();
                    String value = line.substring(eq + 1).trim();
                    if ("enabled".equals(key)) enabled = !"0".equals(value) && !"false".equals(value);
                    else if ("host".equals(key) && value.length() > 0) host = value;
                    else if ("port".equals(key)) port = Integer.parseInt(value);
                    else if ("name".equals(key)) configuredName = value;
                }
                start = end + 1;
            }
        } catch (Throwable ignored) {
        } finally {
            try { if (input != null) input.close(); } catch (Throwable ignored) {}
        }
    }

    private synchronized void ensureStarted() {
        if (!enabled || running) return;
        running = true;
        thread = new Thread(this);
        thread.start();
    }

    public void run() {
        while (running) {
            try {
                status = "connecting";
                socket = (SocketConnection) Connector.open("socket://" + host + ":" + port);
                out = socket.openDataOutputStream();
                in = socket.openDataInputStream();
                status = "online";
                sendHello();
                readLoop();
            } catch (Throwable error) {
                status = "retry";
            } finally {
                closeSocket();
            }
            if (running) {
                try { Thread.sleep(1500L); } catch (Throwable ignored) {}
            }
        }
    }

    private void readLoop() throws Exception {
        while (running && in != null) {
            int length = in.readInt();
            if (length <= 0 || length > 8192) throw new java.io.IOException("bad packet");
            byte[] payload = new byte[length];
            in.readFully(payload);
            handlePacket(payload);
        }
    }

    private void handlePacket(byte[] payload) throws Exception {
        java.io.DataInputStream din = new java.io.DataInputStream(new java.io.ByteArrayInputStream(payload));
        int version = din.readUnsignedByte();
        if (version != VERSION) return;
        int type = din.readUnsignedByte();
        if (type == MSG_WELCOME) {
            selfId = din.readInt();
            return;
        }
        if (type == MSG_STATE) {
            RemotePlayer p = new RemotePlayer();
            p.id = din.readInt();
            p.map = din.readInt();
            p.x = din.readInt();
            p.y = din.readInt();
            p.dir = din.readByte();
            p.name = readString(din);
            p.lastSeen = System.currentTimeMillis();
            if (p.id != selfId) upsert(p);
            return;
        }
        if (type == MSG_LEAVE) {
            remove(din.readInt());
            return;
        }
        if (type == MSG_CHAT) {
            int id = din.readInt();
            String chat = readString(din);
            RemotePlayer p = find(id);
            if (p != null) {
                p.chat = chat;
                p.chatUntil = System.currentTimeMillis() + 5000L;
            }
        }
    }

    private void tick() {
        if (!"online".equals(status) || out == null) return;
        long now = System.currentTimeMillis();
        if (now - lastSend < SEND_INTERVAL) return;
        try {
            c me = c.a();
            int map = ba.pU;
            int x = me.p;
            int y = me.q;
            int dir = me.x;
            boolean changed = map != lastMap || x != lastX || y != lastY || dir != lastDir;
            if (changed || now - lastHeartbeat > 1000L) {
                sendState(me, map, x, y, dir);
                lastMap = map;
                lastX = x;
                lastY = y;
                lastDir = dir;
                lastHeartbeat = now;
            }
            lastSend = now;
            expire(now);
        } catch (Throwable ignored) {}
    }

    private void sendHello() throws Exception {
        c me = c.a();
        java.io.ByteArrayOutputStream bout = new java.io.ByteArrayOutputStream();
        DataOutputStream d = new DataOutputStream(bout);
        d.writeByte(VERSION);
        d.writeByte(MSG_HELLO);
        d.writeInt(ba.pU);
        d.writeInt(me.p);
        d.writeInt(me.q);
        d.writeByte(me.x);
        writeString(d, playerName(me));
        d.flush();
        sendFrame(bout.toByteArray());
    }

    private void sendState(c me, int map, int x, int y, int dir) throws Exception {
        java.io.ByteArrayOutputStream bout = new java.io.ByteArrayOutputStream();
        DataOutputStream d = new DataOutputStream(bout);
        d.writeByte(VERSION);
        d.writeByte(MSG_STATE);
        d.writeInt(selfId);
        d.writeInt(map);
        d.writeInt(x);
        d.writeInt(y);
        d.writeByte(dir);
        writeString(d, playerName(me));
        d.flush();
        sendFrame(bout.toByteArray());
    }

    private synchronized void sendFrame(byte[] payload) throws Exception {
        if (out == null) return;
        out.writeInt(payload.length);
        out.write(payload);
        out.flush();
    }

    private static String playerName(c me) {
        if (configuredName != null && configuredName.length() > 0) return configuredName;
        if (me != null && me.e != null && me.e.length() > 0) return me.e;
        return "Player";
    }

    private static void writeString(DataOutputStream d, String value) throws Exception {
        if (value == null) value = "";
        byte[] bytes = value.getBytes("UTF-8");
        int length = bytes.length;
        if (length > 255) length = 255;
        d.writeShort(length);
        d.write(bytes, 0, length);
    }

    private static String readString(DataInputStream d) throws Exception {
        int length = d.readUnsignedShort();
        if (length <= 0) return "";
        if (length > 2048) throw new java.io.IOException("string too long");
        byte[] bytes = new byte[length];
        d.readFully(bytes);
        return new String(bytes, "UTF-8");
    }

    private synchronized void upsert(RemotePlayer next) {
        RemotePlayer current = find(next.id);
        if (current == null) players.addElement(next);
        else {
            current.map = next.map;
            current.x = next.x;
            current.y = next.y;
            current.dir = next.dir;
            current.name = next.name;
            current.lastSeen = next.lastSeen;
        }
    }

    private synchronized RemotePlayer find(int id) {
        for (int i = 0; i < players.size(); i++) {
            RemotePlayer p = (RemotePlayer) players.elementAt(i);
            if (p.id == id) return p;
        }
        return null;
    }

    private synchronized void remove(int id) {
        for (int i = players.size() - 1; i >= 0; i--) {
            RemotePlayer p = (RemotePlayer) players.elementAt(i);
            if (p.id == id) players.removeElementAt(i);
        }
    }

    private synchronized void expire(long now) {
        for (int i = players.size() - 1; i >= 0; i--) {
            RemotePlayer p = (RemotePlayer) players.elementAt(i);
            if (now - p.lastSeen > TIMEOUT) players.removeElementAt(i);
        }
    }

    private synchronized void draw(Q g) {
        long now = System.currentTimeMillis();
        int map = ba.pU;
        for (int i = 0; i < players.size(); i++) {
            RemotePlayer p = (RemotePlayer) players.elementAt(i);
            if (p.map != map || now - p.lastSeen > TIMEOUT) continue;
            int sx = p.x - am.kZ;
            int sy = p.y - am.la;
            if (sx < -32 || sy < -64 || sx > am.kO + 32 || sy > am.kP + 64) continue;
            int color = colorFor(p.id);
            g.a(sx - 5, sy - 25, 10, 18, color);
            g.a(sx - 3, sy - 31, 6, 6, 0xFFE0B2);
            g.a(sx - 8, sy - 7, 6, 3, color);
            g.a(sx + 2, sy - 7, 6, 3, color);
            bP.s.a(g, p.name == null ? "Player" : p.name, sx, sy - 43, 2);
            if (p.chat != null && p.chat.length() > 0 && p.chatUntil > now) {
                bP.c.a(g, p.chat, sx, sy - 55, 2);
            }
        }
    }

    private static int colorFor(int id) {
        int[] colors = {0x38BDF8,0x34D399,0xF59E0B,0xA78BFA,0xFB7185,0x22D3EE};
        int index = id % colors.length;
        if (index < 0) index = -index;
        return colors[index];
    }

    private void closeSocket() {
        try { if (in != null) in.close(); } catch (Throwable ignored) {}
        try { if (out != null) out.close(); } catch (Throwable ignored) {}
        try { if (socket != null) socket.close(); } catch (Throwable ignored) {}
        in = null;
        out = null;
        socket = null;
    }

    private static final class RemotePlayer {
        int id; int map; int x; int y; int dir; String name; long lastSeen; String chat; long chatUntil;
    }
}
