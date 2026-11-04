import pytest
import models
from utils import generate_order_id, clean_locket_username, extract_invite_code, format_currency_vnd

def test_order_id_generation():
    oid1 = generate_order_id("LK")
    oid2 = generate_order_id("LK")
    assert oid1.startswith("LK")
    assert oid2.startswith("LK")
    assert oid1 != oid2
    assert oid1.isalnum()

def test_clean_locket_username():
    assert clean_locket_username("@dth206") == "dth206"
    assert clean_locket_username("https://locket.camera/links/user.dth") == "user.dth"
    assert clean_locket_username("  @my_user.123  ") == "my_user.123"

def test_extract_invite_code():
    text1 = "Giúp tôi với -- ABC123DEF -- nhanh lên"
    assert extract_invite_code(text1) == "ABC123DEF"
    text2 = "https://lienquan.garena.vn/?code=XYZ789"
    assert extract_invite_code(text2) == "XYZ789"

def test_format_currency_vnd():
    assert format_currency_vnd(30000) == "30.000đ"
    assert format_currency_vnd(0) == "0đ"
