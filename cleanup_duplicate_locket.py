import os
import sys
import json
from datetime import datetime

# Configure utf-8 stdout on windows
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
import models
from utils import now_gmt7

def get_order_score(status):
    st = str(status or "").upper()
    if st in ("COMPLETED", "SUCCESS"):
        return 4
    if st in ("PAID", "PROCESSING"):
        return 3
    if st in ("PARTIAL_PAID",):
        return 2
    if st in ("PENDING",):
        return 1
    return 0

def cleanup_locket_duplicates():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    orders_json_path = os.path.join(base_dir, "orders.json")
    deleted_log_path = os.path.join(base_dir, "deleted_orders.json")

    deleted_db_ids = []
    deleted_json_ids = []

    # ========================================================
    # 1. CLEANUP SQL DATABASE (SQLite / PostgreSQL)
    # ========================================================
    db = models.SessionLocal()
    try:
        db_orders = db.query(models.Order).filter(
            (models.Order.service_type == "locket") | 
            (models.Order.order_id.like("LK%")) | 
            (models.Order.order_id.like("DTHLK%"))
        ).all()

        uid_groups = {}
        for o in db_orders:
            key = None
            if o.uid and len(str(o.uid).strip()) > 5:
                key = f"uid:{str(o.uid).strip()}"
            elif o.username and len(str(o.username).strip()) >= 3:
                key = f"user:{str(o.username).strip().lower()}"
            
            if key:
                uid_groups.setdefault(key, []).append(o)

        for key, group in uid_groups.items():
            if len(group) > 1:
                # Sort: highest score first, then earliest created_at
                def sort_key(item):
                    score = get_order_score(item.status)
                    # Created at timestamp fallback
                    ts = item.created_at.timestamp() if item.created_at else 9999999999
                    return (-score, ts, str(item.order_id))

                sorted_group = sorted(group, key=sort_key)
                keep_order = sorted_group[0]
                remove_orders = sorted_group[1:]

                print(f"[DB] Group {key}: Keeping {keep_order.order_id} ({keep_order.status}) - Deleting {[r.order_id for r in remove_orders]}")

                for rem in remove_orders:
                    deleted_db_ids.append({
                        "order_id": rem.order_id,
                        "source": "database",
                        "uid": rem.uid,
                        "username": rem.username,
                        "status": rem.status,
                        "created_at": str(rem.created_at),
                        "kept_order_id": keep_order.order_id
                    })
                    db.delete(rem)

        db.commit()
    except Exception as e:
        db.rollback()
        print(f"[cleanup_locket_duplicates DB Error] {e}")
    finally:
        db.close()

    # ========================================================
    # 2. CLEANUP orders.json
    # ========================================================
    if os.path.exists(orders_json_path):
        try:
            with open(orders_json_path, "r", encoding="utf-8") as f:
                json_orders = json.load(f)

            j_uid_groups = {}
            for oid, o in json_orders.items():
                if not isinstance(o, dict):
                    continue
                stype = o.get("service_type") or ("locket" if str(oid).startswith("LK") else "")
                uid = str(o.get("uid") or "").strip()
                uname = str(o.get("username") or "").strip().lower()

                key = None
                if uid and len(uid) > 5:
                    key = f"uid:{uid}"
                elif (stype == "locket" or str(oid).startswith("LK")) and uname and len(uname) >= 3:
                    key = f"user:{uname}"

                if key:
                    j_uid_groups.setdefault(key, []).append((oid, o))

            keys_to_delete = set()
            for key, group in j_uid_groups.items():
                if len(group) > 1:
                    def j_sort_key(item):
                        oid, o = item
                        score = get_order_score(o.get("status"))
                        ctime_str = o.get("created_time") or ""
                        ts = 9999999999
                        try:
                            if ctime_str:
                                ts = datetime.strptime(ctime_str, "%Y-%m-%d %H:%M:%S").timestamp()
                        except Exception:
                            pass
                        return (-score, ts, str(oid))

                    sorted_j = sorted(group, key=j_sort_key)
                    keep_oid, keep_o = sorted_j[0]
                    remove_j = sorted_j[1:]

                    print(f"[JSON] Group {key}: Keeping {keep_oid} ({keep_o.get('status')}) - Deleting {[r[0] for r in remove_j]}")

                    for r_oid, r_o in remove_j:
                        keys_to_delete.add(r_oid)
                        deleted_json_ids.append({
                            "order_id": r_oid,
                            "source": "orders.json",
                            "uid": r_o.get("uid"),
                            "username": r_o.get("username"),
                            "status": r_o.get("status"),
                            "created_at": r_o.get("created_time"),
                            "kept_order_id": keep_oid
                        })

            for r_oid in keys_to_delete:
                json_orders.pop(r_oid, None)

            with open(orders_json_path, "w", encoding="utf-8") as f:
                json.dump(json_orders, f, ensure_ascii=False, indent=2)

        except Exception as e:
            print(f"[cleanup_locket_duplicates JSON Error] {e}")

    # ========================================================
    # 3. SAVE DELETED LOG
    # ========================================================
    all_deleted = deleted_db_ids + deleted_json_ids
    if all_deleted:
        existing_deleted = []
        if os.path.exists(deleted_log_path):
            try:
                with open(deleted_log_path, "r", encoding="utf-8") as f:
                    existing_deleted = json.load(f)
                    if not isinstance(existing_deleted, list):
                        existing_deleted = []
            except Exception:
                existing_deleted = []

        existing_deleted.extend(all_deleted)
        with open(deleted_log_path, "w", encoding="utf-8") as f:
            json.dump(existing_deleted, f, ensure_ascii=False, indent=2)

    total_deleted = len(deleted_db_ids) + len(deleted_json_ids)
    print("=" * 60)
    print(f"✅ HOÀN TẤT DỌN DẸP ĐƠN LOCKET TRÙNG LẶP:")
    print(f" - Đã xóa trong Database: {len(deleted_db_ids)} đơn")
    print(f" - Đã xóa trong orders.json: {len(deleted_json_ids)} đơn")
    print(f" - Tổng số đơn trùng đã dọn sạch: {total_deleted} đơn")
    print("=" * 60)

    return {
        "success": True,
        "db_deleted_count": len(deleted_db_ids),
        "json_deleted_count": len(deleted_json_ids),
        "total_deleted": total_deleted,
        "details": all_deleted
    }

if __name__ == "__main__":
    cleanup_locket_duplicates()
