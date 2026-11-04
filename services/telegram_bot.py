import json
import requests
from config_manager import config_manager
from utils import format_currency_vnd

def get_telegram_config():
    cfg = config_manager.load_config()
    tg = cfg.get("telegram", {})
    return tg.get("bot_token"), tg.get("chat_id")

def send_telegram_msg(text, reply_markup=None, chat_id=None, timeout=3):
    """Gửi tin nhắn Telegram an toàn với timeout 3s, không bao giờ làm nghẽn luồng xử lý chính."""
    bot_token, default_chat_id = get_telegram_config()
    target_chat = chat_id or default_chat_id
    if not bot_token or not target_chat:
        return False, "Thiếu bot_token hoặc chat_id"

    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    payload = {
        "chat_id": target_chat,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True
    }
    if reply_markup:
        payload["reply_markup"] = json.dumps(reply_markup) if isinstance(reply_markup, dict) else reply_markup

    try:
        r = requests.post(url, json=payload, timeout=timeout)
        data = r.json() if r.status_code == 200 else {}
        return data.get("ok", False), data.get("description", r.text)
    except Exception as e:
        return False, str(e)

def notify_new_order(order):
    oid = order.get("order_id")
    stype = order.get("service_type")
    amt_str = order.get("amount_formatted") or format_currency_vnd(order.get("amount", 0))

    if stype == "chungsuc":
        svc_name = f"Chung Sức Liên Quân ({order.get('package_name')})"
        target_info = f"Mã mời: <code>{order.get('code') or order.get('raw_code')}</code>"
    elif stype == "locket":
        svc_name = f"Locket Gold ({order.get('package_name')})"
        target_info = f"Username: <b>@{order.get('username')}</b>"
    elif stype == "premium":
        svc_name = f"Chợ Premium ({order.get('package_name')})"
        target_info = f"Mục tiêu: <code>{order.get('target') or order.get('zalo')}</code>"
    else:
        svc_name = f"Dịch Vụ MXH ({order.get('package_name')})"
        target_info = f"Link/User: <code>{order.get('link')}</code> | SL: <b>{order.get('quantity'):,}</b>"

    msg = (
        f"🛒 <b>[ĐƠN HÀNG MỚI: #{oid}]</b>\n"
        f"• Dịch vụ: <b>{svc_name}</b>\n"
        f"• {target_info}\n"
        f"• Giá tiền: <b>{amt_str}</b>\n"
        f"• Zalo: <code>{order.get('zalo') or 'N/A'}</code>\n"
        f"⏳ <i>Đang chờ khách thanh toán VietQR...</i>"
    )
    send_telegram_msg(msg)

def notify_payment_success(order, trans_id=None):
    oid = order.get("order_id")
    stype = order.get("service_type")
    amt_str = order.get("amount_formatted") or format_currency_vnd(order.get("amount", 0))

    if stype == "chungsuc":
        svc_name = f"Chung Sức - {order.get('package_name')}"
    elif stype == "locket":
        svc_name = f"Locket Gold - {order.get('package_name')} (@{order.get('username')})"
    elif stype == "premium":
        svc_name = f"Chợ Premium - {order.get('package_name')}"
    else:
        svc_name = f"MXH - {order.get('package_name')}"

    msg = (
        f"💰 <b>[THANH TOÁN THÀNH CÔNG: #{oid}]</b> (+{amt_str})\n"
        f"• Dịch vụ: <b>{svc_name}</b>\n"
        f"• Zalo: <code>{order.get('zalo') or 'N/A'}</code> | GD: <code>{trans_id or 'Auto VietQR'}</code>\n"
        f"⚡ <i>Hệ thống đang tự động xử lý bàn giao...</i>"
    )
    send_telegram_msg(msg)

def notify_locket_gold_activated(order_id, username, uid):
    msg = (
        f"🎉 <b>[KÍCH HOẠT LOCKET GOLD THÀNH CÔNG]</b>\n"
        f"• Đơn: <b>#{order_id}</b>\n"
        f"• Username: <b>@{username}</b>\n"
        f"• UID: <code>{uid or 'N/A'}</code>\n"
        f"• Trạng thái: ✅ Gold Active (Đã cấp cấu hình DNS VIP)"
    )
    send_telegram_msg(msg)

def notify_popup_updated(title, content, enabled):
    st_icon = "🟢 ĐANG BẬT" if enabled else "🔴 ĐÃ TẮT"
    msg = (
        f"📢 <b>[CẬP NHẬT POPUP THÔNG BÁO TỪ ADMIN WEB]</b>\n"
        f"• Trạng thái: <b>{st_icon}</b>\n"
        f"• Tiêu đề: <b>{title}</b>\n"
        f"• Nội dung: <i>{content}</i>"
    )
    send_telegram_msg(msg)
