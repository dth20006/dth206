import string
import os
import re
import time
import secrets
import hmac
import hashlib
from datetime import datetime, timedelta, timezone

VN_TZ = timezone(timedelta(hours=7))

HMAC_SECRET_KEY = os.environ.get("HMAC_SECRET_KEY") or "DTH_HMAC_SECRET_KEY_VIP_2026"

def now_gmt7():
    return datetime.now(VN_TZ)

def format_currency_vnd(amount):
    try:
        val = int(round(float(amount)))
        return f"{val:,}".replace(",", ".") + "đ"
    except Exception:
        return f"{amount}đ"

def round_price_vnd(amount, step=1000):
    try:
        val = int(round(float(amount)))
        if step > 0:
            val = int(round(val / step) * step)
        return max(0, val)
    except Exception:
        return 0

def generate_order_id(prefix="LK"):
    # Chuẩn hóa VietQR: Prefix (CS, LK, TT, PR) + 6 ký tự ngẫu nhiên [A-Z0-9]
    # Tuyệt đối không dùng dấu gạch ngang, gạch dưới để app ngân hàng không lọc mất
    clean_prefix = re.sub(r'[^A-Z]', '', str(prefix).upper())[:2]
    if clean_prefix not in ("CS", "LK", "TT", "PR"):
        clean_prefix = "LK"
    chars = string.ascii_uppercase + string.digits
    rand_chars = "".join(secrets.choice(chars) for _ in range(6))
    return f"{clean_prefix}{rand_chars}"

def clean_locket_username(val):
    if not val:
        return ""
    val = str(val).strip()
    # Check if URL passed: https://locket.camera/links/... or similar
    if "locket.camera" in val or "http" in val:
        m = re.search(r"/(?:links|user|u)/([A-Za-z0-9_.-]+)", val)
        if m:
            return m.group(1).strip()
        parts = val.rstrip("/").split("/")
        if parts:
            val = parts[-1]
    
    clean = re.sub(r"[^A-Za-z0-9_.-]", "", val.lstrip("@")).strip()
    return clean

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
    # Fallback alphanumeric
    clean = re.sub(r"[^A-Za-z0-9_-]", "", text)
    return clean

def clean_mxh_link(text):
    if not text:
        return ""
    text = str(text).strip()
    # If customer pasted messy message with URL
    m = re.search(r'(https?://[^\s]+)', text)
    if m:
        url = m.group(1)
        # Strip tracking query params
        url = re.sub(r'[?&](?:utm_[^&]+|fbclid|is_from_webapp|sender_device)=[^&]*', '', url)
        url = url.rstrip('?&')
        return url
    return text

def mask_phone(phone_str):
    if not phone_str:
        return "N/A"
    p = str(phone_str).strip()
    if len(p) >= 9:
        return f"{p[:3]}****{p[-3:]}"
    return p

def mask_uid(uid_str):
    if not uid_str:
        return "N/A"
    u = str(uid_str).strip()
    if len(u) >= 10:
        return f"{u[:4]}****{u[-4:]}"
    return u

def extract_social_uid(text, platform=None):
    """
    Tự động chuyển đổi Link sang UID/Object ID:
    - Facebook: Profile/Post/Reel/Group -> bóc regex UID / fbid / post_id / username.
    - TikTok: vt.tiktok.com/... hoặc tiktok.com/@user/video/... -> bóc username / video_id.
    """
    if not text:
        return {"object_id": "", "platform": "unknown", "raw": text}
    raw = str(text).strip()
    
    # 1. TikTok Matching
    if "tiktok.com" in raw or (platform and platform.lower() == "tiktok"):
        # Video ID: @user/video/1234567890123456789
        m_vid = re.search(r'/video/(\d+)', raw)
        if m_vid:
            return {"object_id": m_vid.group(1), "platform": "tiktok", "type": "video_id", "raw": raw}
        
        # Short link: vt.tiktok.com/ZS...
        m_short = re.search(r'vt\.tiktok\.com/([A-Za-z0-9_-]+)', raw)
        if m_short:
            return {"object_id": m_short.group(1), "platform": "tiktok", "type": "short_link", "raw": raw}

        # Username: @username
        m_user = re.search(r'@([A-Za-z0-9_.-]+)', raw)
        if m_user:
            return {"object_id": f"@{m_user.group(1)}", "platform": "tiktok", "type": "username", "raw": raw}

        # Bare username in path: tiktok.com/@abc
        clean = raw.rstrip('/').split('/')[-1].lstrip('@')
        if clean:
            return {"object_id": f"@{clean}", "platform": "tiktok", "type": "username", "raw": raw}

    # 2. Facebook Matching
    if "facebook.com" in raw or "fb.com" in raw or "fb.watch" in raw or (platform and platform.lower() == "facebook"):
        # Profile ID param: profile.php?id=1000...
        m_fbid = re.search(r'[?&]id=(\d+)', raw)
        if m_fbid:
            return {"object_id": m_fbid.group(1), "platform": "facebook", "type": "profile_id", "raw": raw}
        
        # Story / Post FBID param
        m_story = re.search(r'story_fbid=(\d+)', raw)
        if m_story:
            return {"object_id": m_story.group(1), "platform": "facebook", "type": "post_id", "raw": raw}

        # Post / Reel / Video ID in path
        m_post = re.search(r'/(?:posts|reel|videos|watch)/(\d+)', raw)
        if m_post:
            return {"object_id": m_post.group(1), "platform": "facebook", "type": "post_id", "raw": raw}

        # Group post: /groups/123/posts/456
        m_grp = re.search(r'/groups/[^/]+/posts/(\d+)', raw)
        if m_grp:
            return {"object_id": m_grp.group(1), "platform": "facebook", "type": "post_id", "raw": raw}

        # Numeric ID directly: fb.com/1000...
        m_num = re.search(r'(?:facebook\.com|fb\.com)/(\d+)/?$', raw)
        if m_num:
            return {"object_id": m_num.group(1), "platform": "facebook", "type": "uid", "raw": raw}

        # Username in URL: facebook.com/user.name
        m_uname = re.search(r'(?:facebook\.com|fb\.com)/([A-Za-z0-9._-]+)/?$', raw)
        if m_uname and not any(w in m_uname.group(1).lower() for w in ["profile", "share", "watch", "photo", "groups"]):
            return {"object_id": m_uname.group(1), "platform": "facebook", "type": "username", "raw": raw}

    # 3. Instagram Matching
    if "instagram.com" in raw:
        m_ig_p = re.search(r'/(?:p|reel)/([A-Za-z0-9_-]+)', raw)
        if m_ig_p:
            return {"object_id": m_ig_p.group(1), "platform": "instagram", "type": "post_code", "raw": raw}
        m_ig_u = re.search(r'instagram\.com/([A-Za-z0-9_.-]+)', raw)
        if m_ig_u and m_ig_u.group(1) not in ("p", "reel", "stories"):
            return {"object_id": f"@{m_ig_u.group(1)}", "platform": "instagram", "type": "username", "raw": raw}

    return {"object_id": raw, "platform": "general", "type": "raw_link", "raw": raw}


def generate_signed_url(file_type, uid, client_ip, expires_in_seconds=600):
    """
    HMAC Signed URL cho file Module / DNS Config:
    Token = hmac.new(SECRET_KEY, f"{uid}:{expires}:{client_ip}".encode(), hashlib.sha256).hexdigest()
    Hạn sử dụng mặc định: 10 phút (600s).
    """
    secret = HMAC_SECRET_KEY.encode()
    expires = int(time.time()) + int(expires_in_seconds)
    ip_str = str(client_ip or "0.0.0.0").strip()
    uid_str = str(uid or "VIP").strip()
    # Nới lỏng subnet /24 để hỗ trợ khách dùng mạng 4G/LTE
    ip_parts = ip_str.split(".")
    ip_subnet = f"{ip_parts[0]}.{ip_parts[1]}.{ip_parts[2]}.0" if len(ip_parts) == 4 else ip_str
    
    raw_payload = f"{uid_str}:{expires}:{ip_subnet}".encode()
    token = hmac.new(secret, raw_payload, hashlib.sha256).hexdigest()
    return f"/api/download/{file_type}?token={token}&expires={expires}&uid={uid_str}"


def verify_hmac_download_token(uid, expires, client_ip, token):
    """
    Kiểm tra chữ ký HMAC và hạn dùng 10 phút.
    Hỗ trợ 4G/LTE mobile: kiểm tra IP subnet /24, fallback token và bypass IP khi HMAC token hợp lệ.
    """
    if not token or not expires or not uid:
        return False, "Thiếu tham số chữ ký bảo mật (token, expires, uid)."
    
    try:
        exp_int = int(expires)
    except (ValueError, TypeError):
        return False, "Thời hạn expires không hợp lệ."
    
    # 1. Expiration Check (10 mins)
    now_ts = int(time.time())
    if now_ts > exp_int:
        return False, "Link tải đã hết hạn (hạn sử dụng 10 phút). Vui lòng tra cứu lại đơn để nhận link mới!"

    # 2. HMAC Signature Check
    secret = HMAC_SECRET_KEY.encode()
    ip_str = str(client_ip or "0.0.0.0").strip()
    uid_str = str(uid).strip()

    # Subnet /24 (3 octet đầu) cho 4G/LTE
    ip_parts = ip_str.split(".")
    ip_subnet = f"{ip_parts[0]}.{ip_parts[1]}.{ip_parts[2]}.0" if len(ip_parts) == 4 else ip_str

    # Candidate payloads hỗ trợ cả subnet /24, exact IP, fallback proxy và bypass IP
    candidate_payloads = [
        f"{uid_str}:{exp_int}:{ip_subnet}".encode(),
        f"{uid_str}:{exp_int}:{ip_str}".encode(),
        f"{uid_str}:{exp_int}:0.0.0.0".encode(),
        f"{uid_str}:{exp_int}".encode()
    ]

    for payload in candidate_payloads:
        candidate_token = hmac.new(secret, payload, hashlib.sha256).hexdigest()
        if hmac.compare_digest(token, candidate_token):
            return True, "Hợp lệ"

    return False, "Chữ ký HMAC không hợp lệ hoặc đã hết hạn!"


def generate_hmac_video_token(order_id):
    secret = HMAC_SECRET_KEY.encode()
    oid = str(order_id or '').strip().upper()
    return hmac.new(secret, f'video:{oid}'.encode(), hashlib.sha256).hexdigest()

def verify_hmac_video_token(order_id, token, order_token=None):
    if not token or not order_id:
        return False
    tok_clean = str(token).strip()
    if order_token and hmac.compare_digest(tok_clean, str(order_token).strip()):
        return True
    secret = HMAC_SECRET_KEY.encode()
    oid = str(order_id).strip().upper()
    expected1 = hmac.new(secret, f'video:{oid}'.encode(), hashlib.sha256).hexdigest()
    if hmac.compare_digest(tok_clean, expected1):
        return True
    expected2 = hmac.new(secret, oid.encode(), hashlib.sha256).hexdigest()
    if hmac.compare_digest(tok_clean, expected2):
        return True
    if order_token:
        expected3 = hmac.new(secret, f'{oid}:{str(order_token).strip()}'.encode(), hashlib.sha256).hexdigest()
        if hmac.compare_digest(tok_clean, expected3):
            return True
    return False
