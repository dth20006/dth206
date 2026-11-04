import re
import time
import requests
from datetime import datetime, timedelta
from sqlalchemy import or_
from config_manager import config_manager
import models
from utils import now_gmt7
from services.telegram_bot import notify_payment_success
from services.partners import autonhanh_process_order, tangtim_process_order, queue_manager

LOCKET_SHADOW_MODULE_URL = "https://raw.githubusercontent.com/dth20006/shadow/main/dth.sgmodule"

_last_bank_fetch = 0
_rate_limit_until = 0

def clean_transaction_description(desc):
    if not desc:
        return ""
    # Strip everything except uppercase alphanumeric
    return re.sub(r'[^A-Z0-9]', '', str(desc).upper())

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
            trans_id, amount, raw_desc = extract_transaction_details(item)
            if not trans_id or trans_id in processed_db_ids or models.is_transaction_processed(trans_id):
                continue

            clean_desc = clean_transaction_description(raw_desc)
            if not clean_desc:
                continue

            matched_this_item = False
            for order in active_orders:
                oid = order.order_id.upper()
                clean_oid = re.sub(r'[^A-Z0-9]', '', oid)
                pass

                # Regex bóc tách mã đơn chuẩn hóa: Prefix (CS, LK, TT, PR) + 4-10 ký tự [A-Z0-9]
                extracted_oids = [m.group(0).upper() for m in re.finditer(r'\b(CS|LK|TT|PR)[A-Z0-9]{4,10}\b', raw_desc, re.IGNORECASE)]

                is_matched = bool((oid in extracted_oids) or (clean_oid in extracted_oids))




                if is_matched:
                    matched_this_item = True
                    expected_amount = order.amount
                    
                    if amount >= expected_amount:
                        # Full payment - Atomic update (Chỉ update khi PENDING/EXPIRED/PARTIAL_PAID)
                        affected = db.query(models.Order).filter(
                            models.Order.order_id == oid,
                            models.Order.status.in_(["PENDING", "EXPIRED", "PARTIAL_PAID"]),
                            or_(models.Order.is_notified == False, models.Order.is_notified.is_(None))
                        ).update({
                            "status": "PAID",
                            "is_notified": True,
                            "bank_trans_id": trans_id,
                            "paid_at": now_gmt7()
                        })

                        # Ghi nhận ngay transaction_id đã xử lý bất kể affected (idempotent lock)
                        db.commit()
                        models.record_processed_transaction(
                            trans_id=trans_id,
                            amount=amount,
                            description=raw_desc[:500],
                            bank_name="BVBank - ZaloPay (99ZP24261M43061759)",
                            matched_order_id=oid
                        )
                        processed_db_ids.add(trans_id)

                        if affected == 1:
                            matched_order_ids.append(oid)

                            # Send Telegram notification (guaranteed single execution)
                            order_dict = order.to_dict()
                            order_dict["status"] = "PAID"
                            order_dict["is_notified"] = True
                            notify_payment_success(order_dict, trans_id)

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
                            "bank_trans_id": trans_id,
                            "paid_at": now_gmt7()
                        })
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
                            f"• Mã giao dịch: <code>{trans_id}</code>\n"
                            f"• Nội dung: <i>{raw_desc[:200]}</i>\n"
                            f"━━━━━━━━━━━━━━━━━━\n"
                            f"👉 Vui lòng liên hệ khách hoặc xử lý thủ công!"
                        )

            if not matched_this_item and amount > 0:
                unmatched_existing = db.query(models.UnmatchedTransaction).filter_by(trans_id=trans_id).first()
                if not unmatched_existing:
                    db.add(models.UnmatchedTransaction(
                        trans_id=trans_id,
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
        ).update({"status": "EXPIRED"})
        db.commit()

    except Exception as e:
        db.rollback()
        print(f"[match_and_process_transactions Error] {e}")
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

