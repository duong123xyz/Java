NRO STUDIO — PHASE 23.2 CHARACTER SOURCE-BACKED WRITER

Mục tiêu
========
Bỏ blocker Nhân vật trong Unified Patch Workspace và thay profile hardcode bằng dữ liệu đọc trực tiếp từ a/a/H.p(byte).

Đã làm
======
- Parse trực tiếp bytecode H.p(B)V.
- Xác minh field refs và branch shape trước khi cho sửa.
- Đọc source-backed 3 profile hành tinh từ bytecode thật.
- Writer cho các giá trị khởi tạo:
  map, X/Y, vàng, ngọc, ruby, sức mạnh, tiềm năng,
  HP, KI, damage, giáp, chí mạng, tốc độ, level,
  skill points, stamina/maxStamina, selectedSkill.
- Hỗ trợ resize numeric producer khi opcode cũ không đủ chỗ:
  iconst/bipush/sipush/ldc/ldc_w/ldc2_w.
- Tự append CONSTANT_Integer / CONSTANT_Long khi cần.
- Tự remap branch offsets sau khi code_length thay đổi.
- Chỉ cho phép những shape mà H.p(byte) thực tế biểu diễn được:
  * map = base + planet => 3 map phải liên tiếp.
  * HP: Earth riêng, Namek/Xayda dùng chung.
  * KI: Namek riêng, Earth/Xayda dùng chung.
  * Damage: Xayda riêng, Earth/Namek dùng chung.
  * stamina và maxStamina dùng cùng producer nên phải bằng nhau.
  * các field global phải giống nhau giữa 3 hành tinh.
- Nối vào Draft Test / Unified Workspace.
- Nhân vật không còn tính vào unsupportedDrafts khi writer đạt verification.

Lưu ý
=====
Writer cố ý BLOCK nếu bytecode H.p(B)V khác shape đã xác minh trên JAR v1.3.8,
thay vì đoán offset và có nguy cơ phá class.
