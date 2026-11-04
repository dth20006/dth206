import base64
from datetime import datetime
import json
import os
import re
import sys
import time
import uuid
import requests
from config_manager import config_manager, decode_jwt_payload


def safe_print(*args, **kwargs):
    """Safely prints to stdout without raising UnicodeEncodeError on Windows."""
    try:
        print(*args, **kwargs)
    except UnicodeEncodeError:
        try:
            safe_args = [
                str(a).encode(sys.stdout.encoding or "utf-8", errors="replace")
                       .decode(sys.stdout.encoding or "utf-8")
                for a in args
            ]
            print(*safe_args, **kwargs)
        except Exception:
            pass


class LocketAPIError(RuntimeError):
    def __init__(self, status_code, message):
        self.status_code = status_code
        super().__init__(message)

def clean_locket_username(val):
    """
    Tự động chuẩn hóa username Locket:
    Nếu khách dán cả link (@https://locket.cam/tolatduong, https://locket.cam/tolatduong, v.v.),
    hàm sẽ tự động trích xuất chỉ phần username (tolatduong) và loại bỏ toàn bộ link thừa.
    """
    if not val:
        return ""
    s = str(val).strip()

    # 1. Trích xuất username từ link locket.cam hoặc locket.camera ở bất kỳ đâu trong chuỗi
    link_match = re.search(r'(?:https?:\/\/)?(?:www\.)?locket\.(?:cam|camera)\/(?:[^\s\/?#]+\/)*([a-zA-Z0-9_.-]+)', s, re.IGNORECASE)
    if link_match:
        extracted = link_match.group(1).lstrip("@")
        if extracted.lower() not in ("u", "user", "friend", "invite", "share"):
            return extracted

    # 2. Xóa các tiền tố @, giao thức http/https, tên miền, query params, slashes
    s = re.sub(r"^@+", "", s).strip()
    s = re.sub(r"^[a-zA-Z0-9+.-]+://", "", s)
    s = re.sub(r"^(?:www\.)?locket\.(?:cam|camera)/?", "", s, flags=re.IGNORECASE)
    s = s.split("?")[0].split("#")[0].strip()
    if "/" in s:
        segments = [seg for seg in s.split("/") if seg.strip()]
        if segments:
            s = segments[-1]

    s = re.sub(r"^@+", "", s).strip()
    s = re.sub(r"[^A-Za-z0-9_.-]", "", s)
    return s


# Modern Locket 5.89.0 (Build 2716) iOS Network Headers (StoreKit 2)
_RC_HEADERS = {
    "Host": "api.revenuecat.com",
    "Authorization": "Bearer appl_JngFETzdodyLmCREOlwTUtXdQik",
    "Content-Type": "application/json",
    "Accept": "*/*",
    "X-Platform": "iOS",
    "X-Platform-Version": "Version 27.0.1 (Build 24A446)",
    "X-Platform-Device": "iPhone13,4",
    "X-Platform-Flavor": "native",
    "X-Version": "5.89.0",
    "X-Client-Version": "2.69.0",
    "X-Client-Bundle-ID": "com.locket.Locket",
    "X-Client-Build-Version": "2716",
    "X-StoreKit2-Enabled": "true",
    "X-StoreKit-Version": "2",
    "X-Observer-Mode-Enabled": "false",
    "X-Installation-Method": "spm",
    "X-Is-Sandbox": "false",
    "X-Storefront": "VNM",
    "X-Apple-Device-Identifier": "562923EB-8B4F-4FD6-AFAE-867625AF5D92",
    "X-Preferred-Locales": "vi_VN",
    "X-Is-Backgrounded": "false",
    "X-Retry-Count": "0",
    "X-Is-Debug-Build": "false",
    "User-Agent": "Locket/2716 CFNetwork/3896.100.1.2.1 Darwin/27.0.0",
    "Accept-Language": "vi-VN,vi;q=0.9",
    "Connection": "keep-alive",
    "X-RevenueCat-ETag": "",
    "baggage": "sentry-environment=production,sentry-public_key=78fa64317f434fd89d9cc728dd168f50,sentry-release=com.locket.Locket%402.69.0%2B2716,sentry-trace_id=8ad8277b304448f89d30a48ce6f01d09",
    "sentry-trace": "8ad8277b304448f89d30a48ce6f01d09-9f7fbeda950548ae-0",
}


def _generate_nonce():
    """Generate exact 12-byte base64 nonce as required by RevenueCat/Locket."""
    return base64.b64encode(os.urandom(12)).decode("utf-8")


def _make_get_headers(bearer=None, sandbox=False, hash_headers=None):
    h = _RC_HEADERS.copy()
    h["X-Nonce"] = _generate_nonce()
    h["X-Apple-Device-Identifier"] = str(uuid.uuid4()).upper()
    h["X-Is-Sandbox"] = "true" if sandbox else "false"
    if bearer:
        h["Authorization"] = bearer if bearer.startswith("Bearer ") else "Bearer " + bearer
    if hash_headers:
        h["X-Headers-Hash"] = hash_headers.strip()
    return h


def _make_post_headers(bearer=None, sandbox=False, hash_params=None,
                       hash_headers=None, strip_hashes=False):
    h = _RC_HEADERS.copy()
    h["X-Nonce"] = _generate_nonce()
    h["X-Apple-Device-Identifier"] = str(uuid.uuid4()).upper()
    h["X-Is-Sandbox"] = "true" if sandbox else "false"
    if bearer:
        h["Authorization"] = bearer if bearer.startswith("Bearer ") else "Bearer " + bearer
    if not strip_hashes:
        if hash_params:
            h["X-Post-Params-Hash"] = hash_params.strip()
        if hash_headers:
            h["X-Headers-Hash"] = hash_headers.strip()
    else:
        h.pop("X-Post-Params-Hash", None)
        h.pop("X-Headers-Hash", None)
    return h
PROFILE_CACHE_FILE = (
    "/tmp/profile_cache.json"
    if os.environ.get("VERCEL")
    else os.path.join(os.path.dirname(__file__), "profile_cache.json")
)


def _load_profile_cache():
    if not os.path.exists(PROFILE_CACHE_FILE):
        return {}
    try:
        with open(PROFILE_CACHE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_profile_cache(cache):
    try:
        with open(PROFILE_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False, indent=2)
    except Exception as e:
        safe_print(f"[_save_profile_cache] Error: {e}")


def get_cached_profile(username):
    if not username:
        return None
    cache = _load_profile_cache()
    return cache.get(username.strip().lstrip("@").lower())


def set_cached_profile(username, profile):
    if not username or not profile:
        return
    username_key = clean_locket_username(username).lower()
    if profile.get("username"):
        profile["username"] = clean_locket_username(profile["username"])
    cache = _load_profile_cache()
    existing = cache.get(username_key, {})
    merged = existing.copy()
    for k, v in profile.items():
        if v not in (None, "") or k not in merged:
            merged[k] = v
    cache[username_key] = merged
    _save_profile_cache(cache)


class LocketAPI:
    def __init__(self, token=None):
        self.token = token

    def resolve_profile(self, username):
        """Resolve a Locket username to its UID and public profile picture."""
        if not username:
            return None
        username = username.strip().lstrip("@")
        if not username:
            return None

        url = f"https://locket.cam/{username}"
        headers = {
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
            "Accept": "text/html",
        }

        def extract_uid(text):
            if not text:
                return None
            match = re.search(r"/invites/([A-Za-z0-9]{28})", text)
            if match:
                return match.group(1)
            link_match = re.search(r"link=([^\s\"'>]+)", text)
            if link_match:
                try:
                    decoded = link_match.group(1).replace("%3A", ":").replace("%2F", "/")
                    decoded_match = re.search(r"/invites/([A-Za-z0-9]{28})", decoded)
                    if decoded_match:
                        return decoded_match.group(1)
                except Exception:
                    pass
            return None

        def extract_pic(text):
            if not text:
                return None
            match = re.search(
                r"(https://cdn2\.locketcamera\.com/[^\"'\s]+?profile_pic\.(?:webp|png|jpg|jpeg)\?[^\"'\s]+)",
                text,
            )
            if match:
                return match.group(1).replace("&amp;", "&")
            return None

        try:
            response = requests.get(url, headers=headers, allow_redirects=True, timeout=15)
        except Exception as e:
            safe_print(f"[resolve_profile] Network error for {username}: {e}")
            return None

        html = response.text
        uid = extract_uid(str(response.url)) or extract_uid(html)
        if not uid:
            return None

        return {"uid": uid, "profile_picture_url": extract_pic(html)}

    def resolve_uid(self, username):
        """Helper returning only the UID string with robust multi-layer resolution."""
        if not username:
            return None
        clean = str(username).strip().lstrip("@")
        if not clean:
            return None

        # 1. Direct Firebase UID check (Firebase UIDs are 28 alphanumeric characters)
        if re.match(r"^[A-Za-z0-9_-]{28}$", clean):
            return clean

        # 2. Check local profile cache
        try:
            cached = get_cached_profile(clean)
            if cached and cached.get("uid"):
                return cached["uid"]
        except Exception:
            pass

        # 3. Fast check via resolve_profile (locket.cam scraper)
        try:
            profile = self.resolve_profile(clean)
            if profile and profile.get("uid"):
                return profile["uid"]
        except Exception:
            pass

        # 4. Comprehensive fallback via get_full_profile (RPC + CTV resolvers)
        try:
            full_prof = self.get_full_profile(clean)
            if full_prof and full_prof.get("uid"):
                return full_prof["uid"]
        except Exception:
            pass

        return None

    def _call_locket_rpc(self, endpoint, payload, locket_bearer, appcheck="", iid_token=""):
        """Helper to call api.locketcamera.com RPC endpoints with curl + requests fallback."""
        import subprocess
        import shutil

        if not locket_bearer.lower().startswith("bearer "):
            locket_bearer = f"Bearer {locket_bearer}"

        url = f"https://api.locketcamera.com/{endpoint.lstrip('/')}"
        headers = {
            "Accept": "*/*",
            "Authorization": locket_bearer,
            "Content-Type": "application/json",
            "Accept-Language": "vi-VN,vi;q=0.9",
            "User-Agent": "com.locket.Locket/2.68.0 iPhone/27.0.1 hw/iPhone13_4",
            "baggage": (
                "sentry-environment=production,"
                "sentry-public_key=78fa64317f434fd89d9cc728dd168f50,"
                "sentry-release=com.locket.Locket%402.68.0%2B2523,"
                "sentry-trace_id=4cda56e002c94bacb835f7a65a321b0d"
            ),
            "sentry-trace": "4cda56e002c94bacb835f7a65a321b0d-44355e82c53a45c4-0",
        }
        if appcheck:
            headers["X-Firebase-AppCheck"] = appcheck
        if iid_token:
            headers["firebase-instance-id-token"] = iid_token

        body_str = json.dumps(payload, ensure_ascii=False)
        curl_bin = shutil.which("curl.exe") or shutil.which("curl")
        jdata = None

        if curl_bin:
            curl_cmd = [
                curl_bin, "-s", url,
                "-H", f"authorization: {locket_bearer}",
                "-H", "content-type: application/json",
                "-H", "accept: */*",
                "-H", "accept-language: vi-VN,vi;q=0.9",
                "-H", "user-agent: com.locket.Locket/2.68.0 iPhone/27.0.1 hw/iPhone13_4",
                "-H", f"baggage: {headers['baggage']}",
                "-H", f"sentry-trace: {headers['sentry-trace']}",
                "--data-raw", body_str,
            ]
            if appcheck:
                curl_cmd.extend(["-H", f"x-firebase-appcheck: {appcheck}"])
            if iid_token:
                curl_cmd.extend(["-H", f"firebase-instance-id-token: {iid_token}"])
            try:
                proc = subprocess.run(
                    curl_cmd,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=8,
                )
                if proc.returncode == 0 and proc.stdout:
                    jdata = json.loads(proc.stdout)
            except Exception:
                pass

        if not jdata:
            try:
                res = requests.post(
                    url,
                    headers=headers,
                    data=body_str.encode("utf-8"),
                    timeout=8,
                )
                try:
                    jdata = res.json()
                except Exception:
                    jdata = None
            except Exception:
                pass

        return jdata

    def get_full_profile(self, username):
        """Get full profile info for a username with real Locket display name."""
        if not username:
            return None
        clean_user = clean_locket_username(username)
        if not clean_user:
            return None

        # 1. Check local profile cache first
        cached = get_cached_profile(clean_user) or {}
        display_name = (cached.get("display_name") or cached.get("displayName") or "").strip()
        first_name = (cached.get("first_name") or "").strip()
        last_name = (cached.get("last_name") or "").strip()
        uid = (cached.get("uid") or "").strip()
        pic = cached.get("profile_picture_url") or cached.get("avatarUrl")
        badge = cached.get("badge")
        real_username = cached.get("username") or clean_user

        # 2. Direct Locket API lookup if locket_bearer is configured
        tokens = config_manager.get_api_tokens()
        locket_bearer = (tokens.get("locket_bearer") or "").strip()
        appcheck = (tokens.get("firebase_appcheck") or "").strip()
        iid_token = (
            tokens.get("firebase_instance_id_token")
            or "eWl1m6efzs1y_lZxYi_P4N:APA91bF1T3gRZ93UlCJFf-3_m6AnQjLt_EVkyXxlSP5GH5N3hR0ctEjUW6crqLrkIA-lXjZTK1o3x0nImAEX78sTMUx-OWCOn7WQ1XgNvuXpRt6k0F5pJe4"
        ).strip()

        # Proactively check if locket_bearer JWT is expired
        if locket_bearer:
            raw_jwt = re.sub(r"^Bearer\s+", "", locket_bearer, flags=re.IGNORECASE).strip()
            jwt_payload = decode_jwt_payload(raw_jwt) or {}
            if jwt_payload.get("exp") and int(jwt_payload["exp"]) < (time.time() + 30):
                new_token = config_manager.refresh_locket_token()
                if new_token:
                    locket_bearer = f"Bearer {new_token}"

        # Check if firebase_appcheck JWT is already expired; if expired, omit it first
        active_appcheck = appcheck
        if appcheck:
            ac_payload = decode_jwt_payload(appcheck) or {}
            if ac_payload.get("exp") and int(ac_payload["exp"]) < time.time():
                active_appcheck = ""

        def parse_user_obj(jdata):
            if not jdata or not isinstance(jdata, dict) or jdata.get("error"):
                return None
            res_obj = jdata.get("result") or {}
            if isinstance(res_obj, dict) and isinstance(res_obj.get("data"), dict):
                return res_obj.get("data")
            if isinstance(res_obj, dict) and res_obj.get("uid"):
                return res_obj
            if isinstance(jdata.get("data"), dict) and jdata["data"].get("uid"):
                return jdata["data"]
            return None

        if locket_bearer:
            try:
                rpc_payload = {
                    "data": {
                        "username": clean_user,
                        "analytics": {
                            "platform": "ios",
                            "amplitude": {
                                "device_id": "562923EB-8B4F-4FD6-AFAE-867625AF5D92",
                                "session_id": {
                                    "@type": "type.googleapis.com/google.protobuf.Int64Value",
                                    "value": str(int(time.time() * 1000)),
                                },
                            },
                            "experiments": {
                                "flag_18": {"@type": "type.googleapis.com/google.protobuf.Int64Value", "value": "1203"},
                                "flag_7": {"@type": "type.googleapis.com/google.protobuf.Int64Value", "value": "802"},
                                "flag_10": {"@type": "type.googleapis.com/google.protobuf.Int64Value", "value": "505"},
                                "flag_15": {"@type": "type.googleapis.com/google.protobuf.Int64Value", "value": "5010"},
                                "flag_5": {"@type": "type.googleapis.com/google.protobuf.Int64Value", "value": "400"},
                                "flag_14": {"@type": "type.googleapis.com/google.protobuf.Int64Value", "value": "502"},
                                "flag_4": {"@type": "type.googleapis.com/google.protobuf.Int64Value", "value": "43"},
                                "flag_25": {"@type": "type.googleapis.com/google.protobuf.Int64Value", "value": "1615022162"},
                                "flag_9": {"@type": "type.googleapis.com/google.protobuf.Int64Value", "value": "21"},
                                "flag_22": {"@type": "type.googleapis.com/google.protobuf.Int64Value", "value": "1203"},
                                "flag_16": {"@type": "type.googleapis.com/google.protobuf.Int64Value", "value": "521"},
                                "flag_8": {"@type": "type.googleapis.com/google.protobuf.Int64Value", "value": "29"},
                            },
                            "installation_id": iid_token.split(":")[0],
                            "google_analytics": {
                                "app_instance_id": "BB6E194810104617A608015EAF002F32"
                            },
                            "ios_version": "2.68.0.2523",
                        },
                    }
                }

                jdata = self._call_locket_rpc(
                    "getUserByUsername", rpc_payload, locket_bearer, active_appcheck, iid_token
                )

                # Retry without AppCheck or after refreshing Bearer token on error
                if not jdata or (isinstance(jdata, dict) and jdata.get("error")):
                    err_status = (jdata or {}).get("error", {}).get("status", "")
                    if err_status in ("UNAUTHENTICATED", "PERMISSION_DENIED") or not jdata:
                        new_token = config_manager.refresh_locket_token()
                        if new_token:
                            locket_bearer = f"Bearer {new_token}"
                        jdata = self._call_locket_rpc(
                            "getUserByUsername", rpc_payload, locket_bearer, "", iid_token
                        )

                user_data = parse_user_obj(jdata)
                if user_data and user_data.get("uid"):
                    uid = user_data["uid"]
                    first_name = (user_data.get("first_name") or "").strip()
                    last_name = (user_data.get("last_name") or "").strip()
                    combined = f"{first_name} {last_name}".strip()
                    raw_dn = (user_data.get("display_name") or user_data.get("name") or "").strip()
                    display_name = raw_dn or combined or first_name or last_name or display_name
                    pic = user_data.get("profile_picture_url") or pic
                    badge = user_data.get("badge") or badge
                    real_username = user_data.get("username") or real_username
            except Exception as e:
                safe_print(f"[get_full_profile] direct Locket API error: {e}")

        # 3. Query external CTV/Locket userinfo resolvers if real name is still needed
        is_real_name = display_name and display_name.lower() != clean_user.lower()
        if not is_real_name or not uid or not pic:
            lookup_urls = [
                f"https://ctv.nodns.vn/api/v1/userinfo?user={clean_user}",
                f"https://locketgold.vn/api/v1/userinfo?user={clean_user}",
                f"https://locketgold.shop/api/v1/ctv/userinfo?user={clean_user}",
            ]
            user_not_found = False
            for url in lookup_urls:
                if user_not_found:
                    break
                try:
                    res = requests.get(url, timeout=3, headers={
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                        "Accept": "application/json"
                    })
                    if res.status_code == 404:
                        user_not_found = True
                        break
                    if res.ok:
                        d = res.json() or {}
                        if d.get("status") == "error" and d.get("code") == 404:
                            user_not_found = True
                            break
                        raw_dn = (d.get("displayName") or d.get("full_name") or d.get("name") or "").strip()
                        raw_fn = (d.get("first_name") or "").strip()
                        raw_ln = (d.get("last_name") or "").strip()
                        raw_uid = (d.get("uid") or "").strip()
                        raw_pic = d.get("avatarUrl") or d.get("profile_picture_url")
                        raw_badge = d.get("badge")

                        if raw_uid and not uid:
                            uid = raw_uid
                        if raw_pic and not pic:
                            pic = raw_pic
                        if raw_badge and not badge:
                            badge = raw_badge
                        if raw_fn or raw_ln:
                            first_name = raw_fn or first_name
                            last_name = raw_ln or last_name

                        if raw_dn and raw_dn.lower() != clean_user.lower():
                            display_name = raw_dn
                            if not first_name:
                                first_name = raw_dn
                            break
                except requests.exceptions.Timeout:
                    pass
                except Exception as e:
                    safe_print(f"[get_full_profile] lookup error for {url}: {e}")

        # 4. Fallback resolve via locket.cam scraper if UID or avatar is still missing
        if not uid or not pic:
            profile = self.resolve_profile(clean_user)
            if profile:
                uid = uid or profile.get("uid")
                pic = pic or profile.get("profile_picture_url")

        # 5. If UID is resolved (from locket.cam/cache) but display_name is still missing, call fetchUserV2 by UID
        if uid and (not display_name or display_name.lower() == clean_user.lower()) and locket_bearer:
            try:
                jdata_v2 = self._call_locket_rpc(
                    "fetchUserV2",
                    {"data": {"user_uid": uid}},
                    locket_bearer,
                    active_appcheck,
                    iid_token,
                )
                user_v2 = parse_user_obj(jdata_v2)
                if user_v2:
                    first_name = (user_v2.get("first_name") or first_name or "").strip()
                    last_name = (user_v2.get("last_name") or last_name or "").strip()
                    combined = f"{first_name} {last_name}".strip()
                    display_name = (user_v2.get("display_name") or combined or first_name or last_name or display_name).strip()
                    pic = user_v2.get("profile_picture_url") or pic
                    badge = user_v2.get("badge") or badge
                    real_username = user_v2.get("username") or real_username
            except Exception as e:
                safe_print(f"[get_full_profile] fetchUserV2 fallback error: {e}")

        if not uid:
            return None

        if not pic:
            pic = (
                f"https://firebasestorage.googleapis.com:443/v0/b/locket-img/o/"
                f"users%2F{uid}%2Fpublic%2Fprofile_pic.webp?alt=media"
            )

        if pic and ":443" in pic:
            pic = pic.replace(".googleapis.com:443", ".googleapis.com")

        if not display_name:
            if first_name or last_name:
                display_name = f"{first_name} {last_name}".strip() or first_name or last_name

        profile_data = {
            "uid": uid,
            "first_name": first_name,
            "last_name": last_name,
            "display_name": display_name,
            "profile_picture_url": pic,
            "username": clean_locket_username(real_username),
            "badge": badge,
        }

        if (display_name and display_name.lower() != clean_user.lower()) or uid:
            set_cached_profile(clean_user, profile_data)

        return profile_data

    def check_subscriber_gold(self, uid):
        """Check the current Gold entitlement of a subscriber on RevenueCat."""
        url = f"https://api.revenuecat.com/v1/subscribers/{uid}"
        bearer = (
            config_manager.get_api_tokens().get("revenuecat_bearer")
            or ""
        )
        headers = _make_get_headers(bearer=bearer)
        try:
            res = requests.get(url, headers=headers, timeout=15)
            if res.ok:
                data = res.json()
                gold = data.get("subscriber", {}).get("entitlements", {}).get("Gold")
                if gold:
                    expires_date = gold.get("expires_date")
                    is_active = True
                    if expires_date:
                        try:
                            exp_dt = datetime.strptime(expires_date[:19], "%Y-%m-%dT%H:%M:%S")
                            is_active = exp_dt.timestamp() > time.time()
                        except Exception:
                            pass
                    return {
                        "has_gold": True,
                        "is_active": is_active,
                        "expires_date": expires_date,
                        "product_identifier": gold.get("product_identifier"),
                    }
                return {"has_gold": False, "is_active": False, "expires_date": None, "product_identifier": None}
        except Exception as e:
            safe_print(f"[check_subscriber_gold] error: {e}")
        return {"has_gold": False, "is_active": False, "expires_date": None, "product_identifier": None}

    def _build_payload(self, uid, token_config):
        """Build the exact POST /v1/receipts payload matching real Locket 5.89.0 iOS app."""
        fetch_token = re.sub(r"[\s\r\n]+", "", str(token_config.get("fetch_token", "")))
        app_transaction = re.sub(r"[\s\r\n]+", "", str(token_config.get("app_transaction", "")))

        # Auto-detect if fetch_token and app_transaction are swapped
        ft_payload = decode_jwt_payload(fetch_token) or {}
        at_payload = decode_jwt_payload(app_transaction) or {}
        if "receiptType" in ft_payload and "transactionId" in at_payload:
            fetch_token, app_transaction = app_transaction, fetch_token
            ft_payload, at_payload = at_payload, ft_payload

        transaction_id = str(token_config.get("transaction_id") or ft_payload.get("transactionId") or "570002518164026").strip()
        product_id = str(token_config.get("product_id") or ft_payload.get("productId") or "locket_199_1m").strip()
        currency = str(token_config.get("currency") or "VND").strip()
        price = str(token_config.get("price") or "49000").strip()
        store_country = str(token_config.get("store_country") or "VNM").strip()
        sub_group_id = str(token_config.get("subscription_group_id") or "21419447").strip()

        # Exact key layout from modern Locket 5.89.0 iOS capture in locket-gold-master-main
        return {
            "app_user_id": uid,
            "initiation_source": "restore",
            "payload_version": 1,
            "currency": currency,
            "observer_mode": False,
            "app_transaction": app_transaction,
            "fetch_token": fetch_token,
            "store_country": store_country,
            "sdk_originated": False,
            "offers": [],
            "transaction_id": transaction_id,
            "subscription_group_id": sub_group_id,
            "purchase_completed_by": "revenuecat",
            "attributes": {
                "$attConsentStatus": {
                    "value": "denied",
                    "updated_at_ms": int(time.time() * 1000),
                }
            },
            "normal_duration": "P1M",
            "is_restore": True,
            "price": price,
            "product_id": product_id,
        }

    def _do_restore_request(self, uid, token_config, strip_hashes=False):
        """Send POST /v1/receipts and return parsed JSON. Raises LocketAPIError on failure."""
        url = "https://api.revenuecat.com/v1/receipts"

        bearer = (
            token_config.get("revenuecat_bearer")
            or config_manager.get_api_tokens().get("revenuecat_bearer")
            or ""
        )
        is_sandbox = bool(token_config.get("is_sandbox", False))
        hash_params = token_config.get("hash_params")
        hash_headers = token_config.get("hash_headers")

        payload_dict = self._build_payload(uid, token_config)
        payload_bytes = json.dumps(payload_dict, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

        last_error = None
        for attempt in range(3):
            headers = _make_post_headers(
                bearer=bearer,
                sandbox=is_sandbox,
                hash_params=hash_params,
                hash_headers=hash_headers,
                strip_hashes=strip_hashes,
            )
            headers["Content-Length"] = str(len(payload_bytes))

            try:
                response = requests.post(url, headers=headers, data=payload_bytes, timeout=30)
            except requests.exceptions.RequestException as e:
                last_error = e
                safe_print(f"[restorePurchase] Attempt {attempt + 1}/3 network error: {e}")
                if attempt < 2:
                    time.sleep(2)
                continue

            sc = response.status_code
            safe_print(f"[restorePurchase] Attempt {attempt + 1}/3 -> HTTP {sc}")

            if sc == 529 or (500 <= sc < 600):
                last_error = f"HTTP {sc}"
                if attempt < 2:
                    safe_print(f"[restorePurchase] Server busy ({sc}). Retrying in 2s...")
                    time.sleep(2)
                    continue

            # Robust JSON decoding with fallback for brotli/gzip
            data = None
            try:
                content = response.content
                if response.headers.get("Content-Encoding") == "br":
                    try:
                        import brotli
                        content = brotli.decompress(content)
                    except Exception:
                        pass
                data = json.loads(content.decode("utf-8", errors="replace"))
            except Exception:
                try:
                    data = response.json()
                except Exception:
                    data = {}

            if response.ok:
                return data or {}

            detail = response.text[:500] if response.text else "(empty)"
            raise LocketAPIError(sc, f"RevenueCat HTTP {sc}: {detail}")

        raise LocketAPIError(0, f"RevenueCat failed after 3 attempts: {last_error}")

    def restorePurchase(self, uid, token_config=None):
        """Restore/inject Gold for a UID using active token sets with multi-strategy bypass.
        Directly aligned with locket-gold-master-main logic:
        1. All tokens in Standard Mode
        2. All tokens in Strip-Hash Mode
        3. Real entitlement verification via check_subscriber_gold (requires active status)
        """
        if token_config:
            tokens_to_try = [token_config]
        else:
            tokens_to_try = config_manager.get_active_token_sets()

        if not tokens_to_try:
            raise LocketAPIError(
                400,
                "Không có API Token nào được kích hoạt. Vào trang Admin để thêm token.",
            )

        # Build list of strategies:
        # If uid matches the account that generated the token, Standard can go first.
        # Otherwise, Strip-Hash MUST go first to avoid unnecessary 400 parameter hash mismatch errors.
        strategies = []
        for i, t in enumerate(tokens_to_try):
            t_orig_uid = t.get("app_user_id") or config_manager.get_api_tokens().get("locket_account_uid", "")
            if uid and t_orig_uid and uid == t_orig_uid:
                strategies.append({"token": t, "strip": False, "label": f"{t.get('name', f'Token #{i+1}')} Standard"})
                strategies.append({"token": t, "strip": True, "label": f"{t.get('name', f'Token #{i+1}')} Strip-Hash"})
            else:
                strategies.append({"token": t, "strip": True, "label": f"{t.get('name', f'Token #{i+1}')} Strip-Hash"})
                strategies.append({"token": t, "strip": False, "label": f"{t.get('name', f'Token #{i+1}')} Standard"})

        last_exc = None
        for strat in strategies:
            t_conf = strat["token"]
            t_name = t_conf.get("name", "Unnamed")
            t_id = t_conf.get("id")
            strip_mode = strat["strip"]
            mode_label = strat["label"]

            safe_print(f"[*] Starting Strategy: {mode_label} for {uid}...")
            try:
                res = self._do_restore_request(uid, t_conf, strip_hashes=strip_mode)
                safe_print(f"[+] HTTP 200 OK. Verifying Gold status on RevenueCat for {uid}...")

                # 1. Fast verification directly in POST response
                gold_ent = (res or {}).get("subscriber", {}).get("entitlements", {}).get("Gold")
                is_active = False
                exp_date = "N/A"
                prod_id = t_conf.get("product_id") or "locket_199_1m"

                if gold_ent:
                    exp_date = gold_ent.get("expires_date") or "N/A"
                    prod_id = gold_ent.get("product_identifier") or prod_id
                    is_active = True
                    if exp_date and exp_date != "N/A":
                        try:
                            exp_dt = datetime.strptime(exp_date[:19], "%Y-%m-%dT%H:%M:%S")
                            is_active = exp_dt.timestamp() > time.time()
                        except Exception:
                            pass

                # 2. Secondary check via check_subscriber_gold if not confirmed in response
                if not is_active:
                    safe_print(f"[*] Secondary check via GET replica for {uid}...")
                    gold_status = self.check_subscriber_gold(uid)
                    if not gold_status or not gold_status.get("is_active"):
                        time.sleep(1.5)
                        gold_status = self.check_subscriber_gold(uid)
                    if gold_status and gold_status.get("is_active"):
                        is_active = True
                        exp_date = gold_status.get("expires_date", exp_date)
                        prod_id = gold_status.get("product_identifier") or prod_id

                if is_active:
                    safe_print(f"[SUCCESS] Gold entitlement activated! (Hạn: {exp_date})")

                    if t_id:
                        config_manager.update_token_set(t_id, {
                            "last_tested": datetime.now().strftime("%d/%m %H:%M"),
                            "test_status": "200_OK",
                        })

                    return {
                        "success": True,
                        "uid": uid,
                        "product_identifier": prod_id,
                        "expires_date": exp_date,
                        "is_active": True,
                        "token_name": t_name,
                        "mode": mode_label,
                        "raw": res,
                    }
                else:
                    exp_date = (res.get("subscriber", {}).get("entitlements", {}).get("Gold") or {}).get("expires_date", "Hết hạn")
                    safe_print(f"[!] Strategy failed: SERVER_ACCEPTED_BUT_NO_GOLD (Hạn: {exp_date})")
                    if t_id:
                        config_manager.update_token_set(t_id, {
                            "last_tested": datetime.now().strftime("%d/%m %H:%M"),
                            "test_status": "EXPIRED_NO_GOLD",
                        })
                    last_exc = LocketAPIError(400, f"Token '{t_name}' đã hết hạn chu kỳ Apple (Hạn: {exp_date}), RevenueCat không cấp Gold active (SERVER_ACCEPTED_BUT_NO_GOLD).")
                    time.sleep(1)
                    continue

            except LocketAPIError as e:
                last_exc = e
                safe_print(f"[!] Strategy failed: HTTP {e.status_code}: {e}")
                time.sleep(1)
                continue
            except Exception as e:
                last_exc = e
                safe_print(f"[!] Strategy failed: {e}")
                time.sleep(1)
                continue

        if last_exc:
            raise last_exc
        raise LocketAPIError(500, "Không thể kích hoạt Gold sau khi đã thử tất cả bypass strategies. Các Token hiện tại đã hết hạn chu kỳ Apple hoặc không hợp lệ. Vui lòng vào trang Admin để cập nhật Token mới.")


def test_restore_token(token_config, test_uid="test_user_probe"):
    """Probe RevenueCat with a token to check response code, product ID, and whether Gold is actually active."""
    api = LocketAPI()
    try:
        mode = "Standard"
        try:
            res = api._do_restore_request(test_uid, token_config, strip_hashes=False)
        except LocketAPIError as e:
            if e.status_code == 400:
                res = api._do_restore_request(test_uid, token_config, strip_hashes=True)
                mode = "Strip-Hash"
            else:
                raise e

        # Check subscriber status on RevenueCat (fast check via res first)
        gold_ent = (res or {}).get("subscriber", {}).get("entitlements", {}).get("Gold")
        is_active = False
        exp_str = ""
        prod_id = None
        if gold_ent:
            exp_str = gold_ent.get("expires_date") or ""
            prod_id = gold_ent.get("product_identifier")
            if exp_str:
                try:
                    exp_dt = datetime.strptime(exp_str[:19], "%Y-%m-%dT%H:%M:%S")
                    is_active = exp_dt.timestamp() > time.time()
                except Exception:
                    is_active = True
            else:
                is_active = True
        else:
            gold_status = api.check_subscriber_gold(test_uid)
            is_active = bool(gold_status and gold_status.get("is_active"))
            exp_str = (gold_status or {}).get("expires_date") or ""
            prod_id = (gold_status or {}).get("product_identifier")

        if not is_active:
            status_msg = f"⚠️ Token đã hết hạn chu kỳ Apple ({exp_str[:10] if exp_str else 'N/A'}). Server 200 nhưng KHÔNG cấp Gold active (SERVER_ACCEPTED_BUT_NO_GOLD)!"
            test_status = "EXPIRED_NO_GOLD"
            success = False
        else:
            status_msg = f"🟢 Token Live 200 OK ({mode}) - Quyền Gold hoạt động tốt (Hạn: {exp_str[:10] if exp_str else 'N/A'})"
            test_status = "200_OK"
            success = True

        return {
            "success": success,
            "status_code": 200,
            "is_active": is_active,
            "test_status": test_status,
            "expires_date": exp_str,
            "product_id": prod_id,
            "msg": status_msg,
            "data": res,
        }
    except LocketAPIError as e:
        return {"success": False, "status_code": e.status_code, "test_status": f"HTTP_{e.status_code}", "msg": f"HTTP {e.status_code}: {str(e)}"}
    except Exception as e:
        return {"success": False, "status_code": 0, "test_status": "ERR", "msg": f"Lỗi kết nối: {str(e)}"}


def get_mobileconfig_profile(log_callback=None, username=None):
    """Cung cấp cấu hình VIP LocketGold_DNS.mobileconfig chống quét triệt để."""
    if log_callback:
        log_callback(f"[MobileConfig] Cấp cấu hình VIP LocketGold_DNS.mobileconfig cho @{username or 'khách hàng'}")
    else:
        safe_print(f"[MobileConfig] Cấp cấu hình VIP LocketGold_DNS.mobileconfig cho @{username or 'khách hàng'}")
    return "LocketGold_dth206", "/download-config"


