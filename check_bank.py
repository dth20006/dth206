#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_bank.py - Công Cụ Quét & Khớp Tiền Tự Động Cho DTH Portal
Hỗ trợ:
  1. Quét trực tiếp 1 lần: python check_bank.py
  2. Vòng lặp tự động (loop): python check_bank.py --loop 10
  3. Xem chi tiết giao dịch từ thueapibank: python check_bank.py --raw
"""

import sys
import os
import time
import json
import argparse
from datetime import datetime

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

try:
    from app import check_and_process_zalopay_history, load_orders, load_config
except ImportError as e:
    print(f"❌ Không thể import từ app.py: {e}")
    sys.exit(1)


def print_banner():
    print("=" * 65)
    print(" 🚀 DTH PORTAL - HỆ THỐNG AUTO THANH TOÁN ZALOPAY / BVBANK")
    print("    Gộp Chung Sức • Locket Gold • Mạng Xã Hội")
    print("=" * 65)


def run_single_check():
    cfg = load_config()
    pay = cfg.get("payment", {})
    tapi = pay.get("thueapibank", {})
    token = tapi.get("token", "498705aae1752f7c0658c6f622317daf")
    phone = tapi.get("phone", "0353680869")
    acc_no = pay.get("account_number", "99ZP24261M43061759")
    acc_name = pay.get("account_name", "ZALOPAY_DINH TUAN HUNG")

    print(f"\n⏰ Thời gian: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"🏦 Tài khoản nhận: {acc_no} ({acc_name}) | SĐT ZaloPay: {phone}")
    print(f"🔑 Token thueapibank: {token[:8]}...{token[-6:]}")

    orders = load_orders()
    pending = [o for o in orders.values() if o.get("status") == "PENDING"]
    print(f"📋 Số đơn đang chờ thanh toán (PENDING): {len(pending)}")
    for p in pending[:5]:
        print(f"   • Đơn: {p.get('order_id')} | Tiền: {p.get('amount_formatted', p.get('amount'))} | Dịch vụ: {p.get('package_name')}")

    print("\n🔍 Đang gọi thueapibank.vn kiểm tra giao dịch...")
    result = check_and_process_zalopay_history(force=True)

    status = result.get("status")
    matched = result.get("matched", [])

    if status == "success":
        if matched:
            print(f"🎉 KHỚP THÀNH CÔNG {len(matched)} ĐƠN HÀNG:")
            for m in matched:
                print(f"   ✅ Đơn #{m} -> Đã duyệt & tự động chuyển sang trạng thái xử lý!")
        else:
            print("ℹ️ Chưa có giao dịch mới khớp với các đơn PENDING.")
    elif status == "rate_limited":
        print(f"⏳ Cảnh báo giãn cách chống spam: {result.get('msg')}")
    else:
        print(f"❌ Lỗi: {result.get('msg')}")


def run_raw_view():
    import requests
    cfg = load_config()
    token = cfg.get("payment", {}).get("thueapibank", {}).get("token", "498705aae1752f7c0658c6f622317daf")
    url = f"https://thueapibank.vn/historyapizalopay/{token}"
    print(f"🔍 Đang lấy dữ liệu thô từ: {url}")
    try:
        r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=15)
        print(f"HTTP Status: {r.status_code}")
        print(json.dumps(r.json(), indent=2, ensure_ascii=False))
    except Exception as e:
        print(f"Lỗi: {e}")


def main():
    parser = argparse.ArgumentParser(description="Tool kiểm tra và khớp tiền thanh toán ZaloPay")
    parser.add_argument("--loop", type=int, default=0, help="Chạy lặp lại sau mỗi N giây (ví dụ: --loop 10)")
    parser.add_argument("--raw", action="store_true", help="Xem chi tiết JSON thô từ thueapibank")
    args = parser.parse_args()

    print_banner()

    if args.raw:
        run_raw_view()
        return

    if args.loop > 0:
        interval = max(5, args.loop)
        print(f"🔄 Bắt đầu vòng lặp quét tự động mỗi {interval} giây... (Bấm Ctrl + C để dừng)\n")
        try:
            while True:
                run_single_check()
                time.sleep(interval)
        except KeyboardInterrupt:
            print("\n👋 Đã dừng tool.")
    else:
        run_single_check()


if __name__ == "__main__":
    main()

