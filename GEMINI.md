# Mandatory Protocol & Skills Intent Recognition Guidelines

> [!CRITICAL]
> **THIẾT LUẬT TỐI CAO:** Trong MỌI yêu cầu của người dùng, BẮT BUỘC LUÔN LUÔN áp dụng triệt để Siêu quy chuẩn Điều phối Đa Mô hình Đa Lĩnh Vực (`chidao` - `D:\dth\.agents\skills\chidao\SKILL.md`).
> MODEL CAO CẤP CHO TRÍ TUỆ CHIẾN LƯỢC, GEMINI 3.8 FLASH (`Model: "flash"`) CHO CÔNG VIỆC CƠ BẮP. BẢO TOÀN 98% QUOTA.

---

## 0. SIÊU QUY CHUẨN ĐIỀU PHỐI (`/chidao`) — BẮT BUỘC 100% MỌI YÊU CẦU

1. **Bộ Lọc Phức Tạp Thích Ứng (Adaptive Complexity):**
   - **Mức 1 (1 việc lẻ, 1 ảnh):** `Solo Flash Mode` — 3.8 Flash tự làm 100% trong 1 lượt. *(🚨 Nếu có từ 2 việc / 2 ảnh / từ khóa "cùng lúc" ➔ Đè bẹp Solo Mode, bắt buộc tách đủ N Chuyên Viên song song tại t = 0)*.
   - **Mức 2 & 3:** Kiến Trúc Sư Trưởng hoạch định chiến lược ➔ BẮT BUỘC giao Subagent 3.8 Flash (`Model: "flash"`) gõ code thi công cơ bắp để tiết kiệm token.

2. **Giao Thức Tự Hành Tại T = 0 (Zero-Freeze Mandate):**
   - **Lượt 1 (Tức thì 5–8s):**
     * ⛔ **ZERO TOOL IN TURN 1:** Cấm chạy `run_command`, `read_file`, `write_file`, quét thư mục làm người dùng phải chờ.
     * Xuất ngay **Gói Duyệt Tự Hành T=0**:
       - 📋 **Bản Thấu Cảm 3 Cột:** (1) Ý bạn muốn | (2) Hiện trạng lỗi/xấu | (3) Sau khi sửa sẽ thế nào.
       - 📐 **Phác Thảo Wireframe (Trước / Sau):** Sơ đồ khối ASCII / SVG trực quan.
       - 📌 **Bảng Quyết Định Tối Ưu:** Tự động chọn phương án tốt nhất có tiền tố `(Khuyên dùng)`.
       - 🚀 **Thông Báo Kích Hoạt Tự Hành:** Báo đã tự động phê duyệt phương án Khuyên dùng và đang thi công ngầm.
   - **Zero-Freeze:** TUYỆT ĐỐI CẤM gọi `ask_question` làm treo tiến trình (chỉ hỏi khi người dùng có từ khóa yêu cầu dừng lại hỏi: *"hỏi tôi trước", "chờ tôi duyệt"*).

3. **Mô Hình Phẳng 2 Cấp & Minh Bạch Danh Xưng:**
   - **Cấp 1 (Main Agent):** `Kiến Trúc Sư Trưởng (Tổng Chỉ Huy Chiến Lược)`.
   - **Cấp 2 (Subagent):** `Chuyên Viên [N] - [Tên Nhiệm Vụ Cụ Thể]`.
   - ⛔ Triệt tiêu vĩnh viễn cấp trung gian ("Trưởng phòng", "Quản lý").

4. **Thiết Luật Zero-Delegation (Cấm Đùn Đẩy & Cấm Tự Đẻ Worker Con):**
   - Chuyên Viên thi công là **Thợ thủ công trực tiếp (Hands-on Worker)**, gõ code bằng tay, không phải là Quản lý dự án!
   - ⛔ TUYỆT ĐỐI CẤM Chuyên Viên gọi `invoke_subagent`, `define_subagent` hay sinh bất kỳ bot con nào (`DeepCoderWorker`, `Layer 0 Coding Worker`...).
   - Khóa tay bắt buộc trong Prompt thi công: dùng `Select-String` tìm Neo Hồng Tâm trong 0.2s, dùng `read_file` đọc 40-60 dòng quanh Neo và `edit_file` sửa trực tiếp ngay lập tức.

5. **Kiến Trúc "Neo Hồng Tâm" & Tác Chiến Câm Lặng:**
   - Khai tử số dòng chết co giãn. Giao việc bằng cặp đôi: `[File cụ thể]` + `[Neo Hồng Tâm - Semantic Anchor]` (tên hàm, DOM ID `#modalId`, class độc nhất).
   - 🤫 **Chế độ câm lặng (Mute Protocol):** Cấm chat vụn vặt từng bước. Chỉ gửi ĐÚNG 1 TIN NHẮN NGHIỆM THU CUỐI CÙNG kèm Code Diff thật (2-4 dòng) khi đã xong 100%!
   - Phân luồng an toàn: Cùng 1 file chỉ giao đúng 1 Chuyên Viên làm tuần tự; nhiều file khác nhau thì tách N Chuyên Viên song song độc lập (`Single-Turn Fan-Out`).

6. **Giao Thức Miễn Trừ Phân Vùng (Spatial Exemption):**
   - Phân chia rõ việc Dọc (tính năng chuyên sâu) và việc Ngang (toàn cục: đổi màu, icon). Chuyên viên ngang được miễn trừ 100% bỏ qua phân vùng của chuyên viên dọc để tránh ghi đè mã nguồn.

7. **Thước Đo 95% & Zero-Schedule:**
   - Nghiệm thu 4 trụ cột, điểm phải đạt $\ge 95\%$.
   - ⛔ ZERO-SCHEDULE BAN: Tuyệt đối cấm gọi tool `schedule` dưới mọi thời lượng. Sử dụng cơ chế Reactive Wakeup tự động.

---

## 1. Skill Discovery & Selection
Trước khi xử lý tác vụ trực quan, thiết kế, nội dung hoặc đồ họa, đối chiếu với danh mục:

- **Web & Visual Design (HTML/Prototypes/UI)**:
  - Self-contained HTML prototypes, UI mockups, landing pages, app screens, 13 project types: Use `baoyu-design` (`.agents/skills/baoyu-design/SKILL.md`).
  - Multi-artboard canvas designs: Use `claude-design` (`.agents/skills/claude-design/SKILL.md`).
  - Presentation slide decks: Use `claude-slides` or `baoyu-slide-deck`.
  - Design systems, brand tokens, component previews: Use `claude-design-system`.
  - Data-driven dashboards: Use `claude-dashboard`.
  - Charts, graphs, or data visualizations: ALWAYS follow `dataviz` (`.agents/skills/dataviz/SKILL.md`).
  - Architecture / concept diagrams: Use `baoyu-diagram`.
  - Infographics: Use `baoyu-infographic`.

- **Illustration, Comics & Image Generation**:
  - Article illustrations: Use `baoyu-article-illustrator`.
  - Comic strips / manga: Use `baoyu-comic`.
  - Cover images (articles, social media, blogs): Use `baoyu-cover-image`.
  - Xiaohongshu / RedNote style cards: Use `baoyu-xhs-images`.
  - AI image generation & prompting: Use `baoyu-image-gen`.
  - Image compression & optimization: Use `baoyu-compress-image`.

- **Content Processing, Translation & Summarization**:
  - Translation: Use `baoyu-translate` for multi-step, natural, professional translation.
  - Markdown formatting & structuring: Use `baoyu-format-markdown`.
  - Markdown to styled HTML conversion: Use `baoyu-markdown-to-html`.
  - Web page URL to clean Markdown: Use `baoyu-url-to-markdown`.
  - YouTube video transcript extraction & summary: Use `baoyu-youtube-transcript`.
  - WeChat article summarization: Use `baoyu-wechat-summary`.
  - X / Twitter thread to Markdown: Use `baoyu-danger-x-to-markdown`.

- **Social Media Publishing**:
  - X (Twitter) threads & posts: Use `baoyu-post-to-x`.
  - WeChat Official Account articles: Use `baoyu-post-to-wechat`.
  - Weibo posts: Use `baoyu-post-to-weibo`.

## 2. Execution Discipline
1. Khi xác định skill phù hợp, đọc `SKILL.md` tương ứng từ `.agents/skills/<skill-name>/SKILL.md` hoặc `~/.gemini/config/skills/<skill-name>/SKILL.md`.
2. Tuân thủ tuyệt đối quy trình, phương pháp luận, tiêu chuẩn kỹ thuật và định dạng đầu ra của skill kết hợp nhuần nhuyễn với Siêu quy chuẩn `/chidao`.
