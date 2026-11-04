import os
import re
import json
import secrets
from datetime import datetime, timedelta, timezone
from sqlalchemy import (
    create_engine, Column, String, Integer, Boolean, Text, DateTime, ForeignKey, Index, desc, text
)
from sqlalchemy.orm import declarative_base, sessionmaker, scoped_session
from sqlalchemy.pool import NullPool

# GMT+7 Timezone (Asia/Ho_Chi_Minh)
VN_TZ = timezone(timedelta(hours=7))

def now_gmt7():
    return datetime.now(VN_TZ)

Base = declarative_base()

class Order(Base):
    __tablename__ = "orders"

    order_id = Column(String(32), primary_key=True, index=True)
    service_type = Column(String(32), index=True, nullable=False) # chungsuc, locket, mxh, premium
    package_id = Column(String(64), nullable=True)
    package_type = Column(String(64), nullable=True)
    package_name = Column(String(255), nullable=True)
    amount = Column(Integer, default=0, nullable=False)
    amount_formatted = Column(String(64), nullable=True)
    status = Column(String(32), default="PENDING", index=True, nullable=False) # PENDING, PAID, PROCESSING, COMPLETED, PARTIAL_PAID, EXPIRED, CANCELLED, FAILED
    partner_status = Column(String(32), default="WAITING", nullable=False) # WAITING, PROCESSING, SUCCESS, FAILED
    
    # Idempotency flags
    is_notified = Column(Boolean, default=False, nullable=False) # Telegram payment notification sent flag
    telegram_gold_notified = Column(Boolean, default=False, nullable=False) # Locket gold activation telegram flag
    
    bank_trans_id = Column(String(128), nullable=True)
    zalo = Column(String(64), index=True, nullable=True)
    username = Column(String(128), index=True, nullable=True)
    uid = Column(String(128), nullable=True)
    avatar_url = Column(Text, nullable=True)
    code = Column(String(255), nullable=True)
    raw_code = Column(Text, nullable=True)
    link = Column(Text, nullable=True)
    target = Column(Text, nullable=True)
    token = Column(String(64), unique=True, index=True, nullable=False)
    
    qr_url = Column(Text, nullable=True)
    dns_link = Column(Text, nullable=True)
    module_link = Column(Text, nullable=True)
    
    quantity = Column(Integer, default=0)
    delivered = Column(Integer, default=0)
    remains = Column(Integer, default=0)
    start_count = Column(Integer, default=0, nullable=True)
    partner_order_id = Column(String(64), nullable=True)
    
    rating = Column(Integer, nullable=True)
    review_comment = Column(Text, nullable=True)
    extra_data = Column(Text, nullable=True) # JSON serialized data
    
    created_at = Column(DateTime(timezone=True), default=now_gmt7, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    paid_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    def get_extra(self, key, default=None):
        if not self.extra_data:
            return default
        try:
            data = json.loads(self.extra_data)
            return data.get(key, default)
        except Exception:
            return default

    def set_extra(self, key, value):
        data = {}
        if self.extra_data:
            try:
                data = json.loads(self.extra_data)
            except Exception:
                data = {}
        data[key] = value
        self.extra_data = json.dumps(data)

    def to_dict(self):
        sc = getattr(self, "start_count", None)
        if sc is None:
            sc = self.get_extra("start_count")
        qty = int(self.quantity or 0)
        deliv = int(self.delivered or 0)
        rem = self.remains if self.remains is not None else max(0, qty - deliv)
        curr = (sc + deliv) if sc is not None else None
        prog = 100 if self.status in ("COMPLETED", "SUCCESS") else (min(100, max(0, int(round(deliv * 100 / qty)))) if qty else 0)

        return {
            "order_id": self.order_id,
            "service_type": self.service_type,
            "package_id": self.package_id,
            "package_type": self.package_type,
            "package_name": self.package_name,
            "amount": self.amount,
            "amount_formatted": self.amount_formatted or f"{self.amount:,}đ",
            "status": self.status,
            "partner_status": self.partner_status,
            "is_notified": self.is_notified,
            "bank_trans_id": self.bank_trans_id,
            "zalo": self.zalo,
            "username": self.username,
            "uid": self.uid,
            "avatar_url": self.avatar_url,
            "code": self.code,
            "link": self.link,
            "target": self.target,
            "token": self.token,
            "qr_url": self.qr_url,
            "dns_link": self.dns_link,
            "module_link": self.module_link,
            "quantity": self.quantity,
            "delivered": self.delivered,
            "remains": rem,
            "start_count": sc,
            "current_count": curr,
            "buff_count": deliv,
            "progress": prog,
            "partner_order_id": getattr(self, "partner_order_id", None) or self.get_extra("partner_order_id"),
            "rating": self.rating,
            "review_comment": self.review_comment,
            "created_at": self.created_at.strftime("%Y-%m-%d %H:%M:%S") if self.created_at else None,
            "expires_at": self.expires_at.strftime("%Y-%m-%d %H:%M:%S") if self.expires_at else None,
            "paid_at": self.paid_at.strftime("%Y-%m-%d %H:%M:%S") if self.paid_at else None,
            "completed_at": self.completed_at.strftime("%Y-%m-%d %H:%M:%S") if self.completed_at else None,
        }

    def sanitize_for_client(self, exact_match=False, token_match=False):
        d = self.to_dict()
        # Mask sensitive info if not exact match or token verified
        zalo_str = str(self.zalo or "")
        if len(zalo_str) >= 8:
            d["zalo_masked"] = f"{zalo_str[:3]}****{zalo_str[-3:]}"
        else:
            d["zalo_masked"] = zalo_str

        if not (exact_match or token_match):
            d["zalo"] = d["zalo_masked"]
            # Hide private assets for non-verified inquiries
            if self.status not in ("PAID", "COMPLETED"):
                d["dns_link"] = None
                d["module_link"] = None

        # Clean upstream references
        forbidden = ["autonhanh", "tangtim", "batch", "token", "password", "secret", "upstream"]
        for f in forbidden:
            d.pop(f, None)
            
        return d


class ProcessedTransaction(Base):
    __tablename__ = "processed_transactions"

    transaction_id = Column(String(128), primary_key=True, unique=True, index=True)
    amount = Column(Integer, nullable=False)
    description = Column(Text, nullable=True)
    bank_name = Column(String(128), nullable=True)
    matched_order_id = Column(String(32), index=True, nullable=True)
    processed_at = Column(DateTime(timezone=True), default=now_gmt7, index=True)


class UnmatchedTransaction(Base):
    __tablename__ = "unmatched_transactions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    trans_id = Column(String(128), unique=True, index=True, nullable=False)
    amount = Column(Integer, nullable=False)
    description = Column(Text, nullable=True)
    bank_name = Column(String(128), nullable=True)
    trans_time = Column(DateTime(timezone=True), default=now_gmt7, index=True)
    status = Column(String(32), default="PENDING", index=True) # PENDING, MATCHED, REFUNDED
    matched_order_id = Column(String(32), index=True, nullable=True)

    def to_dict(self):
        return {
            "id": self.id,
            "trans_id": self.trans_id,
            "amount": self.amount,
            "amount_formatted": format_currency_vnd(self.amount),
            "description": self.description,
            "bank_name": self.bank_name,
            "trans_time": self.trans_time.strftime("%Y-%m-%d %H:%M:%S") if self.trans_time else None,
            "status": self.status,
            "matched_order_id": self.matched_order_id
        }


class ServiceConfig(Base):
    __tablename__ = "services_config"

    service_key = Column(String(32), primary_key=True) # chungsuc, locket, mxh, premium
    is_active = Column(Boolean, default=True, nullable=False)
    status_state = Column(String(32), default="OPERATIONAL", nullable=False) # OPERATIONAL, DEGRADED, MAINTENANCE
    maintenance_msg = Column(Text, nullable=True)
    reopen_at = Column(DateTime(timezone=True), nullable=True) # Countdown timestamp
    updated_at = Column(DateTime(timezone=True), default=now_gmt7, onupdate=now_gmt7)

    def to_dict(self):
        return {
            "service_key": self.service_key,
            "is_active": self.is_active,
            "status_state": self.status_state,
            "maintenance_msg": self.maintenance_msg,
            "reopen_at": self.reopen_at.strftime("%Y-%m-%d %H:%M:%S") if self.reopen_at else None,
            "reopen_at_ts": int(self.reopen_at.timestamp()) if self.reopen_at else None,
            "updated_at": self.updated_at.strftime("%Y-%m-%d %H:%M:%S") if self.updated_at else None
        }


class ActivationLog(Base):
    __tablename__ = "activation_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    uid = Column(String(128), index=True, nullable=False)
    order_id = Column(String(32), index=True, nullable=True)
    ip_address = Column(String(64), nullable=True)
    user_agent = Column(String(255), nullable=True)
    action_type = Column(String(64), default="activate", index=True, nullable=False) # activate, restore, download_module, download_config
    timestamp = Column(DateTime(timezone=True), default=now_gmt7, index=True)
    extra_info = Column(Text, nullable=True)

    def to_dict(self):
        return {
            "id": self.id,
            "uid": self.uid,
            "order_id": self.order_id,
            "ip_address": self.ip_address,
            "user_agent": self.user_agent,
            "action_type": self.action_type,
            "timestamp": self.timestamp.strftime("%Y-%m-%d %H:%M:%S") if self.timestamp else None,
            "extra_info": self.extra_info
        }


class Blacklist(Base):
    __tablename__ = "blacklists"

    id = Column(Integer, primary_key=True, autoincrement=True)
    type = Column(String(16), nullable=False) # 'ip' or 'phone'
    value = Column(String(128), index=True, nullable=False)
    reason = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), default=now_gmt7, index=True)

    def to_dict(self):
        return {
            "id": self.id,
            "type": self.type,
            "value": self.value,
            "reason": self.reason,
            "created_at": self.created_at.strftime("%Y-%m-%d %H:%M:%S") if self.created_at else None
        }


class Review(Base):
    __tablename__ = "reviews"

    id = Column(Integer, primary_key=True, autoincrement=True)
    order_id = Column(String(32), index=True, nullable=False)
    service_type = Column(String(32), index=True, nullable=False)
    rating = Column(Integer, nullable=False) # 1 - 5
    comment = Column(Text, nullable=True)
    customer_name = Column(String(128), nullable=True)
    created_at = Column(DateTime(timezone=True), default=now_gmt7)


# Database Engine Setup
DATABASE_URL = os.environ.get("DATABASE_URL")

if DATABASE_URL:
    # Normalize postgres protocol for SQLAlchemy
    if DATABASE_URL.startswith("postgres://"):
        DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+pg8000://", 1)
    elif DATABASE_URL.startswith("postgresql://") and not ("+" in DATABASE_URL.split("://")[0]):
        DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+pg8000://", 1)
    
    # Serverless: use NullPool to prevent exhausting client connections on Postgres
    engine = create_engine(DATABASE_URL, poolclass=NullPool, connect_args={"ssl_context": True} if "sslmode=require" in DATABASE_URL else {})
else:
    # SQLite local & Vercel fallback
    base_dir = os.path.dirname(os.path.abspath(__file__))
    is_vercel = os.environ.get("VERCEL") == "1"
    if is_vercel:
        import logging
        logging.warning("[DATABASE WARNING] Running on Serverless/Vercel with SQLite fallback (/tmp/dth_services.db). Data will be ephemeral across function cold starts! Please configure DATABASE_URL (PostgreSQL) for persistent production storage.")
    db_path = "/tmp/dth_services.db" if is_vercel else os.path.join(base_dir, "dth_services.db")
    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False, "timeout": 30},
        pool_pre_ping=True
    )

SessionLocal = scoped_session(sessionmaker(autocommit=False, autoflush=False, bind=engine))

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Danh sách mã giao dịch vĩnh cửu chống trùng lặp khi Vercel cold-start hoặc DB reset
KNOWN_PROCESSED_TRANSACTIONS = {
    "261104002753031", # Đơn CS8IMCWT (Gói 1k2 Lượt SSS - Zalo 0343817944) - Khóa vĩnh viễn
    "261103005554547", # Đơn LKG2BZMH (@dal.207)
    "261103005550313", # Đơn LK46K80R (@amoam)
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

def is_transaction_processed(trans_id: str) -> bool:
    """
    Kiểm tra Idempotency tuyệt đối trước khi xử lý:
    1. Kiểm tra bộ nhớ KNOWN_PROCESSED_TRANSACTIONS.
    2. Kiểm tra Database (bảng processed_transactions có ràng buộc UNIQUE).
    3. Kiểm tra file backup bank_cache.json (/tmp và local).
    """
    if not trans_id:
        return False
    t_clean = str(trans_id).strip()
    if not t_clean:
        return False

    if t_clean in KNOWN_PROCESSED_TRANSACTIONS:
        return True

    # 1. Kiểm tra Database
    db = SessionLocal()
    try:
        exists = db.query(ProcessedTransaction.transaction_id).filter_by(transaction_id=t_clean).first()
        if exists:
            KNOWN_PROCESSED_TRANSACTIONS.add(t_clean)
            return True
    except Exception:
        pass
    finally:
        db.close()

    # 2. Kiểm tra bank_cache.json
    base_dir = os.path.dirname(os.path.abspath(__file__))
    for cache_p in [
        os.path.join(base_dir, "bank_cache.json"),
        "/tmp/bank_cache.json" if os.environ.get("VERCEL") == "1" else None
    ]:
        if cache_p and os.path.exists(cache_p):
            try:
                with open(cache_p, "r", encoding="utf-8") as f:
                    cdata = json.load(f)
                    if t_clean in cdata.get("processed_trans", []):
                        KNOWN_PROCESSED_TRANSACTIONS.add(t_clean)
                        return True
            except Exception:
                pass

    return False

def record_processed_transaction(trans_id: str, amount: int = 0, description: str = "", bank_name: str = "", matched_order_id: str = ""):
    """
    Ghi nhận ngay lập tức transaction_id vào Database (commit ngay) và file backup bank_cache.json.
    """
    if not trans_id:
        return False
    t_clean = str(trans_id).strip()
    if not t_clean:
        return False

    KNOWN_PROCESSED_TRANSACTIONS.add(t_clean)

    # 1. Ghi và commit ngay vào Database
    db = SessionLocal()
    try:
        pt = ProcessedTransaction(
            transaction_id=t_clean,
            amount=amount or 0,
            description=description[:500] if description else "",
            bank_name=bank_name or "BVBank - ZaloPay (99ZP24261M43061759)",
            matched_order_id=matched_order_id or ""
        )
        db.merge(pt)
        db.commit()
    except Exception as e:
        db.rollback()
    finally:
        db.close()

    # 2. Lưu ngay vào bank_cache.json để chống mất khi serverless cold-start
    base_dir = os.path.dirname(os.path.abspath(__file__))
    for cache_p in [
        os.path.join(base_dir, "bank_cache.json"),
        "/tmp/bank_cache.json" if os.environ.get("VERCEL") == "1" else None
    ]:
        if cache_p and os.path.exists(cache_p):
            try:
                with open(cache_p, "r", encoding="utf-8") as f:
                    cdata = json.load(f)
                plist = cdata.get("processed_trans", [])
                if t_clean not in plist:
                    plist.append(t_clean)
                    cdata["processed_trans"] = plist[-500:]
                    with open(cache_p, "w", encoding="utf-8") as f:
                        json.dump(cdata, f, indent=2, ensure_ascii=False)
            except Exception:
                pass

    return True


def init_db():
    Base.metadata.create_all(bind=engine)
    
    # Check if reopen_at column exists in services_config (safe migration for SQLite/Postgres)
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE services_config ADD COLUMN reopen_at TIMESTAMP"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE orders ADD COLUMN start_count INTEGER DEFAULT 0"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE orders ADD COLUMN partner_order_id VARCHAR(64)"))
            conn.commit()
        except Exception:
            pass

    # Initialize default services if not present
    db = SessionLocal()
    try:
        defaults = [
            ("chungsuc", True, "OPERATIONAL", "Sự kiện Chung Sức hoạt động 24/7"),
            ("locket", True, "OPERATIONAL", "Kích hoạt Locket Gold giữ vĩnh viễn"),
            ("mxh", True, "OPERATIONAL", "Hệ thống tăng tương tác MXH tự động"),
            ("premium", False, "MAINTENANCE", "Chợ Premium tạm đóng để cập nhật bảng giá mới"),
        ]
        for key, active, state, msg in defaults:
            cfg = db.query(ServiceConfig).filter_by(service_key=key).first()
            if not cfg:
                db.add(ServiceConfig(
                    service_key=key,
                    is_active=active,
                    status_state=state,
                    maintenance_msg=msg
                ))
        
        # Seed danh sách giao dịch đã xử lý vào database
        for tid in KNOWN_PROCESSED_TRANSACTIONS:
            existing_pt = db.query(ProcessedTransaction.transaction_id).filter_by(transaction_id=tid).first()
            if not existing_pt:
                db.add(ProcessedTransaction(
                    transaction_id=tid,
                    amount=30000,
                    description="Seed giao dịch đã xử lý",
                    bank_name="BVBank - ZaloPay"
                ))
        db.commit()

        db.commit()
    except Exception as e:
        db.rollback()
        print(f"[init_db Error] {e}")
    finally:
        db.close()

# Migration helper: Synchronize orders from orders.json into DB
def migrate_legacy_json_to_db():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    orders_json_path = os.path.join(base_dir, "orders.json")
    if not os.path.exists(orders_json_path):
        return

    # Lay danh sach don hang da bi xoa (chong hoi sinh)
    deleted_ids = set()
    deleted_file = os.path.join(base_dir, "deleted_orders.json")
    if os.path.exists(deleted_file):
        try:
            with open(deleted_file, "r", encoding="utf-8") as df:
                d_list = json.load(df)
                if isinstance(d_list, list):
                    for item in d_list:
                        s_item = str(item).strip().upper()
                        if "ORDER_ID" in s_item:
                            for part in s_item.replace("'", '"').split(","):
                                if "ORDER_ID" in part:
                                    val = part.split(":")[-1].replace('"', '').strip()
                                    deleted_ids.add(val)
                        else:
                            deleted_ids.add(s_item)
        except Exception:
            pass

    db = SessionLocal()
    try:
        with open(orders_json_path, "r", encoding="utf-8") as f:
            legacy_orders = json.load(f)

        existing_orders = {r[0] for r in db.query(Order.order_id).all()}
        synced_count = 0

        for oid, o in legacy_orders.items():
            if not isinstance(o, dict):
                continue
            oid_upper = str(oid).upper()
            if oid_upper in deleted_ids:
                continue
            if not isinstance(o, dict):
                continue
            oid_upper = str(oid).upper()

            amt = o.get("amount", 0)
            try:
                amt = int(abs(float(str(amt).replace(",", "").replace(".", "").replace("đ", "") or 0)))
            except Exception:
                amt = 0
            
            created_str = o.get("created_time") or ""
            dt_created = now_gmt7()
            if created_str:
                try:
                    dt_created = datetime.strptime(created_str, "%Y-%m-%d %H:%M:%S").replace(tzinfo=VN_TZ)
                except Exception:
                    pass

            paid_str = o.get("paid_at") or ""
            dt_paid = None
            if paid_str:
                try:
                    dt_paid = datetime.strptime(paid_str.split()[0] + " " + paid_str.split()[1], "%Y-%m-%d %H:%M:%S").replace(tzinfo=VN_TZ)
                except Exception:
                    pass

            completed_str = o.get("completed_at") or ""
            dt_completed = None
            if completed_str:
                try:
                    dt_completed = datetime.strptime(completed_str.split()[0] + " " + completed_str.split()[1], "%Y-%m-%d %H:%M:%S").replace(tzinfo=VN_TZ)
                except Exception:
                    pass

            qty = int(o.get("quantity") or o.get("turns") or 0)
            deliv = int(o.get("delivered") or o.get("buff_count") or 0)
            rem = int(o.get("remains") if o.get("remains") is not None else max(0, qty - deliv))
            sc = int(o.get("start_count") or 0) if o.get("start_count") is not None else None
            p_order_id = str(o.get("partner_order_id") or o.get("tangtim_order_id") or "")

            raw_st = str(o.get("status", "")).strip().upper()
            st = "COMPLETED" if (raw_st in ("COMPLETED", "HOÀN THÀNH") or (qty > 0 and rem <= 0 and deliv >= qty)) else (raw_st or "PENDING")

            if oid_upper in existing_orders:
                existing = db.query(Order).filter_by(order_id=oid_upper).first()
                if existing:
                    if st == "COMPLETED" and existing.status != "COMPLETED":
                        existing.status = "COMPLETED"
                        existing.partner_status = "SUCCESS"
                        existing.delivered = deliv or qty
                        existing.remains = 0
                        existing.completed_at = dt_completed or now_gmt7()
                    if sc is not None and (not existing.start_count or existing.start_count == 0):
                        existing.start_count = sc
                        existing.set_extra("start_count", sc)
                    if p_order_id and not existing.partner_order_id:
                        existing.partner_order_id = p_order_id
                    if o.get("tangtim_order_id"):
                        existing.set_extra("tangtim_order_id", o.get("tangtim_order_id"))
                    synced_count += 1
                continue

            db_order = Order(
                order_id=oid_upper,
                service_type=o.get("service_type") or ("chungsuc" if oid_upper.startswith("CS") else ("locket" if oid_upper.startswith("LK") else ("premium" if oid_upper.startswith("PR") else "mxh"))),
                package_id=o.get("package_id"),
                package_type=o.get("package_type"),
                package_name=o.get("package_name"),
                amount=amt,
                amount_formatted=o.get("amount_formatted") or f"{amt:,}đ",
                status=st,
                partner_status="SUCCESS" if st == "COMPLETED" else (o.get("partner_status") or "WAITING"),
                is_notified=bool(o.get("is_notified") or o.get("telegram_paid_notified") or o.get("notified_paid") or st in ("PAID", "COMPLETED", "PROCESSING")),
                telegram_gold_notified=bool(o.get("telegram_gold_notified")),
                bank_trans_id=o.get("bank_trans_id") or o.get("transaction_id"),
                zalo=o.get("zalo"),
                username=o.get("username"),
                uid=o.get("uid"),
                avatar_url=o.get("avatar_url"),
                code=o.get("code"),
                raw_code=o.get("raw_code"),
                link=o.get("link"),
                target=o.get("target"),
                token=o.get("token") or secrets.token_hex(16),
                qr_url=o.get("qr_url"),
                dns_link=o.get("dns_link"),
                module_link=o.get("module_link"),
                quantity=qty,
                delivered=deliv,
                remains=rem,
                start_count=sc,
                partner_order_id=p_order_id,
                created_at=dt_created,
                expires_at=dt_created + timedelta(minutes=15),
                paid_at=dt_paid,
                completed_at=dt_completed
            )
            extra_d = {}
            if o.get("tangtim_order_id"):
                extra_d["tangtim_order_id"] = o.get("tangtim_order_id")
            if sc is not None:
                extra_d["start_count"] = sc
            if extra_d:
                db_order.extra_data = json.dumps(extra_d)

            
            if db_order.bank_trans_id:
                record_processed_transaction(db_order.bank_trans_id, amount=amt, matched_order_id=oid_upper)
            db.add(db_order)
            existing_orders.add(oid_upper)
            synced_count += 1

        db.commit()
        print(f"[migrate_legacy_json_to_db] Successfully synced {synced_count} orders into DB.")
    except Exception as e:
        db.rollback()
        print(f"[migrate_legacy_json_to_db Warning] {e}")
    finally:
        db.close()


def log_activation(uid, action_type, ip_address=None, user_agent=None, order_id=None, extra_info=None):
    """Ghi nhận log kích hoạt vào Database và file JSON data/activation_logs.json."""
    if not uid:
        return
    base_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(base_dir, "data")
    os.makedirs(data_dir, exist_ok=True)
    json_path = os.path.join(data_dir, "activation_logs.json")

    # 1. DB Log
    db = SessionLocal()
    try:
        log_entry = ActivationLog(
            uid=str(uid).strip(),
            order_id=str(order_id).strip() if order_id else None,
            ip_address=str(ip_address).strip() if ip_address else None,
            user_agent=str(user_agent)[:255] if user_agent else None,
            action_type=str(action_type).strip(),
            timestamp=now_gmt7(),
            extra_info=str(extra_info) if extra_info else None
        )
        db.add(log_entry)
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"[log_activation DB Error] {e}")
    finally:
        db.close()

    # 2. File JSON Log backup
    try:
        logs = []
        if os.path.exists(json_path):
            try:
                with open(json_path, "r", encoding="utf-8") as f:
                    logs = json.load(f)
                    if not isinstance(logs, list):
                        logs = []
            except Exception:
                logs = []
        logs.append({
            "uid": str(uid).strip(),
            "order_id": str(order_id).strip() if order_id else None,
            "ip_address": str(ip_address).strip() if ip_address else None,
            "user_agent": str(user_agent)[:255] if user_agent else None,
            "action_type": str(action_type).strip(),
            "timestamp": now_gmt7().strftime("%Y-%m-%d %H:%M:%S"),
            "extra_info": str(extra_info) if extra_info else None
        })
        # Keep recent 2000 logs in JSON
        if len(logs) > 2000:
            logs = logs[-2000:]
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(logs, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[log_activation JSON Error] {e}")


def check_uid_activation_limit(uid):
    """
    Rate limit: Giới hạn tối đa 5 lần kích hoạt lại/giờ hoặc 10 lần/ngày trên mỗi UID để chống chia sẻ link/spam.
    """
    if not uid:
        return True, ""
    clean_u = str(uid).strip()
    db = SessionLocal()
    try:
        now = now_gmt7()
        one_hour_ago = now - timedelta(hours=1)
        one_day_ago = now - timedelta(hours=24)

        # Count actions in 1 hour
        hour_count = db.query(ActivationLog).filter(
            ActivationLog.uid == clean_u,
            ActivationLog.timestamp >= one_hour_ago
        ).count()

        if hour_count >= 5:
            return False, f"UID này đã kích hoạt/tải {hour_count} lần trong 1 giờ qua (Tối đa 5 lần/giờ). Vui lòng chờ thêm trước khi thử lại!"

        # Count actions in 24 hours
        day_count = db.query(ActivationLog).filter(
            ActivationLog.uid == clean_u,
            ActivationLog.timestamp >= one_day_ago
        ).count()

        if day_count >= 10:
            return False, f"UID này đã kích hoạt {day_count} lần trong ngày (Tối đa 10 lần/ngày). Vui lòng liên hệ Admin để mở khóa!"

        return True, ""
    except Exception as e:
        print(f"[check_uid_activation_limit Error] {e}")
        return True, ""
    finally:
        db.close()


def is_blacklisted(ip=None, phone=None):
    """Kiểm tra IP hoặc Phone có nằm trong Blacklist hay không."""
    base_dir = os.path.dirname(os.path.abspath(__file__))
    json_path = os.path.join(base_dir, "data", "blacklist.json")

    # Fast file check
    if os.path.exists(json_path):
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                bl_data = json.load(f)
                if ip and ip in bl_data.get("ips", []):
                    return True, "Địa chỉ IP nằm trong danh sách hạn chế do vi phạm quy định chống spam."
                if phone and phone in bl_data.get("phones", []):
                    return True, "Số điện thoại nằm trong danh sách hạn chế do vi phạm quy định chống spam."
        except Exception:
            pass

    # DB check
    db = SessionLocal()
    try:
        if ip:
            entry = db.query(Blacklist).filter_by(type="ip", value=str(ip).strip()).first()
            if entry:
                return True, entry.reason or "IP bị khóa do vi phạm quy định chống spam."
        if phone:
            entry = db.query(Blacklist).filter_by(type="phone", value=str(phone).strip()).first()
            if entry:
                return True, entry.reason or "Số điện thoại bị khóa do vi phạm quy định chống spam."
        return False, ""
    finally:
        db.close()


def add_to_blacklist(b_type, value, reason="Spam đơn hàng"):
    """Thêm IP hoặc Phone vào Blacklist (cả DB và JSON)."""
    if not value:
        return
    clean_val = str(value).strip()
    clean_type = str(b_type).strip().lower()

    base_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(base_dir, "data")
    os.makedirs(data_dir, exist_ok=True)
    json_path = os.path.join(data_dir, "blacklist.json")

    db = SessionLocal()
    try:
        existing = db.query(Blacklist).filter_by(type=clean_type, value=clean_val).first()
        if not existing:
            db.add(Blacklist(type=clean_type, value=clean_val, reason=reason, created_at=now_gmt7()))
            db.commit()
    except Exception as e:
        db.rollback()
        print(f"[add_to_blacklist DB Error] {e}")
    finally:
        db.close()

    try:
        bl_data = {"ips": [], "phones": []}
        if os.path.exists(json_path):
            with open(json_path, "r", encoding="utf-8") as f:
                bl_data = json.load(f)
        key = "ips" if clean_type == "ip" else "phones"
        if clean_val not in bl_data.get(key, []):
            bl_data.setdefault(key, []).append(clean_val)
            with open(json_path, "w", encoding="utf-8") as f:
                json.dump(bl_data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[add_to_blacklist JSON Error] {e}")


def get_vip_tier(phone):
    """
    Tính hạng VIP theo SĐT/Zalo:
    >= 500.000đ: Hạng Vàng (Gold) -> Giảm 10%
    >= 200.000đ: Hạng Bạc (Silver) -> Giảm 5%
    < 200.000đ: Hạng Chuẩn -> Giảm 0%
    """
    if not phone:
        return {
            "tier": "STANDARD",
            "tier_label": "Thành viên",
            "discount_percent": 0,
            "total_spent": 0,
            "badge_color": "#64748b"
        }
    clean_phone = re.sub(r"\D", "", str(phone))
    if not clean_phone:
        return {
            "tier": "STANDARD",
            "tier_label": "Thành viên",
            "discount_percent": 0,
            "total_spent": 0,
            "badge_color": "#64748b"
        }

    db = SessionLocal()
    try:
        paid_orders = db.query(Order).filter(
            Order.zalo == clean_phone,
            Order.status.in_(["PAID", "PROCESSING", "COMPLETED"])
        ).all()

        total_spent = sum(o.amount for o in paid_orders)

        if total_spent >= 500000:
            return {
                "tier": "GOLD",
                "tier_label": "VIP Vàng",
                "discount_percent": 10,
                "total_spent": total_spent,
                "badge_color": "#f59e0b"
            }
        elif total_spent >= 200000:
            return {
                "tier": "SILVER",
                "tier_label": "VIP Bạc",
                "discount_percent": 5,
                "total_spent": total_spent,
                "badge_color": "#94a3b8"
            }
        else:
            return {
                "tier": "STANDARD",
                "tier_label": "Thành viên",
                "discount_percent": 0,
                "total_spent": total_spent,
                "badge_color": "#64748b"
            }
    finally:
        db.close()
