# NRO Game Account Server (Firebase)

Backend TCP lưu tài khoản và nhân vật trong Firestore. Đây là tài khoản **bên trong game**, không phải đăng nhập website.

## Protocol

Mỗi frame: `uint32 length` + payload.

- `10 REGISTER`: `version(1), type(10), username(UTF), password(UTF)`
- `11 LOGIN`: `version(1), type(11), username(UTF), password(UTF)`
- `12 AUTH_RESULT`: `version, type, success, code, message(UTF), sessionToken(UTF)`

## Chạy

1. Tạo Firebase project và bật Firestore.
2. Tải service-account JSON, không commit file này.
3. Copy `.env.example` thành `.env` và điền thông tin.
4. Chạy `npm install` rồi `npm start`.

Server TCP phải được host ở nơi hỗ trợ cổng TCP lâu dài (VPS/Render/Railway phù hợp hơn Vercel Functions).

## Trạng thái tích hợp client

JAR 1.5.5 có sẵn UI `Login` và `Request Register`, nhưng kết nối hiện bị patch `OFFLINE: connect bypassed` và server trỏ `127.0.0.1:14445`. Cần writer JAR thay host/port và khôi phục method connect trước khi UI game gọi được server này.
