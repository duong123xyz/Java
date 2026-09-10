JAVA PANEL - UNLIMITED MECHANICS FIX
Repo: duong123xyz/Java (main)

THAY THE CAC FILE SAU VAO DUNG DUONG DAN:
1. src/services/gameMechanicsService.ts
2. src/components/mechanics/GameMechanicsPanel.tsx

DA SUA:
- Bo hard-cap x100 cua multiplier (TNSM / power cap / BDKB reward / gold multiplier).
- Co the nhap truc tiep x500, x1000, x5000... o o number; slider chi la dieu khien nhanh.
- Bo hard-cap quantity 999999 o Game Mechanics.
- Khong con silent clamp gia tri multiplier ve 100.
- Cap nhat trang thai global gold theo hook thuc te duoc detect.
- Cap nhat text cua Ngoc #77: writer hien tai da co logic phuc hoi/chen branch RNG.
- Cap nhat text Vang global: mechanicsPatchService da co writer wrapper, khong con chi la draft.

GIOI HAN THAT (KHONG BO):
- Chance / ty le % van 0..100. Day la gioi han xac suat that, khong phai gioi han UI gia.
- Khi export, writer van phai ton trong kieu JVM that (int/long/double). Gia tri qua kieu du lieu phai bao loi, khong duoc cat ngam.

BOSS DROP - PHAT HIEN QUAN TRONG:
- BossPanel hien cho sua / them drop vao draft.
- Nhung src/services/draftTestService.ts hien tai CHAN TOAN BO boss draft va noi ro boss writer numeric/runtime chua hoan thien.
- Vi vay 'Them drop Boss' cua ban hien tai KHONG THE ghi that vao JAR; no chi tao draft UI.
- Khong nen go bo blocker trong draftTestService mot cach gia tao, vi nhu vay panel se bao export thanh cong nhung bytecode Boss khong he doi.
- Muon lam custom Boss drop that, can dung JAR game muc tieu de xac minh hook/method/offset va writer bytecode boss-specific (a/a/d.rimDropAndFinish, patch/TM... tuy boss).

KIEM TRA DA CHAY CHO 2 FILE TRONG ZIP:
- TypeScript transpile syntax: PASS (0 syntax errors).

CACH DUNG:
- Giai nen ZIP tai root project.
- Cho phep ghi de 2 file tren.
- Chay: npm run lint
- Chay: npm run build

Luu y: ZIP nay khong vo tinh 'bat' Boss writer gia. Phan custom Boss drop can JAR game de lam dung va test bytecode thuc te.
