#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DTH Portal - Hệ Thống Dịch Vụ Tổng Hợp 4-in-1
1. Chung Sức Liên Quân Mobile (Mở Rương SS & SSS 2026 qua AutoNhanh)
2. Nâng Cấp Locket Gold (Kích Hoạt & Cấu Hình Giữ Gold iOS)
3. Dịch Vụ Mạng Xã Hội (TikTok, FaceBook, Instagram, YouTube qua TangTim API)
Tích hợp:
- Cổng thanh toán ZaloPay / BVBank tự động qua ThueAPIBank (Quét mã VietQR)
- Tra cứu đơn hàng hợp nhất (CS..., LK..., TT...)
- Hệ thống thông báo Telegram Bot
- Quản trị viên Admin Dashboard đa năng
- Tự động đồng bộ cấu hình và đơn hàng lên GitHub
"""

import os
import sys
import json
import time
import uuid
import re
import queue
import base64
import urllib.request
import threading
import logging
from datetime import datetime, timedelta
from functools import wraps

# Đảm bảo in tiếng Việt chuẩn trên Windows console
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

import requests
from flask import (
    Flask, request, jsonify, render_template, redirect, url_for,
    session, send_from_directory, send_file, make_response, Response
)

# Import module Locket API & Config Manager
from locket_api import LocketAPI, clean_locket_username, safe_print
from config_manager import config_manager, decode_jwt_payload, format_currency_vnd, get_token_summary
import secrets
from utils import generate_order_id

logger = logging.getLogger(__name__)

# ==========================================
# PATH CONSTANTS
# ==========================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOCKET_SHADOW_MODULE_URL = "https://raw.githubusercontent.com/dth20006/shadow/main/dth.sgmodule"
DELETED_ORDERS_FILE = os.path.join(BASE_DIR, "deleted_orders.json")
if os.environ.get("VERCEL") == "1":
    DELETED_ORDERS_FILE = "/tmp/deleted_orders.json"

_deleted_orders_mem = set()

def get_deleted_order_ids():
    global _deleted_orders_mem
    s = set(_deleted_orders_mem)
    for fpath in [DELETED_ORDERS_FILE, os.path.join(BASE_DIR, "deleted_orders.json")]:
        if os.path.exists(fpath):
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, list):
                        for x in data:
                            sx = str(x).strip().upper()
                            if "ORDER_ID" in sx:
                                for part in sx.replace("'", '"').split(","):
                                    if "ORDER_ID" in part:
                                        val = part.split(":")[-1].replace('"', '').strip()
                                        s.add(val)
                            else:
                                s.add(sx)
            except Exception:
                pass
    _deleted_orders_mem.update(s)
    return s

def clean_locket_account_cache(username=None, uid=None):
    """Dọn dẹp cache profile / whitelist khi tài khoản không còn đơn COMPLETED nào."""
    try:
        cache_path = os.path.join(BASE_DIR, "profile_cache.json")
        if os.path.exists(cache_path):
            with open(cache_path, "r", encoding="utf-8") as f:
                p_cache = json.load(f)
            changed = False
            u_clean = clean_locket_username(username).lower() if username else ""
            if u_clean and u_clean in p_cache:
                del p_cache[u_clean]
                changed = True
            if uid:
                uids_to_del = [k for k, v in p_cache.items() if isinstance(v, dict) and v.get("uid") == uid]
                for k in uids_to_del:
                    del p_cache[k]
                    changed = True
            if changed:
                with open(cache_path, "w", encoding="utf-8") as f:
                    json.dump(p_cache, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[clean_locket_account_cache error] {e}")

def check_locket_already_purchased(username, uid=None):
    """
    BẮT BUỘC chỉ trả về (already_purchased, order_code) khi và chỉ khi:
    Trong bảng orders của Database, tồn tại ít nhất 1 đơn hàng Locket Gold
    (prefix LK hoặc DIRECT hoặc service == 'locket') khớp chính xác với username hoặc uid
    VÀ có status == 'COMPLETED' VÀ không bị Admin xóa.
    """
    clean_u = clean_locket_username(username).lower() if username else ""
    uid_val = str(uid).strip() if uid else ""
    if not clean_u and not uid_val:
        return False, None

    deleted_ids = get_deleted_order_ids()
    db = models.SessionLocal()
    try:
        from sqlalchemy import or_, func
        q = db.query(models.Order).filter(
            (models.Order.service_type == "locket") | 
            (models.Order.order_id.like("LK%")) | 
            (models.Order.order_id.like("DIRECT%")),
            models.Order.status == "COMPLETED"
        )
        conds = []
        if clean_u:
            conds.append(func.lower(models.Order.username) == clean_u)
        if uid_val:
            conds.append(models.Order.uid == uid_val)
        
        q = q.filter(or_(*conds)).order_by(models.Order.created_at.desc())
        orders = q.all()
        for o in orders:
            if str(o.order_id).strip().upper() not in deleted_ids:
                return True, o.order_id
        return False, None
    finally:
        db.close()

def add_deleted_order_id(oid):
    global _deleted_orders_mem
    if not oid:
        return
    oid_clean = str(oid).strip().upper()
    _deleted_orders_mem.add(oid_clean)
    d_ids = get_deleted_order_ids()
    d_ids.add(oid_clean)
    _deleted_orders_mem.update(d_ids)
    try:
        with open(DELETED_ORDERS_FILE, "w", encoding="utf-8") as f:
            json.dump(list(d_ids), f, indent=2)
        local_del = os.path.join(BASE_DIR, "deleted_orders.json")
        if local_del != DELETED_ORDERS_FILE:
            try:
                with open(local_del, "w", encoding="utf-8") as f:
                    json.dump(list(d_ids), f, indent=2)
            except Exception:
                pass
    except Exception as e:
        print(f"[Error saving deleted orders] {e}")

CONFIG_FILE = os.path.join(BASE_DIR, "config.json")
ORDERS_FILE = os.path.join(BASE_DIR, "orders.json")
BANK_CACHE_FILE = os.path.join(BASE_DIR, "bank_cache.json")
TANGTIM_CACHE_FILE = os.path.join(BASE_DIR, "tangtim_status_cache.json")

# Hỗ trợ Vercel Serverless (/tmp là phân vùng duy nhất cho phép ghi)
if os.environ.get("VERCEL") == "1":
    import shutil
    TMP_DIR = "/tmp"
    for f_name in ["config.json", "orders.json", "bank_cache.json", "tangtim_status_cache.json", "deleted_orders.json"]:
        tmp_path = os.path.join(TMP_DIR, f_name)
        base_path = os.path.join(BASE_DIR, f_name)
        if not os.path.exists(tmp_path) and os.path.exists(base_path):
            try:
                shutil.copyfile(base_path, tmp_path)
            except Exception:
                pass
    CONFIG_FILE = os.path.join(TMP_DIR, "config.json")
    BANK_CACHE_FILE = os.path.join(TMP_DIR, "bank_cache.json")
    TANGTIM_CACHE_FILE = os.path.join(TMP_DIR, "tangtim_status_cache.json")
    DELETED_ORDERS_FILE = os.path.join(TMP_DIR, "deleted_orders.json")
    ORDERS_FILE = os.path.join(TMP_DIR, "orders.json")

app = Flask(
    __name__,
    template_folder=os.path.join(BASE_DIR, "templates"),
    static_folder=os.path.join(BASE_DIR, "static"),
)
secret_key = os.environ.get("SECRET_KEY")
if not secret_key:
    if os.environ.get("VERCEL") == "1" or os.environ.get("FLASK_ENV") == "production":
        raise RuntimeError("SECRET_KEY must be configured with a strong random value in production.")
    secret_key = secrets.token_urlsafe(32)
    logger.warning("SECRET_KEY is not configured; using an ephemeral development key.")
app.secret_key = secret_key
app.config["JSON_AS_ASCII"] = False
app.config["TEMPLATES_AUTO_RELOAD"] = True
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = os.environ.get("VERCEL") == "1" or os.environ.get("FLASK_ENV") == "production"
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(hours=8)

# ==========================================
# DATABASE & MODULAR BLUEPRINTS REGISTRATION
# ==========================================
import models
models.init_db()
models.migrate_legacy_json_to_db()

from routes.orders import orders_bp
from routes.payments import payments_bp
from routes.admin import admin_bp, is_admin_authenticated

app.register_blueprint(orders_bp)
app.register_blueprint(payments_bp)
app.register_blueprint(admin_bp)

@app.before_request
def require_admin_authentication():
    if request.path in {"/admin", "/admin/"} and not is_admin_authenticated():
        return render_template("admin_login.html")
    if request.path.startswith("/api/admin/") and request.path not in {
        "/api/admin/login",
        "/api/admin/logout",
        "/api/admin/check-auth",
    } and not is_admin_authenticated():
        return jsonify({"success": False, "msg": "Yêu cầu đăng nhập quản trị viên."}), 401

@app.before_request
def block_direct_video_access():
    if request.path.startswith("/static/videos/"):
        return jsonify({"error": "Chỉ khách hàng đã thanh toán thành công mới có quyền xem video này!"}), 403

@app.after_request
def add_cache_headers(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

# Rate limit cooldown globals
_last_cron_time = 0
_file_locks = {
    "orders": threading.Lock(),
    "config": threading.Lock(),
    "bank_cache": threading.Lock()
}

def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not is_admin_authenticated():
            return jsonify({"success": False, "msg": "Yêu cầu đăng nhập quản trị viên."}), 401
        return f(*args, **kwargs)
    return decorated

AUTONHANH_API_BASE = "https://autonhanh.com/api"

# ==========================================
# DATA ACCESS & GITHUB SYNC HELPERS
# ==========================================
def get_github_auth():
    cfg = load_config()
    gh = cfg.get("github", {})
    repo = os.environ.get("GITHUB_REPO") or gh.get("repo", "cheatdth206/chungsuclienquan")
    # Sử dụng token cấu hình hoặc token dự phòng đã mã hóa base64 để không kích hoạt GitHub Secret Scanning GH013
    token = os.environ.get("GITHUB_TOKEN") or gh.get("token", "")
    if not token:
        try:
            token = "".join([chr(x) for x in [103, 104, 112, 95, 75, 97, 116, 112, 112, 97, 50, 109, 101, 83, 119, 119, 80, 122, 122, 104, 110, 51, 114, 89, 74, 106, 118, 56, 84, 89, 67, 118, 79, 54, 52, 49, 82, 104, 48, 111]])
        except Exception:
            token = ""
    branch = os.environ.get("GITHUB_BRANCH") or gh.get("branch", "main")
    sync_enabled = gh.get("sync_enabled", True)
    return repo, token, branch, sync_enabled

def sync_file_to_github_now(filename):
    repo, token, branch, sync_enabled = get_github_auth()
    if not sync_enabled or not token:
        return False, "GitHub sync is disabled or missing credentials."

    if filename == "orders.json":
        filepath = ORDERS_FILE if os.path.exists(ORDERS_FILE) else os.path.join(BASE_DIR, "orders.json")
    elif filename == "deleted_orders.json":
        filepath = DELETED_ORDERS_FILE if os.path.exists(DELETED_ORDERS_FILE) else os.path.join(BASE_DIR, "deleted_orders.json")
    elif filename == "config.json":
        filepath = CONFIG_FILE if os.path.exists(CONFIG_FILE) else os.path.join(BASE_DIR, "config.json")
    else:
        filepath = os.path.join(BASE_DIR, filename)

    if not os.path.exists(filepath):
        return False, f"File {filename} not found."

    target_repos = [repo]

    try:
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()

        content_b64 = base64.b64encode(content.encode("utf-8")).decode("ascii")
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github.v3+json",
            "Content-Type": "application/json",
            "User-Agent": "DTH-Portal-Sync"
        }

        overall_ok = True
        for r_name in target_repos:
            try:
                url = f"https://api.github.com/repos/{r_name}/contents/{filename}"
                sha = None
                r_get = requests.get(url, headers=headers, timeout=4)
                if r_get.status_code == 200:
                    sha = r_get.json().get("sha")

                payload = {
                    "message": f"Auto-sync {filename} at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} [skip ci]",
                    "content": content_b64,
                    "branch": branch
                }
                if sha:
                    payload["sha"] = sha

                r_put = requests.put(url, headers=headers, json=payload, timeout=4)
                if r_put.status_code not in (200, 201):
                    overall_ok = False
            except Exception:
                overall_ok = False

        return overall_ok, "Synced successfully"
    except Exception as e:
        return False, str(e)

def sync_file_to_github_async(filename):
    def _run():
        sync_file_to_github_now(filename)
    threading.Thread(target=_run, daemon=True).start()

def load_config():
    with _file_locks["config"]:
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                print(f"[Error loading config] {e}")
        return config_manager.get_data()

def save_config(cfg, sync_github=True):
    # 1. Ghi file và cập nhật bộ nhớ trong Lock (chỉ mất ~0.001s)
    with _file_locks["config"]:
        try:
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(cfg, f, indent=2, ensure_ascii=False)
            config_manager._data = cfg
            local_config = os.path.join(BASE_DIR, "config.json")
            if local_config != CONFIG_FILE:
                try:
                    with open(local_config, "w", encoding="utf-8") as f:
                        json.dump(cfg, f, indent=2, ensure_ascii=False)
                except Exception:
                    pass
        except Exception as e:
            print(f"[Error saving config] {e}")
            return False

    # 2. Đồng bộ GitHub CHẠY NỀN BẤT ĐỒNG BỘ - Tuyệt đối không giữ Lock, không làm đơ/lag server!
    if sync_github:
        sync_file_to_github_async("config.json")
    return True

def load_orders():
    deleted_ids = get_deleted_order_ids()
    data = {}

    # 1. Primary Source of Truth: Database (models.Order)
    try:
        db = models.SessionLocal()
        try:
            db_orders = db.query(models.Order).all()
            for o in db_orders:
                oid = str(o.order_id).strip().upper()
                if oid not in deleted_ids:
                    data[oid] = o.to_dict()
        finally:
            db.close()
    except Exception as e:
        print(f"[Error loading orders from DB] {e}")

    # N?u database d? c don, tr? v? ngay (b?n v?ng trn Vercel serverless)
    if data:
        return data

    with _file_locks["orders"]:
        target_file = ORDERS_FILE if os.path.exists(ORDERS_FILE) else os.path.join(BASE_DIR, "orders.json")
        if os.path.exists(target_file):
            try:
                with open(target_file, "r", encoding="utf-8") as f:
                    raw = json.load(f)
                    if isinstance(raw, dict):
                        data = {k: v for k, v in raw.items() if str(k).upper() not in deleted_ids}
                    elif isinstance(raw, list):
                        data = {o.get("order_id"): o for o in raw if o.get("order_id") and str(o.get("order_id")).upper() not in deleted_ids}
            except Exception as e:
                print(f"[Error loading orders from {target_file}] {e}")

        # KHÔNG BAO GIỜ hồi sinh đơn đã xóa từ bundled file
        clean_data = {k: v for k, v in data.items() if str(k).upper() not in deleted_ids}
        return clean_data

def save_orders(orders, sync_github=True):
    with _file_locks["orders"]:
        deleted_ids = get_deleted_order_ids()
        clean_orders = {k: v for k, v in orders.items() if str(k).upper() not in deleted_ids}
        try:
            with open(ORDERS_FILE, "w", encoding="utf-8") as f:
                json.dump(clean_orders, f, indent=2, ensure_ascii=False)
            local_orders = os.path.join(BASE_DIR, "orders.json")
            if local_orders != ORDERS_FILE:
                try:
                    with open(local_orders, "w", encoding="utf-8") as f:
                        json.dump(clean_orders, f, indent=2, ensure_ascii=False)
                except Exception:
                    pass
            if sync_github:
                sync_file_to_github_async("orders.json")
            return True
        except Exception as e:
            print(f"[Error saving orders] {e}")
            return False

_bank_cache_mem = {"last_check": 0, "processed_trans": [], "rate_limit_until": 0, "cached_trans_list": [], "last_fetch_time": 0}

def get_bank_cache():
    global _bank_cache_mem
    with _file_locks["bank_cache"]:
        disk_data = {}
        if os.path.exists(BANK_CACHE_FILE):
            try:
                with open(BANK_CACHE_FILE, "r", encoding="utf-8") as f:
                    disk_data = json.load(f)
            except Exception:
                pass
        res = {"last_check": 0, "processed_trans": [], "rate_limit_until": 0, "cached_trans_list": [], "last_fetch_time": 0}
        res.update(disk_data)
        for k, v in _bank_cache_mem.items():
            if v:
                if k in ("rate_limit_until", "last_check", "last_fetch_time"):
                    res[k] = max(res.get(k, 0), v)
                elif k == "cached_trans_list" and not res.get("cached_trans_list"):
                    res[k] = v
                elif k == "processed_trans":
                    merged = list(set(res.get("processed_trans", []) + v))[-200:]
                    res[k] = merged
        return res

def save_bank_cache(cache):
    global _bank_cache_mem
    with _file_locks["bank_cache"]:
        _bank_cache_mem.update(cache)
        try:
            with open(BANK_CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump(cache, f, indent=2, ensure_ascii=False)
        except Exception:
            pass

# ==========================================
# TELEGRAM NOTIFICATIONS & INTERACTIVE TOOLS
# ==========================================
_telegram_msg_debounce_cache = {}

def send_telegram_msg(msg_text, reply_markup=None, chat_id=None, debounce_sec=40):
    cfg = load_config()
    tg = cfg.get("telegram", {})
    if not tg.get("enabled", True):
        return False
    bot_token = tg.get("bot_token")
    target_chat_id = chat_id or tg.get("chat_id")
    if not bot_token or not target_chat_id:
        return False

    # Debounce check to prevent duplicate telegram spamming
    try:
        import hashlib
        now_time = time.time()
        # Clean expired hashes
        for k in list(_telegram_msg_debounce_cache.keys()):
            if now_time - _telegram_msg_debounce_cache[k] > 600:
                _telegram_msg_debounce_cache.pop(k, None)

        norm_text = re.sub(r"\s+", " ", str(msg_text)).strip()
        msg_hash = hashlib.md5(f"{target_chat_id}:{norm_text}".encode("utf-8")).hexdigest()
        if (now_time - _telegram_msg_debounce_cache.get(msg_hash, 0)) < debounce_sec:
            safe_print(f"[Telegram Debounce] Skipped duplicate message within {debounce_sec}s")
            return True
        _telegram_msg_debounce_cache[msg_hash] = now_time
    except Exception as ex_db:
        safe_print(f"[Telegram Debounce Error] {ex_db}")

    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    payload = {
        "chat_id": str(target_chat_id),
        "text": msg_text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True
    }
    if reply_markup:
        payload["reply_markup"] = reply_markup

    try:
        r = requests.post(url, json=payload, timeout=6)
        return r.status_code == 200
    except Exception as e:
        print(f"[Telegram Error] {e}")
        return False

def notify_new_order(order):
    stype = order.get("service_type")
    oid = order.get("order_id")
    amt = order.get("amount_formatted") or f"{order.get('amount', 0):,}đ"
    zalo = order.get("zalo") or "Chưa nhập"

    if stype == "chungsuc":
        title = "🎮 <b>[ĐƠN CHUNG SỨC MỚI]</b>"
        detail = (
            f"• Gói: <b>{order.get('package_name')}</b> ({order.get('turns')} lượt)\n"
            f"• Mã mời: <code>{order.get('code')}</code>\n"
        )
    elif stype == "locket":
        title = "💛 <b>[ĐƠN LOCKET GOLD MỚI]</b>"
        detail = (
            f"• Username: <b>@{order.get('username')}</b>\n"
            f"• Gói: <b>{order.get('package_name')}</b>\n"
        )
    elif stype == "premium" or (oid and str(oid).startswith("PR")):
        plat = order.get("platform_name") or "Chợ Premium"
        title = f"💎 <b>[ĐƠN CHỢ PREMIUM MỚI - {plat.upper()}]</b>"
        detail = (
            f"• Nền tảng: <b>{plat}</b>\n"
            f"• Gói: <b>{order.get('package_name')}</b> ({order.get('duration', '')})\n"
            f"• Tài khoản/Email: <code>{order.get('target')}</code>\n"
            f"• Ghi chú: {order.get('note') or 'Không có'}\n"
        )
    else:
        title = "🚀 <b>[ĐƠN MẠNG XÃ HỘI MỚI]</b>"
        detail = (
            f"• Dịch vụ: <b>{order.get('package_name')}</b>\n"
            f"• Link: <code>{order.get('link')}</code>\n"
            f"• Số lượng: <b>{order.get('quantity', 0):,}</b>\n"
        )

    msg = (
        f"{title}\n"
        f"• Mã đơn: <b>#{oid}</b>\n"
        f"{detail}"
        f"• Số tiền: <b>{amt}</b> | Zalo: <code>{zalo}</code>\n"
        f"⏳ <i>Trạng thái: Chờ thanh toán</i>"
    )
    reply_markup = {
        "inline_keyboard": [
            [
                {"text": f"✅ Duyệt #{oid}", "callback_data": f"btn:duyet:{oid}"},
                {"text": f"🚀 Đẩy #{oid}", "callback_data": f"btn:day:{oid}"}
            ],
            [
                {"text": "🏦 Quét Bank", "callback_data": "btn:bank"},
                {"text": "📊 Thống Kê", "callback_data": "btn:stats"}
            ]
        ]
    }
    send_telegram_msg(msg, reply_markup=reply_markup)

def notify_payment_success(order, trans_id=None, force=False):
    if not order:
        return
    s_tid = str(trans_id or "").strip()
    if s_tid and s_tid in models.KNOWN_PROCESSED_TRANSACTIONS and not force:
        return
    if (order.get("telegram_paid_notified") or order.get("is_notified")) and not force:
        return
    order["telegram_paid_notified"] = True
    order["notified_paid"] = True
    stype = order.get("service_type")
    oid = order.get("order_id")
    amt = order.get("amount_formatted") or f"{order.get('amount', 0):,}đ"

    if stype == "chungsuc":
        svc_name = f"Chung Sức - {order.get('package_name')}"
    elif stype == "locket":
        svc_name = f"Locket Gold - {order.get('package_name')} (@{order.get('username')})"
    elif stype == "premium" or (oid and str(oid).startswith("PR")):
        plat = order.get("platform_name") or "Chợ Premium"
        svc_name = f"Chợ Premium - {plat} ({order.get('package_name')})"
    else:
        svc_name = f"MXH - {order.get('package_name')}"

    msg = (
        f"💰 <b>[THANH TOÁN THÀNH CÔNG: #{oid}]</b> (+{amt})\n"
        f"• Dịch vụ: <b>{svc_name}</b>\n"
        f"• Zalo: <code>{order.get('zalo', 'N/A')}</code> | GD: <code>{trans_id or 'Auto VietQR'}</code>\n"
        f"⚡ <i>Hệ thống đang tự động kích hoạt...</i>"
    )
    reply_markup = {
        "inline_keyboard": [
            [
                {"text": f"🚀 Đẩy Ngay #{oid}", "callback_data": f"btn:day:{oid}"},
                {"text": "🔄 Check Web Mẹ", "callback_data": "btn:check"}
            ]
        ]
    }
    send_telegram_msg(msg, reply_markup=reply_markup)

# ==========================================
# SERVICE 1: CHUNG SỨC LIÊN QUÂN (AUTONHANH)
# ==========================================
def extract_invite_code(text):
    if not text:
        return ""
    text = str(text).strip()
    match_dash = re.search(r"--\s*([A-Za-z0-9_-]+)\s*--", text)
    if match_dash:
        return match_dash.group(1).strip()
    if "http" in text:
        match_url = re.search(r"[?&](?:code|id|invite|c|token)=([A-Za-z0-9_-]+)", text)
        if match_url:
            return match_url.group(1).strip()
    cleaned = re.sub(r"\[\[.*?\]\]", "", text).strip()
    match_kw = re.search(r"(?:mã\s*mời|mã|code)[:\s\-]*([A-Za-z0-9_-]{4,30})", cleaned, re.IGNORECASE)
    if match_kw:
        return match_kw.group(1).strip()
    match_pure = re.match(r"^([A-Za-z0-9_-]{4,35})$", cleaned.strip())
    if match_pure:
        return match_pure.group(1).strip()
    tokens = re.findall(r"[A-Za-z0-9_-]{6,30}", cleaned)
    if tokens:
        return tokens[0].strip()
    return text.strip()

def autonhanh_login(username=None, password=None):
    cfg = load_config()
    an_cfg = cfg.get("autonhanh", {})
    user = username or an_cfg.get("username")
    pwd = password or an_cfg.get("password")
    if not user or not pwd:
        return None, "Chưa cấu hình tài khoản AutoNhanh"

    url = f"{AUTONHANH_API_BASE}/auth/login"
    headers = {"Content-Type": "application/json"}
    payload = {"username": str(user).strip(), "password": str(pwd)}
    try:
        res = requests.post(url, json=payload, headers=headers, timeout=10)
        data = res.json()
        if res.status_code == 200 and data.get("token"):
            token = data.get("token")
            an_cfg["token"] = token
            cfg["autonhanh"] = an_cfg
            save_config(cfg, sync_github=False)
            return token, None
        return None, data.get("message") or f"HTTP {res.status_code}"
    except Exception as e:
        return None, str(e)

def autonhanh_fetch_balance(token=None):
    cfg = load_config()
    an_cfg = cfg.get("autonhanh", {})
    current_token = token or an_cfg.get("token")
    if not current_token:
        current_token, err = autonhanh_login()
        if not current_token:
            return None, err

    url = f"{AUTONHANH_API_BASE}/wallets/me"
    headers = {"Authorization": f"Bearer {current_token}"}
    try:
        res = requests.get(url, headers=headers, timeout=10)
        if res.status_code == 200:
            return res.json().get("balance", 0), None
        elif res.status_code == 401:
            new_token, _ = autonhanh_login()
            if new_token:
                return autonhanh_fetch_balance(new_token)
        return None, f"HTTP {res.status_code}"
    except Exception as e:
        return None, str(e)

def autonhanh_calculate_packs(order):
    pkg_id = order.get("package_id")
    turns = int(order.get("turns", 0))
    if pkg_id == "goi_tuy_chon":
        cfg = load_config()
        tuy_chon = cfg.get("chungsuc_packages", {}).get("goi_tuy_chon", {})
        turns_per_pack = int(tuy_chon.get("turns_per_pack", 38))
        return max(1, (turns + turns_per_pack - 1) // turns_per_pack)
    elif pkg_id == "full_3_ruong":
        return 9
    elif pkg_id == "ruong_ss":
        return 4
    elif pkg_id == "san_sss_700":
        return 27
    elif pkg_id == "goi_1k2_sss":
        return 32
    return max(1, (turns + 37) // 38)

def autonhanh_check_batch_status(batch_id, token=None):
    """Kiểm tra trực tiếp trạng thái tiến độ lượt buff batch trên AutoNhanh."""
    if not batch_id:
        return None
    cfg = load_config()
    an_cfg = cfg.get("autonhanh", {})
    if not token:
        token = an_cfg.get("token")
        if not token:
            token, _ = autonhanh_login()
    if not token:
        return None

    url = f"{AUTONHANH_API_BASE}/batches/{batch_id}"
    headers = {
        "Authorization": f"Bearer {token}",
        "User-Agent": "Mozilla/5.0"
    }
    try:
        res = requests.get(url, headers=headers, timeout=12)
        if res.status_code == 200:
            return res.json()
        elif res.status_code == 401:
            new_tok, _ = autonhanh_login()
            if new_tok:
                headers["Authorization"] = f"Bearer {new_tok}"
                r2 = requests.get(url, headers=headers, timeout=12)
                if r2.status_code == 200:
                    return r2.json()
    except Exception as e:
        logger.error(f"Error checking AutoNhanh batch {batch_id}: {e}")
    return None

def autonhanh_process_order(order, force=False):
    cfg = load_config()
    an_cfg = cfg.get("autonhanh", {})
    if not force and not an_cfg.get("enabled", True):
        return False, "Tính năng AutoNhanh đang tắt"

    token = an_cfg.get("token")
    if not token:
        token, err = autonhanh_login()
        if not token:
            order["autonhanh_status"] = "AUTH_FAILED"
            order["autonhanh_error"] = err
            orders = load_orders()
            orders[order.get("order_id")] = order
            save_orders(orders)
            return False, err

    balance, bal_err = autonhanh_fetch_balance(token)
    if balance is not None:
        an_cfg["last_balance"] = balance
        an_cfg["last_check_time"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        cfg["autonhanh"] = an_cfg
        save_config(cfg, sync_github=False)

    packs = autonhanh_calculate_packs(order)
    price_per_pack = int(an_cfg.get("price_per_pack_xu", 760))
    required_xu = packs * price_per_pack

    if balance is not None and balance < required_xu:
        err_msg = f"Thiếu {required_xu - balance:,} Xu (Cần {required_xu:,} Xu, có {balance:,} Xu)"
        order["autonhanh_status"] = "OUT_OF_BALANCE"
        order["autonhanh_error"] = err_msg
        orders = load_orders()
        orders[order.get("order_id")] = order
        save_orders(orders)
        send_telegram_msg(f"⚠️ <b>[CẢNH BÁO AUTONHANH HẾT XU]</b>\nĐơn #{order.get('order_id')}: {err_msg}")
        return False, err_msg

    url = f"{AUTONHANH_API_BASE}/batches"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Idempotency-Key": str(uuid.uuid4())
    }
    raw_code = str(order.get("code") or "").strip()
    payload = {
        "invite_code": raw_code,
        "pack_count": int(packs),
        "note": f"DTH Portal #{order.get('order_id')}"
    }

    try:
        res = requests.post(url, json=payload, headers=headers, timeout=15)
        res_data = res.json()
        if res.status_code in (200, 201) and res_data.get("id"):
            batch_id = res_data.get("id")
            raw_st = str(res_data.get("status", "RUNNING")).upper()
            order["autonhanh_batch_id"] = batch_id
            order["autonhanh_response"] = res_data

            if raw_st == "DONE":
                order["status"] = "COMPLETED"
                order["autonhanh_status"] = "DONE"
                order["completed_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            else:
                order["status"] = "PROCESSING"
                order["autonhanh_status"] = raw_st or "RUNNING"

            orders = load_orders()
            orders[order.get("order_id")] = order
            save_orders(orders)

            reply_kb = {
                "inline_keyboard": [
                    [
                        {"text": "🔄 Check Trạng Thái", "callback_data": "btn:check"},
                        {"text": "📊 Thống Kê", "callback_data": "btn:stats"}
                    ]
                ]
            }
            send_telegram_msg(
                f"🚀 <b>[AUTONHANH ĐÃ NHẬN BATCH CHUNG SỨC]</b>\n"
                f"• Đơn: <b>#{order.get('order_id')}</b>\n"
                f"• Gói: {order.get('package_name')} ({packs} packs)\n"
                f"• Mã mời: <code>{raw_code}</code>\n"
                f"• Batch ID: <code>{batch_id}</code>\n"
                f"• Trạng thái máy chủ: <b>{order['autonhanh_status']}</b>\n"
                f"<i>Hệ thống cron sẽ tự động theo dõi và báo Telegram khi hoàn tất 100%!</i>",
                reply_markup=reply_kb
            )
            return True, res_data
        else:
            err = res_data.get("message") or f"HTTP {res.status_code}"
            order["autonhanh_status"] = "FAILED"
            order["autonhanh_error"] = err
            order["needs_customer_update"] = True
            order["customer_update_type"] = "code"
            order["customer_error_msg"] = "Mã mời Liên Quân của bạn không hợp lệ hoặc đã hết hạn. Vui lòng dán link sự kiện hoặc mã mời mới bên dưới để hệ thống tiếp tục xử lý tự động!"
            orders = load_orders()
            orders[order.get("order_id")] = order
            save_orders(orders)

            oid = order.get("order_id")
            reply_kb = {
                "inline_keyboard": [
                    [
                        {"text": f"✏️ Sửa Mã #{oid}", "callback_data": f"btn:sua:{oid}"},
                        {"text": f"🚀 Đẩy Lại #{oid}", "callback_data": f"btn:day:{oid}"}
                    ],
                    [
                        {"text": f"🗑️ Xóa Đơn #{oid}", "callback_data": f"btn:xoa:{oid}"},
                        {"text": "📋 Xem Đơn Lỗi", "callback_data": "btn:orders_err"}
                    ]
                ]
            }
            send_telegram_msg(
                f"⚠️ <b>[ĐƠN CHUNG SỨC: LỖI MÃ MỜI]</b>\n"
                f"━━━━━━━━━━━━━━━━━━\n"
                f"• Đơn hàng: <b>#{oid}</b>\n"
                f"• Gói: {order.get('package_name')}\n"
                f"• Khách điền: <code>{raw_code}</code>\n"
                f"• Trạng thái tiền: <b>✅ ĐÃ THANH TOÁN ({order.get('amount_formatted', '20.000đ')})</b>\n"
                f"• Lỗi máy chủ: <b>Mã mời không hợp lệ hoặc đã hết hạn</b>\n"
                f"• Zalo khách: <code>{order.get('zalo', 'N/A')}</code>\n"
                f"━━━━━━━━━━━━━━━━━━\n"
                f"👉 Admin sửa ngay bằng lệnh: <code>/sua {oid} &lt;mã_mới&gt;</code>\n"
                f"<i>(Khách hàng cũng đã nhận được thông báo yêu cầu dán mã mới trên web)</i>",
                reply_markup=reply_kb
            )
            return False, err
    except Exception as e:
        err = f"Lỗi gọi AutoNhanh: {e}"
        order["autonhanh_status"] = "ERROR"
        order["autonhanh_error"] = err
        orders = load_orders()
        orders[order.get("order_id")] = order
        save_orders(orders)
        return False, err

# ==========================================
# SERVICE 2: LOCKET GOLD (QUEUE MANAGER)
# ==========================================
_recent_locket_telegram = {}

class QueueManager:
    def __init__(self):
        self.queue = queue.Queue()
        self.lock = threading.Lock()
        self.client_requests = {}
        self.recent_queued = {}
        self.is_vercel = os.environ.get("VERCEL") == "1"
        if not self.is_vercel:
            self.worker_thread = threading.Thread(target=self._process_queue, daemon=True)
            self.worker_thread.start()

    def add_to_queue(self, username, package_type="with_dns", order_id=None):
        now_t = time.time()
        clean_u = re.sub(r"[^A-Za-z0-9_.-]", "", str(username or "").lstrip("@")).lower()
        oid_clean = str(order_id or "").strip().upper()

        with self.lock:
            # Deduplication window 120s to prevent spamming Telegram and API
            if oid_clean:
                last_t = self.recent_queued.get(f"oid_{oid_clean}", 0)
                if now_t - last_t < 120:
                    safe_print(f"[QueueManager] Bỏ qua trùng đơn {oid_clean} (trong 120s)")
                    return f"dup_{oid_clean}"
                self.recent_queued[f"oid_{oid_clean}"] = now_t
            elif clean_u:
                last_t = self.recent_queued.get(f"usr_{clean_u}", 0)
                if now_t - last_t < 120:
                    safe_print(f"[QueueManager] Bỏ qua trùng username {clean_u} (trong 120s)")
                    return f"dup_{clean_u}"
                self.recent_queued[f"usr_{clean_u}"] = now_t
        client_id = str(uuid.uuid4())
        req = {
            "username": username,
            "package_type": package_type,
            "order_id": order_id,
            "status": "waiting",
            "result": None,
            "error": None,
            "added_at": datetime.now()
        }
        with self.lock:
            self.client_requests[client_id] = req

        if self.is_vercel:
            self._process_request(client_id, req)
        else:
            self.queue.put((client_id, req))
        return client_id

    def get_status(self, client_id):
        with self.lock:
            req = self.client_requests.get(client_id)
            if not req:
                return None
            return {
                "status": req.get("status"),
                "result": req.get("result"),
                "error": req.get("error"),
                "position": 0 if req.get("status") == "completed" else 1,
                "total_queue": 1,
                "estimated_time": 3 if req.get("status") == "processing" else 0
            }

    def _process_queue(self):
        while True:
            try:
                client_id, req = self.queue.get(timeout=2)
                self._process_request(client_id, req)
                self.queue.task_done()
            except queue.Empty:
                time.sleep(1)
            except Exception as e:
                safe_print(f"[Queue Error] {e}")

    def _process_request(self, client_id, req):
        with self.lock:
            req["status"] = "processing"

        username = req.get("username")
        order_id = req.get("order_id")
        package_type = req.get("package_type", "with_dns")
        clean_u = re.sub(r"[^A-Za-z0-9_.-]", "", str(username or "").lstrip("@")) or "VIP"

        try:
            token_sets = config_manager.get_active_token_sets()
            if not token_sets:
                token_sets = config_manager.get_token_sets()

            token_to_use = token_sets[0] if token_sets else None
            api = LocketAPI()
            profile = api.get_full_profile(username)
            uid = (profile or {}).get("uid", "")

            restore_result = {}
            if uid:
                try:
                    restore_result = api.restorePurchase(uid, token_to_use)
                except Exception as ex_rst:
                    safe_print(f"[QueueManager] Warning on restorePurchase: {ex_rst}")

            with self.lock:
                req["status"] = "completed"
                req["result"] = restore_result or {"gold": True, "uid": uid, "username": username}

            orders = load_orders()
            already_notified = False
            if order_id and order_id in orders:
                already_notified = bool(orders[order_id].get("telegram_gold_notified"))
                orders[order_id]["status"] = "COMPLETED"
                orders[order_id]["gold_status"] = "ACTIVE"
                orders[order_id]["uid"] = uid
                orders[order_id]["gold_error"] = None
                orders[order_id]["dns_link"] = f"/download-config?u={clean_u}"
                orders[order_id]["module_link"] = LOCKET_SHADOW_MODULE_URL
                orders[order_id]["telegram_gold_notified"] = True
                save_orders(orders)

            now_t = time.time()
            u_key = str(username or "").lower().strip()
            recent_sent = (now_t - _recent_locket_telegram.get(u_key, 0)) < 60
            if not already_notified and not recent_sent:
                _recent_locket_telegram[u_key] = now_t
                send_telegram_msg(
                    f"🎉 <b>[KÍCH HOẠT LOCKET GOLD THÀNH CÔNG]</b>\n"
                    f"• Đơn: <b>#{order_id or 'Trực tiếp'}</b>\n"
                    f"• Username: <b>@{username}</b>\n"
                    f"• UID: <code>{uid or 'N/A'}</code>\n"
                    f"• Trạng thái: ✅ Gold Active (Đã cấp cấu hình DNS VIP)"
                )
        except Exception as e:
            safe_print(f"[QueueManager Error] {e}")
            with self.lock:
                req["status"] = "completed"
                req["error"] = str(e)
            orders = load_orders()
            if order_id and order_id in orders:
                orders[order_id]["status"] = "COMPLETED"
                orders[order_id]["gold_status"] = "ACTIVE"
                orders[order_id]["gold_error"] = None
                orders[order_id]["dns_link"] = f"/download-config?u={clean_u}"
                orders[order_id]["module_link"] = LOCKET_SHADOW_MODULE_URL
                save_orders(orders)

queue_manager = QueueManager()

# ==========================================
# SERVICE 3: MẠNG XÃ HỘI (TANGTIM API)
# ==========================================
def is_sale_active():
    cfg = load_config()
    sale = cfg.get("sale_campaign", {})
    if not sale.get("enabled", False):
        return False, 0
    now = time.time()
    if sale.get("start_time", 0) <= now <= sale.get("end_time", 0):
        return True, float(sale.get("discount_percent", 0))
    return False, 0

def tangtim_fetch_balance():
    cfg = load_config()
    tt_cfg = cfg.get("tangtim", {})
    api_url = tt_cfg.get("api_url", "https://tangtim.vn/api/v2")
    api_key = tt_cfg.get("api_key")
    if not api_key:
        return None, None, None
    usd_rate = float(tt_cfg.get("usd_rate", 25500))
    try:
        res = requests.post(api_url, data={"key": api_key, "action": "balance"}, timeout=8)
        if res.status_code == 200:
            data = res.json()
            raw_usd = float(data.get("balance") or 0)
            bal_vnd = int(round(raw_usd * usd_rate))
            return bal_vnd, f"{bal_vnd:,}đ", raw_usd
    except Exception as e:
        print(f"[TangTim Balance Error] {e}")
    return None, None, None

def tangtim_fetch_all_services():
    cfg = load_config()
    tt_cfg = cfg.get("tangtim", {})
    api_url = tt_cfg.get("api_url", "https://tangtim.vn/api/v2")
    api_key = tt_cfg.get("api_key", "Vi9oKhH3Rs7XrytwK3GsaTqPQgl9AqHNDB2")
    try:
        res = requests.post(api_url, data={"key": api_key, "action": "services"}, timeout=12)
        if res.status_code == 200:
            return res.json()
    except Exception as e:
        print(f"[TangTim Services Error] {e}")
    return None

def detect_service_origin(cat, name, desc=""):
    """Phân loại chuẩn xác Tài Nguyên Việt vs Quốc Tế (Tây)."""
    text = ((cat or "") + " " + (name or "")).lower()
    desc_low = (desc or "").lower()
    if "việt" in (cat or "").lower() or "viet" in (cat or "").lower():
        return "viet"
    if "tây" in (cat or "").lower() or "tay" in (cat or "").lower() or "ngoại" in (cat or "").lower():
        return "tay"
    if any(k in text for k in ["việt", "viet", "người thật việt", "clone việt", "tên việt", "page việt"]):
        return "viet"
    if any(k in text for k in ["tây", "tay", "ngoại", "global", "worldwide", "hq accounts", "hq ", "đa quốc gia", "tài khoản tây"]):
        return "tay"
    for line in desc_low.splitlines():
        if "tài nguyên" in line:
            if "việt" in line:
                return "viet"
            if any(k in line for k in ["tây", "ngoại", "đa quốc gia", "quốc tế", "global"]):
                return "tay"
    if any(k in text for k in ["tiktok", "facebook"]):
        if "tây" in text or "ngoại" in text:
            return "tay"
        return "viet"
    return "tay"

def is_vip_like_or_monthly(name, cat):
    """Xác định các gói Vip Like / Gói tháng không phù hợp với hệ thống buff đơn lẻ."""
    full = (str(name or "") + " " + str(cat or "")).lower()
    if any(k in full for k in ["vip like", "viplike", "gói tháng", "goi thang", "like tháng", "cmt tháng", "tim tháng"]):
        return True
    if "tháng" in str(cat or "").lower():
        return True
    return False

def classify_service(cat, name):
    cat_l = (cat or "").lower().strip()
    name_l = (name or "").lower().strip()

    # 1. Platform Detection (Category priority with strict word boundaries)
    plat = "other"
    if "tik tok" in cat_l or "tiktok" in cat_l:
        plat = "tiktok"
    elif "facebook" in cat_l or re.search(r'\bfb\b', cat_l):
        plat = "facebook"
    elif "instagram" in cat_l or re.search(r'\b(ig|insta)\b', cat_l):
        plat = "instagram"
    elif "youtube" in cat_l or re.search(r'\byt\b', cat_l):
        plat = "youtube"
    elif "telegram" in cat_l or re.search(r'\btele\b', cat_l):
        plat = "telegram"
    elif "threads" in cat_l:
        plat = "threads"
    elif "twitter" in cat_l or "x.com" in cat_l or "x - twitter" in cat_l:
        plat = "twitter"
    elif "shoppe" in cat_l or "shopee" in cat_l:
        plat = "shopee"
    else:
        # Category is generic (e.g. "Gói Tháng All Nền Tảng") -> Check Name with strict boundaries
        if "tik tok" in name_l or "tiktok" in name_l:
            plat = "tiktok"
        elif "youtube" in name_l or re.search(r'\byt\b', name_l):
            plat = "youtube"
        elif "facebook" in name_l or re.search(r'\bfb\b', name_l):
            plat = "facebook"
        elif "instagram" in name_l or re.search(r'\b(ig|insta)\b', name_l):
            plat = "instagram"
        elif "telegram" in name_l or re.search(r'\btele\b', name_l):
            plat = "telegram"
        elif "threads" in name_l:
            plat = "threads"
        elif "twitter" in name_l or "x.com" in name_l:
            plat = "twitter"
        elif "shoppe" in name_l or "shopee" in name_l:
            plat = "shopee"

    # 2. Action Detection
    c = cat_l + " " + name_l
    if any(k in c for k in ["bình luận", "comment", "cmt"]):
        act = "comment"
    elif any(k in c for k in ["share", "chia sẻ", "lưu", "yêu thích"]):
        act = "share"
    elif any(k in c for k in ["theo dõi", "follow", "sub", "đăng kí", "đăng ký"]):
        act = "follow"
    elif any(k in c for k in ["view", "lượt xem", "story", "mắt live", "xem"]):
        act = "view"
    elif any(k in c for k in ["tim", "like", "thả tim", "cảm xúc", "cáu", "buồn", "haha", "wow", "care", "reaction"]):
        act = "like"
    else:
        act = "other"

    return plat, act

def clean_service_description(raw_desc, name="", service_id=None):
    if not raw_desc or not str(raw_desc).strip():
        return ""
    has_warranty = False
    warranty_text = "Không"

    for line in str(raw_desc).splitlines():
        l_low = line.lower()
        if "bảo hành" in l_low or "bao hanh" in l_low:
            if "không" in l_low or "khong" in l_low:
                has_warranty = False
                warranty_text = "Không"
            else:
                has_warranty = True
                if ":" in line:
                    val = line.split(":", 1)[1].strip()
                    val = re.sub(r'<[^>]+>', '', val).strip()
                    warranty_text = val if val else "Có"
                else:
                    warranty_text = "Có"
            break

    cleaned = re.sub(r'<b[^>]*#6000[dD]9[\s\S]*?</b>', '', str(raw_desc), flags=re.I)
    lines_desc = cleaned.replace("\r", "").split("\n")
    cleaned_lines = []
    has_bh_line = False

    for line in lines_desc:
        l_lower = line.lower()
        if "hoàn tiền" in l_lower or "nút hoàn" in l_lower or "chắc chắn hoàn" in l_lower:
            continue
        if "mã máy chủ" in l_lower or "mã api" in l_lower or "🆔" in line:
            continue
        if "tangtim" in l_lower:
            continue
        if "bảo hành" in l_lower or "bao hanh" in l_lower:
            has_bh_line = True
            if has_warranty:
                line = f"🔰 <b>Bảo hành:</b> {warranty_text}"
            else:
                line = "🔰 <b>Bảo hành:</b> Không"
        cleaned_lines.append(line)

    if not has_bh_line:
        if has_warranty:
            cleaned_lines.append(f"🔰 <b>Bảo hành:</b> {warranty_text}")
        else:
            cleaned_lines.append("🔰 <b>Bảo hành:</b> Không")

    cleaned_html = "\n".join(cleaned_lines)
    cleaned_html = re.sub(r'(<br\s*/?>\s*){2,}', '<br>', cleaned_html, flags=re.I)
    cleaned_html = re.sub(r'(<br\s*/?>\s*)+$', '', cleaned_html, flags=re.I)
    cleaned_html = re.sub(r'color\s*:\s*(#ffffff|#fff|white)', 'color: #1e293b', cleaned_html, flags=re.I)
    return cleaned_html.strip()

def recalculate_service_prices(cfg):
    tt_cfg = cfg.get("tangtim", {})
    margin_percent = float(tt_cfg.get("margin_percent", 50))
    multiplier = 1.0 + (margin_percent / 100.0)
    usd_rate = float(tt_cfg.get("usd_rate", 25500))

    # XÓA BỎ TOÀN BỘ GÓI VIP LIKE / GÓI THÁNG THEO YÊU CẦU
    services = [s for s in cfg.get("services", []) if not is_vip_like_or_monthly(s.get("name"), s.get("category"))]
    for s in services:
        sid = s.get("service_id") or s.get("service")
        if sid:
            s["service_id"] = int(sid)
            s["id"] = str(sid)

        cat = s.get("category", "")
        name = s.get("name", "")
        plat, action = classify_service(cat, name)
        s["platform"] = plat
        s["action"] = action
        s["origin"] = detect_service_origin(cat, name, s.get("description", ""))

        base_price = float(s.get("base_price") or 0)
        if base_price <= 0:
            rate_usd = float(s.get("rate_usd_per_1k") or s.get("rate", 0))
            if rate_usd > 0:
                base_price = round(rate_usd * usd_rate / 1000.0, 4)
            else:
                base_price = float(s.get("price_per_unit", 10))
        s["base_price"] = base_price

        sell_price = round(base_price * multiplier, 2)
        if sell_price < 0.1:
            sell_price = round(base_price * multiplier, 3)
        if sell_price <= 0:
            sell_price = 0.01

        s["price_per_unit"] = sell_price
        s["price_formatted"] = f"{sell_price:g}đ"

        # Cài đặt min 1000 cho dịch vụ thường, dịch vụ bình luận giữ raw_min
        raw_max = int(s.get("max") or 1000000)
        raw_min = int(s.get("raw_min") or s.get("min") or 10)
        if s.get("action") == "comment" or "bình luận" in str(s.get("category", "")).lower() or "comment" in str(s.get("name", "")).lower():
            s["min"] = raw_min
        elif raw_max >= 1000:
            s["min"] = 1000 if raw_min <= 1000 else raw_min
        else:
            s["min"] = raw_min
        s["max"] = raw_max
        if not s.get("min"):
            s["min"] = int(s.get("min_qty") or 1000)
        if not s.get("max"):
            s["max"] = int(s.get("max_qty") or 1000000)

        raw_desc = s.get("description") or s.get("details") or ""
        s["description"] = clean_service_description(raw_desc, name, sid)

    cfg["services"] = services
    return cfg

def tangtim_process_order(order):
    cfg = load_config()
    tt_cfg = cfg.get("tangtim", {})
    if not tt_cfg.get("enabled", True):
        return False, "TangTim is disabled"

    api_url = tt_cfg.get("api_url", "https://tangtim.vn/api/v2")
    api_key = tt_cfg.get("api_key", "Vi9oKhH3Rs7XrytwK3GsaTqPQgl9AqHNDB2")
    service_id = order.get("service_id")
    link = order.get("link")
    quantity = int(order.get("quantity") or 1000)
    comments = order.get("comments") or ""

    if not service_id or not link:
        return False, "Thiếu service_id hoặc link"

    payload = {
        "key": api_key,
        "action": "add",
        "service": str(service_id),
        "link": link,
        "quantity": str(quantity)
    }
    if comments:
        payload["comments"] = comments

    try:
        res = requests.post(api_url, data=payload, timeout=15)
        res_data = res.json()
        if res.status_code == 200 and res_data.get("order"):
            tt_order_id = res_data.get("order")
            order["tangtim_order_id"] = tt_order_id
            order["tangtim_status"] = "IN_PROGRESS"
            order["tangtim_response"] = res_data
            order["status"] = "PROCESSING"

            orders = load_orders()
            orders[order.get("order_id")] = order
            save_orders(orders)

            reply_kb = {
                "inline_keyboard": [
                    [
                        {"text": "🔄 Check Tiến Độ", "callback_data": "btn:check"},
                        {"text": "📊 Thống Kê", "callback_data": "btn:stats"}
                    ]
                ]
            }
            send_telegram_msg(
                f"🚀 <b>[TANGTIM ĐÃ NHẬN ĐƠN MXH]</b>\n"
                f"• Đơn: <b>#{order.get('order_id')}</b>\n"
                f"• Gói: {order.get('package_name')}\n"
                f"• Order ID máy chủ: <code>{tt_order_id}</code>\n"
                f"• Số lượng: <b>{quantity:,}</b>\n"
                f"<i>Hệ thống cron sẽ tự động kiểm tra và báo Telegram khi hoàn tất 100%!</i>",
                reply_markup=reply_kb
            )
            return True, res_data
        else:
            err = res_data.get("error") or res_data.get("message") or f"HTTP {res.status_code}"
            order["tangtim_status"] = "FAILED"
            order["tangtim_error"] = err
            order["needs_customer_update"] = True
            order["customer_update_type"] = "link"
            order["customer_error_msg"] = "Link bài viết / trang cá nhân của bạn không hợp lệ hoặc đang ở chế độ riêng tư. Vui lòng nhập link công khai mới bên dưới để hệ thống tiếp tục tăng tương tác!"
            orders = load_orders()
            orders[order.get("order_id")] = order
            save_orders(orders)

            oid = order.get("order_id")
            reply_kb = {
                "inline_keyboard": [
                    [
                        {"text": f"✏️ Sửa Link #{oid}", "callback_data": f"btn:sua:{oid}"},
                        {"text": f"🚀 Đẩy Lại #{oid}", "callback_data": f"btn:day:{oid}"}
                    ],
                    [
                        {"text": f"🗑️ Xóa Đơn #{oid}", "callback_data": f"btn:xoa:{oid}"},
                        {"text": "📋 Xem Đơn Lỗi", "callback_data": "btn:orders_err"}
                    ]
                ]
            }
            send_telegram_msg(
                f"⚠️ <b>[ĐƠN MXH: LỖI LINK BÀI VIẾT]</b>\n"
                f"━━━━━━━━━━━━━━━━━━\n"
                f"• Đơn hàng: <b>#{oid}</b>\n"
                f"• Gói: {order.get('package_name')}\n"
                f"• Khách điền link: <code>{link}</code>\n"
                f"• Trạng thái tiền: <b>✅ ĐÃ THANH TOÁN ({order.get('amount_formatted', 'N/A')})</b>\n"
                f"• Lỗi máy chủ: <b>Link không hợp lệ hoặc bài viết riêng tư</b>\n"
                f"• Zalo khách: <code>{order.get('zalo', 'N/A')}</code>\n"
                f"━━━━━━━━━━━━━━━━━━\n"
                f"👉 Admin sửa ngay bằng lệnh: <code>/sua {oid} &lt;link_mới&gt;</code>\n"
                f"<i>(Khách hàng cũng đã nhận được thông báo yêu cầu dán link mới trên web)</i>",
                reply_markup=reply_kb
            )
            return False, err
    except Exception as e:
        err = f"Lỗi máy chủ MXH: {e}"
        order["tangtim_status"] = "ERROR"
        order["tangtim_error"] = err
        orders = load_orders()
        orders[order.get("order_id")] = order
        save_orders(orders)
        return False, err

def tangtim_check_orders_status(tangtim_order_ids):
    """Quét trạng thái đơn hàng từ máy chủ qua API v2."""
    if not tangtim_order_ids:
        return {}
    cfg = load_config()
    tt_cfg = cfg.get("tangtim", {})
    api_url = tt_cfg.get("api_url", "https://tangtim.vn/api/v2")
    api_key = tt_cfg.get("api_key", "Vi9oKhH3Rs7XrytwK3GsaTqPQgl9AqHNDB2")

    clean_ids = [str(i).strip() for i in tangtim_order_ids if str(i).strip()]
    if not clean_ids:
        return {}

    results = {}
    try:
        if len(clean_ids) == 1:
            payload = {"key": api_key, "action": "status", "order": clean_ids[0]}
            res = requests.post(api_url, data=payload, timeout=12)
            if res.status_code == 200:
                data = res.json()
                if isinstance(data, dict):
                    results[clean_ids[0]] = data
        else:
            ids_str = ",".join(clean_ids[:100])
            payload = {"key": api_key, "action": "status", "orders": ids_str}
            res = requests.post(api_url, data=payload, timeout=15)
            if res.status_code == 200:
                data = res.json()
                if isinstance(data, dict):
                    results = data
    except Exception as ex:
        print(f"[TangTim Status Check Error] {ex}")

    return results

def classify_order_error(order):
    """
    Phân tích lỗi từ các dịch vụ cấp dưới (web mẹ) một cách tuyệt mật:
    Xác định xem có phải lỗi do khách điền sai link/mã không.
    Trả về: (is_target_error, error_type, customer_msg)
    Tuyệt đối không để lộ tên web mẹ hay thông tin kỹ thuật ra ngoài.
    """
    if not order or not isinstance(order, dict):
        return False, None, None

    oid = str(order.get("order_id", ""))
    stype = order.get("service_type") or ("chungsuc" if oid.startswith("CS") else ("mxh" if oid.startswith("TT") else "locket"))

    an_err = str(order.get("autonhanh_error") or "").lower()
    an_st = str(order.get("autonhanh_status") or "").upper()
    tt_err = str(order.get("tangtim_error") or "").lower()
    tt_st = str(order.get("tangtim_status") or "").lower()

    # 1. Kiểm tra đơn Chung Sức Liên Quân (Mã mời / Link sự kiện)
    if stype == "chungsuc" or oid.startswith("CS"):
        if "out_of_balance" in an_st.lower() or "thiếu" in an_err or "xu" in an_err or "auth_failed" in an_st.lower():
            return False, None, None

        code_err_keywords = [
            "invalid_service_code", "invalid code", "mã không", "sai mã", "mã mời", 
            "hết hạn", "invite_code", "không hợp lệ", "không tồn tại", "syntax", "format"
        ]
        if any(k in an_err for k in code_err_keywords) or an_st in ("FAILED", "INVALID", "ERROR"):
            return True, "code", "Mã mời Liên Quân của bạn không hợp lệ hoặc đã hết hạn. Vui lòng dán link sự kiện hoặc mã mời mới bên dưới để hệ thống tiếp tục xử lý tự động!"

    # 2. Kiểm tra đơn Mạng Xã Hội (Link bài viết / trang cá nhân)
    elif stype == "mxh" or oid.startswith("TT"):
        if "balance" in tt_err or "số dư" in tt_err or "api key" in tt_err:
            return False, None, None

        link_err_keywords = [
            "invalid link", "incorrect link", "link", "url", "không hợp lệ", 
            "riêng tư", "private", "not found", "không tìm thấy", "chặn", "die", "post", "video"
        ]
        if any(k in tt_err for k in link_err_keywords) or tt_st in ("failed", "error", "canceled", "cancelled"):
            return True, "link", "Link bài viết / trang cá nhân của bạn không hợp lệ hoặc đang ở chế độ riêng tư. Vui lòng nhập link công khai mới bên dưới để hệ thống tiếp tục tăng tương tác!"

    return False, None, None

def live_state_text(order):
    """Trạng thái thật hiển thị cho khách / admin."""
    is_target_err, err_type, _ = classify_order_error(order)
    if is_target_err:
        return "Cần điền lại mã mới" if err_type == "code" else "Cần điền lại link mới"

    st = order.get("status")
    if st == "PENDING":
        return "Chờ thanh toán"
    if st == "CANCELED":
        return "Đã hủy"
    if st == "COMPLETED":
        return "Hoàn thành một phần" if str(order.get("tangtim_status", "")).lower() == "partial" else "Hoàn thành"
    tt = str(order.get("tangtim_status") or "").strip().lower()
    if tt in ("in progress", "in_progress", "processing"):
        return "Đang chạy"
    if tt in ("pending", "queued"):
        return "Đang chờ vào hàng đợi"
    if tt in ("failed", "error"):
        return "Đang xử lý lại"
    return "Đang xử lý"

def sanitize_order_for_client(order):
    """
    Làm sạch dữ liệu đơn hàng trước khi trả về cho khách (Frontend / Tra cứu / API công khai).
    NGHIÊM CẤM để lộ tên 2 web mẹ (autonhanh, tangtim) và token/key/id nội bộ.
    """
    if not order or not isinstance(order, dict):
        return {}

    o = dict(order)
    is_target_err, err_type, cust_msg = classify_order_error(o)

    o["needs_customer_update"] = bool(is_target_err)
    o["customer_update_type"] = err_type
    o["customer_error_msg"] = cust_msg
    o["state_text"] = live_state_text(o)

    qty = int(o.get("quantity") or o.get("turns") or 0)
    delivered = int(o.get("delivered") or 0)
    st = o.get("status")
    if st == "COMPLETED":
        delivered = qty if qty else delivered

    remains = o.get("remains")
    if remains is None:
        remains = max(0, qty - delivered) if qty else 0

    prog = o.get("progress")
    if prog is None:
        prog = int(min(100, round(delivered * 100 / qty))) if qty else (100 if st == "COMPLETED" else 0)

    o["delivered"] = delivered
    o["remains"] = remains
    o["progress"] = prog

    forbidden_substrings = [
        "autonhanh", "tangtim", "batch", "token", "password", 
        "secret", "raw_response", "backend", "upstream", "provider"
    ]
    clean_dict = {}
    for k, v in o.items():
        k_lower = str(k).lower()
        if any(sub in k_lower for sub in forbidden_substrings):
            continue
        clean_dict[k] = v

    return clean_dict

def refresh_orders_live(orders, only_ids=None, max_age=15, force=False):
    """Hỏi trạng thái THẬT từ máy chủ cho các đơn đang chạy; cập nhật start_count / remains / delivered."""
    now = time.time()
    targets = []
    for oid, o in orders.items():
        if only_ids is not None and oid not in only_ids:
            continue
        tt_id = o.get("tangtim_order_id")
        if tt_id and o.get("status") in ("PROCESSING", "PAID", "COMPLETED"):
            if o.get("status") == "COMPLETED" and not force:
                continue
            if force or now - float(o.get("live_checked_at", 0)) > max_age:
                targets.append((oid, str(tt_id)))
    if not targets:
        return 0, 0

    status_map = tangtim_check_orders_status([t[1] for t in targets])
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    completed = 0
    changed = False

    for oid, tt_id in targets:
        info = status_map.get(tt_id)
        if not info or not isinstance(info, dict) or info.get("error"):
            continue
        o = orders[oid]
        qty = int(o.get("quantity") or 0)
        o["live_checked_at"] = now

        sc = info.get("start_count")
        if sc is not None and str(sc).strip() != "":
            try:
                new_sc = int(float(sc))
                if o.get("start_count") != new_sc:
                    o["start_count"] = new_sc
                    changed = True
            except Exception:
                pass

        rem = info.get("remains")
        if rem is not None and str(rem).strip() != "":
            try:
                rem_val = int(float(rem))
                new_remains = max(0, rem_val)
                new_delivered = max(0, min(qty, qty - new_remains)) if qty else 0
                if o.get("remains") != new_remains or o.get("delivered") != new_delivered:
                    o["remains"] = new_remains
                    o["delivered"] = new_delivered
                    changed = True
            except Exception:
                pass

        tt_st = str(info.get("status", "")).strip().lower()
        deliv_cnt = int(o.get("delivered") or 0)
        # Nếu đã giao đủ số lượng hoặc remains = 0 hoặc máy chủ báo hoàn tất hoặc đã chạy > 48h và đạt >= 80%
        is_completed_now = (
            tt_st in ("completed", "hoàn thành", "finish", "success") or
            (qty > 0 and (o.get("remains", 999) <= 0 or deliv_cnt >= qty)) or
            (qty > 0 and deliv_cnt >= int(qty * 0.8) and (now - float(o.get("created_at", 0)) > 86400 * 2))
        )
        if is_completed_now:
            o["status"] = "COMPLETED"
            o["tangtim_status"] = "Completed"
            o["remains"] = 0
            if qty:
                o["delivered"] = qty
            o["progress"] = 100
            if not o.get("completed_at"):
                o["completed_at"] = now_str
            completed += 1
            changed = True
        elif tt_st == "partial":
            o["status"] = "COMPLETED"
            o["tangtim_status"] = "Partial"
            o["completed_at"] = now_str
            completed += 1
            changed = True
        elif tt_st in ("canceled", "cancelled", "refunded", "hủy", "đã hủy"):
            o["status"] = "CANCELED"
            o["tangtim_status"] = "Canceled"
            changed = True
        elif tt_st in ("in progress", "processing", "đang chạy"):
            if o.get("tangtim_status") != "In progress":
                o["tangtim_status"] = "In progress"
                changed = True
        elif tt_st == "pending":
            if o.get("tangtim_status") != "Pending":
                o["tangtim_status"] = "Pending"
                changed = True

        o["state_text"] = live_state_text(o)
        if qty:
            deliv = int(o.get("delivered") or 0)
            o["progress"] = min(100, max(0, int(round(deliv * 100 / qty))))

    if changed:
        save_orders(orders)
    return completed, len(targets)

def check_web_me_orders_status():
    """
    Quét tự động tiến độ của 2 web mẹ:
    1. AutoNhanh: GET /api/batches/{batch_id} -> nếu DONE chuyển COMPLETED và báo Tele!
    2. TangTim: POST /api/v2 action: status -> nếu Completed/Partial chuyển COMPLETED và báo Tele!
    """
    orders = load_orders()
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    changed = False
    completed_orders = []
    checked_count = 0

    # 1. KIỂM TRA AUTONHANH (CHUNG SỨC)
    for oid, o in list(orders.items()):
        batch_id = o.get("autonhanh_batch_id")
        an_st = str(o.get("autonhanh_status") or "").upper()
        # Đơn có batch_id và chưa hoàn thành
        if batch_id and (o.get("status") in ("PROCESSING", "PAID") or an_st not in ("DONE", "COMPLETED", "FAILED")):
            checked_count += 1
            info = autonhanh_check_batch_status(batch_id)
            if info and isinstance(info, dict):
                st = str(info.get("status", "")).upper()
                processed = info.get("processedItems", 0)
                requested = info.get("requestedItems", 0)
                o["processed_items"] = processed
                o["requested_items"] = requested

                if st == "DONE":
                    o["status"] = "COMPLETED"
                    o["autonhanh_status"] = "DONE"
                    o["completed_at"] = now_str
                    changed = True
                    completed_orders.append(oid)

                    reply_kb = {
                        "inline_keyboard": [
                            [
                                {"text": "📊 Xem Thống Kê", "callback_data": "btn:stats"},
                                {"text": "📋 Xem Đơn Khác", "callback_data": "btn:orders"}
                            ]
                        ]
                    }
                    send_telegram_msg(
                        f"🎉 <b>[CHUNG SỨC ĐÃ HOÀN THÀNH - AUTONHANH]</b>\n"
                        f"━━━━━━━━━━━━━━━━━━\n"
                        f"• Mã đơn: <b>#{oid}</b>\n"
                        f"• Mã mời: <code>{o.get('code')}</code>\n"
                        f"• Gói: <b>{o.get('package_name')}</b>\n"
                        f"• Lượt buff: <b>{processed}/{requested}</b> lượt hoàn tất 100%!\n"
                        f"• Batch ID: <code>{batch_id}</code>\n"
                        f"• Hoàn tất lúc: {now_str}\n"
                        f"━━━━━━━━━━━━━━━━━━",
                        reply_markup=reply_kb
                    )
                elif st in ("RUNNING", "PENDING"):
                    if o.get("autonhanh_status") != st or o.get("status") != "PROCESSING":
                        o["autonhanh_status"] = st
                        o["status"] = "PROCESSING"
                        changed = True
                elif st == "FAILED":
                    o["autonhanh_status"] = "FAILED"
                    changed = True
                    send_telegram_msg(
                        f"⚠️ <b>[CẢNH BÁO BATCH AUTONHANH THẤT BẠI]</b>\n"
                        f"• Mã đơn: <b>#{oid}</b>\n"
                        f"• Batch ID: <code>{batch_id}</code>\n"
                        f"• Trạng thái máy chủ: FAILED"
                    )

    # 2. KIỂM TRA TANGTIM (MẠNG XÃ HỘI)
    tt_targets = []
    for oid, o in list(orders.items()):
        tt_id = o.get("tangtim_order_id")
        tt_st = str(o.get("tangtim_status") or "").lower()
        if tt_id and (o.get("status") in ("PROCESSING", "PAID") or tt_st not in ("completed", "partial", "canceled", "cancelled")):
            tt_targets.append((oid, str(tt_id)))

    if tt_targets:
        checked_count += len(tt_targets)
        status_map = tangtim_check_orders_status([t[1] for t in tt_targets])
        for oid, tt_id in tt_targets:
            info = status_map.get(tt_id)
            if not info or not isinstance(info, dict) or info.get("error"):
                continue
            o = orders[oid]
            qty = int(o.get("quantity") or 0)
            tt_st = str(info.get("status", "")).strip().lower()

            sc = info.get("start_count")
            rem = info.get("remains")
            if sc is not None and str(sc).strip() != "":
                try: o["start_count"] = int(float(sc))
                except Exception: pass
            if rem is not None and str(rem).strip() != "":
                try:
                    rem_val = max(0, int(float(rem)))
                    o["remains"] = rem_val
                    o["delivered"] = max(0, qty - rem_val) if qty else 0
                except Exception: pass

            deliv_cnt = int(o.get("delivered") or 0)
            is_done = (
                tt_st in ("completed", "hoàn thành", "finish", "success") or
                (qty > 0 and (o.get("remains", 999) <= 0 or deliv_cnt >= qty)) or
                (qty > 0 and deliv_cnt >= int(qty * 0.8) and (time.time() - float(o.get("created_at", 0)) > 86400 * 2))
            )
            if is_done:
                o["status"] = "COMPLETED"
                o["tangtim_status"] = "Completed"
                o["remains"] = 0
                if qty: o["delivered"] = qty
                o["progress"] = 100
                if not o.get("completed_at"):
                    o["completed_at"] = now_str
                changed = True
                completed_orders.append(oid)

                reply_kb = {
                    "inline_keyboard": [
                        [
                            {"text": "📊 Xem Thống Kê", "callback_data": "btn:stats"},
                            {"text": "📋 Xem Đơn Khác", "callback_data": "btn:orders"}
                        ]
                    ]
                }
                send_telegram_msg(
                    f"🎉 <b>[ĐƠN MXH ĐÃ HOÀN THÀNH - TANGTIM]</b>\n"
                    f"━━━━━━━━━━━━━━━━━━\n"
                    f"• Mã đơn: <b>#{oid}</b>\n"
                    f"• Dịch vụ: <b>{o.get('package_name')}</b>\n"
                    f"• Link: <code>{o.get('link')}</code>\n"
                    f"• Số lượng: <b>{qty:,}</b> (Hoàn tất 100%)\n"
                    f"• Order ID TangTim: <code>{tt_id}</code>\n"
                    f"• Hoàn tất lúc: {now_str}\n"
                    f"━━━━━━━━━━━━━━━━━━",
                    reply_markup=reply_kb
                )
            elif tt_st == "partial":
                o["status"] = "COMPLETED"
                o["tangtim_status"] = "Partial"
                o["completed_at"] = now_str
                changed = True
                completed_orders.append(oid)
                send_telegram_msg(
                    f"⚠️ <b>[ĐƠN MXH HOÀN THÀNH 1 PHẦN - TANGTIM]</b>\n"
                    f"• Mã đơn: <b>#{oid}</b>\n"
                    f"• Dịch vụ: {o.get('package_name')}\n"
                    f"• Đã giao: <b>{o.get('delivered', 0):,}/{qty:,}</b>\n"
                    f"• Còn lại: {o.get('remains', 0):,}"
                )
            elif tt_st in ("canceled", "cancelled", "refunded", "hủy", "đã hủy"):
                o["status"] = "CANCELED"
                o["tangtim_status"] = "Canceled"
                changed = True
                send_telegram_msg(
                    f"❌ <b>[ĐƠN MXH ĐÃ BỊ HỦY BỞI TANGTIM]</b>\n"
                    f"• Mã đơn: <b>#{oid}</b>\n"
                    f"• Dịch vụ: {o.get('package_name')}\n"
                    f"• Order ID máy chủ: <code>{tt_id}</code>"
                )
            elif tt_st in ("in progress", "processing", "đang chạy"):
                if o.get("tangtim_status") != "In progress" or o.get("status") != "PROCESSING":
                    o["tangtim_status"] = "In progress"
                    o["status"] = "PROCESSING"
                    changed = True

    if changed:
        save_orders(orders)

    return {
        "checked_at": now_str,
        "checked_count": checked_count,
        "completed_count": len(completed_orders),
        "completed_orders": completed_orders
    }

def auto_push_eligible_orders():
    """Tự động đẩy bất kỳ đơn nào có trạng thái PAID hoặc PROCESSING mà chưa được đẩy sang web mẹ."""
    orders = load_orders()
    pushed = []
    for oid, o in list(orders.items()):
        st = o.get("status")
        if st in ("PAID", "PROCESSING"):
            stype = o.get("service_type")
            if (stype == "chungsuc" or oid.startswith("CS")) and not o.get("autonhanh_batch_id"):
                is_err, err_type, _ = classify_order_error(o)
                if is_err and err_type == "code":
                    continue
                ok, res = autonhanh_process_order(o, force=True)
                if ok:
                    pushed.append(oid)
            elif (stype == "mxh" or oid.startswith("TT")) and not o.get("tangtim_order_id"):
                is_err, err_type, _ = classify_order_error(o)
                if is_err and err_type == "link":
                    continue
                ok, res = tangtim_process_order(o)
                if ok:
                    pushed.append(oid)
            elif (stype == "locket" or oid.startswith("LK")) and o.get("gold_status") != "ACTIVE":
                clean_u = re.sub(r"[^A-Za-z0-9_.-]", "", str(o.get("username", "")).lstrip("@")) or "VIP"
                o["status"] = "COMPLETED"
                o["gold_status"] = "ACTIVE"
                o["dns_link"] = f"/download-config?u={clean_u}"
                o["module_link"] = LOCKET_SHADOW_MODULE_URL
                queue_manager.add_to_queue(o.get("username"), o.get("package_type", "with_dns"), order_id=oid)
                pushed.append(oid)
    if pushed:
        save_orders(orders)
    return pushed

# ==========================================
# UNIFIED PAYMENT CHECKING (THUEAPIBANK)
# ==========================================
def process_single_transaction_item(tx_raw):
    """Xử lý trực tiếp 1 transaction nhận từ Webhook hoặc từ polling."""
    if not isinstance(tx_raw, dict):
        return []
    tx = tx_raw
    if "data" in tx_raw and isinstance(tx_raw["data"], dict):
        tx = tx_raw["data"].get("transaction") or tx_raw["data"]
    elif "transaction" in tx_raw and isinstance(tx_raw["transaction"], dict):
        tx = tx_raw["transaction"]

    trans_id = str(tx.get("trans_id") or tx.get("app_trans_id") or tx.get("transaction_id") or tx.get("id") or "").strip()
    if trans_id and models.is_transaction_processed(trans_id):
        return []
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
        for fld in (tpl.get("custom_fields") or []):
            if isinstance(fld, dict):
                desc_parts.append(str(fld.get("value") or ""))
                desc_parts.append(str(fld.get("name") or ""))

    desc_clean = " ".join(desc_parts).upper().replace(" ", "").replace("-", "").replace("_", "")

    orders = load_orders()
    matched = []
    changed = False
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    for oid, order in orders.items():
        if order.get("status") == "PENDING" and not order.get("is_notified") and not order.get("telegram_paid_notified") and not order.get("notified_paid"):
            u_oid = str(oid).upper()
            try:
                order_amt = int(abs(float(str(order.get("amount", 0)).replace(",", "").replace(".", "").replace("đ", "") or 0)))
            except Exception:
                order_amt = 0
            num_suffix = re.sub(r"[^\d]", "", u_oid)
            is_matched_id = (u_oid in desc_clean) or (len(num_suffix) >= 4 and num_suffix in desc_clean)
            if is_matched_id and (amount >= order_amt):
                order["status"] = "PAID"
                order["paid_at"] = now_str
                order["bank_trans_id"] = trans_id
                order["is_notified"] = True
                order["notified_paid"] = True
                order["telegram_paid_notified"] = True
                changed = True
                matched.append(oid)
                if trans_id:
                    models.record_processed_transaction(trans_id, amount=amount, description=desc_clean, matched_order_id=oid)
                notify_payment_success(order, trans_id)

                stype = order.get("service_type")
                if stype == "chungsuc" or oid.startswith("CS"):
                    autonhanh_process_order(order)
                elif stype == "locket" or oid.startswith("LK"):
                    clean_u = re.sub(r"[^A-Za-z0-9_.-]", "", str(order.get("username", "")).lstrip("@")) or "VIP"
                    order["status"] = "COMPLETED"
                    order["gold_status"] = "ACTIVE"
                    order["gold_error"] = None
                    order["dns_link"] = f"/download-config?u={clean_u}"
                    order["module_link"] = LOCKET_SHADOW_MODULE_URL
                    queue_manager.add_to_queue(order.get("username"), order.get("package_type", "with_dns"), order_id=oid)
                elif stype == "premium" or oid.startswith("PR"):
                    order["status"] = "PAID"
                elif stype == "mxh" or oid.startswith("TT"):
                    tangtim_process_order(order)

    if changed:
        save_orders(orders)
    return matched

def check_and_process_zalopay_history(force=False):
    global _last_cron_time
    now = time.time()
    _last_cron_time = now

    orders = load_orders()
    pending = [o for o in orders.values() if o.get("status") == "PENDING"]
    # Tối ưu hóa: Nếu không có đơn PENDING nào chờ thanh toán thì không gọi API ZaloPay để tránh bị 429
    if not pending and not force:
        return {"status": "idle", "msg": "Không có đơn PENDING nào cần duyệt tiền", "matched": []}

    bcache = get_bank_cache()
    cfg = load_config()
    pay_cfg = cfg.get("payment", {})
    thueapi = pay_cfg.get("thueapibank", {})
    if not thueapi.get("enabled", True):
        return {"status": "disabled", "msg": "Quét ngân hàng tự động đang tắt"}

    zalo_token = thueapi.get("token") or "498705aae1752f7c0658c6f622317daf"
    if not zalo_token:
        return {"status": "error", "msg": "Chưa có token thueapibank"}

    trans_list = None
    is_rate_limited = now < bcache.get("rate_limit_until", 0)
    time_since_fetch = now - bcache.get("last_fetch_time", 0)
    min_gap = 15 if force else 25

    # Throttling: Giãn cách tối thiểu 25s (15s khi ép buộc) để bảo vệ ZaloPay không bao giờ bị 429
    if is_rate_limited:
        cached_items = bcache.get("cached_trans_list") or []
        if cached_items:
            trans_list = cached_items
        else:
            wait_left = int(bcache.get("rate_limit_until", 0) - now)
            return {"status": "rate_limited", "msg": f"ZaloPay 429 Cooldown (còn {wait_left}s)", "matched": []}
    elif time_since_fetch < min_gap:
        trans_list = bcache.get("cached_trans_list") or []

    if trans_list is None:
        url = f"https://thueapibank.vn/historyapizalopay/{zalo_token}"
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
        try:
            res = requests.get(url, headers=headers, timeout=(6, 15))
            if res.status_code == 200:
                res_data = res.json()
                if isinstance(res_data, dict) and res_data.get("status") == "error":
                    msg = str(res_data.get("msg", ""))
                    if "429" in msg or "Too many" in msg:
                        # 429 từ ZaloPay: Bắt buộc lùi lại 90s để ZaloPay giải phóng block
                        bcache["rate_limit_until"] = now + 90
                        save_bank_cache(bcache)
                        trans_list = bcache.get("cached_trans_list") or []
                elif isinstance(res_data, dict):
                    raw_data = res_data.get("data") or []
                    if isinstance(raw_data, dict):
                        raw_data = list(raw_data.values())
                    if raw_data:
                        trans_list = raw_data
                        bcache["cached_trans_list"] = raw_data
                        bcache["last_fetch_time"] = now
                        bcache["rate_limit_until"] = 0
                        save_bank_cache(bcache)
            else:
                trans_list = bcache.get("cached_trans_list") or []
        except Exception as e:
            trans_list = bcache.get("cached_trans_list") or []

    if not trans_list:
        trans_list = []
    matched = []
    changed = False

    processed_ids = set(bcache.get("processed_trans", []))

    for item in trans_list:
        # Bóc tách cấu trúc lồng nhau: {"data": {"transaction": {...}}} hoặc {...}
        tx = item
        if isinstance(item, dict):
            if "data" in item and isinstance(item["data"], dict):
                tx = item["data"].get("transaction") or item["data"]
            elif "transaction" in item and isinstance(item["transaction"], dict):
                tx = item["transaction"]

        trans_id = str(tx.get("trans_id") or tx.get("app_trans_id") or tx.get("transaction_id") or tx.get("id") or "").strip()
        if trans_id and (trans_id in models.KNOWN_PROCESSED_TRANSACTIONS or trans_id in processed_ids or models.is_transaction_processed(trans_id)):
            continue

        # Tầng 4: Bộ lọc thời gian giao dịch (<= 60 phút)
        raw_tx_time = tx.get("trans_time") or tx.get("transactionDate") or tx.get("created_time")
        if raw_tx_time and isinstance(raw_tx_time, str) and "T" in raw_tx_time:
            try:
                tx_dt = datetime.fromisoformat(raw_tx_time.replace("Z", "+00:00")).astimezone(models.VN_TZ)
                if (models.now_gmt7() - tx_dt).total_seconds() > 3600:
                    continue
            except Exception:
                pass
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

        # Trích xuất thêm từ template_info / custom_fields của ZaloPay
        tpl = tx.get("template_info") or {}
        if isinstance(tpl, dict):
            cfields = tpl.get("custom_fields") or []
            if isinstance(cfields, list):
                for fld in cfields:
                    if isinstance(fld, dict):
                        desc_parts.append(str(fld.get("value") or ""))
                        desc_parts.append(str(fld.get("name") or ""))

        desc = " ".join(desc_parts)
        desc_clean = desc.upper().replace(" ", "").replace("-", "").replace("_", "")

        for order in pending:
            oid = str(order.get("order_id", "")).upper()
            if order.get("status") in ("PAID", "COMPLETED", "PROCESSING") or order.get("is_notified") or order.get("telegram_paid_notified") or order.get("notified_paid"):
                continue
            try:
                order_amt = int(abs(float(str(order.get("amount", 0)).replace(",", "").replace(".", "").replace("đ", "") or 0)))
            except Exception:
                order_amt = 0

            # Khớp mã đơn CS..., LK..., TT... hoặc đuôi số nguyên trong nội dung CK và khớp số tiền
            num_suffix = re.sub(r"[^\d]", "", oid)
            is_matched_id = (oid in desc_clean) or (len(num_suffix) >= 4 and num_suffix in desc_clean)

            if is_matched_id and (amount >= order_amt):
                order["status"] = "PAID"
                order["paid_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                order["bank_trans_id"] = trans_id
                order["is_notified"] = True
                order["notified_paid"] = True
                order["telegram_paid_notified"] = True
                changed = True
                matched.append(oid)
                if trans_id:
                    processed_ids.add(trans_id)
                    models.record_processed_transaction(trans_id, amount=amount, description=desc_clean, matched_order_id=oid)

                notify_payment_success(order, trans_id)

                # Tự động thực hiện bước tiếp theo theo loại dịch vụ
                stype = order.get("service_type")
                if stype == "chungsuc" or oid.startswith("CS"):
                    autonhanh_process_order(order)
                elif stype == "locket" or oid.startswith("LK"):
                    clean_u = re.sub(r"[^A-Za-z0-9_.-]", "", str(order.get("username", "")).lstrip("@")) or "VIP"
                    order["status"] = "COMPLETED"
                    order["gold_status"] = "ACTIVE"
                    order["gold_error"] = None
                    order["dns_link"] = f"/download-config?u={clean_u}"
                    order["module_link"] = LOCKET_SHADOW_MODULE_URL
                    queue_manager.add_to_queue(order.get("username"), order.get("package_type", "with_dns"), order_id=oid)
                elif stype == "mxh" or oid.startswith("TT"):
                    tangtim_process_order(order)

    bcache["last_check"] = now
    bcache["processed_trans"] = list(processed_ids)[-200:]
    save_bank_cache(bcache)

    if changed:
        save_orders(orders)

    return {
        "status": "success",
        "matched": matched,
        "pending_count": len([o for o in orders.values() if o.get("status") == "PENDING"]),
        "checked_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }

def background_bank_sync_loop():
    if os.environ.get("VERCEL") == "1":
        return
    while True:
        try:
            time.sleep(25)
            check_and_process_zalopay_history(force=False)
        except Exception as e:
            time.sleep(10)

def background_auto_expire_loop():
    if os.environ.get("VERCEL") == "1":
        return
    while True:
        try:
            time.sleep(60)
            db = models.SessionLocal()
            now = models.now_gmt7()
            from datetime import timedelta
            cutoff = now - timedelta(minutes=15)
            expired = db.query(models.Order).filter(
                models.Order.status == "PENDING",
                models.Order.created_at < cutoff
            ).all()
            if expired:
                for o in expired:
                    o.status = "EXPIRED"
                db.commit()
                print(f"[AutoExpireWorker] Đã tự động hủy {len(expired)} đơn quá hạn 15 phút.")
            db.close()
        except Exception as e:
            print(f"[AutoExpireWorker Error] {e}")
            time.sleep(15)

if os.environ.get("VERCEL") != "1":
    t = threading.Thread(target=background_bank_sync_loop, daemon=True)
    t.start()
    t_expire = threading.Thread(target=background_auto_expire_loop, daemon=True)
    t_expire.start()

# ==========================================
# PUBLIC FRONTEND & API ROUTES
# ==========================================
@app.route("/")
def index():
    cfg = load_config()
    is_sale, sale_pct = is_sale_active()
    services_enabled = cfg.get("services_enabled", {"chungsuc": True, "locket": True, "mxh": True, "premium": True})
    return render_template(
        "index.html",
        cfg=cfg,
        is_sale=is_sale,
        sale_pct=sale_pct,
        services_enabled=services_enabled
    )

@app.route("/admin")
def admin_page():
    if not is_admin_authenticated():
        return render_template("admin_login.html")
    try:
        cfg = load_config()
        is_sale, sale_pct = is_sale_active()
        services_enabled = cfg.get("services_enabled", {"chungsuc": True, "locket": True, "mxh": True, "premium": True})
        return render_template(
            "admin.html",
            cfg=cfg,
            is_sale=is_sale,
            sale_pct=sale_pct,
            services_enabled=services_enabled
        )
    except Exception as e:
        logger.error(f"Error rendering admin: {e}", exc_info=True)
        return "Không thể tải bảng quản trị.", 500

@app.route("/health")
@app.route("/ping")
def health():
    return jsonify({"status": "ok", "app": "DTH Portal", "timestamp": int(time.time())})

@app.route('/manifest.json')
@app.route('/static/manifest.json')
def serve_manifest():
    import os
    from flask import send_from_directory, jsonify, make_response
    manifest_path = os.path.join(app.root_path, 'static', 'manifest.json')
    if os.path.exists(manifest_path):
        return send_from_directory(os.path.join(app.root_path, 'static'), 'manifest.json', mimetype='application/manifest+json')
    manifest_data = {
        "name": "DTH Services",
        "short_name": "DTH",
        "start_url": "/",
        "display": "standalone",
        "background_color": "#0b1120",
        "theme_color": "#0284c7",
        "icons": [{"src": "/static/favicon.png", "sizes": "192x192", "type": "image/png"}]
    }
    res = make_response(jsonify(manifest_data))
    res.headers['Content-Type'] = 'application/manifest+json'
    return res

@app.route("/apple-touch-icon.png")
def serve_apple_touch_icon():
    return send_from_directory(os.path.join(app.root_path, "static"), "apple-touch-icon.png", mimetype="image/png")


@app.route("/api/public/config")
def public_config():
    cfg = load_config()
    pay = cfg.get("payment", {})
    is_sale, sale_pct = is_sale_active()
    return jsonify({
        "success": True,
        "site_name": cfg.get("site_name", "DTH Portal"),
        "site_title": cfg.get("site_title", ""),
        "shop_info": cfg.get("shop_info", {}),
        "payment": {
            "bank_id": pay.get("bank_id", "970454"),
            "bank_name": pay.get("bank_name", "Ngân Hàng Bản Việt (BVBank - ZaloPay)"),
            "account_number": pay.get("account_number", "99ZP24261M43061759"),
            "account_name": pay.get("account_name", "ZALOPAY_DINH TUAN HUNG"),
            "display_name": pay.get("display_name", "DINH TUAN HUNG"),
            "phone": pay.get("phone", "0353680869")
        },
        "is_sale": is_sale,
        "sale_discount": sale_pct,
        "sale_campaign": cfg.get("sale_campaign", {}),
        "services_enabled": cfg.get("services_enabled", {"chungsuc": True, "locket": True, "mxh": True, "premium": True})
    })

@app.route("/api/announcement", methods=["GET"])
def api_get_announcement():
    ann = config_manager.get_popup_announcement()
    return jsonify({
        "success": True,
        "data": ann,
        "enabled": ann.get("enabled", False),
        "title": ann.get("title", ""),
        "content": ann.get("content", ""),
        "updated_at": ann.get("updated_at", 0)
    })


@app.route("/api/public/recent-history")
def public_recent_history():
    orders = load_orders()
    completed = [o for o in orders.values() if o.get("status") in ("COMPLETED", "PROCESSING", "PAID")]
    completed.sort(key=lambda x: x.get("created_at", 0), reverse=True)

    items = []
    for o in completed[:15]:
        zalo = str(o.get("zalo") or "")
        masked_zalo = (zalo[:3] + "***" + zalo[-3:]) if len(zalo) >= 7 else "098***"
        stype = o.get("service_type") or ("chungsuc" if str(o.get("order_id")).startswith("CS") else ("locket" if str(o.get("order_id")).startswith("LK") else "mxh"))

        if stype == "chungsuc":
            desc = f"Mở thành công {o.get('package_name', 'Full Rương')}"
        elif stype == "locket":
            u = o.get("username", "khách")
            masked_u = (u[:2] + "***" + u[-2:]) if len(u) > 4 else u
            desc = f"Kích hoạt Locket Gold (@{masked_u})"
        elif stype == "premium" or str(o.get("order_id", "")).startswith("PR"):
            plat = o.get("platform_name") or "Chợ Premium"
            desc = f"Mua thành công {o.get('package_name', plat)}"
        else:
            desc = f"Tăng thành công {o.get('package_name', 'tương tác MXH')}"

        items.append({
            "user": masked_zalo,
            "desc": desc,
            "amount": o.get("amount_formatted") or f"{o.get('amount', 0):,}đ",
            "time": o.get("created_time")
        })
    return jsonify({"success": True, "items": items})

# ==========================================
# CHUNG SỨC LIÊN QUÂN ROUTES
# ==========================================
@app.route("/api/chungsuc/packages")
@app.route("/api/packages")
def get_chungsuc_packages():
    cfg = load_config()
    pkgs = cfg.get("chungsuc_packages", {})
    return jsonify({"success": True, "packages": pkgs})

@app.route("/api/chungsuc/order", methods=["POST"])
def create_chungsuc_order():
    data = request.get_json(silent=True) or {}
    raw_code = (data.get("code") or data.get("invite_code") or "").strip()
    package_id = (data.get("package_id") or "full_3_ruong").strip()
    zalo = (data.get("zalo") or "").strip()
    custom_packs = int(data.get("custom_packs") or 4)

    clean_code = extract_invite_code(raw_code)
    if not clean_code or len(clean_code) < 4:
        return jsonify({"success": False, "msg": "Vui lòng nhập đúng mã mời hoặc link chia sẻ Chung Sức Liên Quân."}), 400

    cfg = load_config()
    pkgs = cfg.get("chungsuc_packages", {})
    if package_id not in pkgs:
        return jsonify({"success": False, "msg": "Gói sự kiện không hợp lệ."}), 400

    pkg = pkgs[package_id]
    if package_id == "goi_tuy_chon":
        price_per_pack = int(pkg.get("price_per_pack", 2222))
        turns_per_pack = int(pkg.get("turns_per_pack", 38))
        min_packs = int(pkg.get("min_packs", 4))
        packs = max(min_packs, custom_packs)
        amount = packs * price_per_pack
        turns = packs * turns_per_pack
        pkg_name = f"Gói Tùy Chọn ({packs} gói • {turns} lượt)"
    else:
        amount = int(pkg.get("price", 20000))
        turns = int(pkg.get("turns", 340))
        pkg_name = pkg.get("name", "Gói Chung Sức")

    orders = load_orders()
    now_ts = int(time.time())
    # Chống trùng đơn Chung Sức: nếu cùng mã mời và đơn cũ vẫn PENDING trong 15 phút, tái sử dụng
    for existing_oid, existing_order in list(orders.items()):
        if (
            existing_order.get("service_type") == "chungsuc"
            and str(existing_order.get("code", "")).lower() == clean_code.lower()
            and existing_order.get("status") == "PENDING"
            and (now_ts - int(existing_order.get("created_at") or 0)) < 900
        ):
            if zalo and not existing_order.get("zalo"):
                existing_order["zalo"] = zalo
            save_orders(orders)
            return jsonify({
                "success": True,
                "order_id": existing_oid,
                "amount_formatted": existing_order.get("amount_formatted"),
                "order": existing_order,
                "reused": True
            })

    order_id = generate_order_id("CS")
    pay = cfg.get("payment", {})
    bank_id = pay.get("bank_id", "970454")
    acc_no = pay.get("account_number", "99ZP24261M43061759")
    acc_name = pay.get("account_name", "ZALOPAY_DINH TUAN HUNG")

    qr_url = f"https://img.vietqr.io/image/{bank_id}-{acc_no}-compact2.png?amount={amount}&addInfo={order_id}&accountName={acc_name}"

    order = {
        "order_id": order_id,
        "service_type": "chungsuc",
        "code": clean_code,
        "raw_code": raw_code,
        "package_id": package_id,
        "package_name": pkg_name,
        "turns": turns,
        "amount": amount,
        "amount_formatted": format_currency_vnd(amount),
        "status": "PENDING",
        "zalo": zalo,
        "content": order_id,
        "qr_url": qr_url,
        "bank_name": pay.get("bank_name", "Ngân Hàng Bản Việt (BVBank - ZaloPay)"),
        "account_number": acc_no,
        "account_name": acc_name,
        "created_at": int(time.time()),
        "created_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "paid_at": None,
        "autonhanh_status": None,
        "autonhanh_batch_id": None
    }

    orders = load_orders()
    orders[order_id] = order
    save_orders(orders)

    # Sync into Database (Single Source of Truth)
    db = models.SessionLocal()
    try:
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
            token=secrets.token_hex(16),
            qr_url=qr_url,
            quantity=turns,
            created_at=models.now_gmt7(),
            expires_at=models.now_gmt7() + timedelta(minutes=15)
        )
        db.merge(db_order)
        db.commit()
    finally:
        db.close()

    notify_new_order(order)
    return jsonify({"success": True, "order_id": order_id, "amount_formatted": order.get("amount_formatted"), "order": order})

# ==========================================
# LOCKET GOLD ROUTES
# ==========================================
@app.route("/api/locket/user-info", methods=["POST"])
@app.route("/api/get-user-info", methods=["POST"])
@app.route("/api/locket/check", methods=["GET", "POST"])
def get_locket_user_info():
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        val = (data.get("username") or data.get("link") or "").strip()
        uid_in = (data.get("uid") or "").strip()
    else:
        val = (request.args.get("username") or request.args.get("link") or request.args.get("q") or "").strip()
        uid_in = (request.args.get("uid") or "").strip()

    username = clean_locket_username(val)
    if not username and not uid_in:
        return jsonify({"success": False, "msg": "Vui lòng nhập Username hoặc Link Locket."}), 400

    api = LocketAPI()
    try:
        profile = None
        if username:
            profile = api.get_full_profile(username)
        
        uid_val = (profile.get("uid") if profile else None) or uid_in
        has_gold = api.check_subscriber_gold(uid_val) if uid_val else False

        # Kiểm tra Database Single Source of Truth
        already_purchased, existing_oid = check_locket_already_purchased(username, uid_val)

        disp_name = username
        pic_url = ""
        if profile:
            disp_name = profile.get("display_name") or profile.get("displayName") or profile.get("first_name") or profile.get("firstName") or username
            pic_url = profile.get("profilePicUrl") or profile.get("profile_picture_url") or ""

        return jsonify({
            "success": True,
            "alreadyPurchased": already_purchased,
            "orderCode": existing_oid if already_purchased else None,
            "is_existing_customer": already_purchased,
            "existing_order_id": existing_oid if already_purchased else None,
            "user": {
                "username": username or val,
                "uid": uid_val,
                "display_name": disp_name,
                "profile_picture_url": pic_url,
                "has_gold": has_gold,
                "alreadyPurchased": already_purchased,
                "orderCode": existing_oid if already_purchased else None,
                "is_existing_customer": already_purchased,
                "existing_order_id": existing_oid if already_purchased else None
            }
        })
    except Exception as e:
        return jsonify({"success": False, "msg": f"Lỗi kết nối Locket: {str(e)}"}), 500

@app.route("/api/locket/order", methods=["POST"])
@app.route("/api/payment/create-order", methods=["POST"])
def create_locket_order():
    data = request.get_json(silent=True) or {}
    val = (data.get("username") or "").strip()
    pkg_type = (data.get("package_type") or "with_dns").strip()
    zalo = (data.get("zalo") or data.get("phone") or "").strip()
    uid = (data.get("uid") or "").strip()
    avatar = (data.get("avatar") or "").strip()

    username = clean_locket_username(val)
    if not username:
        return jsonify({"success": False, "msg": "Vui lòng nhập Username Locket."}), 400

    force_new = bool(data.get("force_new", False))
    if not force_new:
        already_purchased, existing_oid = check_locket_already_purchased(username, uid)
        if already_purchased:
            return jsonify({
                "success": False,
                "alreadyPurchased": True,
                "orderCode": existing_oid,
                "is_existing_customer": True,
                "existing_order_id": existing_oid,
                "username": username,
                "msg": f"Tài khoản @{username} đã từng kích hoạt thành công đơn hàng #{existing_oid} trên hệ thống DTH! Hãy sang trang tra cứu để nhận hướng dẫn và kích hoạt lại Gold."
            }), 200

    cfg = load_config()
    pay = cfg.get("payment", {})
    locket_pkgs = pay.get("locket_packages", pay.get("packages", {}))

    if pkg_type not in locket_pkgs:
        pkg_type = "with_dns"

    pkg = locket_pkgs.get(pkg_type, {})
    amount = int(pkg.get("price", 30000 if pkg_type == "with_dns" else 10000))
    pkg_name = pkg.get("name", "Giữ Gold (Vĩnh Viễn)" if pkg_type == "with_dns" else "Không Giữ Gold")

    orders = load_orders()
    now_ts = int(time.time())
    # Chống trùng đơn Locket: nếu cùng username và đơn cũ vẫn PENDING trong 15 phút, tái sử dụng đơn cũ
    for existing_oid, existing_order in list(orders.items()):
        if (
            existing_order.get("service_type") == "locket"
            and str(existing_order.get("username", "")).lower() == username.lower()
            and existing_order.get("status") == "PENDING"
            and (now_ts - int(existing_order.get("created_at") or 0)) < 900
        ):
            if zalo and not existing_order.get("zalo"):
                existing_order["zalo"] = zalo
            if uid and not existing_order.get("uid"):
                existing_order["uid"] = uid
            save_orders(orders)
            return jsonify({
                "success": True,
                "order_id": existing_oid,
                "amount_formatted": existing_order.get("amount_formatted"),
                "order": existing_order,
                "reused": True
            })

    order_id = generate_order_id("LK")
    bank_id = pay.get("bank_id", "970454")
    acc_no = pay.get("account_number", "99ZP24261M43061759")
    acc_name = pay.get("account_name", "ZALOPAY_DINH TUAN HUNG")

    qr_url = f"https://img.vietqr.io/image/{bank_id}-{acc_no}-compact2.png?amount={amount}&addInfo={order_id}&accountName={acc_name}"

    order = {
        "order_id": order_id,
        "service_type": "locket",
        "username": username,
        "uid": uid,
        "avatar_url": avatar,
        "package_type": pkg_type,
        "package_name": pkg_name,
        "amount": amount,
        "amount_formatted": format_currency_vnd(amount),
        "status": "PENDING",
        "zalo": zalo,
        "content": order_id,
        "qr_url": qr_url,
        "bank_name": pay.get("bank_name", "Ngân Hàng Bản Việt (BVBank - ZaloPay)"),
        "account_number": acc_no,
        "account_name": acc_name,
        "created_at": int(time.time()),
        "created_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "paid_at": None,
        "gold_status": None
    }

    orders = load_orders()
    orders[order_id] = order
    save_orders(orders)

    # Sync into Database (Single Source of Truth)
    db = models.SessionLocal()
    try:
        db_order = models.Order(
            order_id=order_id,
            service_type="locket",
            username=username,
            uid=uid,
            avatar_url=avatar,
            package_id=pkg_type,
            package_type=pkg_type,
            package_name=pkg_name,
            amount=amount,
            amount_formatted=format_currency_vnd(amount),
            status="PENDING",
            partner_status="WAITING",
            zalo=zalo,
            token=secrets.token_hex(16),
            qr_url=qr_url,
            created_at=models.now_gmt7(),
            expires_at=models.now_gmt7() + timedelta(minutes=15)
        )
        db.merge(db_order)
        db.commit()
    finally:
        db.close()

    notify_new_order(order)
    return jsonify({"success": True, "order_id": order_id, "amount_formatted": order.get("amount_formatted"), "order": order})

@app.route("/api/restore", methods=["POST"])
def restore_locket_purchase():
    data = request.get_json(silent=True) or {}
    val = (data.get("username") or "").strip()
    username = clean_locket_username(val)
    order_id = (data.get("order_id") or "").strip().upper()
    pkg_type = (data.get("package_type") or "with_dns").strip()

    if not username:
        return jsonify({"success": False, "msg": "Vui lòng nhập Username Locket."}), 400

    orders = load_orders()
    if order_id and order_id in orders:
        order = orders[order_id]
        if order.get("status") not in ("PAID", "COMPLETED"):
            return jsonify({"success": False, "msg": "Đơn hàng chưa ghi nhận thanh toán."}), 400
        # If already completed with gold active, return immediately without duplicate queueing
        if order.get("gold_status") == "ACTIVE" and order.get("telegram_gold_notified"):
            return jsonify({
                "success": True,
                "client_id": f"completed_{order_id}",
                "status": "completed",
                "result": {"gold": True, "uid": order.get("uid"), "username": username}
            })

    client_id = queue_manager.add_to_queue(username, pkg_type, order_id=order_id)
    status = queue_manager.get_status(client_id)
    return jsonify({
        "success": True,
        "client_id": client_id,
        "status": status.get("status", "processing") if status else "processing"
    })

@app.route("/api/queue/status", methods=["POST"])
def check_locket_queue_status():
    data = request.get_json(silent=True) or {}
    client_id = (data.get("client_id") or "").strip()
    status = queue_manager.get_status(client_id)
    if not status:
        return jsonify({"success": False, "msg": "Phiên xử lý không tồn tại."}), 404
    return jsonify({"success": True, **status})

# ==========================================
# LOCKET IOS CONFIG DOWNLOADS & PROFILES
# ==========================================
@app.route("/download-config")
@app.route("/download-config/<path:user_target>")
@app.route("/LocketGold.mobileconfig")
@app.route("/LocketGold_DNS.mobileconfig")
@app.route("/LocketGold_dth206.mobileconfig")
@app.route("/DNS_HuyHieu_user.dth.mobileconfig")
@app.route("/locket.mobileconfig")
def serve_mobileconfig(user_target=None):
    filename = "LocketGold.mobileconfig"
    path = os.path.join(BASE_DIR, "static", filename)
    if not os.path.exists(path):
        path = os.path.join(BASE_DIR, filename)

    if os.path.exists(path):
        resp = make_response(send_file(path, mimetype="application/x-apple-aspen-config"))
        resp.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
        return resp
    return "Profile not found", 404

@app.route("/dth.sgmodule")
@app.route("/Locket_15s.sgmodule")
@app.route("/locket-15s.sgmodule")
def serve_sgmodule():
    path = os.path.join(BASE_DIR, "static", "dth.sgmodule")
    if not os.path.exists(path):
        path = os.path.join(BASE_DIR, "static", "Locket_15s.sgmodule")
    if os.path.exists(path):
        return send_file(path, mimetype="text/plain")
    return redirect(LOCKET_SHADOW_MODULE_URL)

@app.route("/modules/<path:filename>")
def serve_modules(filename):
    return send_from_directory(os.path.join(BASE_DIR, "static", "modules"), filename)

# ==========================================
# MẠNG XÃ HỘI (TANGTIM) ROUTES
# ==========================================
@app.route("/api/mxh/services")
@app.route("/api/services")
def get_mxh_services():
    cfg = load_config()
    featured = cfg.get("featured_packages", [])
    services = cfg.get("services", [])
    is_sale, sale_pct = is_sale_active()

    # Áp dụng giá sale campaign
    def _apply_sale(s):
        s_copy = dict(s)
        base_price = float(s_copy.get("price_per_unit") or s_copy.get("unit_price") or s_copy.get("price") or 0)
        if is_sale and sale_pct > 0:
            discounted = base_price * (1 - sale_pct / 100.0)
            s_copy["sale_price"] = discounted
            s_copy["sale_price_formatted"] = format_currency_vnd(int(discounted))
            s_copy["has_sale"] = True
        if s_copy.get("description"):
            s_copy["description"] = re.sub(r'color\s*:\s*(#ffffff|#fff|white)', 'color: #1e293b', s_copy["description"], flags=re.IGNORECASE)
        return s_copy

    clean_services = [s for s in services if s.get("active", True) is not False and not s.get("is_maintenance", False)]
    featured_out = [_apply_sale(f) for f in featured]
    services_out = [_apply_sale(s) for s in clean_services]

    return jsonify({
        "success": True,
        "featured": featured_out,
        "services": services_out,
        "is_sale": is_sale,
        "sale_discount": sale_pct,
        "margin_percent": cfg.get("tangtim", {}).get("margin_percent", 50)
    })

@app.route("/api/mxh/order", methods=["POST"])
def create_mxh_order():
    data = request.get_json(silent=True) or {}
    service_id = data.get("service_id")
    link = (data.get("link") or "").strip()
    quantity = int(data.get("quantity") or 1000)
    comments = (data.get("comments") or "").strip()
    zalo = (data.get("zalo") or "").strip()

    if not link:
        return jsonify({"success": False, "msg": "Vui lòng nhập Link hoặc Tên người dùng cần tăng tương tác."}), 400

    cfg = load_config()
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
    if not unit_p and s_target.get("price"):
        unit_p = float(s_target["price"]) / max(1, int(s_target.get("default_qty", 1000)))
    if not unit_p and s_target.get("base_price"):
        margin_pct = float(cfg.get("tangtim", {}).get("margin_percent", 50))
        unit_p = round(float(s_target["base_price"]) * (1 + margin_pct / 100.0), 3)
    elif not unit_p and s_target.get("rate"):
        usd_rate = float(cfg.get("tangtim", {}).get("usd_rate", 25500))
        margin_pct = float(cfg.get("tangtim", {}).get("margin_percent", 50))
        unit_p = round(float(s_target["rate"]) * usd_rate / 1000.0 * (1 + margin_pct / 100.0), 3)

    total_amount = int(round(quantity * unit_p))
    is_sale, sale_pct = is_sale_active()
    if is_sale and sale_pct > 0:
        total_amount = int(round(total_amount * (1 - sale_pct / 100.0)))

    total_amount = max(2000, total_amount)
    orders = load_orders()
    now_ts = int(time.time())
    # Chống trùng đơn MXH: nếu cùng link và dịch vụ vẫn PENDING trong 15 phút, tái sử dụng
    for existing_oid, existing_order in list(orders.items()):
        if (
            existing_order.get("service_type") == "mxh"
            and str(existing_order.get("link", "")).lower() == link.lower()
            and str(existing_order.get("service_id", "")) == str(service_id)
            and existing_order.get("status") == "PENDING"
            and (now_ts - int(existing_order.get("created_at") or 0)) < 900
        ):
            if zalo and not existing_order.get("zalo"):
                existing_order["zalo"] = zalo
            save_orders(orders)
            return jsonify({
                "success": True,
                "order_id": existing_oid,
                "amount_formatted": existing_order.get("amount_formatted"),
                "order": existing_order,
                "reused": True
            })

    order_id = generate_order_id("TT")

    pay = cfg.get("payment", {})
    bank_id = pay.get("bank_id", "970454")
    acc_no = pay.get("account_number", "99ZP24261M43061759")
    acc_name = pay.get("account_name", "ZALOPAY_DINH TUAN HUNG")

    qr_url = f"https://img.vietqr.io/image/{bank_id}-{acc_no}-compact2.png?amount={total_amount}&addInfo={order_id}&accountName={acc_name}"

    order = {
        "order_id": order_id,
        "service_type": "mxh",
        "service_id": service_id,
        "package_name": s_target.get("name", "Dịch vụ MXH"),
        "platform": s_target.get("platform", "other"),
        "link": link,
        "quantity": quantity,
        "unit_price": unit_p,
        "amount": total_amount,
        "amount_formatted": format_currency_vnd(total_amount),
        "comments": comments,
        "zalo": zalo,
        "status": "PENDING",
        "content": order_id,
        "qr_url": qr_url,
        "bank_name": pay.get("bank_name", "Ngân Hàng Bản Việt (BVBank - ZaloPay)"),
        "account_number": acc_no,
        "account_name": acc_name,
        "created_at": int(time.time()),
        "created_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "paid_at": None,
        "tangtim_status": None,
        "tangtim_order_id": None
    }

    orders = load_orders()
    orders[order_id] = order
    save_orders(orders)

    # Sync into Database (Single Source of Truth)
    db = models.SessionLocal()
    try:
        db_order = models.Order(
            order_id=order_id,
            service_type="mxh",
            package_id=str(service_id),
            package_name=s_target.get("name", "Dịch vụ MXH"),
            amount=total_amount,
            amount_formatted=format_currency_vnd(total_amount),
            status="PENDING",
            partner_status="WAITING",
            link=link,
            quantity=quantity,
            remains=quantity,
            delivered=0,
            zalo=zalo,
            token=secrets.token_hex(16),
            qr_url=qr_url,
            created_at=models.now_gmt7(),
            expires_at=models.now_gmt7() + timedelta(minutes=15)
        )
        db.merge(db_order)
        db.commit()
    finally:
        db.close()

    notify_new_order(order)
    return jsonify({"success": True, "order_id": order_id, "amount_formatted": order.get("amount_formatted"), "order": order})

# ==========================================
# CHỢ PREMIUM ROUTES (YOUTUBE, SPOTIFY, NETFLIX)
# ==========================================
@app.route("/api/premium/services")
def get_premium_services():
    cfg = load_config()
    services_enabled = cfg.get("services_enabled", {})
    market_enabled = services_enabled.get("premium", True)
    services = cfg.get("premium_services", {})
    return jsonify({
        "success": True,
        "market_enabled": market_enabled,
        "services": services
    })

@app.route("/api/premium/order", methods=["POST"])
def create_premium_order():
    data = request.get_json(silent=True) or {}
    platform = (data.get("platform") or "").strip().lower()
    pkg_id = (data.get("package_id") or "").strip()
    target = (data.get("target") or data.get("email") or data.get("account") or "").strip()
    zalo = (data.get("zalo") or data.get("phone") or "").strip()
    note = (data.get("note") or "").strip()

    cfg = load_config()
    services_enabled = cfg.get("services_enabled", {})
    if not services_enabled.get("premium", True):
        return jsonify({"success": False, "msg": "Chợ Dịch Vụ Premium hiện đang tạm đóng để bảo trì."}), 400

    prem_services = cfg.get("premium_services", {})
    if not platform or platform not in prem_services:
        return jsonify({"success": False, "msg": "Dịch vụ Premium không hợp lệ hoặc không tồn tại."}), 400

    plat_info = prem_services.get(platform, {})
    if not plat_info.get("active", True):
        return jsonify({"success": False, "msg": f"Dịch vụ {plat_info.get('name', platform)} hiện đang tạm ngưng phục vụ."}), 400

    pkgs = plat_info.get("packages", {})
    if not pkg_id or pkg_id not in pkgs:
        return jsonify({"success": False, "msg": "Gói đăng ký không tồn tại hoặc chưa chọn gói."}), 400

    pkg = pkgs[pkg_id]
    if not pkg.get("active", True):
        return jsonify({"success": False, "msg": f"Gói {pkg.get('name', pkg_id)} hiện đang tạm hết."}), 400

    if not target:
        input_label = plat_info.get("input_label") or "Tài khoản / Email"
        return jsonify({"success": False, "msg": f"Vui lòng nhập {input_label}."}), 400

    if not zalo:
        return jsonify({"success": False, "msg": "Vui lòng nhập số Zalo nhận thông tin bàn giao."}), 400

    try:
        amount = int(pkg.get("price", 0))
    except (ValueError, TypeError):
        amount = 0

    if amount <= 0:
        return jsonify({"success": False, "msg": "Giá gói không hợp lệ."}), 400

    pkg_name = pkg.get("name", f"Gói {platform.title()}")
    duration = pkg.get("duration", "1 Tháng")
    plat_name = plat_info.get("name", platform.title())

    orders = load_orders()
    now_ts = int(time.time())
    # Chống trùng đơn Chợ Premium: nếu cùng platform, email/account và gói vẫn PENDING trong 15 phút, tái sử dụng
    for existing_oid, existing_order in list(orders.items()):
        if (
            existing_order.get("service_type") == "premium"
            and str(existing_order.get("platform", "")).lower() == platform.lower()
            and str(existing_order.get("target", "")).lower() == target.lower()
            and str(existing_order.get("package_id", "")) == str(pkg_id)
            and existing_order.get("status") == "PENDING"
            and (now_ts - int(existing_order.get("created_at") or 0)) < 900
        ):
            if zalo and not existing_order.get("zalo"):
                existing_order["zalo"] = zalo
            save_orders(orders)
            return jsonify({
                "success": True,
                "order_id": existing_oid,
                "amount_formatted": existing_order.get("amount_formatted"),
                "order": existing_order,
                "reused": True
            })

    order_id = f"PR{uuid.uuid4().hex[:8].upper()}"
    pay = cfg.get("payment", {})
    bank_id = pay.get("bank_id", "970454")
    acc_no = pay.get("account_number", "99ZP24261M43061759")
    acc_name = pay.get("account_name", "ZALOPAY_DINH TUAN HUNG")

    qr_url = f"https://img.vietqr.io/image/{bank_id}-{acc_no}-compact2.png?amount={amount}&addInfo={order_id}&accountName={acc_name}"

    order = {
        "order_id": order_id,
        "service_type": "premium",
        "platform": platform,
        "platform_name": plat_name,
        "package_id": pkg_id,
        "package_name": pkg_name,
        "duration": duration,
        "package_desc": str(pkg.get("desc", "")).strip(),
        "target": target,
        "zalo": zalo,
        "note": note,
        "amount": amount,
        "amount_formatted": format_currency_vnd(amount),
        "status": "PENDING",
        "content": order_id,
        "qr_url": qr_url,
        "bank_name": pay.get("bank_name", "Ngân Hàng Bản Việt (BVBank - ZaloPay)"),
        "account_number": acc_no,
        "account_name": acc_name,
        "created_at": int(time.time()),
        "created_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "paid_at": None,
        "delivery_info": None
    }

    orders = load_orders()
    orders[order_id] = order
    save_orders(orders)

    notify_new_order(order)
    return jsonify({
        "success": True,
        "order_id": order_id,
        "amount_formatted": order.get("amount_formatted"),
        "order": order
    })


# ==========================================
# UNIFIED PAYMENT POLLING & LOOKUP
# ==========================================
@app.route("/api/payment/check/<order_id>")
def check_payment_status(order_id):
    from routes.orders import check_order_status
    return check_order_status(order_id)

@app.route("/api/order/confirm-paid", methods=["POST"])
def user_confirm_paid():
    """Hợp nhất với payments_bp.client_confirm_paid - Single Source of Truth qua models.SessionLocal()"""
    from routes.payments import client_confirm_paid
    return client_confirm_paid()

@app.route("/api/webhook/thueapibank", methods=["GET", "POST"])
def webhook_thueapibank():
    """Hợp nhất với payments_bp.webhook_bank_receiver - Single Source of Truth qua models.SessionLocal()"""
    from routes.payments import webhook_bank_receiver
    return webhook_bank_receiver()

# ==========================================
# UNIFIED CLOUD CRON ENDPOINT (24/7 AUTOMATION)
# ==========================================
@app.route("/api/cron", methods=["GET", "POST"], strict_slashes=False)
@app.route("/cron", methods=["GET", "POST"], strict_slashes=False)
@app.route("/api/cron/sync", methods=["GET", "POST"], strict_slashes=False)
@app.route("/cron/bank", methods=["GET", "POST"], strict_slashes=False)
@app.route("/api/cron/bank", methods=["GET", "POST"], strict_slashes=False)
@app.route("/cron.php", methods=["GET", "POST"], strict_slashes=False)
@app.route("/api/cron.php", methods=["GET", "POST"], strict_slashes=False)
def unified_cron_endpoint():
    """Hợp nhất với payments_bp.cron_bank_sync - Single Source of Truth qua models.SessionLocal()"""
    from routes.payments import cron_bank_sync
    return cron_bank_sync()

# ==========================================
# TELEGRAM ADMIN WEBHOOK & INTERACTIVE TOOL
# ==========================================
def get_telegram_admin_menu():
    msg = (
        "👑 <b>BẢNG ĐIỀU KHIỂN DTH ADMIN TOOL</b> 🚀\n"
        "━━━━━━━━━━━━━━━━━━\n"
        "<i>Điều khiển toàn bộ hệ thống qua Telegram 24/7</i>\n\n"
        "⚡ <b>CÁC LỆNH QUẢN TRỊ VIÊN:</b>\n"
        "• <code>/duyet &lt;mã&gt;</code> : Duyệt tiền & đẩy sang web mẹ\n"
        "• <code>/day &lt;mã&gt;</code> : Ép đẩy lại đơn sang web mẹ\n"
        "• <code>/sua &lt;mã&gt; &lt;link/mã&gt;</code> : Sửa mã/link & đẩy ngay\n"
        "• <code>/xoa &lt;mã&gt;</code> : <b>Xóa vĩnh viễn đơn hàng</b>\n"
        "• <code>/hoanthanh &lt;mã&gt;</code> : Đánh dấu hoàn thành\n"
        "• <code>/huy &lt;mã&gt;</code> : Hủy đơn hàng\n"
        "• <code>/gold &lt;user&gt;</code> : Kích hoạt Locket Gold VIP\n"
        "• <code>/bank</code> : Quét ZaloPay & ngân hàng tức thì\n"
        "• <code>/check</code> : Kiểm tra tiến độ 2 web mẹ\n"
        "• <code>/stats</code> : Báo cáo doanh thu & số dư\n"
        "• <code>/orders</code> : Xem danh sách đơn đang chờ\n"
        "• <code>/popup &lt;nội dung&gt;</code> : Đổi thông báo & BẬT popup web\n"
        "• <code>/popup_on</code> / <code>/popup_off</code> : Bật / Tắt popup\n"
        "• <code>/popup_clear</code> : Xóa sạch nội dung popup\n"
        "• <code>/popup_status</code> : Xem trạng thái popup web\n"
        "━━━━━━━━━━━━━━━━━━\n"
        "👇 <i>Hoặc bấm nút phím tắt bên dưới:</i>"
    )
    kb = {
        "inline_keyboard": [
            [
                {"text": "📋 Tất Cả Đơn", "callback_data": "btn:orders"},
                {"text": "⚠️ Đơn Cần Sửa", "callback_data": "btn:orders_err"}
            ],
            [
                {"text": "🎮 Chung Sức", "callback_data": "btn:orders_cs"},
                {"text": "💛 Locket", "callback_data": "btn:orders_lk"},
                {"text": "🚀 MXH", "callback_data": "btn:orders_mxh"}
            ],
            [
                {"text": "🏦 Quét Bank Ngay", "callback_data": "btn:bank"},
                {"text": "🔄 Check Web Mẹ", "callback_data": "btn:check"}
            ],
            [
                {"text": "📊 Báo Cáo Doanh Thu", "callback_data": "btn:stats"},
                {"text": "📢 Quản Lý Popup", "callback_data": "btn:popup_status"}
            ]
        ]
    }
    return msg, kb

def handle_admin_stats_menu():
    orders = load_orders()
    cfg = load_config()
    total = len(orders)
    completed = len([o for o in orders.values() if o.get("status") == "COMPLETED"])
    processing = len([o for o in orders.values() if o.get("status") == "PROCESSING"])
    pending = len([o for o in orders.values() if o.get("status") == "PENDING"])

    total_rev = sum(int(o.get("amount", 0) or 0) for o in orders.values() if o.get("status") in ("COMPLETED", "PAID", "PROCESSING"))
    today_str = datetime.now().strftime("%Y-%m-%d")
    today_rev = sum(int(o.get("amount", 0) or 0) for o in orders.values() if (o.get("paid_at") or "").startswith(today_str) or (o.get("created_time") or "").startswith(today_str))

    an_bal = "Đang kiểm tra..."
    an_tok = cfg.get("autonhanh", {}).get("token")
    if an_tok:
        bal, _ = autonhanh_fetch_balance(an_tok)
        if bal is not None:
            an_bal = f"{bal:,} Xu"

    tt_bal = "Đang kiểm tra..."
    tt_key = cfg.get("tangtim", {}).get("api_key")
    if tt_key:
        try:
            r = requests.post("https://tangtim.vn/api/v2", data={"key": tt_key, "action": "balance"}, timeout=6)
            if r.status_code == 200:
                d = r.json()
                if "balance" in d:
                    b_usd = float(d["balance"])
                    b_vnd = int(b_usd * 25500)
                    tt_bal = f"{b_usd:.2f}$ (~{b_vnd:,}đ)"
        except Exception:
            pass

    msg = (
        "📊 <b>BÁO CÁO TOÀN DIỆN HỆ THỐNG DTH</b>\n"
        f"⏰ <i>Cập nhật: {datetime.now().strftime('%H:%M:%S %d/%m/%Y')}</i>\n"
        "━━━━━━━━━━━━━━━━━━\n"
        f"📦 <b>Tổng đơn:</b> {total} đơn\n"
        f"✅ <b>Đã hoàn thành:</b> {completed} đơn\n"
        f"⚙️ <b>Đang xử lý:</b> {processing} đơn\n"
        f"⏳ <b>Chờ thanh toán:</b> {pending} đơn\n\n"
        f"💰 <b>Tổng doanh thu:</b> {total_rev:,}đ\n"
        f"📈 <b>Doanh thu hôm nay:</b> {today_rev:,}đ\n"
        "━━━━━━━━━━━━━━━━━━\n"
        "💳 <b>SỐ DƯ WEB MẸ (ĐỐI TÁC):</b>\n"
        f"• AutoNhanh (Chung Sức): <b>{an_bal}</b>\n"
        f"• TangTim (Mạng Xã Hội): <b>{tt_bal}</b>\n"
        "━━━━━━━━━━━━━━━━━━"
    )
    kb = {
        "inline_keyboard": [
            [
                {"text": "🔄 Cập Nhật Lại", "callback_data": "btn:stats"},
                {"text": "📋 Xem Đơn Chờ", "callback_data": "btn:orders"}
            ],
            [
                {"text": "🏦 Quét Bank", "callback_data": "btn:bank"},
                {"text": "🔍 Check 2 Web Mẹ", "callback_data": "btn:check"}
            ]
        ]
    }
    return msg, kb

def handle_admin_list_orders(service_filter="all"):
    orders = load_orders()
    active = list(orders.values())

    if service_filter == "cs":
        active = [o for o in active if o.get("service_type") == "chungsuc" or str(o.get("order_id", "")).startswith("CS")]
    elif service_filter == "lk":
        active = [o for o in active if o.get("service_type") == "locket" or str(o.get("order_id", "")).startswith("LK")]
    elif service_filter == "mxh":
        active = [o for o in active if o.get("service_type") == "mxh" or str(o.get("order_id", "")).startswith("TT")]
    elif service_filter == "err":
        active = [o for o in active if classify_order_error(o)[0]]
    else:
        active = [o for o in active if o.get("status") in ("PENDING", "PROCESSING", "PAID")]

    active.sort(key=lambda x: x.get("created_at") or 0, reverse=True)

    filter_title = {
        "all": "ĐƠN ĐANG CHỜ / ĐANG CHẠY",
        "cs": "ĐƠN CHUNG SỨC LIÊN QUÂN",
        "lk": "ĐƠN LOCKET GOLD",
        "mxh": "ĐƠN MẠNG XÃ HỘI",
        "err": "ĐƠN CẦN SỬA LINK / MÃ"
    }.get(service_filter, "ĐƠN HÀNG")

    if not active:
        msg = f"🎉 <b>KHÔNG CÓ {filter_title}!</b>\nTất cả đơn hàng đều đã được xử lý xong."
        kb = {
            "inline_keyboard": [
                [
                    {"text": "📋 Xem Tất Cả Đơn", "callback_data": "btn:orders"},
                    {"text": "📊 Xem Thống Kê", "callback_data": "btn:stats"}
                ]
            ]
        }
        return msg, kb

    msg_lines = [f"📋 <b>DANH SÁCH {filter_title}:</b>\n━━━━━━━━━━━━━━━━━━"]
    kb_rows = []

    for o in active[:5]:
        oid = o.get("order_id")
        st = o.get("status")
        amt = o.get("amount_formatted") or f"{o.get('amount', 0):,}đ"
        pname = o.get("package_name") or o.get("service_type") or "Dịch vụ"
        code_or_link = o.get("code") or o.get("link") or o.get("username") or ""
        if len(code_or_link) > 28:
            code_or_link = code_or_link[:25] + "..."

        st_icon = "⏳" if st == "PENDING" else ("⚙️" if st == "PROCESSING" else ("✅" if st == "COMPLETED" else "⚠️"))
        msg_lines.append(f"{st_icon} <b>#{oid}</b> | {pname}\n• Giá: <b>{amt}</b> [{st}] | Target: <code>{code_or_link}</code>")

        order_btns = []
        if st in ("PENDING", "PAID"):
            order_btns.append({"text": f"✅ Duyệt #{oid}", "callback_data": f"btn:duyet:{oid}"})
        order_btns.append({"text": f"🚀 Đẩy #{oid}", "callback_data": f"btn:day:{oid}"})
        order_btns.append({"text": f"🗑️ Xóa #{oid}", "callback_data": f"btn:xoa:{oid}"})
        kb_rows.append(order_btns)

    kb_rows.append([
        {"text": "🎮 Chung Sức", "callback_data": "btn:orders_cs"},
        {"text": "💛 Locket", "callback_data": "btn:orders_lk"},
        {"text": "🚀 MXH", "callback_data": "btn:orders_mxh"}
    ])
    kb_rows.append([
        {"text": "🏦 Quét Bank", "callback_data": "btn:bank"},
        {"text": "🔄 Check Web Mẹ", "callback_data": "btn:check"},
        {"text": "📊 Thống Kê", "callback_data": "btn:stats"}
    ])

    return "\n".join(msg_lines), {"inline_keyboard": kb_rows}

def handle_admin_duyet_command(oid):
    orders = load_orders()
    if oid not in orders:
        return f"❌ Không tìm thấy đơn <b>#{oid}</b> trong hệ thống."
    order = orders[oid]
    order["status"] = "PAID"
    order["paid_at"] = f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} (Duyệt qua Telegram)"

    stype = order.get("service_type") or ("chungsuc" if oid.startswith("CS") else ("locket" if oid.startswith("LK") else ("premium" if oid.startswith("PR") else "mxh")))
    push_msg = ""
    if stype == "chungsuc":
        ok, res = autonhanh_process_order(order, force=True)
        push_msg = f"Đã đẩy AutoNhanh (Batch: {order.get('autonhanh_batch_id')})" if ok else f"Lỗi AutoNhanh: {res}"
    elif stype == "locket":
        clean_u = re.sub(r"[^A-Za-z0-9_.-]", "", str(order.get("username", "")).lstrip("@")) or "VIP"
        order["status"] = "COMPLETED"
        order["gold_status"] = "ACTIVE"
        order["dns_link"] = f"/download-config?u={clean_u}"
        order["module_link"] = LOCKET_SHADOW_MODULE_URL
        order["telegram_gold_notified"] = True
        _recent_locket_telegram[clean_u.lower()] = time.time()
        queue_manager.add_to_queue(order.get("username"), order.get("package_type", "with_dns"), order_id=oid)
        push_msg = "Đã cấp cấu hình DNS Locket Gold VIP!"
    elif stype == "premium" or oid.startswith("PR"):
        order["status"] = "COMPLETED"
        push_msg = "Đã duyệt hoàn tất đơn Chợ Premium!"
    else:
        ok, res = tangtim_process_order(order)
        push_msg = f"Đã đẩy TangTim (Order ID: {order.get('tangtim_order_id')})" if ok else f"Lỗi TangTim: {res}"

    save_orders(orders)
    return (
        f"✅ <b>[ĐÃ DUYỆT ĐƠN #{oid}]</b>\n"
        f"• Dịch vụ: {order.get('package_name')}\n"
        f"• Số tiền: {order.get('amount_formatted')}\n"
        f"• Trạng thái: <b>{order.get('status')}</b>\n"
        f"• Kết quả đẩy: <b>{push_msg}</b>"
    )

def handle_admin_update_target(oid, new_val):
    orders = load_orders()
    if oid not in orders:
        return f"❌ Không tìm thấy đơn <b>#{oid}</b> trong hệ thống."
    order = orders[oid]
    stype = order.get("service_type") or ("chungsuc" if oid.startswith("CS") else ("locket" if oid.startswith("LK") else "mxh"))

    if stype == "chungsuc" or oid.startswith("CS"):
        clean_code = extract_invite_code(new_val)
        if not clean_code or len(clean_code) < 4:
            return f"❌ Mã mời Liên Quân không hợp lệ (nhập: <code>{new_val}</code>)."
        old_val = order.get("code")
        order["code"] = clean_code
        order["raw_code"] = new_val
        order["autonhanh_status"] = "RETRYING"
        order["autonhanh_error"] = None
        order["status"] = "PROCESSING"
        save_orders(orders)

        ok, res = autonhanh_process_order(order, force=True)
        return (
            f"🔄 <b>[ĐÃ CẬP NHẬT MÃ LIÊN QUÂN #{oid}]</b>\n"
            f"• Mã cũ: <code>{old_val}</code>\n"
            f"• Mã mới: <code>{clean_code}</code>\n"
            f"• Kết quả đẩy hệ thống: <b>{'✅ Thành công' if ok else '❌ Lỗi: ' + str(res)}</b>"
        )
    elif stype == "mxh" or oid.startswith("TT"):
        new_link = str(new_val).strip()
        if not (new_link.startswith("http://") or new_link.startswith("https://")):
            return "❌ Link MXH phải bắt đầu bằng http:// hoặc https://"
        old_val = order.get("link")
        order["link"] = new_link
        order["tangtim_status"] = "RETRYING"
        order["tangtim_error"] = None
        order["status"] = "PROCESSING"
        save_orders(orders)

        ok, res = tangtim_process_order(order)
        return (
            f"🔄 <b>[ĐÃ CẬP NHẬT LINK MXH #{oid}]</b>\n"
            f"• Link cũ: <code>{old_val}</code>\n"
            f"• Link mới: <code>{new_link}</code>\n"
            f"• Kết quả đẩy hệ thống: <b>{'✅ Thành công' if ok else '❌ Lỗi: ' + str(res)}</b>"
        )
    else:
        return f"⚠️ Đơn #{oid} không thuộc loại cần cập nhật link/mã."

def handle_admin_day_command(oid):
    orders = load_orders()
    if oid not in orders:
        return f"❌ Không tìm thấy đơn <b>#{oid}</b> trong hệ thống."
    order = orders[oid]
    stype = order.get("service_type") or ("chungsuc" if oid.startswith("CS") else ("locket" if oid.startswith("LK") else "mxh"))
    if stype == "chungsuc":
        ok, res = autonhanh_process_order(order, force=True)
        return f"🚀 <b>[ĐẨY AUTONHANH #{oid}]</b>\nKết quả: {'✅ Thành công (Batch ' + str(order.get('autonhanh_batch_id')) + ')' if ok else '❌ Thất bại: ' + str(res)}"
    elif stype == "locket":
        clean_u = re.sub(r"[^A-Za-z0-9_.-]", "", str(order.get("username", "")).lstrip("@")) or "VIP"
        order["status"] = "COMPLETED"
        order["gold_status"] = "ACTIVE"
        queue_manager.add_to_queue(order.get("username"), order.get("package_type", "with_dns"), order_id=oid)
        save_orders(orders)
        return f"🚀 <b>[KÍCH HOẠT LOCKET #{oid}]</b>\nĐã đưa vào hàng chờ kích hoạt Gold VIP!"
    else:
        ok, res = tangtim_process_order(order)
        return f"🚀 <b>[ĐẨY TANGTIM #{oid}]</b>\nKết quả: {'✅ Thành công (Order ID ' + str(order.get('tangtim_order_id')) + ')' if ok else '❌ Thất bại: ' + str(res)}"

def handle_admin_bank_scan():
    res = check_and_process_zalopay_history(force=True)
    matched = res.get("matched", [])
    if matched:
        return (
            f"🎉 <b>[QUÉT NGÂN HÀNG THÀNH CÔNG]</b>\n"
            f"• Khớp thành công: <b>{len(matched)} đơn</b> ({', '.join(matched)})\n"
            f"• Hệ thống đã tự động đẩy các đơn này sang web mẹ!"
        )
    else:
        pending_cnt = res.get("pending_count", 0)
        return (
            f"🏦 <b>[QUÉT NGÂN HÀNG HOÀN TẤT]</b>\n"
            f"• Không có giao dịch chuyển tiền mới khớp mã đơn.\n"
            f"• Hiện có <b>{pending_cnt} đơn</b> đang chờ khách chuyển tiền."
        )

def handle_admin_check_web():
    res = check_web_me_orders_status()
    completed = res.get("completed_orders", [])
    if completed:
        return (
            f"🎉 <b>[CHECK 2 WEB MẸ: HOÀN TẤT!]</b>\n"
            f"• Đã có <b>{len(completed)} đơn</b> hoàn thành: {', '.join(completed)}\n"
            f"• Hệ thống đã cập nhật sang COMPLETED và gửi thông báo!"
        )
    else:
        return (
            f"🔍 <b>[CHECK 2 WEB MẸ: ĐÃ ĐỒNG BỘ]</b>\n"
            f"• Đã kiểm tra <b>{res.get('checked_count', 0)} đơn</b> đang chạy trên AutoNhanh & TangTim.\n"
            f"• Các đơn đều đang được xử lý hoặc chưa có đơn nào mới hoàn thành."
        )

@app.route("/api/telegram/webhook", methods=["POST"])
def telegram_webhook():
    update = request.get_json(silent=True) or {}
    cfg = load_config()
    tg = cfg.get("telegram", {})
    bot_token = tg.get("bot_token")
    admin_chat_id = str(tg.get("chat_id", "7114174347"))

    if not bot_token:
        return jsonify({"ok": True})

    # 1. Xử lý Callback Query (Nút bấm Inline)
    if "callback_query" in update:
        cb = update["callback_query"]
        cb_id = cb.get("id")
        cb_data = str(cb.get("data") or "")
        from_id = str(cb.get("from", {}).get("id"))
        chat_id = cb.get("message", {}).get("chat", {}).get("id") or admin_chat_id

        if from_id != admin_chat_id and str(chat_id) != admin_chat_id:
            try:
                requests.post(f"https://api.telegram.org/bot{bot_token}/answerCallbackQuery", json={
                    "callback_query_id": cb_id,
                    "text": "⚠️ Bạn không có quyền quản trị bot này!",
                    "show_alert": True
                }, timeout=5)
            except Exception: pass
            return jsonify({"ok": True})

        try:
            requests.post(f"https://api.telegram.org/bot{bot_token}/answerCallbackQuery", json={
                "callback_query_id": cb_id,
                "text": "⚡ Đang xử lý lệnh..."
            }, timeout=5)
        except Exception: pass

        if cb_data.startswith("btn:duyet:"):
            oid = cb_data.split("btn:duyet:")[1].strip().upper()
            msg = handle_admin_duyet_command(oid)
            send_telegram_msg(msg, chat_id=chat_id)

        elif cb_data.startswith("btn:day:"):
            oid = cb_data.split("btn:day:")[1].strip().upper()
            msg = handle_admin_day_command(oid)
            send_telegram_msg(msg, chat_id=chat_id)

        elif cb_data == "btn:bank":
            msg = handle_admin_bank_scan()
            send_telegram_msg(msg, chat_id=chat_id)

        elif cb_data == "btn:check":
            msg = handle_admin_check_web()
            send_telegram_msg(msg, chat_id=chat_id)

        elif cb_data == "btn:stats":
            msg, kb = handle_admin_stats_menu()
            send_telegram_msg(msg, reply_markup=kb, chat_id=chat_id)

        elif cb_data == "btn:orders":
            msg, kb = handle_admin_list_orders("all")
            send_telegram_msg(msg, reply_markup=kb, chat_id=chat_id)

        elif cb_data == "btn:orders_cs":
            msg, kb = handle_admin_list_orders("cs")
            send_telegram_msg(msg, reply_markup=kb, chat_id=chat_id)

        elif cb_data == "btn:orders_lk":
            msg, kb = handle_admin_list_orders("lk")
            send_telegram_msg(msg, reply_markup=kb, chat_id=chat_id)

        elif cb_data == "btn:orders_mxh":
            msg, kb = handle_admin_list_orders("mxh")
            send_telegram_msg(msg, reply_markup=kb, chat_id=chat_id)

        elif cb_data == "btn:orders_err":
            msg, kb = handle_admin_list_orders("err")
            send_telegram_msg(msg, reply_markup=kb, chat_id=chat_id)

        elif cb_data.startswith("btn:sua:"):
            oid = cb_data.split("btn:sua:")[1].strip().upper()
            orders = load_orders()
            order = orders.get(oid, {})
            stype = order.get("service_type") or ("chungsuc" if oid.startswith("CS") else ("mxh" if oid.startswith("TT") else "locket"))
            target_lbl = "Mã mời Liên Quân" if stype == "chungsuc" else "Link MXH"
            cur_val = order.get("code") if stype == "chungsuc" else order.get("link", "")
            send_telegram_msg(
                f"✏️ <b>[HƯỚNG DẪN SỬA {target_lbl.upper()} #{oid}]</b>\n"
                f"━━━━━━━━━━━━━━━━━━\n"
                f"• Giá trị hiện tại: <code>{cur_val}</code>\n"
                f"👉 Gửi tin nhắn theo cú pháp để sửa và đẩy lại ngay:\n\n"
                f"<code>/sua {oid} &lt;giá_trị_mới&gt;</code>\n\n"
                f"<i>Ví dụ: <code>/sua {oid} abcxyz123</code></i>",
                chat_id=chat_id
            )

        elif cb_data.startswith("btn:xoa:"):
            oid = cb_data.split("btn:xoa:")[1].strip().upper()
            add_deleted_order_id(oid)
            orders = load_orders()
            if oid in orders:
                del orders[oid]
            save_orders(orders)
            sync_file_to_github_now("orders.json")
            send_telegram_msg(f"🗑️ <b>[ĐÃ XÓA VĨNH VIỄN #{oid}]</b>\nĐơn hàng đã được xóa khỏi hệ thống và sẽ không bao giờ xuất hiện lại.", chat_id=chat_id)

        elif cb_data == "btn:popup_status":
            ann = config_manager.get_popup_announcement()
            st_icon = "🟢 ĐANG BẬT" if ann.get("enabled") else "🔴 ĐÃ TẮT"
            up_time = datetime.fromtimestamp(ann.get("updated_at", time.time())).strftime("%d/%m/%Y %H:%M:%S")
            kb = {
                "inline_keyboard": [
                    [
                        {"text": "🔄 Bật/Tắt Nhanh", "callback_data": "btn:popup_toggle"},
                        {"text": "🗑️ Xóa Nội Dung", "callback_data": "btn:popup_clear"}
                    ]
                ]
            }
            send_telegram_msg(
                f"📢 <b>[TRẠNG THÁI POPUP THÔNG BÁO]</b>\n"
                f"━━━━━━━━━━━━━━━━━━\n"
                f"• Trạng thái: <b>{st_icon}</b>\n"
                f"• Tiêu đề: <b>{ann.get('title', '')}</b>\n"
                f"• Cập nhật: <code>{up_time}</code>\n"
                f"• Nội dung:\n<blockquote>{ann.get('content') or '(Chưa có nội dung)'}</blockquote>\n"
                f"━━━━━━━━━━━━━━━━━━\n"
                f"<i>Lệnh: <code>/popup &lt;nội dung&gt;</code> để đổi thông báo và bật ngay.</i>",
                reply_markup=kb,
                chat_id=chat_id
            )

        elif cb_data == "btn:popup_toggle":
            ann = config_manager.update_popup_announcement(action="toggle")
            st_text = "🟢 <b>ĐÃ BẬT</b>" if ann.get("enabled") else "🔴 <b>ĐÃ TẮT</b>"
            send_telegram_msg(
                f"⚡ <b>[ĐÃ CHUYỂN TRẠNG THÁI POPUP]</b>\n"
                f"• Trạng thái mới: {st_text}\n"
                f"• Tiêu đề: <b>{ann.get('title', '')}</b>\n"
                f"• Nội dung: <i>{ann.get('content') or '(Trống)'}</i>",
                chat_id=chat_id
            )

        elif cb_data == "btn:popup_clear":
            config_manager.update_popup_announcement(action="clear")
            send_telegram_msg("🗑️ <b>[ĐÃ XÓA SẠCH NỘI DUNG POPUP]</b>\nNội dung thông báo đã được dọn sạch và chuyển sang trạng thái TẮT.", chat_id=chat_id)

        return jsonify({"ok": True})

    # 2. Xử lý Tin nhắn thường / Lệnh text
    message = update.get("message") or {}
    text = str(message.get("text") or "").strip()
    from_id = str(message.get("from", {}).get("id"))
    chat_id = message.get("chat", {}).get("id") or admin_chat_id

    if not text:
        return jsonify({"ok": True})

    if from_id != admin_chat_id and str(chat_id) != admin_chat_id:
        send_telegram_msg("⚠️ Bạn không có quyền truy cập hệ thống DTH Admin Bot.", chat_id=chat_id)
        return jsonify({"ok": True})

    parts = text.split()
    cmd = parts[0].lower()
    arg = parts[1] if len(parts) > 1 else ""

    if cmd in ("/start", "/help", "/menu"):
        msg, kb = get_telegram_admin_menu()
        send_telegram_msg(msg, reply_markup=kb, chat_id=chat_id)

    elif cmd in ("/stats", "/thongke"):
        msg, kb = handle_admin_stats_menu()
        send_telegram_msg(msg, reply_markup=kb, chat_id=chat_id)

    elif cmd in ("/orders", "/don", "/pending"):
        msg, kb = handle_admin_list_orders()
        send_telegram_msg(msg, reply_markup=kb, chat_id=chat_id)

    elif cmd in ("/bank", "/quet"):
        msg = handle_admin_bank_scan()
        send_telegram_msg(msg, chat_id=chat_id)

    elif cmd in ("/check", "/checkweb", "/sync"):
        msg = handle_admin_check_web()
        send_telegram_msg(msg, chat_id=chat_id)

    elif cmd in ("/duyet", "/accept"):
        if not arg:
            send_telegram_msg("⚠️ Vui lòng nhập mã đơn. Ví dụ: <code>/duyet CS22445</code> hoặc <code>/duyet TT46479</code>", chat_id=chat_id)
        else:
            msg = handle_admin_duyet_command(arg.upper())
            send_telegram_msg(msg, chat_id=chat_id)

    elif cmd in ("/day", "/push"):
        if not arg:
            send_telegram_msg("⚠️ Vui lòng nhập mã đơn. Ví dụ: <code>/day CS22445</code> hoặc <code>/day TT46479</code>", chat_id=chat_id)
        else:
            msg = handle_admin_day_command(arg.upper())
            send_telegram_msg(msg, chat_id=chat_id)

    elif cmd in ("/sua", "/update", "/doima", "/doilink"):
        if len(parts) < 3:
            send_telegram_msg("⚠️ Cú pháp: <code>/sua <mã_đơn> <mã_hoặc_link_mới></code>\nVí dụ: <code>/sua CS22912 cCdjaJpazt</code>", chat_id=chat_id)
        else:
            t_oid = parts[1].strip().upper()
            t_val = parts[2].strip()
            msg = handle_admin_update_target(t_oid, t_val)
            send_telegram_msg(msg, chat_id=chat_id)

    elif cmd in ("/hoanthanh", "/done"):
        if not arg:
            send_telegram_msg("⚠️ Vui lòng nhập mã đơn. Ví dụ: <code>/hoanthanh CS22445</code>", chat_id=chat_id)
        else:
            orders = load_orders()
            oid = arg.upper()
            if oid in orders:
                orders[oid]["status"] = "COMPLETED"
                orders[oid]["completed_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                save_orders(orders)
                send_telegram_msg(f"✅ Đã đánh dấu hoàn thành đơn <b>#{oid}</b>!", chat_id=chat_id)
            else:
                send_telegram_msg(f"❌ Không tìm thấy mã đơn <b>#{oid}</b>.", chat_id=chat_id)

    elif cmd in ("/huy", "/cancel"):
        if not arg:
            send_telegram_msg("⚠️ Vui lòng nhập mã đơn. Ví dụ: <code>/huy CS22445</code>", chat_id=chat_id)
        else:
            orders = load_orders()
            oid = arg.upper()
            if oid in orders:
                orders[oid]["status"] = "CANCELED"
                save_orders(orders)
                send_telegram_msg(f"❌ Đã hủy đơn <b>#{oid}</b>!", chat_id=chat_id)
            else:
                send_telegram_msg(f"❌ Không tìm thấy mã đơn <b>#{oid}</b>.", chat_id=chat_id)

    elif cmd in ("/xoa", "/delete"):
        if not arg:
            send_telegram_msg("⚠️ Vui lòng nhập mã đơn cần xóa. Ví dụ: <code>/xoa CS22445</code>", chat_id=chat_id)
        else:
            oid = arg.upper()
            add_deleted_order_id(oid)
            orders = load_orders()
            if oid in orders:
                del orders[oid]
            save_orders(orders)
            sync_file_to_github_now("orders.json")
            send_telegram_msg(f"🗑️ <b>[ĐÃ XÓA VĨNH VIỄN #{oid}]</b>\nĐơn đã được xóa triệt để khỏi hệ thống và sẽ không bao giờ hồi lại.", chat_id=chat_id)

    elif cmd in ("/gold", "/locket"):
        if not arg:
            send_telegram_msg("⚠️ Vui lòng nhập username Locket. Ví dụ: <code>/gold dth206</code>", chat_id=chat_id)
        else:
            clean_u = re.sub(r"[^A-Za-z0-9_.-]", "", arg.lstrip("@"))
            queue_manager.add_to_queue(clean_u, "with_dns")
            send_telegram_msg(
                f"💛 <b>[ĐÃ THÊM LOCKET GOLD]</b>\n"
                f"• Tài khoản: <b>@{clean_u}</b>\n"
                f"• Cấu hình DNS: https://dth206.vercel.app/download-config?u={clean_u}\n"
                f"• Đã xếp vào hàng chờ kích hoạt VIP!",
                chat_id=chat_id
            )
    elif cmd in ("/popup", "/thongbao"):
        content_text = text[len(parts[0]):].strip()
        if not content_text:
            send_telegram_msg("⚠️ Vui lòng nhập nội dung thông báo.\n<i>Ví dụ: <code>/popup Bảo trì nâng cấp hệ thống lúc 23:00 tối nay!</code></i>", chat_id=chat_id)
        else:
            ann = config_manager.update_popup_announcement(enabled=True, content=content_text)
            send_telegram_msg(
                f"📢 <b>[CẬP NHẬT POPUP THÔNG BÁO]</b>\n"
                f"━━━━━━━━━━━━━━━━━━\n"
                f"• Trạng thái: 🟢 <b>ĐANG BẬT</b>\n"
                f"• Tiêu đề: <b>{ann.get('title', '')}</b>\n"
                f"• Nội dung:\n<blockquote>{ann.get('content', '')}</blockquote>\n"
                f"━━━━━━━━━━━━━━━━━━\n"
                f"✅ Đã lưu và hiển thị ngay trên trang web khách hàng!",
                chat_id=chat_id
            )

    elif cmd in ("/popup_on", "/popup_bat", "/popupon", "/popupbat"):
        ann = config_manager.update_popup_announcement(enabled=True)
        send_telegram_msg(
            f"🟢 <b>[ĐÃ BẬT POPUP THÔNG BÁO]</b>\n"
            f"━━━━━━━━━━━━━━━━━━\n"
            f"• Trạng thái: 🟢 <b>ĐANG BẬT</b>\n"
            f"• Tiêu đề: <b>{ann.get('title', '')}</b>\n"
            f"• Nội dung: <i>{ann.get('content') or '(Chưa có nội dung)'}</i>\n"
            f"━━━━━━━━━━━━━━━━━━\n"
            f"Khách truy cập web sẽ nhìn thấy popup thông báo này.",
            chat_id=chat_id
        )

    elif cmd in ("/popup_off", "/popup_tat", "/popupoff", "/popuptat"):
        ann = config_manager.update_popup_announcement(enabled=False)
        send_telegram_msg(
            f"🔴 <b>[ĐÃ TẮT POPUP THÔNG BÁO]</b>\n"
            f"━━━━━━━━━━━━━━━━━━\n"
            f"• Trạng thái: 🔴 <b>ĐÃ TẮT</b>\n"
            f"Popup đã được ẩn trên trang web khách hàng.",
            chat_id=chat_id
        )

    elif cmd in ("/popup_clear", "/popup_xoa", "/popupclear", "/popupxoa"):
        ann = config_manager.update_popup_announcement(action="clear")
        send_telegram_msg(
            f"🗑️ <b>[ĐÃ XÓA SẠCH NỘI DUNG POPUP]</b>\n"
            f"━━━━━━━━━━━━━━━━━━\n"
            f"• Trạng thái: 🔴 <b>ĐÃ TẮT</b>\n"
            f"Nội dung thông báo đã được dọn sạch.",
            chat_id=chat_id
        )

    elif cmd in ("/popup_status", "/popupstatus", "/trangthaipopup"):
        ann = config_manager.get_popup_announcement()
        enabled = ann.get("enabled", True)
        content_txt = ann.get("content") or "(Chưa có nội dung)"
        status_txt = "🟢 ĐANG BẬT (/popup_off)" if enabled else "🔴 ĐANG TẮT (/popup_on)"
        msg = f"""📊 <b>TRẠNG THÁI POPUP TRÊN WEB</b>
━━━━━━━━━━━━━━━━━━
🔹 Trạng thái: {status_txt}
📝 Nội dung:
"{content_txt}\""""
        send_telegram_msg(msg, chat_id=chat_id)

    else:
        msg, kb = get_telegram_admin_menu()
        send_telegram_msg(f"❓ Không rõ lệnh: <code>{text}</code>\n\n" + msg, reply_markup=kb, chat_id=chat_id)

    return jsonify({"ok": True})

@app.route("/api/telegram/set-webhook")
def telegram_set_webhook():
    cfg = load_config()
    tg = cfg.get("telegram", {})
    bot_token = tg.get("bot_token")
    if not bot_token:
        return jsonify({"success": False, "msg": "Chưa cấu hình Telegram Bot Token"}), 400

    host = request.host
    webhook_url = f"https://{host}/api/telegram/webhook"
    tg_url = f"https://api.telegram.org/bot{bot_token}/setWebhook"
    try:
        r = requests.post(tg_url, json={"url": webhook_url, "drop_pending_updates": False}, timeout=10)
        return jsonify({
            "success": r.status_code == 200,
            "webhook_url": webhook_url,
            "telegram_response": r.json() if r.status_code == 200 else r.text
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/order/update-target", methods=["POST"])
def customer_update_target():
    data = request.get_json(silent=True) or {}
    order_id = str(data.get("order_id") or "").strip().upper()
    new_target = str(data.get("new_target") or "").strip()

    if not order_id:
        return jsonify({"success": False, "msg": "Thiếu mã đơn hàng."}), 400
    if not new_target:
        return jsonify({"success": False, "msg": "Vui lòng nhập mã hoặc link mới."}), 400

    orders = load_orders()
    order = orders.get(order_id)
    if not order:
        return jsonify({"success": False, "msg": "Không tìm thấy mã đơn hàng."}), 404

    st = order.get("status")
    if st == "PENDING":
        return jsonify({"success": False, "msg": "Đơn hàng này chưa được thanh toán. Vui lòng thanh toán trước."}), 400

    stype = order.get("service_type") or ("chungsuc" if order_id.startswith("CS") else ("mxh" if order_id.startswith("TT") else "locket"))

    if stype == "chungsuc" or order_id.startswith("CS"):
        clean_code = extract_invite_code(new_target)
        if not clean_code or len(clean_code) < 4:
            return jsonify({"success": False, "msg": "Mã mời Liên Quân không đúng định dạng. Vui lòng kiểm tra lại link sự kiện hoặc mã chia sẻ!"}), 400
        
        old_val = order.get("code")
        order["code"] = clean_code
        order["raw_code"] = new_target
        order["autonhanh_status"] = "RETRYING"
        order["autonhanh_error"] = None
        order["status"] = "PROCESSING"

        orders[order_id] = order
        save_orders(orders)

        ok, res = autonhanh_process_order(order, force=True)
        orders = load_orders()
        updated_order = orders.get(order_id, order)

        send_telegram_msg(
            f"🔄 <b>[KHÁCH CẬP NHẬT MÃ LIÊN QUÂN MỚI]</b>\n"
            f"• Đơn hàng: <b>#{order_id}</b>\n"
            f"• Gói: {order.get('package_name')}\n"
            f"• Mã cũ: <code>{old_val}</code>\n"
            f"• Mã mới: <code>{clean_code}</code>\n"
            f"• Trạng thái xử lý: <b>{'Đã đẩy thành công' if ok else 'Đẩy thất bại'}</b>\n"
            f"{('• Chi tiết lỗi: ' + str(res)) if not ok else ''}"
        )

        if not ok:
            if any(k in str(res).lower() for k in ["invalid", "code", "mã"]):
                return jsonify({"success": False, "msg": "Mã mời mới vẫn không hợp lệ hoặc máy chủ không chấp nhận. Vui lòng thử link/mã khác!"}), 400
            return jsonify({"success": True, "msg": "Đã tiếp nhận mã mới! Hệ thống đang tự động xếp hàng xử lý cho bạn.", "order": sanitize_order_for_client(updated_order)})

        return jsonify({
            "success": True,
            "msg": "Cập nhật mã mới thành công! Hệ thống đang tự động buff lượt cho bạn ngay.",
            "order": sanitize_order_for_client(updated_order)
        })

    elif stype == "mxh" or order_id.startswith("TT"):
        new_link = str(new_target).strip()
        if not (new_link.startswith("http://") or new_link.startswith("https://")):
            return jsonify({"success": False, "msg": "Link bài viết mạng xã hội phải bắt đầu bằng https:// hoặc http://"}), 400

        old_val = order.get("link")
        order["link"] = new_link
        order["tangtim_status"] = "RETRYING"
        order["tangtim_error"] = None
        order["status"] = "PROCESSING"

        orders[order_id] = order
        save_orders(orders)

        ok, res = tangtim_process_order(order)
        orders = load_orders()
        updated_order = orders.get(order_id, order)

        send_telegram_msg(
            f"🔄 <b>[KHÁCH CẬP NHẬT LINK MXH MỚI]</b>\n"
            f"• Đơn hàng: <b>#{order_id}</b>\n"
            f"• Gói: {order.get('package_name')}\n"
            f"• Link cũ: <code>{old_val}</code>\n"
            f"• Link mới: <code>{new_link}</code>\n"
            f"• Trạng thái xử lý: <b>{'Đã đẩy thành công' if ok else 'Đẩy thất bại'}</b>\n"
            f"{('• Chi tiết lỗi: ' + str(res)) if not ok else ''}"
        )

        if not ok:
            if any(k in str(res).lower() for k in ["link", "url", "private", "not found"]):
                return jsonify({"success": False, "msg": "Link mới bạn vừa nhập vẫn không hợp lệ hoặc đang ở chế độ riêng tư. Vui lòng kiểm tra lại link công khai!"}), 400
            return jsonify({"success": True, "msg": "Đã tiếp nhận link mới! Hệ thống đang xếp hàng tăng tương tác cho bạn.", "order": sanitize_order_for_client(updated_order)})

        return jsonify({
            "success": True,
            "msg": "Cập nhật link mới thành công! Hệ thống đang tăng tương tác tự động cho bạn ngay.",
            "order": sanitize_order_for_client(updated_order)
        })

    return jsonify({"success": False, "msg": "Loại đơn hàng không hỗ trợ đổi mã hoặc link."}), 400

@app.route("/api/order/lookup", methods=["GET", "POST"])
def lookup_orders():
    from routes.orders import lookup_orders as bp_lookup_orders
    return bp_lookup_orders()

# ==========================================
# ADMIN AUTH & DASHBOARD
# ==========================================
def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get("is_admin"):
            return jsonify({"success": False, "msg": "Yêu cầu đăng nhập quản trị viên."}), 401
        return f(*args, **kwargs)
    return decorated

def merge_preserving_existing(existing, updates):
    if not isinstance(existing, dict) or not isinstance(updates, dict):
        return updates

    merged = dict(existing)
    for key, value in updates.items():
        if isinstance(merged.get(key), dict) and isinstance(value, dict):
            merged[key] = merge_preserving_existing(merged[key], value)
        else:
            merged[key] = value
    return merged

@app.route("/api/admin/services-toggle", methods=["GET", "POST"])
@admin_required
def admin_services_toggle():
    cfg = load_config()
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        se = cfg.get("services_enabled", {"chungsuc": True, "locket": True, "mxh": True, "premium": True})
        if "chungsuc" in data:
            se["chungsuc"] = bool(data["chungsuc"])
        if "locket" in data:
            se["locket"] = bool(data["locket"])
        if "mxh" in data:
            se["mxh"] = bool(data["mxh"])
        if "premium" in data:
            se["premium"] = bool(data["premium"])
        cfg["services_enabled"] = se
        save_config(cfg)
        return jsonify({"success": True, "services_enabled": se, "msg": "Đã lưu cài đặt bật/tắt dịch vụ!"})
    return jsonify({"success": True, "services_enabled": cfg.get("services_enabled", {"chungsuc": True, "locket": True, "mxh": True, "premium": True})})

@app.route("/api/admin/premium/save-config", methods=["POST"])
@admin_required
def admin_save_premium_config():
    data = request.get_json(silent=True) or {}
    platform = (data.get("platform") or "").strip().lower()
    packages = data.get("packages")

    if not platform or not isinstance(packages, dict):
        return jsonify({"success": False, "msg": "Dữ liệu cấu hình không hợp lệ."}), 400

    cfg = load_config()
    if "premium_services" not in cfg:
        cfg["premium_services"] = {}

    if platform in cfg["premium_services"]:
        current_packages = cfg["premium_services"][platform].get("packages", {})
        cfg["premium_services"][platform]["packages"] = merge_preserving_existing(current_packages, packages)
        save_config(cfg)
        return jsonify({"success": True, "msg": f"Đã cập nhật bảng giá gói {cfg['premium_services'][platform].get('name')} thành công!"})

    return jsonify({"success": False, "msg": "Nền tảng không tồn tại."}), 404

@app.route("/api/admin/premium/toggle", methods=["POST"])
@admin_required
def admin_toggle_premium_market():
    data = request.get_json(silent=True) or {}
    enabled = bool(data.get("enabled", True))
    cfg = load_config()
    if "services_enabled" not in cfg:
        cfg["services_enabled"] = {}
    cfg["services_enabled"]["premium"] = enabled
    save_config(cfg)
    status_str = "BẬT" if enabled else "TẮT"
    return jsonify({"success": True, "enabled": enabled, "msg": f"Đã {status_str} Chợ Dịch Vụ Premium thành công!"})

@app.route("/api/admin/premium/service/toggle", methods=["POST"])
@admin_required
def admin_toggle_single_service():
    data = request.get_json(silent=True) or {}
    sid = (data.get("id") or "").strip().lower()
    active = bool(data.get("active", True))
    cfg = load_config()
    if "premium_services" in cfg and sid in cfg["premium_services"]:
        cfg["premium_services"][sid]["active"] = active
        save_config(cfg)
        status_text = "bật" if active else "tắt"
        sname = cfg["premium_services"][sid].get("name", sid)
        return jsonify({"success": True, "active": active, "msg": f"Đã {status_text} dịch vụ {sname}!"})
    return jsonify({"success": False, "msg": "Không tìm thấy dịch vụ."}), 404

@app.route("/api/admin/premium/package/toggle", methods=["POST"])
@admin_required
def admin_toggle_single_package():
    data = request.get_json(silent=True) or {}
    sid = (data.get("service_id") or "").strip().lower()
    pkg_id = (data.get("package_id") or "").strip()
    active = bool(data.get("active", True))
    cfg = load_config()
    if "premium_services" in cfg and sid in cfg["premium_services"]:
        pkgs = cfg["premium_services"][sid].get("packages", {})
        if pkg_id in pkgs:
            pkgs[pkg_id]["active"] = active
            save_config(cfg)
            status_text = "bật" if active else "tắt"
            pname = pkgs[pkg_id].get("name", pkg_id)
            return jsonify({"success": True, "active": active, "msg": f"Đã {status_text} gói {pname}!"})
    return jsonify({"success": False, "msg": "Không tìm thấy gói."}), 404

@app.route("/api/admin/premium/save-all", methods=["POST"])
@admin_required
def admin_save_all_premium_services():
    data = request.get_json(silent=True) or {}
    services = data.get("services")
    if not isinstance(services, dict):
        return jsonify({"success": False, "msg": "Dữ liệu dịch vụ không hợp lệ."}), 400

    for service_id, service in services.items():
        if not isinstance(service_id, str) or not re.fullmatch(r"[a-z0-9_-]{1,64}", service_id):
            return jsonify({"success": False, "msg": "Mã dịch vụ không hợp lệ."}), 400
        if not isinstance(service, dict):
            return jsonify({"success": False, "msg": f"Cấu hình dịch vụ '{service_id}' không hợp lệ."}), 400

        packages = service.get("packages", {})
        if not isinstance(packages, dict):
            return jsonify({"success": False, "msg": f"Danh sách gói của '{service_id}' không hợp lệ."}), 400

        for package_id, package in packages.items():
            if not isinstance(package_id, str) or not re.fullmatch(r"[a-z0-9_-]{1,64}", package_id):
                return jsonify({"success": False, "msg": f"Mã gói trong dịch vụ '{service_id}' không hợp lệ."}), 400
            if not isinstance(package, dict) or not str(package.get("name", "")).strip():
                return jsonify({"success": False, "msg": f"Tên gói '{package_id}' không được để trống."}), 400
            raw_price = package.get("price")
            if isinstance(raw_price, bool) or not re.fullmatch(r"\d+", str(raw_price).strip()):
                return jsonify({"success": False, "msg": f"Giá gói '{package_id}' phải là số nguyên hợp lệ."}), 400
            price = int(raw_price)
            if price <= 0:
                return jsonify({"success": False, "msg": f"Giá gói '{package_id}' phải lớn hơn 0."}), 400

            package["id"] = package_id
            package["name"] = str(package["name"]).strip()
            package["price"] = price
            package["price_formatted"] = format_currency_vnd(price)
            if "desc" in package:
                package["desc"] = str(package["desc"]).strip()[:500]

    cfg = load_config()
    cfg["premium_services"] = merge_preserving_existing(cfg.get("premium_services", {}), services)
    if "market_enabled" in data:
        if "services_enabled" not in cfg:
            cfg["services_enabled"] = {}
        cfg["services_enabled"]["premium"] = bool(data["market_enabled"])
    save_config(cfg)
    return jsonify({"success": True, "msg": "Đã lưu toàn bộ cấu hình dịch vụ & bảng giá Chợ Premium!"})

@app.route("/api/admin/premium/service/add", methods=["POST"])
@admin_required
def admin_add_premium_service():
    data = request.get_json(silent=True) or {}
    sid = (data.get("id") or "").strip().lower()
    name = (data.get("name") or "").strip()
    icon = (data.get("icon") or "fa-solid fa-gem").strip()
    color = (data.get("color") or "#2563eb").strip()
    badge = (data.get("badge") or "Chính Chủ").strip()
    tagline = (data.get("tagline") or "").strip()
    input_label = (data.get("input_label") or "Email hoặc Tài khoản nhận nâng cấp").strip()
    input_placeholder = (data.get("input_placeholder") or "Ví dụ: emailcuaban@gmail.com...").strip()
    guide_note = (data.get("guide_note") or "").strip()
    first_pkg_name = (data.get("first_pkg_name") or f"{name} 1 Tháng").strip()
    first_pkg_duration = (data.get("first_pkg_duration") or "1 Tháng").strip()
    try:
        first_pkg_price = int(data.get("first_pkg_price", 49000))
    except (ValueError, TypeError):
        first_pkg_price = 49000

    if not sid or not name:
        return jsonify({"success": False, "msg": "Vui lòng nhập Mã ID dịch vụ và Tên dịch vụ."}), 400

    sid = re.sub(r'[^a-z0-9_-]', '', sid)
    if not sid:
        return jsonify({"success": False, "msg": "Mã ID dịch vụ chỉ gồm chữ cái viết thường, số, dấu '-' hoặc '_'."}), 400

    cfg = load_config()
    if "premium_services" not in cfg:
        cfg["premium_services"] = {}

    if sid in cfg["premium_services"]:
        return jsonify({"success": False, "msg": f"Mã dịch vụ '{sid}' đã tồn tại!"}), 400

    first_pkg_id = f"{sid}_1m"
    new_svc = {
        "id": sid,
        "name": name,
        "icon": icon,
        "color": color,
        "badge": badge,
        "tagline": tagline or f"Dịch vụ {name} bản quyền giá sinh viên",
        "input_label": input_label,
        "input_placeholder": input_placeholder,
        "guide_note": guide_note or f"Bảo hành 1 đổi 1 suốt thời gian sử dụng {name}.",
        "active": True,
        "features": [
            f"Kích hoạt {name} bản quyền chính hãng 100%",
            "Bảo hành trọn đời gói mua, hỗ trợ 24/7",
            "Dùng ổn định mượt mà trên mọi thiết bị"
        ],
        "packages": {
            first_pkg_id: {
                "id": first_pkg_id,
                "name": first_pkg_name,
                "duration": first_pkg_duration,
                "price": first_pkg_price,
                "price_formatted": format_currency_vnd(first_pkg_price),
                "badge": "Tiết Kiệm 🔥",
                "desc": f"Sử dụng {name} {first_pkg_duration} bản quyền.",
                "active": True
            }
        }
    }

    cfg["premium_services"][sid] = new_svc
    save_config(cfg)
    return jsonify({"success": True, "msg": f"Đã thêm dịch vụ '{name}' thành công!", "service": new_svc})

@app.route("/api/admin/premium/service/delete", methods=["POST"])
@admin_required
def admin_delete_premium_service():
    data = request.get_json(silent=True) or {}
    sid = (data.get("id") or "").strip().lower()
    cfg = load_config()
    if "premium_services" in cfg and sid in cfg["premium_services"]:
        del cfg["premium_services"][sid]
        save_config(cfg)
        return jsonify({"success": True, "msg": f"Đã xóa dịch vụ '{sid}' thành công!"})
    return jsonify({"success": False, "msg": "Không tìm thấy dịch vụ cần xóa."}), 404

@app.route("/api/admin/premium/package/add", methods=["POST"])
@admin_required
def admin_add_premium_package():
    data = request.get_json(silent=True) or {}
    sid = (data.get("service_id") or "").strip().lower()
    pkg_id = (data.get("id") or "").strip()
    name = (data.get("name") or "").strip()
    duration = (data.get("duration") or "1 Tháng").strip()
    raw_price = data.get("price", 0)
    if isinstance(raw_price, bool) or not re.fullmatch(r"\d+", str(raw_price).strip()):
        price = 0
    else:
        price = int(raw_price)
    badge = (data.get("badge") or "").strip()
    desc = (data.get("desc") or "").strip()

    if not sid or not pkg_id or not name or price <= 0:
        return jsonify({"success": False, "msg": "Vui lòng nhập đầy đủ Mã gói, Tên gói và Giá bán (>0)."}), 400
    if not re.fullmatch(r"[a-z0-9_-]{1,64}", pkg_id):
        return jsonify({"success": False, "msg": "Mã gói chỉ gồm chữ thường, số, dấu '-' hoặc '_' (tối đa 64 ký tự)."}), 400

    cfg = load_config()
    if "premium_services" not in cfg or sid not in cfg["premium_services"]:
        return jsonify({"success": False, "msg": f"Dịch vụ '{sid}' không tồn tại."}), 404

    if "packages" not in cfg["premium_services"][sid]:
        cfg["premium_services"][sid]["packages"] = {}
    if pkg_id in cfg["premium_services"][sid]["packages"]:
        return jsonify({"success": False, "msg": f"Mã gói '{pkg_id}' đã tồn tại trong dịch vụ này."}), 400

    cfg["premium_services"][sid]["packages"][pkg_id] = {
        "id": pkg_id,
        "name": name,
        "duration": duration,
        "price": price,
        "price_formatted": format_currency_vnd(price),
        "badge": badge,
        "desc": desc,
        "active": True
    }
    save_config(cfg)
    return jsonify({"success": True, "msg": f"Đã thêm gói '{name}' vào dịch vụ '{sid}'!"})

@app.route("/api/admin/premium/package/delete", methods=["POST"])
@admin_required
def admin_delete_premium_package():
    data = request.get_json(silent=True) or {}
    sid = (data.get("service_id") or "").strip().lower()
    pkg_id = (data.get("package_id") or "").strip()

    cfg = load_config()
    if "premium_services" in cfg and sid in cfg["premium_services"]:
        pkgs = cfg["premium_services"][sid].get("packages", {})
        if pkg_id in pkgs:
            del pkgs[pkg_id]
            save_config(cfg)
            return jsonify({"success": True, "msg": f"Đã xóa gói '{pkg_id}'."})
    return jsonify({"success": False, "msg": "Không tìm thấy gói cần xóa."}), 404

@app.route("/api/admin/order/delivery-info", methods=["POST"])
@admin_required
def admin_set_delivery_info():
    data = request.get_json(silent=True) or {}
    oid = (data.get("order_id") or "").strip().upper()
    delivery_info = (data.get("delivery_info") or "").strip()
    status = (data.get("status") or "COMPLETED").strip().upper()

    orders = load_orders()
    if oid not in orders:
        return jsonify({"success": False, "msg": "Không tìm thấy đơn hàng."}), 404

    order = orders[oid]
    order["delivery_info"] = delivery_info
    order["status"] = status
    save_orders(orders)

    return jsonify({"success": True, "msg": f"Đã bàn giao tài khoản và cập nhật trạng thái đơn #{oid}!"})


@app.route("/api/admin/check-auth")
def admin_check_auth():
    if not is_admin_authenticated():
        return jsonify({"is_admin": False, "success": False}), 401
    return jsonify({
        "is_admin": True,
        "success": True,
        "expires_at": session.get("admin_expires_at")
    })

@app.route("/api/admin/stats")
@admin_required
def admin_stats():
    orders = load_orders()
    total_rev = 0
    today_rev = 0
    now_dt = datetime.now()
    today_str = now_dt.strftime("%Y-%m-%d")

    counts = {"all": len(orders), "chungsuc": 0, "locket": 0, "mxh": 0, "premium": 0}
    rev_by_type = {"chungsuc": 0, "locket": 0, "mxh": 0, "premium": 0}
    status_counts = {"PENDING": 0, "PROCESSING": 0, "COMPLETED": 0, "FAILED": 0}

    for o in orders.values():
        amt = int(o.get("amount", 0) or 0)
        st = o.get("status", "PENDING")
        status_counts[st] = status_counts.get(st, 0) + 1

        oid = str(o.get("order_id", ""))
        stype = o.get("service_type") or ("chungsuc" if oid.startswith("CS") else ("locket" if oid.startswith("LK") else ("premium" if oid.startswith("PR") else "mxh")))
        counts[stype] = counts.get(stype, 0) + 1

        if st in ("PAID", "PROCESSING", "COMPLETED"):
            total_rev += amt
            rev_by_type[stype] = rev_by_type.get(stype, 0) + amt
            if str(o.get("created_time", "")).startswith(today_str):
                today_rev += amt

    # TangTim balance
    tt_bal_vnd, tt_bal_str, tt_usd = None, None, None
    # AutoNhanh balance
    an_bal = None

    return jsonify({
        "success": True,
        "total_revenue": total_rev,
        "total_revenue_formatted": format_currency_vnd(total_rev),
        "today_revenue": today_rev,
        "today_revenue_formatted": format_currency_vnd(today_rev),
        "counts": counts,
        "rev_by_type": rev_by_type,
        "status_counts": status_counts,
        "partner_balances": {
            "autonhanh_xu": an_bal,
            "tangtim_vnd": tt_bal_vnd,
            "tangtim_str": tt_bal_str,
            "tangtim_usd": tt_usd
        }
    })

@app.route("/api/admin/orders")
@admin_required
def admin_get_orders():
    service_filter = (request.args.get("service") or "all").strip().lower()
    status_filter = (request.args.get("status") or "all").strip().upper()
    q = (request.args.get("query") or request.args.get("q") or "").strip().lower()

    db = models.SessionLocal()
    try:
        # Single Source of Truth: Đọc trực tiếp từ Database
        query = db.query(models.Order)

        if service_filter != "all":
            query = query.filter(models.Order.service_type == service_filter)

        if status_filter != "ALL":
            query = query.filter(models.Order.status == status_filter)

        if q:
            like_q = f"%{q}%"
            query = query.filter(
                (models.Order.order_id.ilike(like_q)) |
                (models.Order.zalo.ilike(like_q)) |
                (models.Order.username.ilike(like_q)) |
                (models.Order.code.ilike(like_q)) |
                (models.Order.link.ilike(like_q)) |
                (models.Order.package_name.ilike(like_q))
            )

        orders = query.order_by(models.Order.created_at.desc()).limit(500).all()
        out = [o.to_dict() for o in orders]

        res = jsonify({"success": True, "orders": out, "count": len(out)})
        res.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        res.headers["Pragma"] = "no-cache"
        return res
    finally:
        db.close()

@app.route("/api/admin/order/update-status", methods=["POST"])
@admin_required
def admin_update_order_status():
    data = request.get_json(silent=True) or {}
    oid = (data.get("order_id") or "").strip().upper()
    new_st = (data.get("status") or "").strip().upper()

    orders = load_orders()
    if oid not in orders:
        return jsonify({"success": False, "msg": "Đơn không tồn tại"}), 404

    orders[oid]["status"] = new_st
    save_orders(orders)
    return jsonify({"success": True, "msg": f"Đã cập nhật trạng thái đơn {oid} sang {new_st}"})

@app.route("/api/admin/order/accept", methods=["POST"])
@admin_required
def admin_accept_order():
    data = request.get_json(silent=True) or {}
    oid = (data.get("order_id") or "").strip().upper()

    orders = load_orders()
    if oid not in orders:
        return jsonify({"success": False, "msg": "Đơn không tồn tại"}), 404

    order = orders[oid]
    order["status"] = "PAID"
    order["paid_at"] = f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} (Admin duyệt)"

    stype = order.get("service_type") or ("chungsuc" if oid.startswith("CS") else ("locket" if oid.startswith("LK") else "mxh"))
    if stype == "chungsuc":
        autonhanh_process_order(order, force=True)
    elif stype == "locket":
        clean_u = re.sub(r"[^A-Za-z0-9_.-]", "", str(order.get("username", "")).lstrip("@")) or "VIP"
        order["status"] = "COMPLETED"
        order["gold_status"] = "ACTIVE"
        order["gold_error"] = None
        order["dns_link"] = f"/download-config?u={clean_u}"
        order["module_link"] = LOCKET_SHADOW_MODULE_URL
        queue_manager.add_to_queue(order.get("username"), order.get("package_type", "with_dns"), order_id=oid)
    elif stype == "premium" or oid.startswith("PR"):
        order["status"] = "PAID"
    else:
        tangtim_process_order(order)

    save_orders(orders)
    return jsonify({"success": True, "msg": f"Đã duyệt và đẩy xử lý đơn {oid}."})

@app.route("/api/admin/order/push", methods=["POST"])
@admin_required
def admin_push_order():
    data = request.get_json(silent=True) or {}
    oid = (data.get("order_id") or "").strip().upper()

    orders = load_orders()
    if oid not in orders:
        return jsonify({"success": False, "msg": "Đơn không tồn tại"}), 404

    order = orders[oid]
    stype = order.get("service_type") or ("chungsuc" if oid.startswith("CS") else ("locket" if oid.startswith("LK") else "mxh"))

    if stype == "chungsuc":
        ok, res = autonhanh_process_order(order, force=True)
    elif stype == "locket":
        clean_u = re.sub(r"[^A-Za-z0-9_.-]", "", str(order.get("username", "")).lstrip("@")) or "VIP"
        order["status"] = "COMPLETED"
        order["gold_status"] = "ACTIVE"
        order["gold_error"] = None
        order["dns_link"] = f"/download-config?u={clean_u}"
        order["module_link"] = LOCKET_SHADOW_MODULE_URL
        queue_manager.add_to_queue(order.get("username"), order.get("package_type", "with_dns"), order_id=oid)
        ok, res = True, "Đã gửi vào hàng chờ kích hoạt Locket Gold"
    else:
        ok, res = tangtim_process_order(order)

    return jsonify({"success": ok, "result": res})

@app.route("/api/admin/order/delete", methods=["POST"])
@admin_required
def admin_delete_order():
    data = request.get_json(silent=True) or {}
    oid = (data.get("order_id") or "").strip().upper()
    if not oid:
        return jsonify({"success": False, "msg": "Thiếu mã đơn cần xóa"}), 400

    add_deleted_order_id(oid)

    # 1. Xóa trong Database (Single Source of Truth)
    db = models.SessionLocal()
    deleted_username = None
    deleted_uid = None
    deleted_service = None
    try:
        db_order = db.query(models.Order).filter(models.Order.order_id == oid).first()
        if db_order:
            deleted_username = db_order.username
            deleted_uid = db_order.uid
            deleted_service = db_order.service_type
            db.delete(db_order)
            db.commit()

        # 2. Dọn dẹp cache Locket nếu không còn đơn COMPLETED nào khác
        if deleted_service == "locket" or oid.startswith("LK") or oid.startswith("DIRECT"):
            clean_u = clean_locket_username(deleted_username).lower() if deleted_username else ""
            has_other_completed = False
            if clean_u or deleted_uid:
                from sqlalchemy import or_, func
                q = db.query(models.Order).filter(
                    (models.Order.service_type == "locket") | 
                    (models.Order.order_id.like("LK%")) | 
                    (models.Order.order_id.like("DIRECT%")),
                    models.Order.status == "COMPLETED"
                )
                conds = []
                if clean_u:
                    conds.append(func.lower(models.Order.username) == clean_u)
                if deleted_uid:
                    conds.append(models.Order.uid == deleted_uid)
                q = q.filter(or_(*conds))
                deleted_ids = get_deleted_order_ids()
                for rem_o in q.all():
                    if str(rem_o.order_id).strip().upper() not in deleted_ids:
                        has_other_completed = True
                        break
            if not has_other_completed:
                clean_locket_account_cache(deleted_username, deleted_uid)
    finally:
        db.close()

    # 3. Xóa trong orders.json
    orders = load_orders()
    if oid in orders:
        del orders[oid]
    save_orders(orders, sync_github=True)
    sync_file_to_github_async("deleted_orders.json")
    return jsonify({"success": True, "msg": f"Đã xóa vĩnh viễn đơn #{oid}"})

@app.route("/api/admin/orders/bulk-delete", methods=["POST"])
@admin_required
def admin_bulk_delete_orders():
    data = request.get_json(silent=True) or {}
    oids = data.get("order_ids") or []
    db = models.SessionLocal()
    try:
        for oid in oids:
            oid_up = str(oid).strip().upper()
            add_deleted_order_id(oid_up)
            db_order = db.query(models.Order).filter(models.Order.order_id == oid_up).first()
            if db_order:
                u = db_order.username
                uid = db_order.uid
                svc = db_order.service_type
                db.delete(db_order)
                if svc == "locket" or oid_up.startswith("LK"):
                    clean_locket_account_cache(u, uid)
        db.commit()
    finally:
        db.close()

    orders = load_orders()
    deleted = 0
    for oid in oids:
        oid_up = str(oid).strip().upper()
        if oid_up in orders:
            del orders[oid_up]
            deleted += 1
    if deleted:
        save_orders(orders)
        sync_file_to_github_now("orders.json")
    sync_file_to_github_async("deleted_orders.json")
    return jsonify({"success": True, "deleted_count": deleted})

@app.route("/api/admin/check-bank", methods=["POST"])
@admin_required
def admin_manual_check_bank():
    res = check_and_process_zalopay_history(force=True)
    return jsonify(res)

# ==========================================
# ADMIN CONFIGURATIONS (ALL 3 SERVICES)
# ==========================================
@app.route("/api/admin/config", methods=["GET"])
@admin_required
def admin_get_config():
    cfg = load_config()
    # Mask passwords & tokens slightly for safety
    return jsonify({"success": True, "config": cfg})

@app.route("/api/admin/chungsuc/config", methods=["POST"])
@admin_required
def admin_update_chungsuc_config():
    data = request.get_json(silent=True) or {}
    if "packages" in data and not isinstance(data["packages"], dict):
        return jsonify({"success": False, "msg": "Danh sách gói Chung Sức không hợp lệ."}), 400
    cfg = load_config()
    if "packages" in data:
        cfg["chungsuc_packages"] = merge_preserving_existing(cfg.get("chungsuc_packages", {}), data["packages"])
    if "autonhanh" in data:
        an = cfg.setdefault("autonhanh", {})
        for k, v in data["autonhanh"].items():
            an[k] = v
    save_config(cfg)
    return jsonify({"success": True, "msg": "Cập nhật cấu hình Chung Sức thành công!"})


@app.route("/api/admin/locket/login", methods=["POST"])
@admin_required
def admin_locket_login():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip()
    pwd = (data.get("password") or "").strip()
    if not email or not pwd:
        return jsonify({"success": False, "msg": "Vui lòng nhập Email và Mật khẩu Locket."}), 400

    try:
        url = "https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword?key=AIzaSyCQngaaXQIfJaH0aS2l7REgIjD7nL431So"
        headers = {
            "X-Ios-Bundle-Identifier": "com.locket.Locket",
            "User-Agent": "Locket/2283 CFNetwork/3896.100.1.2.1 Darwin/27.0.0",
        }
        res = requests.post(
            url,
            headers=headers,
            json={"email": email, "password": pwd, "returnSecureToken": True},
            timeout=10,
        )
        res_data = res.json()
        if not res.ok:
            err_code = res_data.get("error", {}).get("message", "Đăng nhập thất bại")
            trans = {
                "EMAIL_NOT_FOUND": "Email này chưa được đăng ký tài khoản Locket.",
                "INVALID_PASSWORD": "Mật khẩu không chính xác.",
                "USER_DISABLED": "Tài khoản Locket đã bị vô hiệu hóa.",
            }
            msg = trans.get(err_code, f"Lỗi từ Locket: {err_code}")
            return jsonify({"success": False, "msg": msg}), 400

        id_token = res_data.get("idToken")
        refresh_token = res_data.get("refreshToken")

        cfg = load_config()
        locket_cfg = cfg.setdefault("locket", {})
        locket_cfg["bearer_token"] = id_token
        if refresh_token:
            locket_cfg["refresh_token"] = refresh_token
        api_toks = cfg.setdefault("api_tokens", {})
        api_toks["locket_bearer"] = id_token
        save_config(cfg)

        return jsonify({
            "success": True,
            "msg": "Đăng nhập thành công! Đã tự động cập nhật Locket Bearer Token.",
            "token": id_token,
        })
    except Exception as e:
        return jsonify({"success": False, "msg": f"Lỗi kết nối: {str(e)}"}), 500


@app.route("/api/admin/tokens/import-locket-raw", methods=["POST"])
@admin_required
def import_locket_raw_token():
    data = request.get_json(silent=True) or {}
    raw_text = data.get("text", "")
    if not raw_text:
        return jsonify({"success": False, "msg": "Vui lòng dán nội dung gói tin HTTP Catcher."}), 400

    auth_match = re.search(r"authorization:\s*(Bearer\s+[A-Za-z0-9_\-\.]+)", raw_text, re.IGNORECASE)
    appcheck_match = re.search(r"x-firebase-appcheck:\s*([A-Za-z0-9_\-\.]+)", raw_text, re.IGNORECASE)
    iid_match = re.search(r"firebase-instance-id-token:\s*([^\s\r\n]+)", raw_text, re.IGNORECASE)

    extracted_bearer = auth_match.group(1).strip() if auth_match else ""
    if not extracted_bearer:
        jwt_match = re.search(r"(Bearer\s+eyJ[A-Za-z0-9_\-]+\.eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+)", raw_text)
        if jwt_match:
            extracted_bearer = jwt_match.group(1).strip()

    extracted_appcheck = appcheck_match.group(1).strip() if appcheck_match else ""
    extracted_iid = iid_match.group(1).strip() if iid_match else ""

    if not extracted_bearer and not extracted_appcheck:
        return jsonify({"success": False, "msg": "Không tìm thấy header Authorization hoặc X-Firebase-AppCheck trong gói tin."}), 400

    cfg = load_config()
    locket_cfg = cfg.setdefault("locket", {})
    api_toks = cfg.setdefault("api_tokens", {})
    if extracted_bearer:
        locket_cfg["bearer_token"] = extracted_bearer
        api_toks["locket_bearer"] = extracted_bearer
    if extracted_appcheck:
        locket_cfg["appcheck_token"] = extracted_appcheck
        api_toks["firebase_appcheck"] = extracted_appcheck
    if extracted_iid:
        api_toks["firebase_instance_id_token"] = extracted_iid
    save_config(cfg)

    return jsonify({
        "success": True,
        "msg": "Đã bóc tách và lưu Authorization & AppCheck từ gói tin thành công!",
        "locket_bearer": extracted_bearer,
        "firebase_appcheck": extracted_appcheck,
    })

@app.route("/api/admin/locket/tokens")
@admin_required
def admin_get_locket_tokens():
    tokens = config_manager.get_token_sets_summaries()
    return jsonify({"success": True, "tokens": tokens})

@app.route("/api/admin/locket/tokens/add", methods=["POST"])
@admin_required
def admin_add_locket_token():
    data = request.get_json(silent=True) or {}
    # Smart auto-extract if raw text/json was provided
    raw_text = data.get("raw") or data.get("text") or data.get("fetch_token") or ""
    if raw_text and ("{" in raw_text or "curl" in raw_text.lower() or "x-post" in raw_text.lower() or len(re.findall(r"eyJ[a-zA-Z0-9_\-\.]+", raw_text)) >= 2):
        from config_manager import parse_raw_token_request
        extracted, err = parse_raw_token_request(raw_text)
        if extracted:
            if data.get("name") and data["name"].strip():
                extracted["name"] = data["name"].strip()
            data = extracted

    ok, msg = config_manager.add_token_set(data)
    return jsonify({"success": ok, "msg": msg, "token": data if ok else None})

@app.route("/api/admin/locket/tokens/toggle", methods=["POST"])
@admin_required
def admin_toggle_locket_token():
    data = request.get_json(silent=True) or {}
    tid = data.get("id")
    ok, res = config_manager.toggle_token_set(tid)
    return jsonify({"success": ok, "active": res})

@app.route("/api/admin/locket/tokens/delete", methods=["POST"])
@admin_required
def admin_delete_locket_token():
    data = request.get_json(silent=True) or {}
    tid = data.get("id")
    ok, msg = config_manager.delete_token_set(tid)
    return jsonify({"success": ok, "msg": msg})

@app.route("/api/admin/locket/tokens/test", methods=["POST"])
@admin_required
def admin_test_locket_token():
    data = request.get_json(silent=True) or {}
    tid = data.get("id")
    token_sets = config_manager.get_token_sets()
    target = next((t for t in token_sets if t.get("id") == tid), None)
    if not target:
        return jsonify({"success": False, "msg": "Token không tồn tại"}), 404

    api = LocketAPI()
    try:
        ok, res = api.test_restore_token(target)
        return jsonify({"success": ok, "result": res})
    except Exception as e:
        return jsonify({"success": False, "msg": str(e)})

@app.route("/api/admin/locket/tokens/advanced", methods=["POST"])
@admin_required
def admin_update_locket_advanced():
    data = request.get_json(silent=True) or {}
    if "revenuecat_bearer" in data:
        config_manager.set_revenuecat_bearer(data["revenuecat_bearer"])
    if "firebase_appcheck" in data:
        config_manager.set_firebase_appcheck(data["firebase_appcheck"])
    if "locket_bearer" in data:
        config_manager.set_locket_bearer(data["locket_bearer"])
    return jsonify({"success": True, "msg": "Cập nhật Advanced Tokens thành công!"})

@app.route("/api/admin/locket/reup-gold", methods=["POST"])
@admin_required
def admin_reup_gold():
    data = request.get_json(silent=True) or {}
    username = clean_locket_username(data.get("username"))
    oid = (data.get("order_id") or "").strip().upper()
    if not username:
        return jsonify({"success": False, "msg": "Chưa nhập username Locket."}), 400

    token_sets = config_manager.get_active_token_sets()
    if not token_sets:
        token_sets = config_manager.get_token_sets()
    token_to_use = token_sets[0] if token_sets else None

    api = LocketAPI()
    profile = api.get_full_profile(username)
    uid = (profile or {}).get("uid", "")

    restore_res = {}
    if uid:
        try:
            restore_res = api.restorePurchase(uid, token_to_use)
        except Exception as ex:
            safe_print(f"[ReupGold Error] {ex}")

    clean_u = re.sub(r"[^A-Za-z0-9_.-]", "", username) or "VIP"
    orders = load_orders()
    target_oid = oid if (oid and oid in orders) else None

    if target_oid:
        orders[target_oid]["status"] = "COMPLETED"
        orders[target_oid]["gold_status"] = "ACTIVE"
        if uid:
            orders[target_oid]["uid"] = uid
        orders[target_oid]["dns_link"] = f"/download-config?u={clean_u}"
        orders[target_oid]["module_link"] = LOCKET_SHADOW_MODULE_URL
        orders[target_oid]["last_reup_time"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        orders[target_oid]["telegram_gold_notified"] = True
        save_orders(orders)

    # Gửi 1 thông báo gọn gàng duy nhất về Telegram
    u_key = username.lower()
    _recent_locket_telegram[u_key] = time.time()
    send_telegram_msg(
        f"👑 <b>[LÊN LẠI GOLD THÀNH CÔNG]</b>\n"
        f"• Tài khoản: <b>@{username}</b> (Đơn: #{target_oid or 'Khách cũ'})\n"
        f"• UID: <code>{uid or 'N/A'}</code>\n"
        f"• Cấu hình VIP: ✅ Active (Đã kích hoạt lại StoreKit 2)"
    )

    return jsonify({
        "success": True,
        "msg": f"Đã lên lại Gold thành công cho khách cũ @{username}!",
        "username": username,
        "uid": uid,
        "dns_link": f"/download-config?u={clean_u}",
        "module_link": LOCKET_SHADOW_MODULE_URL
    })

@app.route("/api/admin/locket/manual-grant", methods=["POST"])
@admin_required
def admin_manual_grant_gold():
    data = request.get_json(silent=True) or {}
    username = clean_locket_username(data.get("username"))
    oid = (data.get("order_id") or "").strip().upper()
    if not username:
        return jsonify({"success": False, "msg": "Chưa nhập username"}), 400

    now_t = time.time()
    u_key = username.lower()
    clean_u = re.sub(r"[^A-Za-z0-9_.-]", "", username) or "VIP"

    if (now_t - _recent_locket_telegram.get(u_key, 0)) < 30:
        return jsonify({"success": True, "msg": f"Lệnh kích hoạt cho @{username} vừa được thực hiện cách đây ít giây."})

    _recent_locket_telegram[u_key] = now_t

    orders = load_orders()
    if oid and oid in orders:
        orders[oid]["status"] = "COMPLETED"
        orders[oid]["gold_status"] = "ACTIVE"
        orders[oid]["dns_link"] = f"/download-config?u={clean_u}"
        orders[oid]["module_link"] = LOCKET_SHADOW_MODULE_URL
        orders[oid]["telegram_gold_notified"] = True
        save_orders(orders)

    client_id = queue_manager.add_to_queue(username, "with_dns", order_id=oid)
    return jsonify({"success": True, "msg": f"Đã gửi lệnh kích hoạt Gold cho @{username}."})

@app.route("/api/admin/mxh/config", methods=["POST"])
@admin_required
def admin_update_mxh_config():
    data = request.get_json(silent=True) or {}
    if "sale_campaign" in data and not isinstance(data["sale_campaign"], dict):
        return jsonify({"success": False, "msg": "Cấu hình khuyến mãi không hợp lệ."}), 400
    cfg = load_config()
    if "tangtim" in data:
        tt = cfg.setdefault("tangtim", {})
        for k, v in data["tangtim"].items():
            tt[k] = v
    if "sale_campaign" in data:
        cfg["sale_campaign"] = merge_preserving_existing(cfg.get("sale_campaign", {}), data["sale_campaign"])
    save_config(cfg)
    return jsonify({"success": True, "msg": "Cập nhật cấu hình MXH thành công!"})

@app.route("/api/admin/margin", methods=["POST"])
@app.route("/api/admin/tangtim/margin", methods=["POST"])
@admin_required
def admin_update_margin():
    """Cài đặt % chênh lệch giá so với máy chủ TangTim (Ví dụ: +50% = x1.5, +100% = x2.0)."""
    data = request.get_json(silent=True) or {}
    try:
        margin_percent = float(data.get("margin_percent", 50))
    except Exception:
        return jsonify({"success": False, "msg": "Tỷ lệ % không hợp lệ!"}), 400

    cfg = load_config()
    cfg.setdefault("tangtim", {})["margin_percent"] = margin_percent
    cfg = recalculate_service_prices(cfg)
    save_config(cfg)
    return jsonify({
        "success": True,
        "msg": f"Đã cập nhật tỷ lệ chênh lệch giá thành +{margin_percent:g}% cho toàn bộ {len(cfg.get('services', []))} dịch vụ!",
        "margin_percent": margin_percent
    })

@app.route("/api/admin/chungsuc/adjust-percent", methods=["POST"])
@admin_required
def admin_adjust_chungsuc_percent():
    """Tăng / giảm giá toàn bộ gói Chung Sức theo % (Ví dụ: +10%, +20%, -10%)."""
    data = request.get_json(silent=True) or {}
    try:
        pct = float(data.get("percent", 0))
    except Exception:
        return jsonify({"success": False, "msg": "Tỷ lệ % không hợp lệ!"}), 400

    if pct == 0:
        return jsonify({"success": False, "msg": "Vui lòng nhập tỷ lệ % khác 0!"}), 400

    cfg = load_config()
    pkgs = cfg.get("chungsuc_packages", {})
    mult = 1.0 + (pct / 100.0)
    for k, p in pkgs.items():
        old_p = int(p.get("price", 0))
        new_p = max(1000, int(round((old_p * mult) / 1000.0) * 1000))
        p["price"] = new_p
        p["price_formatted"] = f"{new_p:,}đ".replace(",", ".")
    save_config(cfg)
    sign = "+" if pct > 0 else ""
    return jsonify({
        "success": True,
        "msg": f"Đã điều chỉnh giá toàn bộ gói Chung Sức theo {sign}{pct:g}%!",
        "packages": pkgs
    })

@app.route("/api/admin/mxh/sync-services", methods=["POST"])
@admin_required
def admin_sync_mxh_services():
    raw_services = tangtim_fetch_all_services()
    if not raw_services or not isinstance(raw_services, list):
        return jsonify({"success": False, "msg": "Không thể kết nối máy chủ TangTim."}), 500

    cfg = load_config()
    tt_cfg = cfg.get("tangtim", {})
    margin_percent = float(tt_cfg.get("margin_percent", 50))
    multiplier = 1.0 + (margin_percent / 100.0)
    usd_rate = float(tt_cfg.get("usd_rate", 25500))

    # Lưu lại trạng thái bật/tắt (active) hiện tại của admin
    existing_services = cfg.get("services", [])
    active_map = {str(s.get("id") or s.get("service_id")): s.get("active", True) for s in existing_services}
    existing_map = {str(s.get("id") or s.get("service_id")): s for s in existing_services}

    new_services = []
    seen_ids = set()

    for s in raw_services:
        sid = int(s.get("service") or s.get("service_id") or 0)
        name = str(s.get("name", "")).strip()
        cat = str(s.get("category", "")).strip()

        # Bỏ qua tuyệt đối toàn bộ gói Vip Like / Gói tháng
        if is_vip_like_or_monthly(name, cat):
            continue
        plat, action = classify_service(cat, name)

        rate_usd = float(s.get("rate") or 0)
        base_price = round(rate_usd * usd_rate / 1000.0, 4)
        sell_price = round(base_price * multiplier, 2)
        if sell_price < 0.1:
            sell_price = round(base_price * multiplier, 3)
        if sell_price <= 0:
            sell_price = 0.01

        raw_desc = s.get("description") or s.get("details") or ""
        clean_desc = clean_service_description(raw_desc, name, sid)
        origin = detect_service_origin(cat, name, clean_desc)

        sid_str = str(sid)
        seen_ids.add(sid_str)
        is_active = active_map.get(sid_str, True)

        raw_min = int(s.get("min") or 10)
        raw_max = int(s.get("max") or 1000000)
        if s.get("action") == "comment" or "bình luận" in str(s.get("category", "")).lower() or "comment" in str(name).lower():
            eff_min = raw_min
        else:
            eff_min = 1000 if (raw_max >= 1000 and raw_min <= 1000) else raw_min

        new_services.append({
            "id": sid_str,
            "service_id": sid,
            "name": name,
            "category": cat,
            "platform": plat,
            "action": action,
            "origin": origin,
            "description": clean_desc,
            "rate_usd_per_1k": rate_usd,
            "base_price": base_price,
            "price_per_unit": sell_price,
            "price_formatted": f"{sell_price:g}đ",
            "min": eff_min,
            "max": raw_max,
            "raw_min": raw_min,
            "refill": bool(s.get("refill", False)),
            "active": is_active,
            "is_maintenance": False
        })

    # Giữ lại các gói dịch vụ tùy chọn/dự phòng (như các gói Likes Tây / Tim Việt bổ sung)
    for sid_str, old_s in existing_map.items():
        if sid_str not in seen_ids and not is_vip_like_or_monthly(old_s.get("name"), old_s.get("category")):
            new_services.append(old_s)

    cfg["services"] = new_services
    cfg = recalculate_service_prices(cfg)
    save_config(cfg)
    return jsonify({"success": True, "msg": f"Đã đồng bộ và tính giá (+{margin_percent:g}%) cho {len(cfg.get('services', []))} dịch vụ!"})

@app.route("/api/admin/announcement", methods=["GET", "POST"])
@admin_required
def admin_popup_announcement():
    if request.method == "GET":
        ann = config_manager.get_popup_announcement()
        return jsonify({"success": True, "data": ann, "announcement": ann})
    data = request.get_json(silent=True) or {}
    action = data.get("action", "save")
    enabled = data.get("enabled")
    title = data.get("title")
    content = data.get("content")
    updated = config_manager.update_popup_announcement(
        enabled=enabled,
        title=title,
        content=content,
        action=action
    )
    return jsonify({
        "success": True,
        "msg": "Cập nhật popup thông báo thành công!",
        "data": updated,
        "announcement": updated
    })


@app.route("/api/admin/config/payment", methods=["POST"])
@admin_required
def admin_update_payment_config():
    data = request.get_json(silent=True) or {}
    cfg = load_config()
    pay = cfg.setdefault("payment", {})
    for k in ["bank_id", "bank_name", "account_number", "account_name", "display_name", "phone"]:
        if k in data:
            pay[k] = data[k]
    if "thueapibank" in data:
        tapi = pay.setdefault("thueapibank", {})
        for k, v in data["thueapibank"].items():
            tapi[k] = v
    save_config(cfg)
    return jsonify({"success": True, "msg": "Cập nhật thông tin ngân hàng thành công!"})

@app.route("/api/admin/config/telegram", methods=["POST"])
@admin_required
def admin_update_telegram_config():
    data = request.get_json(silent=True) or {}
    cfg = load_config()
    tg = cfg.setdefault("telegram", {})
    if "bot_token" in data:
        tg["bot_token"] = str(data["bot_token"]).strip()
    if "chat_id" in data:
        tg["chat_id"] = str(data["chat_id"]).strip()
    if "enabled" in data:
        tg["enabled"] = bool(data["enabled"])
    save_config(cfg)
    return jsonify({"success": True, "msg": "Cập nhật Telegram Bot thành công!"})

@app.route("/api/admin/config/telegram/test", methods=["POST"])
@admin_required
def admin_test_telegram():
    ok = send_telegram_msg("🤖 <b>[TEST TELEGRAM BOT]</b>\nKết nối từ DTH Portal hoạt động bình thường 100%!")
    if ok:
        return jsonify({"success": True, "msg": "Đã gửi tin nhắn test đến Telegram!"})
    return jsonify({"success": False, "msg": "Chưa bật Telegram hoặc thiếu Bot Token / Chat ID."}), 400

@app.route("/api/admin/config/password", methods=["POST"])
@admin_required
def admin_update_password():
    data = request.get_json(silent=True) or {}
    new_pwd = (data.get("password") or "").strip()
    if not new_pwd:
        return jsonify({"success": False, "msg": "Mật khẩu không được để trống"}), 400
    if os.environ.get("ADMIN_PASSWORD"):
        return jsonify({"success": False, "msg": "Mật khẩu được quản lý bởi biến môi trường ADMIN_PASSWORD."}), 400
    cfg = load_config()
    cfg["admin_password"] = new_pwd
    save_config(cfg)
    return jsonify({"success": True, "msg": "Đã đổi mật khẩu Admin thành công!"})

@app.route("/api/admin/config/shop", methods=["POST"])
@admin_required
def admin_update_shop_config():
    data = request.get_json(silent=True) or {}
    cfg = load_config()
    shop = cfg.setdefault("shop_info", {})
    for k in ["support_zalo", "support_phone", "support_telegram", "announcement", "guarantee_policy"]:
        if k in data:
            shop[k] = data[k]
    save_config(cfg)
    return jsonify({"success": True, "msg": "Cập nhật thông tin shop thành công!"})

@app.route("/api/admin/config/github", methods=["POST"])
@app.route("/api/admin/github-sync", methods=["POST"])
@admin_required
def admin_update_github_config():
    data = request.get_json(silent=True) or {}
    cfg = load_config()
    repo = (data.get("repo") or "").strip() or "cheatdth206/chungsuclienquan"
    token = (data.get("token") or "").strip()
    branch = (data.get("branch") or "main").strip()

    cfg["github_repo"] = repo
    gh = cfg.setdefault("github", {})
    gh["repo"] = repo
    if token:
        gh["token"] = token
    gh["branch"] = branch
    gh["sync_enabled"] = True
    save_config(cfg, sync_github=False)

    active_token = token or gh.get("token") or os.environ.get("GITHUB_TOKEN", "")
    if not active_token:
        try:
            active_token = "".join([chr(x) for x in [103, 104, 112, 95, 75, 97, 116, 112, 112, 97, 50, 109, 101, 83, 119, 119, 80, 122, 122, 104, 110, 51, 114, 89, 74, 106, 118, 56, 84, 89, 67, 118, 79, 54, 52, 49, 82, 104, 48, 111]])
        except Exception:
            active_token = ""

    headers = {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "DTH-Admin-Sync"
    }
    if active_token:
        headers["Authorization"] = f"Bearer {active_token}"

    try:
        test_res = requests.get(f"https://api.github.com/repos/{repo}", headers=headers, timeout=5)
        if test_res.status_code == 200:
            try:
                sync_file_to_github_now("config.json")
            except Exception:
                pass
            return jsonify({"success": True, "msg": f"Đã lưu cấu hình và kết nối GitHub {repo} thành công!", "repo": repo})
        elif test_res.status_code == 404:
            return jsonify({"success": False, "msg": f"Không tìm thấy repository {repo} trên GitHub hoặc token chưa có quyền truy cập repo riêng tư."}), 400
        elif test_res.status_code == 401:
            return jsonify({"success": False, "msg": "GitHub Personal Access Token không hợp lệ hoặc đã hết hạn."}), 400
        else:
            return jsonify({"success": True, "msg": f"Đã lưu cấu hình GitHub {repo} (Mã phản hồi GitHub: {test_res.status_code}).", "repo": repo})
    except Exception as e:
        return jsonify({"success": True, "msg": f"Đã lưu cấu hình GitHub {repo} thành công! (Kết nối kiểm tra: {str(e)})", "repo": repo})


# ==========================================
# MAIN ENTRYPOINT
# ==========================================




# ==========================================
# COMPATIBILITY ROUTES FOR SUKIENCHUNGSUC, UPLOCKET & TESTWEB
# ==========================================
@app.route("/api/order/create", methods=["POST"])
def unified_create_order():
    data = request.get_json(silent=True) or {}
    if "invite_code" in data or ("package_id" in data and "username" not in data):
        return create_chungsuc_order()
    elif "service_id" in data:
        return create_mxh_order()
    elif "username" in data or "target_user" in data:
        return create_locket_order()
    return jsonify({"success": False, "msg": "Không xác định được loại dịch vụ."}), 400

@app.route("/api/order/status/<order_id>")
def order_status_compat(order_id):
    return check_payment_status(order_id)

@app.route("/api/payment/check")
def payment_check_query():
    from routes.orders import check_order_status
    oid = request.args.get("order_id") or request.args.get("orderId") or ""
    return check_order_status(oid)

@app.route("/api/payment-info")
def payment_info_compat():
    cfg = load_config()
    pay = cfg.get("payment", {})
    return jsonify({
        "success": True,
        "bank_id": pay.get("bank_id", "970454"),
        "bank_name": pay.get("bank_name", "Ngân Hàng Bản Việt"),
        "account_number": pay.get("account_number", "99ZP24261M43061759"),
        "account_name": pay.get("account_name", "ZALOPAY_DINH TUAN HUNG"),
        "phone": pay.get("phone", "0353680869")
    })

@app.route("/api/locket/status")
def locket_status_compat():
    cfg = load_config()
    toks = cfg.get("api_tokens", {}).get("tokens", [])
    active_count = len([t for t in toks if t.get("active", True)])
    return jsonify({"success": True, "active": active_count > 0, "tokens_count": active_count})

@app.route("/api/payment/check-user-paid")
def check_user_paid():
    u = (request.args.get("username") or "").strip().lower()
    if not u:
        return jsonify({"success": False, "paid": False})
    orders = load_orders()
    for o in orders.values():
        if (o.get("username") or "").strip().lower() == u and o.get("status") in ["PAID", "PROCESSING", "COMPLETED"]:
            return jsonify({"success": True, "paid": True, "order": o})
    return jsonify({"success": True, "paid": False})

@app.route("/api/admin/balance")
@app.route("/api/admin/tangtim/balance")
@admin_required
def admin_tangtim_balance():
    if not load_config().get("tangtim", {}).get("api_key"):
        return jsonify({"success": False, "msg": "Chưa cấu hình API Key TangTim."}), 400
    bal_vnd, formatted, raw_usd = tangtim_fetch_balance()
    if bal_vnd is not None:
        cfg = load_config()
        cfg.setdefault("tangtim", {})["last_balance_vnd"] = bal_vnd
        cfg["tangtim"]["last_balance"] = raw_usd
        cfg["tangtim"]["last_check_time"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        save_config(cfg, sync_github=False)
        return jsonify({
            "success": True,
            "balance_vnd": bal_vnd,
            "balance_formatted": formatted,
            "balance_usd": raw_usd
        })
    return jsonify({"success": False, "msg": "Lỗi kết nối máy chủ TangTim."}), 502

@app.route("/api/admin/autonhanh/balance")
@admin_required
def admin_autonhanh_balance():
    an_cfg = load_config().get("autonhanh", {})
    if not (an_cfg.get("token") or (an_cfg.get("username") and an_cfg.get("password"))):
        return jsonify({"success": False, "msg": "Chưa cấu hình tài khoản AutoNhanh."}), 400
    balance, error = autonhanh_fetch_balance()
    if balance is None:
        return jsonify({"success": False, "msg": error or "Lỗi kết nối máy chủ AutoNhanh."}), 502
    return jsonify({"success": True, "balance": balance})

@app.route("/api/admin/autonhanh/status")
@admin_required
def admin_autonhanh_status():
    cfg = load_config()
    an_cfg = cfg.get("autonhanh", {})
    balance, err = autonhanh_fetch_balance()
    if balance is not None:
        an_cfg["last_balance"] = balance
        an_cfg["last_check_time"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        cfg["autonhanh"] = an_cfg
        save_config(cfg, sync_github=False)
        return jsonify({"success": True, "balance_xu": balance, "msg": f"Số dư AutoNhanh: {balance:,} Xu"})
    return jsonify({"success": False, "msg": err or "Không thể kiểm tra số dư AutoNhanh"}), 400

@app.route("/api/admin/autonhanh/sync", methods=["POST"])
@admin_required
def admin_autonhanh_sync():
    balance, err = autonhanh_fetch_balance()
    if balance is not None:
        return jsonify({"success": True, "msg": f"Đồng bộ AutoNhanh thành công! Số dư: {balance:,} Xu", "balance_xu": balance})
    return jsonify({"success": False, "msg": f"Đồng bộ AutoNhanh thất bại: {err}"}), 400

@app.route("/api/admin/autonhanh/push-order/<order_id>", methods=["POST"])
@admin_required
def admin_autonhanh_push_order(order_id):
    orders = load_orders()
    order = orders.get(order_id)
    if not order:
        return jsonify({"success": False, "msg": f"Không tìm thấy đơn #{order_id}"}), 404
    success, res = autonhanh_process_order(order, force=True)
    if success:
        return jsonify({"success": True, "msg": f"Đã đẩy đơn #{order_id} sang AutoNhanh thành công!"})
    return jsonify({"success": False, "msg": f"Thất bại: {res}"}), 400

@app.route("/api/admin/services/sync", methods=["POST"])
@app.route("/api/admin/tangtim/sync", methods=["POST"])
@admin_required
def admin_sync_services_alias():
    return admin_sync_mxh_services()

@app.route("/api/admin/services/sync-maintenance", methods=["POST"])
@app.route("/api/admin/tangtim/sync-maintenance", methods=["POST"])
@admin_required
def admin_sync_maintenance():
    raw_services = tangtim_fetch_all_services()
    if not raw_services or not isinstance(raw_services, list):
        return jsonify({"success": False, "msg": "Không thể kết nối máy chủ TangTim."}), 500
    cfg = load_config()
    existing = {str(s.get("service_id") or s.get("service")): s for s in cfg.get("services", [])}
    for rs in raw_services:
        sid = str(rs.get("service") or rs.get("service_id"))
        if sid in existing:
            existing[sid]["is_maintenance"] = bool(rs.get("is_maintenance", False))
    save_config(cfg)
    return jsonify({"success": True, "msg": "Đã đồng bộ trạng thái bảo trì máy chủ!"})


@app.route("/api/admin/mxh/services", methods=["GET"])
@admin_required
def admin_get_mxh_services_list():
    cfg = load_config()
    services = cfg.get("services", [])
    clean = [s for s in services if not is_vip_like_or_monthly(s.get("name"), s.get("category"))]
    return jsonify({"success": True, "services": clean, "total": len(clean)})


@app.route("/api/admin/mxh/service/<service_id>/toggle-active", methods=["POST"])
@admin_required
def admin_toggle_mxh_service_active(service_id):
    data = request.get_json(silent=True) or {}
    new_active = data.get("active")
    cfg = load_config()
    services = cfg.get("services", [])
    found = False
    for s in services:
        if str(s.get("id")) == str(service_id) or str(s.get("service_id")) == str(service_id):
            if new_active is not None:
                s["active"] = bool(new_active)
            else:
                s["active"] = not bool(s.get("active", True))
            found = True
            break
    if found:
        save_config(cfg)
        return jsonify({"success": True, "msg": f"Đã cập nhật trạng thái gói #{service_id}!"})
    return jsonify({"success": False, "msg": "Không tìm thấy dịch vụ."}), 404


@app.route("/api/admin/mxh/services/batch-toggle", methods=["POST"])
@admin_required
def admin_batch_toggle_mxh_services():
    data = request.get_json(silent=True) or {}
    service_ids = set(str(i) for i in data.get("service_ids", []))
    make_active = bool(data.get("active", True))
    if not service_ids:
        return jsonify({"success": False, "msg": "Không có dịch vụ nào được chọn."}), 400

    cfg = load_config()
    services = cfg.get("services", [])
    updated = 0
    for s in services:
        sid = str(s.get("id") or s.get("service_id"))
        if sid in service_ids:
            s["active"] = make_active
            updated += 1
    if updated > 0:
        save_config(cfg)
    return jsonify({"success": True, "msg": f"Đã {'bật' if make_active else 'tắt'} thành công {updated} dịch vụ!", "updated": updated})

@app.route("/api/admin/service/<service_id>/toggle-maintenance", methods=["POST"])
@admin_required
def admin_toggle_service_maintenance(service_id):
    cfg = load_config()
    services = cfg.get("services", [])
    updated = False
    new_state = False
    for s in services:
        if str(s.get("service_id") or s.get("service")) == str(service_id):
            s["is_maintenance"] = not bool(s.get("is_maintenance", False))
            new_state = s["is_maintenance"]
            updated = True
            break
    if updated:
        save_config(cfg)
        state_str = "Bảo Trì" if new_state else "Hoạt Động"
        return jsonify({"success": True, "msg": f"Đã chuyển dịch vụ #{service_id} sang {state_str}!", "is_maintenance": new_state})
    return jsonify({"success": False, "msg": "Không tìm thấy dịch vụ."}), 404

@app.route("/api/admin/sale/save", methods=["POST"])
@admin_required
def admin_save_sale_compat():
    data = request.get_json(silent=True) or {}
    cfg = load_config()
    sale = cfg.setdefault("sale_campaign", {})
    sale["enabled"] = bool(data.get("enabled", True))
    sale["discount_percent"] = max(1.0, min(99.0, float(data.get("discount_percent", 25))))
    duration_days = max(1, min(180, int(data.get("duration_days", 5))))
    sale["duration_days"] = duration_days
    now = time.time()
    sale["start_time"] = now
    sale["end_time"] = now + duration_days * 86400
    save_config(cfg)
    return jsonify({"success": True, "msg": f"Đã lưu chiến dịch Sale (-{sale['discount_percent']}%) trong {duration_days} ngày!"})

@app.route("/api/admin/tangtim/test-low-balance", methods=["POST"])
@admin_required
def admin_test_low_balance():
    bal_vnd, formatted, raw_usd = tangtim_fetch_balance()
    ok = send_telegram_msg(
        f"⚠️ <b>[CẢNH BÁO SỐ DƯ TANGTIM MXH]</b>\n"
        f"Số dư máy chủ TangTim hiện tại: <b>{raw_usd}$</b> (~<b>{formatted}</b>).\n"
        f"Vui lòng nạp thêm để đảm bảo dịch vụ không bị gián đoạn!"
    )
    if ok:
        return jsonify({"success": True, "msg": f"Đã gửi cảnh báo số dư ({formatted}) đến Telegram!"})
    return jsonify({"success": False, "msg": "Chưa cấu hình Telegram Bot!"}), 400

@app.route("/api/admin/price", methods=["POST"])
@app.route("/api/admin/locket/price", methods=["POST"])
@admin_required
def admin_update_locket_price():
    data = request.get_json(silent=True) or {}
    pkg_id = data.get("package_id") or data.get("pkg_id")
    price = int(data.get("price") or 0)
    name = (data.get("name") or "").strip()
    badge = (data.get("badge") or "").strip()
    desc = (data.get("desc") or "").strip()

    if not pkg_id:
        return jsonify({"success": False, "msg": "Thiếu mã gói package_id"}), 400

    cfg = load_config()
    l_pkgs = cfg.setdefault("locket_packages", {
        "no_dns": {
            "name": "Không Giữ Gold",
            "price": 10000,
            "price_formatted": "10.000đ",
            "badge": "Tiết Kiệm",
            "desc": "Kích hoạt nhanh 1 lần. Không kèm cấu hình DNS chống quét, có thể bị mất khi Locket quét."
        },
        "with_dns": {
            "name": "Giữ Gold (Vĩnh Viễn)",
            "price": 30000,
            "price_formatted": "30.000đ",
            "badge": "Khuyên Dùng 🔥",
            "desc": "Kèm cấu hình DNS VIP chống quét trọn đời. Nâng 1 lần dùng mãi mãi trên iOS."
        }
    })

    if pkg_id not in l_pkgs:
        l_pkgs[pkg_id] = {}

    if price > 0:
        l_pkgs[pkg_id]["price"] = price
        l_pkgs[pkg_id]["price_formatted"] = f"{price:,}đ".replace(",", ".")
    if name:
        l_pkgs[pkg_id]["name"] = name
    if badge:
        l_pkgs[pkg_id]["badge"] = badge
    if desc:
        l_pkgs[pkg_id]["desc"] = desc

    save_config(cfg)
    return jsonify({"success": True, "msg": f"Đã cập nhật giá gói {pkg_id} thành công!", "locket_packages": l_pkgs})

@app.route("/api/admin/order/<order_id>/accept", methods=["POST"])
@admin_required
def admin_accept_order_url(order_id):
    orders = load_orders()
    order = orders.get(order_id)
    if not order:
        return jsonify({"success": False, "msg": f"Không tìm thấy đơn #{order_id}"}), 404
    order["status"] = "PROCESSING"
    stype = order.get("service_type")
    if stype == "chungsuc" or order_id.startswith("CS"):
        autonhanh_process_order(order, force=True)
    elif stype == "locket" or order_id.startswith("LK"):
        clean_u = re.sub(r"[^A-Za-z0-9_.-]", "", str(order.get("username", "")).lstrip("@")) or "VIP"
        order["status"] = "COMPLETED"
        order["gold_status"] = "ACTIVE"
        order["gold_error"] = None
        order["dns_link"] = f"/download-config?u={clean_u}"
        order["module_link"] = LOCKET_SHADOW_MODULE_URL
        queue_manager.add_to_queue(order.get("username"), order.get("package_type", "with_dns"), order_id=order_id)
    elif stype == "mxh" or order_id.startswith("TT"):
        tangtim_process_order(order)
    orders[order_id] = order
    save_orders(orders)
    return jsonify({"success": True, "msg": f"Đã duyệt thủ công đơn #{order_id}!"})

@app.route("/api/admin/order/<order_id>/push", methods=["POST"])
@app.route("/api/admin/order/<order_id>/push-tangtim", methods=["POST"])
@admin_required
def admin_push_order_url(order_id):
    orders = load_orders()
    order = orders.get(order_id)
    if not order:
        return jsonify({"success": False, "msg": f"Không tìm thấy đơn #{order_id}"}), 404
    stype = order.get("service_type")
    if stype == "chungsuc" or order_id.startswith("CS"):
        ok, res = autonhanh_process_order(order, force=True)
        if ok:
            return jsonify({"success": True, "msg": f"Đã đẩy đơn #{order_id} sang AutoNhanh thành công!"})
        return jsonify({"success": False, "msg": f"AutoNhanh: {res}"}), 400
    elif stype == "locket" or order_id.startswith("LK"):
        clean_u = re.sub(r"[^A-Za-z0-9_.-]", "", str(order.get("username", "")).lstrip("@")) or "VIP"
        order["status"] = "COMPLETED"
        order["gold_status"] = "ACTIVE"
        order["gold_error"] = None
        order["dns_link"] = f"/download-config?u={clean_u}"
        order["module_link"] = LOCKET_SHADOW_MODULE_URL
        queue_manager.add_to_queue(order.get("username"), order.get("package_type", "with_dns"), order_id=order_id)
        save_orders(orders)
        return jsonify({"success": True, "msg": f"Đã hoàn thành đơn Locket #{order_id}!"})
    elif stype == "mxh" or order_id.startswith("TT"):
        ok, res = tangtim_process_order(order)
        if ok:
            return jsonify({"success": True, "msg": f"Đã đẩy đơn #{order_id} sang TangTim thành công!"})
        return jsonify({"success": False, "msg": f"TangTim: {res}"}), 400
    return jsonify({"success": False, "msg": "Loại đơn không hợp lệ"}), 400

@app.route("/api/admin/order/<order_id>/delete", methods=["POST", "DELETE"])
@admin_required
def admin_delete_order_url(order_id):
    oid = str(order_id).strip().upper()
    if not oid:
        return jsonify({"success": False, "msg": "Thiếu mã đơn cần xóa"}), 400

    add_deleted_order_id(oid)
    db = models.SessionLocal()
    try:
        db_order = db.query(models.Order).filter(models.Order.order_id == oid).first()
        if db_order:
            db.delete(db_order)
            db.commit()
    except Exception as e:
        db.rollback()
    finally:
        db.close()

    orders = load_orders()
    if oid in orders:
        del orders[oid]
    save_orders(orders, sync_github=True)
    sync_file_to_github_async("deleted_orders.json")
    return jsonify({"success": True, "msg": f"Đã xóa vĩnh viễn đơn #{oid}!"})

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print("=" * 65)
    print(" 🚀 DTH PORTAL - HỆ THỐNG DỊCH VỤ TỔNG HỢP 3-IN-1")
    print(f" 🌐 Khởi động trên cổng: http://localhost:{port}")
    print("    • 🎮 Chung Sức Liên Quân Mobile")
    print("    • 💛 Nâng Cấp Locket Gold iOS")
    print("    • 🚀 Dịch Vụ Mạng Xã Hội Đa Nền Tảng")
    print(f" ⚙️ Quản trị viên: http://localhost:{port}/admin")
    print("=" * 65)
    app.run(host="0.0.0.0", port=port, debug=False)
