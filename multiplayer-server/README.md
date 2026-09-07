# NRO Multiplayer Lite Server

Phase 1 đồng bộ **người chơi / map / tọa độ / hướng / tên**. Đây chưa phải server NRO đầy đủ.

## Chạy

Yêu cầu Node.js 18+.

Windows: `run-server.bat`

macOS/Linux: `chmod +x run-server.sh && ./run-server.sh`

Mặc định TCP game `14445`, HTTP quản trị `14446`.
Status: `http://127.0.0.1:14446/status`.

## LAN

Máy host chạy server, lấy IP LAN mà server in ra (ví dụ `192.168.1.10`), dùng IP đó trong panel Multiplayer. Bạn bè cùng Wi-Fi/LAN phải dùng IP LAN, **không dùng 127.0.0.1**. Cho phép Node.js qua Firewall.

## Phase 1 chưa có

- sprite remote thật (đang là placeholder)
- skill/combat đồng bộ
- quái/HP boss dùng chung
- drop/party/trade/PvP
