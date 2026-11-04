#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
cron_worker.py - Tiến trình chạy nền độc lập cho DTH Portal
Tự động quét tiền từ thueapibank và đồng bộ trạng thái đơn hàng định kỳ.
"""

import sys
import os
import time
from datetime import datetime

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from app import check_and_process_zalopay_history, load_orders

def main():
    print("=" * 60)
    print(" 🚀 DTH PORTAL CRON WORKER - QUÉT TIỀN TỰ ĐỘNG")
    print("=" * 60)
    interval = 30
    while True:
        try:
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            orders = load_orders()
            pending_count = len([o for o in orders.values() if o.get("status") == "PENDING"])
            print(f"[{now_str}] Đang quét (Đơn chờ: {pending_count})...", end="", flush=True)

            res = check_and_process_zalopay_history(force=False)
            matched = res.get("matched", [])
            if matched:
                print(f" 🎉 Khớp {len(matched)} đơn: {matched}")
            else:
                print(f" {res.get('msg', 'OK')}")

        except Exception as e:
            print(f" Lỗi: {e}")

        time.sleep(interval)

if __name__ == "__main__":
    main()

