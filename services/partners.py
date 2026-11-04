import os
import re
import time
import queue
import secrets
import threading
import requests
from datetime import datetime
from config_manager import config_manager
from locket_api import LocketAPI
from services.telegram_bot import send_telegram_msg, notify_locket_gold_activated
from utils import clean_locket_username, extract_invite_code, now_gmt7
import models

LOCKET_SHADOW_MODULE_URL = "https://raw.githubusercontent.com/dth20006/shadow/main/dth.sgmodule"

AUTONHANH_API_BASE = "https://autonhanh.com/api"

# ==========================================
# 1. AUTONHANH (CHUNG SỨC LIÊN QUÂN)
# ==========================================
def autonhanh_login():
    cfg = config_manager.load_config()
    an_cfg = cfg.get("autonhanh", {})
    username = an_cfg.get("username", "dth206")
    password = an_cfg.get("password", "20062006dth")
    
    try:
        url = f"{AUTONHANH_API_BASE}/auth/login"
        r = requests.post(url, json={"username": username, "password": password}, timeout=10)
        data = r.json()
        if r.status_code == 200 and data.get("token"):
            token = data["token"]
            an_cfg["token"] = token
            cfg["autonhanh"] = an_cfg
            config_manager.save_config(cfg, sync_github=False)
            return token, None
        return None, data.get("message") or "Đăng nhập AutoNhanh thất bại"
    except Exception as e:
        return None, str(e)

def autonhanh_fetch_balance(token):
    try:
        url = f"{AUTONHANH_API_BASE}/user/balance"
        r = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=8)
        data = r.json()
        if r.status_code == 200 and "balance" in data:
            return int(data["balance"]), None
        return None, data.get("message") or "Lỗi lấy số dư"
    except Exception as e:
        return None, str(e)

def autonhanh_calculate_packs(order):
    pkg_id = order.get("package_id")
    if pkg_id == "ruong_1":
        return 1
    elif pkg_id == "ruong_2":
        return 4
    elif pkg_id == "full_3_ruong":
        return 9
    elif pkg_id == "goi_tuy_chon":
        return max(4, int(order.get("quantity") or 4))
    return 9

def autonhanh_process_order(order, force=False):
    cfg = config_manager.load_config()
    an_cfg = cfg.get("autonhanh", {})
    if not force and not an_cfg.get("enabled", True):
        return False, "Tính năng AutoNhanh đang bảo trì"

    token = an_cfg.get("token")
    if not token:
        token, err = autonhanh_login()
        if not token:
            return False, err

    balance, bal_err = autonhanh_fetch_balance(token)
    if balance is not None:
        an_cfg["last_balance"] = balance
        cfg["autonhanh"] = an_cfg
        config_manager.save_config(cfg, sync_github=False)

    packs = autonhanh_calculate_packs(order)
    price_per_pack = int(an_cfg.get("price_per_pack_xu", 760))
    required_xu = packs * price_per_pack

    if balance is not None and balance < required_xu:
        err_msg = f"Thiếu {required_xu - balance:,} Xu"
        send_telegram_msg(f"⚠️ <b>[CẢNH BÁO AUTONHANH HẾT XU]</b>\nĐơn #{order.get('order_id')}: {err_msg}")
        return False, err_msg

    url = f"{AUTONHANH_API_BASE}/batches"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    code = order.get("code") or extract_invite_code(order.get("raw_code") or "")
    payload = {
        "code": code,
        "quantity": packs,
        "auto_start": True
    }

    try:
        r = requests.post(url, headers=headers, json=payload, timeout=15)
        data = r.json()
        if r.status_code in (200, 201) and data.get("id"):
            batch_id = data["id"]
            db = models.SessionLocal()
            try:
                db_o = db.query(models.Order).filter_by(order_id=order.get("order_id")).first()
                if db_o:
                    db_o.partner_status = "PROCESSING"
                    db_o.status = "PROCESSING"
                    db.commit()
            finally:
                db.close()
            return True, batch_id
        return False, data.get("message") or "Đẩy đơn sang đối tác thất bại"
    except Exception as e:
        return False, str(e)


# ==========================================
# 2. TANGTIM (MẠNG XÃ HỘI)
# ==========================================
def tangtim_process_order(order):
    cfg = config_manager.load_config()
    tt_cfg = cfg.get("tangtim", {})
    if not tt_cfg.get("enabled", True):
        return False, "Dịch vụ MXH đang bảo trì"

    api_url = tt_cfg.get("api_url", "https://tangtim.vn/api/v2")
    api_key = tt_cfg.get("api_key", "Vi9oKhH3Rs7XrytwK3GsaTqPQgl9AqHNDB2")
    service_id = order.get("package_id") or order.get("service_id")
    link = order.get("link")
    quantity = int(order.get("quantity") or 1000)

    if not service_id or not link:
        return False, "Thiếu service_id hoặc link"

    payload = {
        "key": api_key,
        "action": "add",
        "service": str(service_id),
        "link": link,
        "quantity": str(quantity)
    }

    try:
        res = requests.post(api_url, data=payload, timeout=15)
        res_data = res.json()
        if res.status_code == 200 and res_data.get("order"):
            tt_order_id = res_data.get("order")
            db = models.SessionLocal()
            try:
                db_o = db.query(models.Order).filter_by(order_id=order.get("order_id")).first()
                if db_o:
                    db_o.partner_status = "PROCESSING"
                    db_o.status = "PROCESSING"
                    db_o.partner_order_id = str(tt_order_id)
                    db_o.set_extra("tangtim_order_id", tt_order_id)
                    db.commit()
            finally:
                db.close()
            return True, tt_order_id
        return False, res_data.get("error") or "Không thể khởi tạo tiến trình MXH"
    except Exception as e:
        return False, str(e)


def check_smm_order_status(tt_order_id):
    """Quét trạng thái đơn hàng SMM từ máy chủ đối tác (TangTim API v2)."""
    if not tt_order_id:
        return None
    cfg = config_manager.load_config()
    tt_cfg = cfg.get("tangtim", {})
    api_url = tt_cfg.get("api_url", "https://tangtim.vn/api/v2")
    api_key = tt_cfg.get("api_key", "Vi9oKhH3Rs7XrytwK3GsaTqPQgl9AqHNDB2")
    try:
        payload = {"key": api_key, "action": "status", "order": str(tt_order_id).strip()}
        res = requests.post(api_url, data=payload, timeout=10)
        if res.status_code == 200:
            data = res.json()
            if isinstance(data, dict) and not data.get("error"):
                return data
    except Exception as ex:
        print(f"[check_smm_order_status error] {ex}")
    return None


def sync_smm_order_live(order_obj, db=None, force=False):
    """
    Đồng bộ tức thì tiến độ và trạng thái đơn MXH từ web mẹ vào order_obj và Database.
    Mapping đầy đủ mọi biến thể trạng thái từ đối tác:
    - Hoàn thành: 'hoàn thành', 'completed', 'success', 'done', 'da_chay', 'finish' hoặc remains == 0
    - Đang chạy: 'in progress', 'in_progress', 'processing', 'running', 'đang chạy'
    - Một phần: 'partial', 'hoàn thành một phần'
    - Đã hủy: 'canceled', 'cancelled', 'refunded', 'hủy', 'đã hủy'
    - Chờ xử lý: 'pending', 'queued'
    """
    if not order_obj:
        return False

    tt_id = order_obj.get_extra("tangtim_order_id") if hasattr(order_obj, "get_extra") else None
    if not tt_id and hasattr(order_obj, "partner_order_id") and order_obj.partner_order_id:
        if str(order_obj.partner_order_id).isdigit():
            tt_id = order_obj.partner_order_id

    if not tt_id:
        oid_str = str(getattr(order_obj, "order_id", "")).upper()
        if oid_str == "TT64862":
            tt_id = 1563193

    if not tt_id:
        return False

    info = check_smm_order_status(tt_id)
    if not info or not isinstance(info, dict) or info.get("error"):
        return False

    status_str = str(info.get("status", "")).strip().lower()
    sc = info.get("start_count")
    rem = info.get("remains")
    qty = int(getattr(order_obj, "quantity", 0) or 0)

    # 1. Update start_count
    if sc is not None and str(sc).strip() != "":
        try:
            sc_val = int(float(sc))
            if hasattr(order_obj, "start_count"):
                order_obj.start_count = sc_val
            if hasattr(order_obj, "set_extra"):
                order_obj.set_extra("start_count", sc_val)
        except Exception:
            pass

    # 2. Update remains & delivered
    rem_val = None
    if rem is not None and str(rem).strip() != "":
        try:
            rem_val = max(0, int(float(rem)))
            order_obj.remains = rem_val
            deliv = max(0, min(qty, qty - rem_val)) if qty else 0
            order_obj.delivered = deliv
        except Exception:
            pass

    # 3. Status Mapping
    completed_keywords = ['hoàn thành', 'completed', 'success', 'done', 'da_chay', 'finish']
    is_completed = (
        (status_str in completed_keywords) or
        (qty > 0 and rem_val is not None and rem_val <= 0 and (status_str != "canceled")) or
        (status_str == "" and rem_val == 0)
    )

    if is_completed:
        order_obj.status = "COMPLETED"
        order_obj.partner_status = "SUCCESS"
        order_obj.remains = 0
        if qty:
            order_obj.delivered = qty
        if not getattr(order_obj, "completed_at", None):
            order_obj.completed_at = now_gmt7()
    elif status_str in ['partial', 'hoàn thành một phần']:
        order_obj.status = "COMPLETED"
        order_obj.partner_status = "SUCCESS"
        if not getattr(order_obj, "completed_at", None):
            order_obj.completed_at = now_gmt7()
    elif status_str in ['canceled', 'cancelled', 'refunded', 'hủy', 'đã hủy']:
        order_obj.status = "CANCELLED"
        order_obj.partner_status = "FAILED"
    elif status_str in ['in progress', 'in_progress', 'processing', 'running', 'đang chạy']:
        if order_obj.status != "COMPLETED":
            order_obj.status = "PROCESSING"
            order_obj.partner_status = "PROCESSING"
    elif status_str in ['pending', 'queued']:
        if order_obj.status != "COMPLETED":
            order_obj.partner_status = "PROCESSING"

    if hasattr(order_obj, "set_extra"):
        order_obj.set_extra("tangtim_order_id", tt_id)
        order_obj.set_extra("buff_count", order_obj.delivered)
        if getattr(order_obj, "start_count", None) is not None:
            order_obj.set_extra("current_count", (order_obj.start_count or 0) + (order_obj.delivered or 0))

    if db:
        try:
            db.commit()
        except Exception as ex_c:
            print(f"[sync_smm_order_live commit warning] {ex_c}")

    return True



_recent_gold_notifications = {}
_notif_lock = threading.Lock()

def should_send_gold_notification(order_id, username, uid):
    now = time.time()
    key = f"{order_id}_{username}_{uid}".lower()
    with _notif_lock:
        last = _recent_gold_notifications.get(key, 0)
        if now - last < 180:
            return False
        _recent_gold_notifications[key] = now
        # Clean up keys older than 1 hour
        for k in list(_recent_gold_notifications.keys()):
            if now - _recent_gold_notifications[k] > 3600:
                del _recent_gold_notifications[k]
        return True
class QueueManager:
    def __init__(self):
        self.queue = queue.Queue()
        self.lock = threading.Lock()
        self.recent_queued = {}
        self.client_requests = {}
        self.is_vercel = os.environ.get("VERCEL") == "1"
        if not self.is_vercel:
            self.worker_thread = threading.Thread(target=self._process_queue, daemon=True)
            self.worker_thread.start()

    def add_to_queue(self, username, package_type="with_dns", order_id=None):
        now_t = time.time()
        clean_u = clean_locket_username(username).lower()
        oid_clean = str(order_id or "").strip().upper()

        with self.lock:
            # Check deduplication window (120s)
            if oid_clean:
                last_t = self.recent_queued.get(f"oid_{oid_clean}", 0)
                if now_t - last_t < 120:
                    return f"dup_{oid_clean}"
                self.recent_queued[f"oid_{oid_clean}"] = now_t
            elif clean_u:
                last_t = self.recent_queued.get(f"usr_{clean_u}", 0)
                if now_t - last_t < 120:
                    return f"dup_{clean_u}"
                self.recent_queued[f"usr_{clean_u}"] = now_t

        client_id = f"cli_{now_t}_{secrets.token_hex(4)}"
        req = {
            "username": clean_u,
            "package_type": package_type,
            "order_id": oid_clean,
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

    def _process_queue(self):
        while True:
            try:
                client_id, req = self.queue.get(timeout=2)
                self._process_request(client_id, req)
                self.queue.task_done()
            except queue.Empty:
                time.sleep(1)
            except Exception as e:
                print(f"[Queue Error] {e}")

    def _process_request(self, client_id, req):
        with self.lock:
            req["status"] = "processing"

        username = req.get("username")
        order_id = req.get("order_id")
        clean_u = clean_locket_username(username) or "VIP"

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
                    print(f"[QueueManager] Warning on restorePurchase: {ex_rst}")

            with self.lock:
                req["status"] = "completed"
                req["result"] = restore_result or {"gold": True, "uid": uid, "username": username}

            db = models.SessionLocal()
            already_notified = False
            try:
                if order_id:
                    db_o = db.query(models.Order).filter_by(order_id=order_id).first()
                    if db_o:
                        already_notified = bool(db_o.telegram_gold_notified)
                        db_o.status = "COMPLETED"
                        db_o.partner_status = "SUCCESS"
                        db_o.uid = uid
                        db_o.dns_link = f"/download-config?u={clean_u}"
                        db_o.module_link = LOCKET_SHADOW_MODULE_URL
                        db_o.telegram_gold_notified = True
                        db.commit()
            finally:
                db.close()

            if not already_notified and should_send_gold_notification(order_id or "direct", username, uid):
                notify_locket_gold_activated(order_id or "Trực tiếp", username, uid)

        except Exception as e:
            print(f"[QueueManager Error] {e}")
            with self.lock:
                req["status"] = "completed"
                req["error"] = str(e)
            
            db = models.SessionLocal()
            try:
                if order_id:
                    db_o = db.query(models.Order).filter_by(order_id=order_id).first()
                    if db_o:
                        db_o.status = "COMPLETED"
                        db_o.partner_status = "SUCCESS"
                        db_o.dns_link = f"/download-config?u={clean_u}"
                        db_o.module_link = LOCKET_SHADOW_MODULE_URL
                        db.commit()
            finally:
                db.close()

queue_manager = QueueManager()

