import re
import time
import requests
import logging
from datetime import datetime, timedelta
from sqlalchemy import or_
from config_manager import config_manager
import models
from utils import now_gmt7
from services.telegram_bot import notify_payment_success
from services.partners import autonhanh_process_order, tangtim_process_order, queue_manager

logger = logging.getLogger("bank_service")

LOCKET_SHADOW_MODULE_URL = "https://raw.githubusercontent.com/dth20006/shadow/main/dth.sgmodule"

_last_bank_fetch = 0
_rate_limit_until = 0

# ==============================================================================
# TẦNG 1 (4-TIER IDEMPOTENCY LOCK): TẬP HỢP GIAO DỊCH ĐÃ XỬ LÝ VĨNH CỬU
# Tuyệt đối không bao giờ xử lý hay gửi Telegram lặp lại các giao dịch này
# ==============================================================================
KNOWN_PROCESSED_TRANSACTIONS = {
    "261104002753031",  # Đơn #CS8IMCWT (+70.000đ - Gói 1k2 Lượt SSS - Zalo 0343817944) - KHÓA VĨNH VIỄN
    "261103005554547",  # Đơn LKG2BZMH (@dal.207)
    "261103005550313",  # Đơn LK46K80R (@amoam)
    "261104000081012",
    "261103005585923",
    "261103005578035",
    "261103005073065",
    "261103004810842",
    "261103004715978",
    "261103003584912",
    "261103000897524",
    "261102005755411",
    "261102005747615",
    "261102005681550",
    "261102005625975",
    "261102005625719",
    "261102005617044",
    "261102005615867",
    "261102005596666",
    "261102005574710",
    "261102005308498",
    "261102004776378",
    "261102004456952",
    "261102004442095",
    "261102003749080",
    "261102003730227",
    "261102000097048",
    "261101004657072",
    "261101004653662",
    "261101004492728",
    "261101004476012"
}
models.KNOWN_PROCESSED_TRANSACTIONS.update(KNOWN_PROCESSED_TRANSACTIONS)


def clean_transaction_description(desc):
    if not desc:
        return ""
    # Strip everything except uppercase alphanumeric
    return re.sub(r'[^A-Z0-9]', '', str(desc).upper())


def parse_trans_time(tx):
    """Trích xuất và chuẩn hóa thời gian phát sinh giao dịch ngân hàng thành datetime (GMT+7)."""
    if not isinstance(tx, dict):
        return None
    raw_time = (
        tx.get("trans_time") or tx.get("transactionDate") or tx.get("time") or 
        tx.get("date") or tx.get("created_at") or tx.get("created_time")
    )
    if not raw_time:
        return None
    try:
        if isinstance(raw_time, (int, float)):
            if raw_time > 1e11:
                raw_time = raw_time / 1000.0
            return datetime.fromtimestamp(raw_time, tz=models.VN_TZ)
        if isinstance(raw_time, str):
            raw_time = raw_time.strip()
            if "T" in raw_time:
                cleaned = raw_time.replace("Z", "+00:00")
                return datetime.fromisoformat(cleaned).astimezone(models.VN_TZ)
            for fmt in ("%Y-%m-%d %H:%M:%S", "%d/%m/%Y %H:%M:%S", "%Y/%m/%d %H:%M:%S"):
                try:
                    return datetime.strptime(raw_time, fmt).replace(tzinfo=models.VN_TZ)
                except ValueError:
                    continue
    except Exception:
        pass
    return None


def extract_transaction_details(item):
    tx = item
    if isinstance(item, dict):
        if "data" in item and isinstance(item["data"], dict):
            tx = item["data"].get("transaction") or item["data"]
        elif "transaction" in item and isinstance(item["transaction"], dict):
            tx = item["transaction"]

    trans_id = str(tx.get("trans_id") or tx.get("app_trans_id") or tx.get("transaction_id") or tx.get("id") or "").strip()
    raw_amt = tx.get("transferAmount") or tx.get("trans_amount") or tx.get("amount") or tx.get("charge_amount") or tx.get("subtotal_amount") or tx.get("price") or 0
    try:
        amount = int(abs(float(str(raw_amt).replace(",", "").replace(".", "").replace("đ", "") or 0)))
    except Exception:
        amount = 0

    desc_parts = [
        str(tx.get("description") or ""),
        str(tx.get("trans_note") or ""),
        str(tx.get("title") or ""),
        str(tx.get("remark") or ""),
        str(tx.get("message") or ""),
        str(tx.get("order_info") or ""),
        str(tx.get("content") or ""),
        str(tx.get("comment") or ""),
        str(tx.get("memo") or ""),
        str(tx.get("app_trans_id") or "")
    ]
    tpl = tx.get("template_info") or {}
    if isinstance(tpl, dict):
        cfields = tpl.get("custom_fields") or []
        if isinstance(cfields, list):
            for fld in cfields:
                if isinstance(fld, dict):
                    desc_parts.append(str(fld.get("value") or ""))
                    desc_parts.append(str(fld.get("name") or ""))

    raw_desc = " ".join(desc_parts)
    return trans_id, amount, raw_desc


def match_and_process_transactions(trans_list):
    if not trans_list:
        return []

    db = models.SessionLocal()
    matched_order_ids = []

    try:
        # Get all processed transaction IDs from DB
        processed_db_ids = {r[0] for r in db.query(models.ProcessedTransaction.transaction_id).all()}
        
        # Get active candidate orders (PENDING, EXPIRED within 24h, or PARTIAL_PAID)
        cutoff_time = now_gmt7() - timedelta(hours=24)
        active_orders = db.query(models.Order).filter(
            models.Order.status.in_(["PENDING", "EXPIRED", "PARTIAL_PAID"]),
            models.Order.created_at >= cutoff_time
        ).all()

        for item in trans_list:
            tx = item
            if isinstance(item, dict):
                if "data" in item and isinstance(item["data"], dict):
                    tx = item["data"].get("transaction") or item["data"]
                elif "transaction" in item and isinstance(item["transaction"], dict):
                    tx = item["transaction"]

            trans_id, amount, raw_desc = extract_transaction_details(item)
            s_trans_id = str(trans_id).strip()

            # TẦNG 1: Hardcoded / Seeded Idempotency Lock
            if not s_trans_id or s_trans_id in KNOWN_PROCESSED_TRANSACTIONS or s_trans_id in processed_db_ids or models.is_transaction_processed(s_trans_id):
                continue

            # TẦNG 4: Bộ lọc thời gian giao dịch (Chỉ xử lý trong vòng 60 phút gần nhất)
            tx_time = parse_trans_time(tx)
            if tx_time:
                diff_sec = (now_gmt7() - tx_time).total_seconds()
                if diff_sec > 3600:
                    logger.info(f"[Tier 4 Time Window] Bỏ qua giao dịch cũ {s_trans_id} phát sinh {int(diff_sec/60)} phút trước (> 60 phút).")
                    continue

            clean_desc = clean_transaction_description(raw_desc)
            if not clean_desc:
                continue

            matched_this_item = False
            for order in active_orders:
                oid = order.order_id.upper()
                clean_oid = re.sub(r'[^A-Z0-9]', '', oid)

                # TẦNG 3: Kiểm tra trạng thái đơn hàng & cờ đã thông báo trước khi xử lý
                if order.status in ("paid", "completed", "PAID", "COMPLETED") or getattr(order, "is_notified", False) is True:
                    logger.info(f"[Tier 3 Order Check] Đơn #{oid} đã được xử lý thanh toán trước đó (status={order.status}, is_notified={getattr(order, 'is_notified', False)}). Bỏ qua gửi Telegram.")
                    continue

                # Regex bóc tách mã đơn chuẩn hóa: Prefix (CS, LK, TT, PR) + 4-10 ký tự [A-Z0-9]
                extracted_oids = [m.group(0).upper() for m in re.finditer(r'(CS|LK|TT|PR)[A-Z0-9]{4,10}', raw_desc, re.IGNORECASE)]
                is_matched = bool((oid in extracted_oids) or (clean_oid in extracted_oids))

                if is_matched:
                    matched_this_item = True
                    expected_amount = order.amount
                    
                    if amount >= expected_amount:
                        # Full payment - Atomic update (Chỉ update khi PENDING/EXPIRED/PARTIAL_PAID và chưa notified)
                        affected = db.query(models.Order).filter(
                            models.Order.order_id == oid,
                            models.Order.status.in_(["PENDING", "EXPIRED", "PARTIAL_PAID"]),
                            or_(models.Order.is_notified == False, models.Order.is_notified.is_(None))
                        ).update({
                            "status": "PAID",
                            "is_notified": True,
                            "bank_trans_id": s_trans_id,
                            "paid_at": now_gmt7()
                        }, synchronize_session=False)

                        # Ghi nhận ngay transaction_id đã xử lý bất kể affected (idempotent lock)
                        db.commit()
                        models.record_processed_transaction(
                            trans_id=s_trans_id,
                            amount=amount,
                            description=raw_desc[:500],
                            bank_name="BVBank - ZaloPay (99ZP24261M43061759)",
                            matched_order_id=oid
                        )
                        KNOWN_PROCESSED_TRANSACTIONS.add(s_trans_id)
                        processed_db_ids.add(s_trans_id)

                        if affected == 1:
                            matched_order_ids.append(oid)

                            # TẦNG 3: Gửi Telegram đúng 1 lần duy nhất
                            order_dict = order.to_dict()
                            order_dict["status"] = "PAID"
                            order_dict["is_notified"] = True

                            notify_payment_success(order_dict, s_trans_id)

                            # Cập nhật cờ và trạng thái chắc chắn
                            order.is_notified = True
                            order.status = "PAID"
                            db.commit()

                            # Trigger respective automated partner fulfillment
                            stype = order.service_type
                            if stype == "chungsuc" or oid.startswith("CS"):
                                autonhanh_process_order(order_dict)
                            elif stype == "locket" or oid.startswith("LK"):
                                clean_u = re.sub(r"[^A-Za-z0-9_.-]", "", str(order.username or "").lstrip("@")) or "VIP"
                                # Update Locket specific links
                                db.query(models.Order).filter_by(order_id=oid).update({
                                    "status": "COMPLETED",
                                    "partner_status": "SUCCESS",
                                    "dns_link": f"/download-config?u={clean_u}",
                                    "module_link": LOCKET_SHADOW_MODULE_URL
                                })
                                db.commit()
                                queue_manager.add_to_queue(order.username, order.package_type or "with_dns", order_id=oid)
                            elif stype == "mxh" or oid.startswith("TT"):
                                tangtim_process_order(order_dict)
                    
                    elif 0 < amount < expected_amount:
                        # Partial payment
                        db.query(models.Order).filter_by(order_id=oid).update({
                            "status": "PARTIAL_PAID",
                            "bank_trans_id": s_trans_id,
                            "paid_at": now_gmt7()
                        }, synchronize_session=False)
                        db.commit()
                        from services.telegram_bot import send_telegram_msg
                        send_telegram_msg(
                            f"⚠️ <b>[CẢNH BÁO CHUYỂN THIẾU TIỀN]</b>\n"
                            f"━━━━━━━━━━━━━━━━━━\n"
                            f"• Mã đơn: <b>#{oid}</b>\n"
                            f"• Dịch vụ: <b>{order.package_name}</b>\n"
                            f"• Số tiền cần chuyển: <b>{expected_amount:,}đ</b>\n"
                            f"• Số tiền ĐÃ chuyển: <b>{amount:,}đ</b> (Thiếu: {expected_amount - amount:,}đ)\n"
                            f"• Số Zalo khách: <code>{order.zalo or 'Không có'}</code>\n"
                            f"• Mã giao dịch: <code>{s_trans_id}</code>\n"
                            f"• Nội dung: <i>{raw_desc[:200]}</i>\n"
                            f"━━━━━━━━━━━━━━━━━━\n"
                            f"👉 Vui lòng liên hệ khách hoặc xử lý thủ công!"
                        )

            if not matched_this_item and amount > 0:
                unmatched_existing = db.query(models.UnmatchedTransaction).filter_by(trans_id=s_trans_id).first()
                if not unmatched_existing:
                    db.add(models.UnmatchedTransaction(
                        trans_id=s_trans_id,
                        amount=amount,
                        description=raw_desc[:500],
                        bank_name="BVBank - ZaloPay (99ZP24261M43061759)",
                        trans_time=now_gmt7(),
                        status="PENDING"
                    ))
                    db.commit()

        # Check for expired pending orders (> 15 minutes)
        expire_cutoff = now_gmt7() - timedelta(minutes=15)
        db.query(models.Order).filter(
            models.Order.status == "PENDING",
            models.Order.created_at < expire_cutoff
        ).update({"status": "EXPIRED"}, synchronize_session=False)
        db.commit()

    except Exception as e:
        db.rollback()
        logger.error(f"[match_and_process_transactions Error] {e}")
    finally:
        db.close()

    return matched_order_ids


def fetch_and_sync_zalopay_bank(force=False):
    """
    Quét API ZaloPay/BVBank qua thueapibank.vn có kiểm soát cooldown và rate limit an toàn.
    Tự động khớp đơn hàng PENDING trong cơ sở dữ liệu ACID.
    """
    global _last_bank_fetch, _rate_limit_until
    now = time.time()

    if now < _rate_limit_until and not force:
        return {"status": "rate_limited", "wait_seconds": int(_rate_limit_until - now)}

    if (now - _last_bank_fetch < 10) and not force:
        return {"status": "skipped", "msg": "Cooldown 10s active"}

    cfg = config_manager.load_config()
    pay_cfg = cfg.get("payment", {})
    tapi = pay_cfg.get("thueapibank", {})
    if not tapi.get("enabled", True):
        return {"status": "disabled", "msg": "Quét ngân hàng tự động đang tắt"}

    api_token = tapi.get("token") or "498705aae1752f7c0658c6f622317daf"
    api_url = f"https://thueapibank.vn/historyapizalopay/{api_token}"

    try:
        r = requests.get(
            api_url,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) DTH-BankSync/2.0"},
            timeout=10
        )
        _last_bank_fetch = now

        if r.status_code == 429:
            _rate_limit_until = now + 60
            return {"status": "rate_limited", "msg": "429 backoff 60s"}

        if r.status_code == 200:
            data = r.json()
            trans_list = []
            if isinstance(data, dict):
                trans_list = data.get("data") or data.get("transactions") or data.get("records") or []
                if isinstance(trans_list, dict):
                    trans_list = list(trans_list.values())
            elif isinstance(data, list):
                trans_list = data

            matched = match_and_process_transactions(trans_list)
            return {"status": "success", "matched": matched, "count": len(trans_list)}

        return {"status": "error", "http_code": r.status_code}

    except Exception as e:
        return {"status": "error", "error": str(e)}


def check_bank_transactions(force=False):
    """Kiểm tra đối soát biến động ngân hàng tự động (alias cho fetch_and_sync_zalopay_bank)."""
    return fetch_and_sync_zalopay_bank(force=force)


def check_mbbank_transactions(force=False):
    """Kiểm tra đối soát MBBank / BVBank tự động."""
    return fetch_and_sync_zalopay_bank(force=force)
