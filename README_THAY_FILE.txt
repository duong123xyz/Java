NRO Studio - Mob Drop Editor (không Admin / không Firebase)

Thay đúng 2 file vào project hiện tại:
1) src/components/mobs/MobPanel.tsx
2) src/services/mobDropDraftService.ts

Sau khi thay:
- restart Vite/Preview;
- mở JAR lại;
- vào Quái -> chọn mob -> Vật phẩm rơi;
- bấm "Thêm vật phẩm rơi";
- nhập Item ID, Tỷ lệ %, SL min/max -> Lưu.

Rule được lưu riêng theo JAR trong localStorage, không cần backend/admin.
Một mob có thể có nhiều rule; mỗi rule là một item độc lập.

LƯU Ý:
Repo hiện tại a/a/a/A.u chỉ có schema template quái 9 cột, không có cột drop.
Bản này làm đúng editor + persistence cho drop. Chưa giả vờ patch runtime vào JAR.
Bước runtime tiếp theo phải hook đường drop a/a/aa.customDrop / a(La/m;La/a/H;Z)[I trên JAR thực tế.
