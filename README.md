# ⚡ DTH Services - Cổng Dịch Vụ Nạp & Kích Hoạt Tự Động 24/7 (v2.0 Architecture)

Cổng dịch vụ đa năng tích hợp thanh toán VietQR tự động, quản lý đơn hàng bền vững qua Database ACID (PostgreSQL / SQLite), bảo mật cao cấp và giao diện Luxury White hiện đại.

---

## 🏛️ Kiến Trúc Hệ Thống (Modular Architecture)

Dự án đã được tái cấu trúc từ file nguyên khối thành kiến trúc module chuẩn mực:
```
D:\dth\gop3web\
├── models.py               # Database engine, Session, Schema (Order, ProcessedTransaction, ServiceConfig, Review)
├── utils.py                # Timezone (Asia/Ho_Chi_Minh), tiền tệ, mã hóa token, chuẩn hóa link
├── services/
│   ├── partners.py         # AutoNhanh (Chung Sức), LocketAPI (VIP Gold), TangTim (MXH) với cơ chế Retry
│   ├── bank.py             # Parser BVBank / ZaloPay (99ZP...), thuật toán đối soát giao dịch nguyên tử
│   └── telegram_bot.py     # Hệ thống thông báo Telegram an toàn, chống lặp tin nhắn tuyệt đối (Idempotent)
├── routes/
│   ├── orders.py           # Blueprint /api/order (Tạo đơn, tra cứu Exact Match, đánh giá)
│   ├── payments.py         # Blueprint /api/payment & /api/webhook (Xác thực Webhook, đối soát Cron)
│   └── admin.py            # Blueprint /api/admin (Dashboard, quản lý dịch vụ, xuất báo cáo CSV)
├── tests/
│   ├── test_orders.py      # Unit test tạo mã đơn, làm sạch link, tính giá
│   ├── test_payments.py    # Unit test đối soát ngân hàng nguyên tử, chống spam
│   └── test_security.py    # Unit test khóa chặn dịch vụ bảo trì
├── templates/
│   ├── index.html          # Giao diện Minimalist Luxury White, PWA, Modal thanh toán tự bung Gold
│   └── admin.html          # Giao diện quản trị viên đa năng
├── static/
│   ├── css/style.css       # Theme Luxury White & Dark mode, nút bấm độ tương phản cao
│   ├── js/app.js           # Polling 5s siêu nhẹ, Web Audio Ting Ting, Confetti, In-App Browser Warning
│   ├── manifest.json       # Cấu hình PWA cài đặt App trên iPhone/Android
│   ├── favicon.png         # Icon 64x64 chuẩn hóa
│   └── favicon.ico
├── app.py                  # Entrypoint Flask WSGI cho Vercel Serverless
└── requirements.txt        # Khóa phiên bản thư viện ổn định
```

---

## 🔐 Cấu Hình Biến Môi Trường (Environment Variables / Secrets)

Khi triển khai trên **Vercel** (`Project Settings -> Environment Variables`) hoặc VPS:

| Biến Môi Trường | Ý Nghĩa / Mục Đích | Giá Trị Mẫu |
| :--- | :--- | :--- |
| `DATABASE_URL` | Kết nối PostgreSQL (Supabase / Neon) với `NullPool` | `postgresql+pg8000://user:pass@ep-cool.ap-southeast-1.aws.neon.tech/neondb` |
| `SECRET_KEY` | Khóa bí mật mã hóa Session Cookie Admin | `dth_super_secret_session_key_2026` |
| `ADMIN_PASSWORD` | Mật khẩu đăng nhập Admin Dashboard (`/admin`) | `admin` (hoặc mật khẩu tùy chỉnh) |
| `CRON_SECRET` | Header `X-Cron-Secret` xác thực Endpoint Cron | `dth_cron_sync_secret_token_99` |
| `BANK_WEBHOOK_SECRET` | Chữ ký / Token xác thực Webhook Ngân hàng | `DTH_SECURE_WEBHOOK_KEY_2026` |
| `TELEGRAM_BOT_TOKEN` | Token Bot Telegram nhận thông báo | `7714154848:AAE...` |
| `TELEGRAM_CHAT_ID` | ID Chat Telegram của Admin | `7114174347` |

> *Ghi chú:* Nếu không cấu hình `DATABASE_URL`, hệ thống sẽ tự động sử dụng SQLite fallback (`dth_services.db` trên local hoặc `/tmp/dth_services.db` trên Vercel).

---

## 🔄 Quy Trình Đối Soát Ngân Hàng & Chống Spam Tuyệt Đối

1. **Idempotency & Row-Level Lock:** Mỗi mã giao dịch từ ngân hàng (`transaction_id`) được lưu trữ duy nhất trong bảng `processed_transactions`.
2. **Atomic Update:** Câu lệnh cập nhật trạng thái đơn:
   ```sql
   UPDATE orders SET status = 'PAID', is_notified = TRUE, paid_at = NOW(), bank_trans_id = :trans_id
   WHERE order_id = :oid AND status IN ('PENDING', 'EXPIRED', 'PARTIAL_PAID') AND is_notified = FALSE;
   ```
   Chỉ một worker thực thi thành công duy nhất mới được kích hoạt lệnh gửi thông báo Telegram, triệt tiêu 100% tình trạng spam tin nhắn.
3. **Polling 5s Tách Biệt:** Khách hàng kiểm tra trạng thái chỉ đọc từ Database nội bộ (< 15ms), tuyệt đối không gọi API ngân hàng ngoài luồng polling để không bị dính Cooldown hay 429 Rate Limit.

---

## 🛡️ Bảo Mật & Quyền Riêng Tư

* **Ẩn Link Module VIP:** Tuyệt đối không hardcode link `dth.sgmodule` trong HTML tĩnh. Link được phân phối qua endpoint `/api/download/sgmodule` chỉ khi đơn hàng đã được xác nhận `PAID`.
* **Tra Cứu Exact Match 100%:** Bắt buộc nhập chính xác Mã đơn hàng hoặc Số điện thoại đầy đủ (10 số). Số điện thoại được che một phần (`0899***660`).
* **Khóa Chặn Ở Backend:** Mọi API tạo đơn đều kiểm tra trạng thái `is_active` của dịch vụ trong Database trước khi xử lý.

---

## 🧪 Kiểm Thử Hệ Thống (Pytest)

Chạy bộ kiểm thử tự động toàn diện:
```bash
python -m pytest
```
Bao gồm:
- Kiểm thử tạo mã đơn ngẫu nhiên an toàn, không trùng lặp.
- Kiểm thử làm sạch link và bóc tách username.
- Kiểm thử làm sạch chuỗi mô tả giao dịch BVBank / ZaloPay.
- Kiểm thử đối soát ngân hàng nguyên tử (Atomic Match) và chống lặp.
- Kiểm thử khóa chặn dịch vụ bảo trì.

---

## 📱 Tính Năng Trải Nghiệm Khách Hàng (UX Highlights)

1. **Luxury White Theme:** Tông trắng sáng sang trọng, chuyển đổi Light/Dark Mode mượt mà.
2. **In-App Browser Warning:** Cảnh báo khi khách mở link từ Zalo/TikTok/Messenger, hướng dẫn mở bằng Safari để cài file `.mobileconfig` một chạm.
3. **Receipt Card Generator:** Tự động tạo ảnh biên lai điện tử sang xịn kèm mã QR để tải về máy.
4. **Confetti & Chime:** Hiệu ứng pháo giấy cùng âm thanh "Ting Ting" crystal từ Web Audio API khi thanh toán thành công.
5. **Smart URL Doctor:** Nút "✨ Tự động làm sạch link" giúp khách không bao giờ nhập sai link/mã mời.
