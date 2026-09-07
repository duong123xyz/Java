NRO STUDIO — PHASE 21 MULTIPLAYER LITE

Mục tiêu Phase 1
================
Cho 2–10 client JAR offline kết nối một mini server riêng và nhìn thấy trạng thái cơ bản của nhau.

Đã có
=====
- TCP side-channel riêng, không thay protocol offline simulator hiện tại.
- Đồng bộ map ID.
- Đồng bộ tọa độ X / Y.
- Đồng bộ hướng.
- Đồng bộ tên.
- Vẽ remote player bằng placeholder ngay sau world render.
- HTTP /status xem player online.
- HTTP /chat gửi bubble chat tới client.
- Panel Multiplayer trong NRO Studio.
- Build JAR multiplayer trực tiếp từ JAR đang mở, có verify hook trước khi VALIDATED.

Chưa có
=======
- Sprite head/body/leg thật cho remote.
- Animation chạy/bay/đánh.
- Skill/damage realtime.
- Quái/boss authoritative chung.
- Drop chung.
- Party/trade/PvP.

Cách chạy LAN
=============
1. Cài Node.js 18+ trên máy host.
2. Mở thư mục multiplayer-server.
3. Windows: chạy run-server.bat.
4. Lấy IP LAN server in ra, ví dụ 192.168.1.10.
5. Trong NRO Studio > Multiplayer:
   Host = 192.168.1.10
   TCP port = 14445
6. Bấm “Tạo JAR Multiplayer & mở Chạy thử” hoặc tải JAR.
7. Với mỗi người nên build/tạo tên riêng.
8. Máy bạn bè cùng Wi-Fi/LAN dùng cùng IP server.
9. Nếu Windows Firewall hỏi, cho phép Node.js trên Private networks.

Lưu ý transport
===============
JAR client dùng javax.microedition.io.SocketConnection thật.
Trên emulator/native J2ME có socket support thì kết nối thẳng TCP.
Trong FreeJ2ME/CheerpJ web, mức hỗ trợ raw socket phụ thuộc runtime/browser. Phase này chủ yếu là prototype để xác minh transport. Nếu runner web không mở TCP được, bước tiếp theo nên đổi side-channel sang transport WebSocket/HTTP bridge tương thích browser.

Hook kỹ thuật
=============
a/ai.paint(Graphics) vốn gọi:
  a/L.A(a/Q)

Builder retarget đúng 1 invokestatic đó thành:
  patch/MultiplayerLite.afterWorld(a/Q)

MultiplayerLite.afterWorld() gọi lại a/L.A(q) trước, sau đó mới tick/draw remote player.
Do đó không tăng code_length của a/ai.paint; chỉ append Constant Pool và retarget operand của 1 invokestatic.
