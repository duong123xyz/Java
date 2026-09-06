/**
 * Toàn bộ câu chữ chính của giao diện NRO Studio.
 *
 * Chỉ sửa nội dung hiển thị trong file này khi muốn đổi cách gọi trên giao diện.
 * Không đổi các mã kỹ thuật như ORIGINAL, PATCHED, VALIDATED vì chúng được dùng
 * trong logic xử lý JAR và kiểm tra bản vá.
 */
export const VI_TEXT = {
  appName: 'NRO Studio',
  appVersion: 'v0.5',
  appSubtitle: 'Trình chỉnh sửa JAR J2ME',

  jarLabel: 'JAR:',
  closeJar: 'Đóng JAR',
  closeJarTitle: 'Đóng file JAR và giải phóng bộ nhớ',
  clientMemoryMode: 'Chế độ bộ nhớ phía trình duyệt',

  tabs: {
    overview: 'Tổng quan',
    explorer: 'Duyệt JAR',
    items: 'Vật phẩm',
    testGame: 'Chạy thử game',
  },

  badges: {
    modified: 'đã sửa',
    patched: 'Đã vá',
  },

  status: {
    label: 'Trạng thái:',
    loaded: 'Đã tải JAR thành công',
  },

  errors: {
    unknownJarLoad: 'Không xác định được lỗi khi tải file JAR',
  },

  closeConfirm: {
    title: 'Có thay đổi chưa được lưu.',
    descriptionBeforeCount: 'Bạn đang có',
    descriptionAfterCount:
      'vật phẩm đã chỉnh sửa trong bộ nhớ RAM. Nếu đóng file JAR, toàn bộ thay đổi nháp này sẽ bị hủy.',
    cancel: 'Tiếp tục chỉnh sửa',
    discardAndClose: 'Hủy thay đổi và đóng JAR',
  },
} as const;
