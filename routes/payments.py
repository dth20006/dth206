import os
from flask import Blueprint, request, jsonify
from config_manager import config_manager
import models
from services.bank import match_and_process_transactions, fetch_and_sync_zalopay_bank

payments_bp = Blueprint("payments_bp", __name__)

@payments_bp.route("/api/webhook/bank", methods=["GET", "POST"])
@payments_bp.route("/api/webhook/thueapibank", methods=["GET", "POST"])
def webhook_bank_receiver():
    """
    Webhook thời gian thực nhận biến động số dư từ ThueApiBank / SePay / Casso / Ngân hàng.
    Đọc ghi thống nhất qua models.SessionLocal() (Database Single Source of Truth).
    """
    payload = request.get_json(silent=True) or request.form.to_dict() or request.args.to_dict() or {}
    trans_list = []
    if isinstance(payload, list):
        trans_list = payload
    elif isinstance(payload, dict):
        if "data" in payload and isinstance(payload["data"], list):
            trans_list = payload["data"]
        elif payload:
            trans_list = [payload]

    # Kiểm tra Idempotency tuyệt đối: Lọc bỏ ngay toàn bộ transaction_id đã xử lý
    from services.bank import extract_transaction_details
    valid_trans = []
    for t in trans_list:
        t_id, _, _ = extract_transaction_details(t)
        if t_id and models.is_transaction_processed(t_id):
            continue
        valid_trans.append(t)

    if trans_list and not valid_trans:
        return jsonify({"status": "already_processed", "success": True, "count": 0}), 200

    matched_ids = match_and_process_transactions(valid_trans)
    if not matched_ids and not trans_list:
        # Nếu payload rỗng hoặc là ping webhook, kích hoạt quét bank có cooldown an toàn (force=False)
        sync_res = fetch_and_sync_zalopay_bank(force=False)
        if isinstance(sync_res, dict):
            matched_ids = sync_res.get("matched", [])

    return jsonify({
        "success": True,
        "status": "ok",
        "matched": matched_ids,
        "matched_orders": matched_ids,
        "count": len(matched_ids)
    })


def execute_unified_cron(force_bank=False):
    """
    Unified Cron 24/7 đối soát ngân hàng và đồng bộ hệ thống:
    Đọc ghi thống nhất qua models.SessionLocal() (Database Single Source of Truth).
    """
    # 1. Quét ngân hàng tự động (ZaloPay BVBank via ThueAPIBank)
    bank_res = fetch_and_sync_zalopay_bank(force=force_bank)

    # 2. Tự động đẩy các đơn đủ điều kiện sang web mẹ
    pushed = []
    db = models.SessionLocal()
    try:
        from services.partners import autonhanh_process_order, tangtim_process_order, queue_manager, LOCKET_SHADOW_MODULE_URL
        from utils import clean_locket_username

        eligible_orders = db.query(models.Order).filter(
            models.Order.status.in_(["PAID", "PROCESSING"])
        ).all()

        for order in eligible_orders:
            oid = order.order_id
            stype = order.service_type
            if (stype == "chungsuc" or oid.startswith("CS")) and not order.partner_order_id:
                ok, res = autonhanh_process_order(order.to_dict())
                if ok:
                    pushed.append(oid)
            elif (stype == "mxh" or oid.startswith("TT")) and not order.partner_order_id:
                ok, res = tangtim_process_order(order.to_dict())
                if ok:
                    pushed.append(oid)
            elif (stype == "locket" or oid.startswith("LK")) and order.status != "COMPLETED":
                clean_u = clean_locket_username(order.username) or "VIP"
                order.status = "COMPLETED"
                order.partner_status = "SUCCESS"
                order.dns_link = f"/download-config?u={clean_u}"
                order.module_link = LOCKET_SHADOW_MODULE_URL
                db.commit()
                queue_manager.add_to_queue(order.username, order.package_type or "with_dns", order_id=oid)
                pushed.append(oid)

        # 3. Thống kê tổng hợp trực tiếp từ DB
        total = db.query(models.Order).count()
        completed = db.query(models.Order).filter_by(status="COMPLETED").count()
        processing = db.query(models.Order).filter_by(status="PROCESSING").count()
        pending = db.query(models.Order).filter_by(status="PENDING").count()
        paid = db.query(models.Order).filter_by(status="PAID").count()
    except Exception as e:
        print(f"[execute_unified_cron Error] {e}")
        total = completed = processing = pending = paid = 0
    finally:
        db.close()

    return {
        "success": True,
        "message": "Unified Cron executed successfully",
        "timestamp": models.now_gmt7().strftime("%Y-%m-%d %H:%M:%S"),
        "bank_scan": bank_res,
        "auto_pushed": pushed,
        "stats": {
            "total_orders": total,
            "completed": completed,
            "processing": processing,
            "pending": pending,
            "paid": paid
        }
    }


@payments_bp.route("/api/cron/sync-bank", methods=["GET", "POST"])
@payments_bp.route("/api/cron/sync", methods=["GET", "POST"])
@payments_bp.route("/api/cron", methods=["GET", "POST"])
@payments_bp.route("/cron", methods=["GET", "POST"])
@payments_bp.route("/cron.php", methods=["GET", "POST"])
@payments_bp.route("/api/cron.php", methods=["GET", "POST"])
@payments_bp.route("/api/cron/bank", methods=["GET", "POST"])
@payments_bp.route("/cron/bank", methods=["GET", "POST"])
def cron_bank_sync():
    """
    Cron đối soát ngân hàng ngầm có Cooldown an toàn.
    """
    result = execute_unified_cron(force_bank=True)
    return jsonify(result)


@payments_bp.route("/api/order/confirm-paid", methods=["POST"])
@payments_bp.route("/api/payment/confirm", methods=["POST"])
def client_confirm_paid():
    """
    Nút '🔄 Tôi đã chuyển khoản - Kiểm tra ngay' (có cooldown 5s từ client).
    Đọc ghi thống nhất qua models.SessionLocal() (Database Single Source of Truth).
    """
    data = request.get_json(silent=True) or {}
    order_id = str(data.get("order_id") or "").strip().upper()

    db = models.SessionLocal()
    try:
        order = db.query(models.Order).filter_by(order_id=order_id).first()
        if not order:
            return jsonify({"success": False, "msg": "Không tìm thấy mã đơn hàng."}), 404

        if order.status in ("PAID", "PROCESSING", "COMPLETED"):
            return jsonify({
                "success": True,
                "is_paid": True,
                "status": order.status,
                "order": order.sanitize_for_client(exact_match=True)
            })

        # Trigger quick bank sync (force=True khi khách bấm trực tiếp)
        fetch_and_sync_zalopay_bank(force=True)
        db.refresh(order)

        is_paid = order.status in ("PAID", "PROCESSING", "COMPLETED")
        return jsonify({
            "success": True,
            "is_paid": is_paid,
            "status": order.status,
            "order": order.sanitize_for_client(exact_match=True)
        })
    finally:
        db.close()
