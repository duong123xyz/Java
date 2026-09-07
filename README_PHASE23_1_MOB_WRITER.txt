NRO STUDIO — PHASE 23.1 MOB WRITER
==================================

Mục tiêu
--------
Nối nháp panel Quái vào Draft Test / Unified Patch Workspace thay vì blocker.

Writer
------
Nguồn: a/a/a/A.u
Schema:
  id, TYPE, NAME, hp, range_move, speed, dart_Type, percent_dame, percent_tiem_nang

Panel vẫn khóa ID/TYPE. Nháp chỉ serialize lại NAME và các chỉ số template đang cho phép chỉnh.
Writer dùng chung generic static String[][] rewrite engine với NPC / Map / Skill / Part:
- kiểm tra CellEvidence
- phát hiện CONSTANT_String/Utf8 dùng chung
- UNIQUE_REPLACE hoặc CLONE_AND_RETARGET
- hỗ trợ ldc -> ldc_w khi cần
- mở lại class/JAR để verify semantic diff

Thay đổi Draft Test
-------------------
- Quái không còn bị tính là unsupported.
- dirty mob được tính vào supportedDrafts.
- getMobDraftFingerprint vẫn nằm trong freshness fingerprint.
- Boss và Nhân vật vẫn là blocker nếu có draft vì hai domain đó cần numeric/runtime writer riêng.

Kiểm tra trên JAR NgocRongChay-v1.3.8(1).jar
--------------------------------------------
- a/a/a/A.u = 119 row x 9 cột.
- javap: 1,080 ldc/ldc_w = 9 schema cell + 119*9 data cell, tức toàn bộ cell bảng đều được tạo bởi ldc/ldc_w phù hợp generic writer.
- aastore = 1,199 = 9 schema + 119*(9 cell + 1 outer row).
- Runtime JVM test: thay unique CONSTANT_String của Mob #0 rồi load lại a.a.a.A.u thành công, row count vẫn 119 và các field khác không đổi.
