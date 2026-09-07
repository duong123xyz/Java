# Tài khoản trong game bằng Firebase

Thư mục `game-account-server/` là TCP backend cho tài khoản **trong game**:

- đăng ký tài khoản;
- đăng nhập và phát session token;
- mật khẩu được băm bằng `scrypt`, không lưu plain text;
- dữ liệu nằm trong Firestore (`gameAccounts`, `characters`, `gameSessions`).

## Giới hạn hiện tại của JAR 1.5.5

Client đã có màn hình `Login`/`Request Register`, nhưng bản JAR đang dùng đã bị
vá tắt kết nối (`OFFLINE: connect bypassed`) và trỏ về `127.0.0.1:14445`.
Vì vậy backend không thể tự làm nút đăng nhập hoạt động nếu chưa khôi phục phần
socket trong client.

Để hoàn tất writer và xuất JAR chơi được, cần một trong hai đầu vào:

1. JAR online nguyên bản đúng phiên bản 1.5.5; hoặc
2. source/class nguyên bản chứa phần kết nối mạng (trong bản này là class liên
   quan tới `a/aW.class`).

Sau đó writer sẽ vá host/port của backend và nối packet đăng ký/đăng nhập của
game vào server. Không đưa service-account Firebase vào JAR hoặc mã frontend.

## Chạy backend

Xem `game-account-server/README.md`. Server cần môi trường hỗ trợ TCP lâu dài;
Firebase chỉ là database, không thay thế tiến trình game server TCP.
