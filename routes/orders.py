import os
import re
import time
import json
import secrets
import urllib.parse
from datetime import timedelta
import requests
from flask import Blueprint, request, jsonify, make_response, send_file, current_app
from config_manager import config_manager
import models
from utils import (
    now_gmt7, format_currency_vnd, round_price_vnd, generate_order_id,
    clean_locket_username, extract_invite_code, clean_mxh_link, mask_phone,
    extract_social_uid, generate_signed_url, verify_hmac_download_token,
    generate_hmac_video_token, verify_hmac_video_token, HMAC_SECRET_KEY
)
from services.telegram_bot import notify_new_order
from services.bank import fetch_and_sync_zalopay_bank

orders_bp = Blueprint("orders_bp", __name__)

# In-memory IP rate limiter for order creation: max 5 orders / 60 seconds / IP
_order_ip_tracker = {}

def get_client_ip():
    """Lấy IP chuẩn từ Header Cloudflare / Reverse Proxy hoặc Remote Addr."""
    cf_ip = request.headers.get("CF-Connecting-IP")
    if cf_ip:
        return cf_ip.strip()
    x_forwarded = request.headers.get("X-Forwarded-For")
    if x_forwarded:
        return x_forwarded.split(",")[0].strip()
    return request.remote_addr or "127.0.0.1"

def check_order_rate_limit(client_ip):
    """Giới hạn tối đa 5 đơn/phút/IP."""
    now_ts = time.time()
    history = _order_ip_tracker.get(client_ip, [])
    # Keep timestamps within 60 seconds
    history = [t for t in history if now_ts - t < 60]
    if len(history) >= 5:
        _order_ip_tracker[client_ip] = history
        return False
    history.append(now_ts)
    _order_ip_tracker[client_ip] = history
    return True

def verify_turnstile(token, client_ip):
    """
    Xác thực Cloudflare Turnstile token nếu được gửi lên.
    Nếu hệ thống chưa cấu hình secret key, bỏ qua an toàn (return True).
    """
    if not token:
        return True
    cfg = config_manager.load_config()
    secret = os.environ.get("CF_TURNSTILE_SECRET_KEY") or cfg.get("security", {}).get("cf_turnstile_secret")
    if not secret:
        return True
    try:
        resp = requests.post(
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
            data={
                "secret": secret,
                "response": token,
                "remoteip": client_ip
            },
            timeout=4
        )
        data = resp.json()
        return bool(data.get("success", False))
    except Exception as e:
        print(f"[verify_turnstile Warning] {e}")
        return True

def check_service_active(service_key):
    db = models.SessionLocal()
    try:
        cfg = db.query(models.ServiceConfig).filter_by(service_key=service_key).first()
        if cfg and not cfg.is_active:
            return False, cfg.maintenance_msg or f"Dịch vụ {service_key.upper()} đang tạm bảo trì."
        return True, None
    finally:
        db.close()

@orders_bp.route("/api/order/create", methods=["POST"])
def create_order():
    data = request.get_json(silent=True) or {}
    client_ip = get_client_ip()

    # 1. Rate Limiting (5 đơn / phút / IP)
    if not check_order_rate_limit(client_ip):
        return jsonify({
            "success": False,
            "msg": "Bạn đang tạo đơn quá nhanh (tối đa 5 đơn/phút). Vui lòng đợi trong giây lát!"
        }), 429

    # 2. Cloudflare Turnstile Verification
    turnstile_token = data.get("cf-turnstile-response") or data.get("turnstile_token")
    if not verify_turnstile(turnstile_token, client_ip):
        return jsonify({
            "success": False,
            "msg": "Xác thực bảo mật Turnstile thất bại. Vui lòng thử lại!"
        }), 400

    # 3. Detect service type
    if "invite_code" in data or "code" in data or ("package_id" in data and "username" not in data and "service_id" not in data and "platform" not in data):
        service_type = "chungsuc"
    elif "service_id" in data:
        service_type = "mxh"
    elif "platform" in data:
        service_type = "premium"
    else:
        service_type = "locket"

    # 4. Check Blacklist (IP & Phone)
    zalo_raw = (data.get("zalo") or data.get("phone") or "").strip()
    is_blocked, block_reason = models.is_blacklisted(ip=client_ip, phone=zalo_raw)
    if is_blocked:
        return jsonify({"success": False, "msg": f"Truy cập bị từ chối: {block_reason}"}), 403

    # 5. Anti-spam auto blacklist detection (>= 10 unpaid consecutive orders)
    db = models.SessionLocal()
    try:
        unpaid_orders_count = db.query(models.Order).filter(
            models.Order.extra_data.like(f"%{client_ip}%"),
            models.Order.status.in_(["PENDING", "EXPIRED", "CANCELLED"])
        ).count()
        paid_orders_count = db.query(models.Order).filter(
            models.Order.extra_data.like(f"%{client_ip}%"),
            models.Order.status.in_(["PAID", "PROCESSING", "COMPLETED"])
        ).count()
        if unpaid_orders_count >= 10 and paid_orders_count == 0:
            models.add_to_blacklist("ip", client_ip, "Tạo quá 10 đơn ảo liên tiếp không thanh toán")
            return jsonify({
                "success": False,
                "msg": "IP của bạn đã bị đưa vào danh sách đen do tạo quá 10 đơn ảo không thanh toán (403 Forbidden)."
            }), 403
    finally:
        db.close()

    # 6. Check service enabled status in Database
    is_active, msg = check_service_active(service_type)
    if not is_active:
        return jsonify({"success": False, "msg": msg}), 403

    cfg = config_manager.load_config()
    pay_cfg = cfg.get("payment", {})
    bank_id = pay_cfg.get("bank_id", "970454")
    acc_no = pay_cfg.get("account_number", "99ZP24261M43061759")
    acc_name = pay_cfg.get("account_name", "ZALOPAY_DINH TUAN HUNG")

    # 7. Check VIP Tier for Phone / Zalo
    vip_info = models.get_vip_tier(zalo_raw)
    vip_pct = int(vip_info.get("discount_percent", 0))

    # 8. Process according to service type with SERVER-SIDE PRICE CALCULATION
    if service_type == "chungsuc":
        raw_code = (data.get("code") or data.get("invite_code") or "").strip()
        package_id = (data.get("package_id") or "full_3_ruong").strip()
        zalo = zalo_raw
        try:
            custom_packs = int(data.get("custom_packs") or 4)
            if custom_packs < 1:
                return jsonify({"success": False, "msg": "Số lượng gói tùy chọn phải từ 4 trở lên."}), 400
        except (ValueError, TypeError):
            return jsonify({"success": False, "msg": "Số lượng gói không hợp lệ."}), 400

        clean_code = extract_invite_code(raw_code)
        if not clean_code or len(clean_code) < 4:
            return jsonify({"success": False, "msg": "Vui lòng nhập đúng mã mời hoặc link chia sẻ Sự Kiện Chung Sức."}), 400

        pkgs = cfg.get("chungsuc_packages", {})
        if package_id not in pkgs:
            return jsonify({"success": False, "msg": "Gói sự kiện không hợp lệ."}), 400

        pkg = pkgs[package_id]
        if package_id == "goi_tuy_chon":
            price_per_pack = int(pkg.get("price_per_pack", 2222))
            turns_per_pack = int(pkg.get("turns_per_pack", 38))
            min_packs = int(pkg.get("min_packs", 4))
            packs = max(min_packs, custom_packs)
            amount = round_price_vnd(packs * price_per_pack, 1000)
            turns = packs * turns_per_pack
            pkg_name = f"Gói Tùy Chọn ({packs} gói • {turns} lượt)"
        else:
            amount = int(pkg.get("price", 20000))
            turns = int(pkg.get("turns", 340))
            pkg_name = pkg.get("name", "Gói Chung Sức")

        # VIP Discount
        if vip_pct > 0:
            discount_amount = int(amount * vip_pct / 100)
            amount = round_price_vnd(amount - discount_amount, 1000)

        # Idempotency Window 15 phút: cùng code / zalo và cùng số tiền
        db_idemp = models.SessionLocal()
        fifteen_mins_ago = now_gmt7() - timedelta(minutes=15)
        try:
            cs_conds = [
                models.Order.service_type == "chungsuc",
                models.Order.status == "PENDING",
                models.Order.created_at >= fifteen_mins_ago,
                models.Order.amount == amount
            ]
            if clean_code:
                cs_conds.append(models.Order.code == clean_code)
            elif zalo:
                cs_conds.append(models.Order.zalo == zalo)
            existing_cs = db_idemp.query(models.Order).filter(*cs_conds).order_by(models.Order.created_at.desc()).first()
            if existing_cs:
                client_res = existing_cs.sanitize_for_client(exact_match=True, token_match=True)
                client_res["vip_tier"] = vip_info.get("tier")
                client_res["vip_discount_percent"] = vip_pct
                return jsonify({
                    "success": True,
                    "order_id": existing_cs.order_id,
                    "amount": existing_cs.amount,
                    "amount_formatted": existing_cs.amount_formatted,
                    "token": existing_cs.token,
                    "vip": vip_info,
                    "order": client_res,
                    "reused": True
                })
        finally:
            db_idemp.close()

        order_id = generate_order_id("CS")
        token = secrets.token_hex(16)
        qr_url = f"https://img.vietqr.io/image/{bank_id}-{acc_no}-compact2.png?amount={amount}&addInfo={order_id}&accountName={acc_name}"

        db_order = models.Order(
            order_id=order_id,
            service_type="chungsuc",
            package_id=package_id,
            package_name=pkg_name,
            amount=amount,
            amount_formatted=format_currency_vnd(amount),
            status="PENDING",
            partner_status="WAITING",
            zalo=zalo,
            code=clean_code,
            raw_code=raw_code,
            token=token,
            qr_url=qr_url,
            quantity=turns,
            extra_data=json.dumps({"ip": client_ip, "vip": vip_info}),
            created_at=now_gmt7(),
            expires_at=now_gmt7() + timedelta(minutes=15)
        )

    elif service_type == "locket":
        val = (data.get("username") or data.get("target_user") or "").strip()
        pkg_type = (data.get("package_type") or "with_dns").strip()
        zalo = zalo_raw
        uid = (data.get("uid") or "").strip()
        avatar = (data.get("avatar") or "").strip()

        username = clean_locket_username(val)
        if not username:
            return jsonify({"success": False, "msg": "Vui lòng nhập Username Locket hợp lệ."}), 400

        # Rate limit UID activation check
        if uid:
            lim_ok, lim_msg = models.check_uid_activation_limit(uid)
            if not lim_ok:
                return jsonify({"success": False, "msg": lim_msg}), 429

        locket_pkgs = cfg.get("locket_packages", {})
        pkg = locket_pkgs.get(pkg_type) or locket_pkgs.get("with_dns") or {}
        amount = int(pkg.get("price", 30000))
        pkg_name = pkg.get("name", "Locket Gold VIP")

        # Flash sale check
        sale = cfg.get("sale_campaign", {})
        if sale.get("enabled", False):
            pct = float(sale.get("discount_percent", 0))
            if 0 < pct < 100:
                amount = round_price_vnd(amount * (100 - pct) / 100, 1000)

        # VIP Discount
        if vip_pct > 0:
            discount_amount = int(amount * vip_pct / 100)
            amount = round_price_vnd(amount - discount_amount, 1000)

        # Idempotency Window 15 phút: cùng username / uid và cùng số tiền
        db_idemp = models.SessionLocal()
        fifteen_mins_ago = now_gmt7() - timedelta(minutes=15)
        try:
            lk_conds = [
                models.Order.service_type == "locket",
                models.Order.status == "PENDING",
                models.Order.created_at >= fifteen_mins_ago,
                models.Order.amount == amount
            ]
            if uid:
                lk_conds.append(models.Order.uid == uid)
            else:
                lk_conds.append(models.Order.username.ilike(username))
            existing_lk = db_idemp.query(models.Order).filter(*lk_conds).order_by(models.Order.created_at.desc()).first()
            if existing_lk:
                client_res = existing_lk.sanitize_for_client(exact_match=True, token_match=True)
                client_res["vip_tier"] = vip_info.get("tier")
                client_res["vip_discount_percent"] = vip_pct
                return jsonify({
                    "success": True,
                    "order_id": existing_lk.order_id,
                    "amount": existing_lk.amount,
                    "amount_formatted": existing_lk.amount_formatted,
                    "token": existing_lk.token,
                    "vip": vip_info,
                    "order": client_res,
                    "reused": True
                })
        finally:
            db_idemp.close()

        order_id = generate_order_id("LK")
        token = secrets.token_hex(16)
        qr_url = f"https://img.vietqr.io/image/{bank_id}-{acc_no}-compact2.png?amount={amount}&addInfo={order_id}&accountName={acc_name}"

        db_order = models.Order(
            order_id=order_id,
            service_type="locket",
            package_id=pkg_type,
            package_type=pkg_type,
            package_name=pkg_name,
            amount=amount,
            amount_formatted=format_currency_vnd(amount),
            status="PENDING",
            partner_status="WAITING",
            zalo=zalo,
            username=username,
            uid=uid,
            avatar_url=avatar,
            token=token,
            qr_url=qr_url,
            extra_data=json.dumps({"ip": client_ip, "vip": vip_info}),
            created_at=now_gmt7(),
            expires_at=now_gmt7() + timedelta(minutes=15)
        )

        # Log UID activation attempt
        if uid:
            models.log_activation(
                uid=uid,
                action_type="order_created",
                ip_address=client_ip,
                user_agent=request.user_agent.string,
                order_id=order_id,
                extra_info=f"Username: @{username}"
            )

    elif service_type == "mxh":
        service_id = data.get("service_id")
        raw_link = (data.get("link") or "").strip()
        zalo = zalo_raw
        try:
            quantity = int(data.get("quantity") or 1000)
            if quantity <= 0:
                return jsonify({"success": False, "msg": "Số lượng phải lớn hơn 0."}), 400
        except (ValueError, TypeError):
            return jsonify({"success": False, "msg": "Số lượng không hợp lệ."}), 400

        link = clean_mxh_link(raw_link)
        if not link:
            return jsonify({"success": False, "msg": "Vui lòng nhập Link hoặc Tên người dùng hợp lệ."}), 400

        # Lọc đơn trùng (Anti-Overlap): Chặn tạo đơn mới nếu link đang có đơn PENDING hoặc PROCESSING
        db_chk = models.SessionLocal()
        try:
            overlap_order = db_chk.query(models.Order).filter(
                models.Order.service_type == "mxh",
                models.Order.link == link,
                models.Order.status.in_(["PENDING", "PROCESSING"])
            ).first()
            if overlap_order:
                return jsonify({
                    "success": False,
                    "msg": "Link này đang có đơn đang chạy (#" + overlap_order.order_id + "), vui lòng chờ đơn cũ hoàn tất!"
                }), 400
        finally:
            db_chk.close()

        services = cfg.get("services", [])
        featured = cfg.get("featured_packages", [])
        all_s = {str(s.get("service_id") or s.get("service")): s for s in services}
        for f in featured:
            all_s[str(f.get("service_id"))] = f

        s_target = all_s.get(str(service_id))
        if not s_target:
            return jsonify({"success": False, "msg": "Dịch vụ mạng xã hội không tồn tại."}), 400

        min_q = int(s_target.get("min") or s_target.get("min_qty") or 10)
        max_q = int(s_target.get("max") or s_target.get("max_qty") or 1000000)
        if quantity < min_q or quantity > max_q:
            return jsonify({"success": False, "msg": f"Số lượng không hợp lệ (Tối thiểu: {min_q:,}, Tối đa: {max_q:,})."}), 400

        unit_p = float(s_target.get("price_per_unit") or s_target.get("unit_price") or 0)
        raw_amt = quantity * unit_p
        amount = round_price_vnd(raw_amt, 1000)
        pkg_name = f"{s_target.get('name', 'Tương tác MXH')} ({quantity:,})"

        # VIP Discount
        if vip_pct > 0:
            discount_amount = int(amount * vip_pct / 100)
            amount = round_price_vnd(amount - discount_amount, 1000)

        # Idempotency Window 15 phút: cùng link và cùng số tiền
        db_idemp = models.SessionLocal()
        fifteen_mins_ago = now_gmt7() - timedelta(minutes=15)
        try:
            existing_mxh = db_idemp.query(models.Order).filter(
                models.Order.service_type == "mxh",
                models.Order.link == link,
                models.Order.status == "PENDING",
                models.Order.created_at >= fifteen_mins_ago,
                models.Order.amount == amount
            ).order_by(models.Order.created_at.desc()).first()
            if existing_mxh:
                client_res = existing_mxh.sanitize_for_client(exact_match=True, token_match=True)
                client_res["vip_tier"] = vip_info.get("tier")
                client_res["vip_discount_percent"] = vip_pct
                return jsonify({
                    "success": True,
                    "order_id": existing_mxh.order_id,
                    "amount": existing_mxh.amount,
                    "amount_formatted": existing_mxh.amount_formatted,
                    "token": existing_mxh.token,
                    "vip": vip_info,
                    "order": client_res,
                    "reused": True
                })
        finally:
            db_idemp.close()

        order_id = generate_order_id("TT")
        token = secrets.token_hex(16)
        qr_url = f"https://img.vietqr.io/image/{bank_id}-{acc_no}-compact2.png?amount={amount}&addInfo={order_id}&accountName={acc_name}"

        db_order = models.Order(
            order_id=order_id,
            service_type="mxh",
            package_id=str(service_id),
            package_name=pkg_name,
            amount=amount,
            amount_formatted=format_currency_vnd(amount),
            status="PENDING",
            partner_status="WAITING",
            zalo=zalo,
            link=link,
            quantity=quantity,
            remains=quantity,
            token=token,
            qr_url=qr_url,
            extra_data=json.dumps({"ip": client_ip, "vip": vip_info, "comments": data.get("comments")}),
            created_at=now_gmt7(),
            expires_at=now_gmt7() + timedelta(minutes=15)
        )

    else: # Premium
        platform = (data.get("platform") or "").strip().lower()
        pkg_id = (data.get("package_id") or "").strip()
        target = (data.get("target") or data.get("email") or "").strip()
        zalo = zalo_raw

        prem_cfg = cfg.get("premium_services", {})
        plat_data = prem_cfg.get(platform)
        if not plat_data:
            return jsonify({"success": False, "msg": "Dịch vụ Premium không tồn tại."}), 400

        packages = plat_data.get("packages", [])
        pkg_obj = next((p for p in packages if str(p.get("id")) == str(pkg_id)), None)
        if not pkg_obj:
            return jsonify({"success": False, "msg": "Gói thời hạn không tồn tại."}), 400

        amount = int(pkg_obj.get("price", 0))
        pkg_name = f"{plat_data.get('name')} - {pkg_obj.get('name')}"

        # VIP Discount
        if vip_pct > 0:
            discount_amount = int(amount * vip_pct / 100)
            amount = round_price_vnd(amount - discount_amount, 1000)

        # Idempotency Window 15 phút: cùng target / platform và cùng số tiền
        db_idemp = models.SessionLocal()
        fifteen_mins_ago = now_gmt7() - timedelta(minutes=15)
        try:
            existing_pr = db_idemp.query(models.Order).filter(
                models.Order.service_type == "premium",
                models.Order.target == target,
                models.Order.status == "PENDING",
                models.Order.created_at >= fifteen_mins_ago,
                models.Order.amount == amount
            ).order_by(models.Order.created_at.desc()).first()
            if existing_pr:
                client_res = existing_pr.sanitize_for_client(exact_match=True, token_match=True)
                client_res["vip_tier"] = vip_info.get("tier")
                client_res["vip_discount_percent"] = vip_pct
                return jsonify({
                    "success": True,
                    "order_id": existing_pr.order_id,
                    "amount": existing_pr.amount,
                    "amount_formatted": existing_pr.amount_formatted,
                    "token": existing_pr.token,
                    "vip": vip_info,
                    "order": client_res,
                    "reused": True
                })
        finally:
            db_idemp.close()

        order_id = generate_order_id("PR")
        token = secrets.token_hex(16)
        qr_url = f"https://img.vietqr.io/image/{bank_id}-{acc_no}-compact2.png?amount={amount}&addInfo={order_id}&accountName={acc_name}"

        db_order = models.Order(
            order_id=order_id,
            service_type="premium",
            package_id=pkg_id,
            package_name=pkg_name,
            amount=amount,
            amount_formatted=format_currency_vnd(amount),
            status="PENDING",
            partner_status="WAITING",
            zalo=zalo,
            target=target,
            token=token,
            qr_url=qr_url,
            extra_data=json.dumps({"ip": client_ip, "vip": vip_info}),
            created_at=now_gmt7(),
            expires_at=now_gmt7() + timedelta(minutes=15)
        )

    # 9. Save to Database
    db = models.SessionLocal()
    try:
        db.add(db_order)
        db.commit()
        db.refresh(db_order)
        order_dict = db_order.to_dict()
    finally:
        db.close()

    # 10. Notify Admin Telegram
    notify_new_order(order_dict)

    client_res = db_order.sanitize_for_client(exact_match=True, token_match=True)
    client_res["vip_tier"] = vip_info.get("tier")
    client_res["vip_discount_percent"] = vip_pct

    res = jsonify({
        "success": True,
        "order_id": db_order.order_id,
        "amount": db_order.amount,
        "amount_formatted": db_order.amount_formatted,
        "token": db_order.token,
        "vip": vip_info,
        "order": client_res
    })
    res.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return res


def enrich_order_with_signed_links(order_obj, client_ip):
    """Bổ sung HMAC Signed Links và Shadowrocket 1-click install link cho đơn đã thanh toán."""
    d = order_obj.sanitize_for_client(exact_match=True)
    if order_obj.status in ("PAID", "PROCESSING", "COMPLETED"):
        uid_val = order_obj.uid or order_obj.username or order_obj.order_id
        signed_module = generate_signed_url("module", uid_val, client_ip)
        signed_config = generate_signed_url("config", uid_val, client_ip)
        
        host_base = request.host_url.rstrip("/")
        full_module_url = f"{host_base}{signed_module}"
        
        d["signed_module_url"] = signed_module
        d["signed_config_url"] = signed_config
        d["shadowrocket_install_url"] = f"shadowrocket://install?module={urllib.parse.quote(full_module_url)}"
        d["shadowrocket_add_url"] = f"shadowrocket://add/module?url={urllib.parse.quote(full_module_url)}"
        v_token = order_obj.token or generate_hmac_video_token(order_obj.order_id)
        d["token"] = order_obj.token
        d["video_token"] = v_token
        d["video_guide_shadowrocket_url"] = f"/api/video/guide?type=shadowrocket&order_id={order_obj.order_id}&token={v_token}"
        d["video_guide_module_url"] = f"/api/video/guide?type=module&order_id={order_obj.order_id}&token={v_token}"
    return d


@orders_bp.route("/api/orders/<order_id>/status", methods=["GET"])
@orders_bp.route("/api/payment/check/<order_id>", methods=["GET"])
@orders_bp.route("/api/payment/check", methods=["GET"])
def check_order_status(order_id=None):
    if not order_id:
        order_id = request.args.get("order_id") or request.args.get("orderId") or ""
    oid = str(order_id).strip().upper()
    if not oid:
        return jsonify({"success": False, "msg": "Thiếu mã đơn hàng."}), 400

    client_ip = get_client_ip()
    db = models.SessionLocal()
    try:
        order = db.query(models.Order).filter_by(order_id=oid).first()
        if not order:
            return jsonify({"success": False, "msg": "Không tìm thấy mã đơn hàng."}), 404

        # Khi khách đang mở trang chờ thanh toán: tự động kích hoạt kiểm tra ngân hàng ngầm
        if order.status in ("PENDING", "PARTIAL_PAID"):
            try:
                fetch_and_sync_zalopay_bank(force=False)
                db.refresh(order)
            except Exception as ex_sync:
                print(f"[check_order_status sync error] {ex_sync}")

        # Lazy expire check
        if order.status == "PENDING" and order.expires_at and now_gmt7() > order.expires_at:
            order.status = "EXPIRED"
            db.commit()

        is_paid = order.status in ("PAID", "PROCESSING", "COMPLETED")
        client_order = enrich_order_with_signed_links(order, client_ip)

        res = jsonify({
            "success": True,
            "status": order.status,
            "partner_status": order.partner_status,
            "is_paid": is_paid,
            "paid_at": order.paid_at.strftime("%Y-%m-%d %H:%M:%S") if order.paid_at else None,
            "order": client_order
        })
        res.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        return res
    finally:
        db.close()


@orders_bp.route("/api/order/lookup", methods=["GET", "POST"])
def lookup_orders():
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        q = (data.get("query") or data.get("order_id") or data.get("keyword") or "").strip()
    else:
        q = (request.args.get("query") or request.args.get("order_id") or request.args.get("q") or "").strip()

    if not q:
        return jsonify({"success": False, "msg": "Vui lòng nhập Mã đơn hàng hoặc Số Zalo chính xác để tra cứu."}), 400

    client_ip = get_client_ip()
    q_clean = q.upper()
    q_digits = re.sub(r'\D', '', q)
    is_exact_phone = bool(re.match(r'^0\d{9}$', q_digits))

    db = models.SessionLocal()
    try:
        matched = []
        if is_exact_phone:
            matched = db.query(models.Order).filter(models.Order.zalo == q_digits).order_by(models.Order.created_at.desc()).limit(15).all()
        else:
            order = db.query(models.Order).filter(models.Order.order_id == q_clean).first()
            if order:
                matched = [order]
            elif len(q) >= 3:
                clean_u = clean_locket_username(q)
                matched = db.query(models.Order).filter(
                    models.Order.service_type == "locket",
                    (models.Order.username.ilike(clean_u)) | (models.Order.uid == q)
                ).order_by(models.Order.created_at.desc()).limit(10).all()

        # Filter out deleted orders
        try:
            from app import get_deleted_order_ids
            deleted_ids = get_deleted_order_ids()
            matched = [o for o in matched if str(o.order_id).strip().upper() not in deleted_ids]
        except Exception:
            pass

        if not matched:
            return jsonify({
                "success": True,
                "orders": [],
                "results": [],
                "msg": "Không tìm thấy đơn hàng nào khớp chính xác. Hãy kiểm tra lại mã đơn hoặc số điện thoại (10 số)."
            })

        # Realtime sync SMM orders from partner web mẹ
        for o in matched:
            if o.service_type == "mxh" or o.order_id.startswith("TT") or o.status in ("PROCESSING", "PAID"):
                try:
                    from services.partners import sync_smm_order_live
                    sync_smm_order_live(o, db=db, force=True)
                except Exception as ex_sync:
                    print(f"[lookup sync error] {ex_sync}")
        db.commit()

        if is_exact_phone:
            # Tra cứu bằng SĐT Zalo chỉ xem danh sách tóm tắt (Mã che một phần LK-***123).
            # Bắt buộc nhập Mã đơn đầy đủ mới trả về link Module Shadowrocket VIP, DNS Profile và Video VIP.
            summary_results = []
            for o in matched:
                oid = str(o.order_id).strip().upper()
                if len(oid) > 5:
                    masked_id = f"{oid[:2]}-***{oid[-3:]}"
                else:
                    masked_id = f"***{oid[-2:]}"
                summary_results.append({
                    "order_id": masked_id,
                    "service_type": o.service_type,
                    "package_name": o.package_name,
                    "amount": o.amount,
                    "amount_formatted": o.amount_formatted,
                    "status": o.status,
                    "partner_status": o.partner_status,
                    "created_at": o.created_at.strftime("%Y-%m-%d %H:%M:%S") if o.created_at else None,
                    "paid_at": o.paid_at.strftime("%Y-%m-%d %H:%M:%S") if o.paid_at else None,
                    "is_summary": True,
                    "requires_full_id": True,
                    "note": "Nhập chính xác Mã đơn hàng đầy đủ để lấy link tải DNS / Module VIP và Video hướng dẫn!"
                })
            res = jsonify({
                "success": True,
                "orders": summary_results,
                "results": summary_results,
                "is_phone_summary": True
            })
            res.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            return res

        results = [enrich_order_with_signed_links(o, client_ip) for o in matched]
        res = jsonify({"success": True, "orders": results, "results": results})
        res.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        return res
    finally:
        db.close()


@orders_bp.route("/api/order/sync-progress/<order_id>", methods=["GET", "POST"])
def sync_order_progress(order_id):
    oid = str(order_id).strip().upper()
    client_ip = get_client_ip()
    db = models.SessionLocal()
    try:
        order = db.query(models.Order).filter_by(order_id=oid).first()
        if not order:
            return jsonify({"success": False, "msg": "Không tìm thấy mã đơn hàng."}), 404

        from services.partners import sync_smm_order_live
        sync_smm_order_live(order, db=db, force=True)
        db.commit()
        db.refresh(order)

        client_order = enrich_order_with_signed_links(order, client_ip)
        res = jsonify({"success": True, "order": client_order})
        res.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        return res
    finally:
        db.close()


@orders_bp.route("/api/order/review", methods=["POST"])
def submit_review():
    data = request.get_json(silent=True) or {}
    order_id = str(data.get("order_id") or "").strip().upper()
    try:
        rating = int(data.get("rating") or 5)
        rating = max(1, min(5, rating))
    except (ValueError, TypeError):
        rating = 5
    comment = str(data.get("comment") or "").strip()[:500]

    db = models.SessionLocal()
    try:
        order = db.query(models.Order).filter_by(order_id=order_id).first()
        if not order:
            return jsonify({"success": False, "msg": "Không tìm thấy đơn hàng."}), 404

        order.rating = rating
        order.review_comment = comment

        rev = models.Review(
            order_id=order_id,
            service_type=order.service_type,
            rating=rating,
            comment=comment,
            customer_name=mask_phone(order.zalo) if order.zalo else "Khách Hàng VIP"
        )
        db.add(rev)
        db.commit()
        return jsonify({"success": True, "msg": "Cảm ơn bạn đã gửi đánh giá!"})
    finally:
        db.close()


# ========================================================
# HMAC SIGNED DOWNLOAD ROUTES & PROTECTED MODULE/DNS
# ========================================================
@orders_bp.route("/api/download/module")
def download_hmac_signed_module():
    """
    Route Backend tải Module Shadowrocket với chữ ký HMAC:
    ?token=...&expires=...&uid=...
    Kiểm tra IP, thời hạn 10 phút và tối đa 3 lần tải.
    """
    token = request.args.get("token") or ""
    expires = request.args.get("expires") or ""
    uid = request.args.get("uid") or ""
    client_ip = get_client_ip()

    is_valid, reason = verify_hmac_download_token(uid, expires, client_ip, token)
    if not is_valid:
        return jsonify({"success": False, "msg": f"Từ chối truy cập: {reason}"}), 403

    # Check download count limit (max 3 times within 10 minutes)
    db = models.SessionLocal()
    try:
        cutoff = now_gmt7() - timedelta(minutes=10)
        dl_count = db.query(models.ActivationLog).filter(
            models.ActivationLog.uid == str(uid).strip(),
            models.ActivationLog.action_type == "download_module",
            models.ActivationLog.timestamp >= cutoff
        ).count()

        if dl_count >= 3:
            return jsonify({
                "success": False,
                "msg": "Link tải này đã đạt giới hạn tối đa 3 lần tải. Vui lòng tra cứu lại đơn để nhận link mới!"
            }), 403
    finally:
        db.close()

    # Log download action
    models.log_activation(
        uid=uid,
        action_type="download_module",
        ip_address=client_ip,
        user_agent=request.user_agent.string,
        extra_info=f"Download attempt #{dl_count + 1}"
    )

    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    static_module = os.path.join(base_dir, "static", "dth.sgmodule")
    root_module = os.path.join(base_dir, "dth.sgmodule")
    target_file = static_module if os.path.exists(static_module) else root_module

    if os.path.exists(target_file):
        response = make_response(send_file(target_file, mimetype="text/plain", as_attachment=False))
        response.headers["Content-Disposition"] = 'inline; filename="dth.sgmodule"'
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        return response

    return "https://raw.githubusercontent.com/dth20006/shadow/main/dth.sgmodule", 200, {"Content-Type": "text/plain"}


@orders_bp.route("/api/download/config")
def download_hmac_signed_config():
    """
    Route Backend tải DNS Config .mobileconfig với chữ ký HMAC:
    ?token=...&expires=...&uid=...
    Kiểm tra IP, thời hạn 10 phút và tối đa 3 lần tải.
    """
    token = request.args.get("token") or ""
    expires = request.args.get("expires") or ""
    uid = request.args.get("uid") or ""
    client_ip = get_client_ip()

    is_valid, reason = verify_hmac_download_token(uid, expires, client_ip, token)
    if not is_valid:
        return jsonify({"success": False, "msg": f"Từ chối truy cập: {reason}"}), 403

    # Check download count limit (max 3 times within 10 minutes)
    db = models.SessionLocal()
    try:
        cutoff = now_gmt7() - timedelta(minutes=10)
        dl_count = db.query(models.ActivationLog).filter(
            models.ActivationLog.uid == str(uid).strip(),
            models.ActivationLog.action_type == "download_config",
            models.ActivationLog.timestamp >= cutoff
        ).count()

        if dl_count >= 3:
            return jsonify({
                "success": False,
                "msg": "Link tải file DNS đã đạt giới hạn tối đa 3 lần tải. Vui lòng tra cứu lại đơn để nhận link mới!"
            }), 403
    finally:
        db.close()

    # Log download action
    models.log_activation(
        uid=uid,
        action_type="download_config",
        ip_address=client_ip,
        user_agent=request.user_agent.string,
        extra_info=f"Download attempt #{dl_count + 1}"
    )

    clean_u = clean_locket_username(uid) or "VIP"
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    template_path = os.path.join(base_dir, "LocketGold_DNS.mobileconfig")
    if not os.path.exists(template_path):
        template_path = os.path.join(base_dir, "static", "LocketGold_DNS.mobileconfig")

    content = ""
    if os.path.exists(template_path):
        with open(template_path, "r", encoding="utf-8") as f:
            content = f.read()
    else:
        content = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<plist version=\"1.0\"><dict></dict></plist>"

    content = content.replace("USER_PLACEHOLDER", clean_u)

    filename = f"LocketGold_{clean_u}.mobileconfig"
    response = make_response(content)
    response.headers["Content-Type"] = "application/x-apple-aspen-config; charset=utf-8"
    response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return response


# Backward-compatible routes
@orders_bp.route("/api/download/sgmodule")
def download_vip_sgmodule():
    oid = (request.args.get("order_id") or "").strip().upper()
    token = (request.args.get("token") or "").strip()

    db = models.SessionLocal()
    try:
        order = None
        if oid:
            order = db.query(models.Order).filter_by(order_id=oid).first()
        elif token:
            order = db.query(models.Order).filter_by(token=token).first()

        if not order or order.status not in ("PAID", "PROCESSING", "COMPLETED"):
            return jsonify({"success": False, "msg": "Truy cập bị từ chối. Module VIP chỉ dành cho đơn hàng đã thanh toán thành công!"}), 403

        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        static_module = os.path.join(base_dir, "static", "dth.sgmodule")
        if os.path.exists(static_module):
            return send_file(static_module, mimetype="text/plain", as_attachment=False)
        return "https://raw.githubusercontent.com/dth20006/shadow/main/dth.sgmodule", 200, {"Content-Type": "text/plain"}
    finally:
        db.close()


# ========================================================
# VIP PROTECTED VIDEO GUIDE STREAMING ROUTE
# ========================================================
@orders_bp.route("/api/video/guide", methods=["GET"])
def stream_vip_guide_video():
    """
    Endpoint phát video hướng dẫn có bảo vệ chỉ dành cho khách đã thanh toán:
    /api/video/guide?type=shadowrocket|module&order_id=...&token=...
    Chỉ trả về video nếu order_id có trạng thái PAID / COMPLETED và token HMAC hợp lệ.
    Nếu chưa mua / sai token: Trả về lỗi 403 Forbidden {"error": "Chỉ khách hàng đã thanh toán thành công mới có quyền xem video này!"}.
    """
    video_type = (request.args.get("type") or "").strip().lower()
    order_id = (request.args.get("order_id") or request.args.get("orderId") or "").strip().upper()
    token = (request.args.get("token") or "").strip()

    if not order_id or not token:
        return jsonify({"error": "Chỉ khách hàng đã thanh toán thành công mới có quyền xem video này!"}), 403

    db = models.SessionLocal()
    try:
        order = db.query(models.Order).filter(models.Order.order_id == order_id).first()
        if not order:
            return jsonify({"error": "Chỉ khách hàng đã thanh toán thành công mới có quyền xem video này!"}), 403

        if order.status not in ("PAID", "PROCESSING", "COMPLETED"):
            return jsonify({"error": "Chỉ khách hàng đã thanh toán thành công mới có quyền xem video này!"}), 403

        if not verify_hmac_video_token(order_id, token, order.token):
            expires = request.args.get("expires")
            valid_fallback = False
            if expires:
                valid_fallback, _ = verify_hmac_download_token(order_id, expires, get_client_ip(), token)
            if not valid_fallback:
                return jsonify({"error": "Chỉ khách hàng đã thanh toán thành công mới có quyền xem video này!"}), 403

        if video_type in ("shadowrocket", "sr", "guide_shadowrocket", "video1"):
            target_filename = "guide_shadowrocket.mp4"
        elif video_type in ("module", "mod", "guide_module", "video2"):
            target_filename = "guide_module.mp4"
        else:
            return jsonify({"error": "Loại video không hợp lệ (shadowrocket hoặc module)."}), 400

        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        video_path = os.path.join(base_dir, "static", "videos", target_filename)

        if not os.path.exists(video_path):
            alt_path = os.path.join(base_dir, "static", target_filename)
            if os.path.exists(alt_path):
                video_path = alt_path
            else:
                return jsonify({"error": "Video hiện đang được cập nhật, vui lòng thử lại sau ít phút!"}), 404

        resp = make_response(send_file(video_path, mimetype="video/mp4", conditional=True, as_attachment=False))
        resp.headers["Accept-Ranges"] = "bytes"
        resp.headers["Cache-Control"] = "private, max-age=3600"
        return resp
    finally:
        db.close()



@orders_bp.route("/download-config")
def download_dns_config():
    user = (request.args.get("u") or request.args.get("user") or "").strip()
    clean_u = clean_locket_username(user) or "VIP"
    
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    template_path = os.path.join(base_dir, "LocketGold_DNS.mobileconfig")
    if not os.path.exists(template_path):
        template_path = os.path.join(base_dir, "static", "LocketGold_DNS.mobileconfig")
    
    content = ""
    if os.path.exists(template_path):
        with open(template_path, "r", encoding="utf-8") as f:
            content = f.read()
    else:
        content = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<plist version=\"1.0\"><dict></dict></plist>"

    content = content.replace("USER_PLACEHOLDER", clean_u)
    
    filename = f"LocketGold_{clean_u}.mobileconfig"
    response = make_response(content)
    response.headers["Content-Type"] = "application/x-apple-aspen-config; charset=utf-8"
    response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return response


# ========================================================
# SMM UTILITIES & AI COMMENTS GENERATOR
# ========================================================
@orders_bp.route("/api/smm/extract-id", methods=["GET", "POST"])
def smm_extract_id():
    """Tự động chuyển đổi Link Facebook/TikTok sang UID/Object ID."""
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        raw_url = (data.get("url") or data.get("link") or "").strip()
        platform = data.get("platform")
    else:
        raw_url = (request.args.get("url") or request.args.get("link") or "").strip()
        platform = request.args.get("platform")

    if not raw_url:
        return jsonify({"success": False, "msg": "Vui lòng cung cấp link cần bóc tách."}), 400

    extracted = extract_social_uid(raw_url, platform=platform)
    return jsonify({
        "success": True,
        "object_id": extracted.get("object_id"),
        "platform": extracted.get("platform"),
        "type": extracted.get("type"),
        "raw": extracted.get("raw")
    })


@orders_bp.route("/api/smm/check-public", methods=["GET"])
def smm_check_public():
    """
    Public Checker: Kiểm tra nhanh trạng thái link/profile công khai hay riêng tư (Private).
    """
    url = (request.args.get("url") or request.args.get("link") or "").strip()
    stype = (request.args.get("type") or "").strip().lower()

    if not url:
        return jsonify({"success": False, "msg": "Thiếu URL kiểm tra."}), 400

    # If already a bare username or numeric UID, pass through as valid
    if not (url.startswith("http://") or url.startswith("https://")):
        return jsonify({
            "success": True,
            "is_public": True,
            "msg": "Định dạng ID/Username hợp lệ."
        })

    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        }
        resp = requests.head(url, headers=headers, timeout=3.5, allow_redirects=True)
        if resp.status_code in (404, 410):
            return jsonify({
                "success": True,
                "is_public": False,
                "status_code": resp.status_code,
                "msg": "Link không tồn tại hoặc đã bị gỡ bỏ (Lỗi 404/410)!"
            })

        final_url = str(resp.url).lower()
        if "facebook.com" in final_url or "fb.com" in final_url:
            if "login.php" in final_url or "checkpoint" in final_url:
                return jsonify({
                    "success": True,
                    "is_public": False,
                    "msg": "Bài viết/Trang Facebook đang ở chế độ Riêng tư (Private) hoặc yêu cầu đăng nhập mới xem được!"
                })

        return jsonify({
            "success": True,
            "is_public": True,
            "msg": "Link công khai hợp lệ."
        })
    except Exception as e:
        # Permissive fallback so legitimate orders aren't hard blocked on network hiccups
        return jsonify({
            "success": True,
            "is_public": True,
            "msg": "Đã ghi nhận link (Bỏ qua kiểm tra kết nối)."
        })


@orders_bp.route("/api/smm/generate-comments", methods=["GET", "POST"])
def smm_generate_comments():
    """
    AI Comment Generator: Sinh 10-20 câu bình luận tiếng Việt tự nhiên, phù hợp mạng xã hội.
    Hỗ trợ topic và tone đa dạng.
    """
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        topic = str(data.get("topic") or "ban_hang").strip().lower()
        tone = str(data.get("tone") or "tu_nhien").strip().lower()
        count = int(data.get("count") or 15)
    else:
        topic = str(request.args.get("topic") or "ban_hang").strip().lower()
        tone = str(request.args.get("tone") or "tu_nhien").strip().lower()
        count = int(request.args.get("count") or 15)

    count = max(10, min(30, count))

    # Knowledge base for Vietnamese social comments
    comments_db = {
        "ban_hang": {
            "tu_nhien": [
                "Shop ơi check ib em với ạ", "Có ship COD về tỉnh không shop ơi?", "Chất vải mặc mát ko bạn?",
                "Tầm bao nhiêu ngày nhận được hàng thế ạ?", "Mẫu này cao 1m6 nặng 50kg mặc size gì vừa ạ?",
                "Cho mình xin bảng size chuẩn với shop", "Đẹp quá chừng luôn, để em gom lúa đặt liền nè",
                "Màu ngoài đời có y như trên hình ko shop?", "Có được kiểm tra hàng trước khi thanh toán ko bạn?",
                "Vừa đặt 1 chiếc, mong hàng sớm về tay", "Form này nam hay nữ mặc đều đẹp đúng ko ạ?",
                "Còn màu trắng ko bạn ơi?", "Giao nhanh giúp em nhé, cuối tuần em đi tiệc rồi",
                "Shop tư vấn nhiệt tình ghê, lát em đặt luôn", "Áo đẹp xuất sắc shop ơi, 10 điểm",
                "Hàng chính hãng chuẩn xịn chứ shop?", "Ủng hộ shop lâu dài nè, đợt trước mua ưng ý lắm"
            ],
            "khen_ngoi": [
                "Đẹp xuất sắc shop ơi, mê từ cái nhìn đầu tiên luôn á 🥰", "Mẫu này tôn dáng dã man luôn trời ơi!",
                "10/10 không có nhưng, hàng đẹp y chang hình luôn nha mn", "Chất lượng đỉnh của chóp, săn deal hời quá",
                "Nhìn sang chảnh xịn sò thực sự, đáng đồng tiền bát gạo!", "Xinh xỉu luôn á, mọi người nên mua nha",
                "Mua lần 2 rồi vẫn mê tít, uy tín lắm luôn nè", "Đóng gói cẩn thận 5 sao, giao hàng nhanh như chớp"
            ],
            "hoi_gia": [
                "Bao nhiêu một chiếc vậy shop?", "Xin giá công khai với ạ", "Có ưu đãi giảm giá gì ko shop ơi?",
                "Mua 2 chiếc có được freeship ko ạ?", "Inbox em báo giá sỉ với nha", "Giá hạt dẻ quá, cho em xin giá size L",
                "Shop check tin nhắn chờ báo giá em nhé", "Combo 3 cái giá bao nhiêu thế bạn?"
            ],
            "review_uy_tin": [
                "Đã nhận hàng nha shop, chất lượng vượt ngoài mong đợi luôn á!", "Vải mềm mịn, đường may rất chỉn chu, cho shop 5 sao",
                "Shop uy tín thực sự, giao đúng mẫu đúng size luôn", "Mặc vừa in luôn, ai cũng khen đẹp hết nè",
                "Lần đầu mua ở shop mà hài lòng quá trời, sẽ ủng hộ tiếp", "Đáng đồng tiền lắm mn ơi, nên mua nha"
            ]
        },
        "an_uong": {
            "tu_nhien": [
                "Quán ở đâu vậy ạ cho mình xin địa chỉ với", "Nhìn ngon mắt quá, thèm chảy nước miếng luôn",
                "Mở cửa từ mấy giờ đến mấy giờ vậy bạn?", "Cuối tuần phải rủ hội bạn ghé ăn thử liền mới được",
                "Menu có nhiều món ko ạ?", "Giá cả thế nào vậy mọi người ơi?",
                "Món này ăn kèm với gì ngon nhất vậy shop?", "Quán có chỗ để ô tô ko ạ?"
            ],
            "khen_ngoi": [
                "Món này ngon đỉnh chóp luôn, nước sốt đậm đà mê ly", "Không gian quán chill xỉu, chụp hình góc nào cũng đẹp",
                "Đồ ăn tươi ngon chuẩn vị luôn á 10/10", "Phục vụ nhanh nhẹn dễ thương cực kỳ luôn nha"
            ]
        },
        "khen_ngoi": {
            "tu_nhien": [
                "Xinh quá chị ơi 🥰", "Visual đỉnh chóp luôn trời ơi!", "Hóng clip mới của bạn mãi luôn á",
                "Dễ thương xỉu up xỉu down luôn nè", "Năng lượng tích cực ghê, chúc bạn ngày mới vui vẻ nha",
                "Thần thái ngút ngàn luôn á", "Outfit này hợp với bạn cực kỳ luôn nè", "Nụ cười tỏa nắng luôn á"
            ]
        },
        "hai_huoc": {
            "tu_nhien": [
                "Cười đau cả bụng luôn á trời 🤣🤣", "Bớt hài lại giùm cái coi, đang uống nước suýt sặc",
                "Xem đi xem lại 10 lần vẫn cười như điên", "Hài hước vừa thôi ai chịu nổi ba",
                "Cứ tưởng thế nào, cái kết bất ngờ chưa bà già", "Mắc cười quá trời, thả tim cho chủ thớt nè"
            ]
        }
    }

    # Select pool
    category = comments_db.get(topic) or comments_db.get("ban_hang")
    pool = category.get(tone) or category.get("tu_nhien") or comments_db["ban_hang"]["tu_nhien"]
    
    # If not enough, supplement from natural
    all_supp = list(comments_db["ban_hang"]["tu_nhien"])
    combined = list(pool)
    for c in all_supp:
        if c not in combined:
            combined.append(c)

    import random
    selected = random.sample(combined, min(count, len(combined)))

    return jsonify({
        "success": True,
        "topic": topic,
        "tone": tone,
        "count": len(selected),
        "comments": selected,
        "text": "\n".join(selected)
    })


# ========================================================
# VIP TIER CHECK ROUTE
# ========================================================
@orders_bp.route("/api/vip/check", methods=["GET"])
def check_vip_tier():
    """
    Endpoint kiểm tra hạng VIP và % giảm giá của số điện thoại / Zalo.
    >= 200.000đ: Hạng Bạc (Silver) -> Giảm 5%
    >= 500.000đ: Hạng Vàng (Gold) -> Giảm 10%
    """
    phone = (request.args.get("phone") or request.args.get("zalo") or "").strip()
    if not phone:
        return jsonify({"success": False, "msg": "Vui lòng cung cấp số điện thoại."}), 400

    vip_data = models.get_vip_tier(phone)
    return jsonify({
        "success": True,
        "phone": phone,
        "tier": vip_data["tier"],
        "tier_label": vip_data["tier_label"],
        "discount_percent": vip_data["discount_percent"],
        "total_spent": vip_data["total_spent"],
        "total_spent_formatted": format_currency_vnd(vip_data["total_spent"]),
        "badge_color": vip_data["badge_color"],
        "is_vip": vip_data["discount_percent"] > 0
    })

# ========================================================
# CREATOR FREE TOOLS: TIKTOK NO WATERMARK & MP3
# ========================================================
@orders_bp.route("/api/tools/tiktok-download", methods=["GET", "POST"])
def tiktok_download_tool():
    """
    Tải video TikTok không logo và nhạc nền MP3 chất lượng cao.
    """
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        raw_url = (data.get("url") or "").strip()
    else:
        raw_url = (request.args.get("url") or "").strip()

    if not raw_url:
        return jsonify({"success": False, "msg": "Vui lòng nhập link video TikTok."}), 400

    try:
        api_url = f"https://www.tikwm.com/api/?url={urllib.parse.quote(raw_url)}"
        resp = requests.get(api_url, timeout=7)
        res_json = resp.json() if resp.status_code == 200 else {}

        if res_json.get("code") == 0 and "data" in res_json:
            v_data = res_json["data"]
            return jsonify({
                "success": True,
                "title": v_data.get("title", "TikTok Video"),
                "video_url": v_data.get("play"),
                "wm_video_url": v_data.get("wmplay"),
                "music_url": v_data.get("music"),
                "cover": v_data.get("cover"),
                "author": v_data.get("author", {}).get("unique_id", "TikToker")
            })
        else:
            return jsonify({"success": False, "msg": "Không thể tải video từ link này. Hãy kiểm tra lại link!"}), 400
    except Exception as e:
        return jsonify({"success": False, "msg": f"Lỗi kết nối máy chủ TikTok: {str(e)}"}), 500


# ========================================================
# DAILY FINANCIAL DIGEST TELEGRAM NOTIFICATION
# ========================================================
def generate_daily_financial_report():
    """
    Tổng hợp báo cáo tài chính trong ngày và gửi Telegram cho Admin (chat_id: 7114174347).
    """
    from services.telegram_bot import send_telegram_msg

    db = models.SessionLocal()
    try:
        now = models.now_gmt7()
        start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
        end_of_day = now.replace(hour=23, minute=59, second=59, microsecond=999999)

        today_orders = db.query(models.Order).filter(
            models.Order.status.in_(["PAID", "PROCESSING", "COMPLETED"]),
            models.Order.created_at >= start_of_day,
            models.Order.created_at <= end_of_day
        ).all()

        total_orders = len(today_orders)
        total_revenue = sum(o.amount for o in today_orders)

        by_svc = {"chungsuc": [], "locket": [], "mxh": [], "premium": []}
        for o in today_orders:
            stype = o.service_type or "mxh"
            by_svc.setdefault(stype, []).append(o)

        cs_rev = sum(o.amount for o in by_svc.get("chungsuc", []))
        lk_rev = sum(o.amount for o in by_svc.get("locket", []))
        mxh_rev = sum(o.amount for o in by_svc.get("mxh", []))
        prem_rev = sum(o.amount for o in by_svc.get("premium", []))

        # Estimated upstream costs (approx 35% across services)
        est_cost = int(total_revenue * 0.35)
        net_profit = max(0, total_revenue - est_cost)

        date_str = now.strftime("%d/%m/%Y")
        msg = (
            f"📊 <b>[BÁO CÁO TÀI CHÍNH CUỐI NGÀY — {date_str}]</b>\n"
            f"⏰ <i>Thời gian chốt sổ: 23:59 GMT+7</i>\n"
            f"────────────────────────\n"
            f"🛒 <b>Tổng đơn hoàn tất:</b> <code>{total_orders:,} đơn</code>\n"
            f"💰 <b>Tổng doanh thu:</b> <b>+{format_currency_vnd(total_revenue)}</b>\n"
            f"📉 <b>Chi phí API đối tác (ước tính):</b> <code>-{format_currency_vnd(est_cost)}</code>\n"
            f"💵 <b>LÃI RÒNG THỰC TẾ:</b> <b style=\"color:#10b981\">+{format_currency_vnd(net_profit)}</b>\n"
            f"────────────────────────\n"
            f"📈 <b>Chi tiết từng mảng:</b>\n"
            f"• 🎮 Chung Sức: <b>{len(by_svc['chungsuc'])} đơn</b> (+{format_currency_vnd(cs_rev)})\n"
            f"• 💛 Locket Gold: <b>{len(by_svc['locket'])} đơn</b> (+{format_currency_vnd(lk_rev)})\n"
            f"• 🚀 Dịch Vụ MXH: <b>{len(by_svc['mxh'])} đơn</b> (+{format_currency_vnd(mxh_rev)})\n"
            f"• 💎 Chợ Premium: <b>{len(by_svc['premium'])} đơn</b> (+{format_currency_vnd(prem_rev)})\n"
            f"────────────────────────\n"
            f"⚡ <i>Hệ thống DTH Services tự động vận hành trơn tru 100%!</i>"
        )

        ok, desc = send_telegram_msg(msg, chat_id="7114174347")
        return {
            "success": ok,
            "date": date_str,
            "total_orders": total_orders,
            "total_revenue": total_revenue,
            "estimated_cost": est_cost,
            "net_profit": net_profit,
            "telegram_response": desc
        }
    finally:
        db.close()


@orders_bp.route("/api/cron/daily-financial-digest", methods=["GET", "POST"])
def cron_daily_financial_digest():
    """Endpoint kích hoạt báo cáo tài chính cuối ngày qua Telegram."""
    report = generate_daily_financial_report()
    return jsonify(report)


# ========================================================
# PUBLIC ORDER TRACKING LINK (/track/<order_id>)
# ========================================================
@orders_bp.route("/track/<order_id>")
def public_track_order(order_id):
    """
    Đường Dẫn Chia Sẻ Trạng Thái Đơn Hàng Công Khai:
    BẢO MẬT TUYỆT ĐỐI: Ẩn toàn bộ thông tin thanh toán, số tài khoản, số tiền và dữ liệu nhạy cảm của khách.
    """
    from flask import render_template
    oid = str(order_id).strip().upper()
    db = models.SessionLocal()
    try:
        order = db.query(models.Order).filter_by(order_id=oid).first()
        if not order:
            return render_template("track.html", error=f"Không tìm thấy thông tin đơn hàng #{oid}.", order=None), 404

        svc_display_map = {
            "chungsuc": "Sự Kiện Chung Sức Liên Quân",
            "locket": "Kích Hoạt Locket Gold VIP",
            "mxh": "Dịch Vụ Tăng Tương Tác Mạng Xã Hội",
            "premium": "Chợ Tài Khoản Premium"
        }

        # Progress calculation
        pct = 100
        if order.status in ("PENDING", "PARTIAL_PAID"):
            pct = 25
        elif order.status == "PAID":
            pct = 50
        elif order.status == "PROCESSING":
            pct = 75
        elif order.status in ("COMPLETED", "SUCCESS"):
            pct = 100

        safe_data = {
            "order_id": order.order_id,
            "service_name": svc_display_map.get(order.service_type, "Dịch Vụ Số"),
            "package_name": order.package_name or "Gói dịch vụ",
            "status": order.status,
            "partner_status": order.partner_status,
            "created_at": order.created_at.strftime("%d/%m/%Y %H:%M") if order.created_at else "Vừa xong",
            "completed_at": order.completed_at.strftime("%d/%m/%Y %H:%M") if order.completed_at else None,
            "quantity": order.quantity,
            "delivered": order.delivered,
            "remains": order.remains,
            "progress_percent": pct
        }
        return render_template("track.html", order=safe_data, error=None)
    finally:
        db.close()


@orders_bp.route("/api/locket/check", methods=["GET", "POST"])
def check_locket_status():
    from app import check_locket_already_purchased
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        val = (data.get("username") or data.get("link") or "").strip()
        uid = (data.get("uid") or "").strip()
    else:
        val = (request.args.get("username") or request.args.get("link") or request.args.get("q") or "").strip()
        uid = (request.args.get("uid") or "").strip()

    username = clean_locket_username(val)
    already_purchased, order_code = check_locket_already_purchased(username, uid)

    return jsonify({
        "success": True,
        "alreadyPurchased": already_purchased,
        "orderCode": order_code,
        "is_existing_customer": already_purchased,
        "existing_order_id": order_code,
        "username": username or val
    })
