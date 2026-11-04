import time

from app import app
from config_manager import config_manager


def test_admin_page_and_orders_require_authentication():
    client = app.test_client()

    page = client.get("/admin")
    assert page.status_code == 200
    assert b"adminLoginForm" in page.data
    assert b"adminLayout" not in page.data
    assert b"dth.sgmodule" not in page.data
    assert client.get("/api/admin/orders").status_code == 401
    assert client.get("/api/admin/check-auth").status_code == 401


def test_admin_login_sets_expiring_http_only_session(monkeypatch):
    monkeypatch.setenv("ADMIN_PASSWORD", "test-admin-password")
    client = app.test_client()

    response = client.post("/api/admin/login", json={"password": "test-admin-password"})
    assert response.status_code == 200
    assert "HttpOnly" in response.headers["Set-Cookie"]

    auth = client.get("/api/admin/check-auth")
    assert auth.status_code == 200
    assert auth.get_json()["expires_at"] > time.time()
    assert b"adminLayout" in client.get("/admin").data

    with client.session_transaction() as admin_session:
        admin_session["admin_expires_at"] = time.time() - 1
    assert client.get("/api/admin/orders").status_code == 401
    assert b"adminLayout" not in client.get("/admin").data


def test_admin_login_fails_closed_without_configured_password(monkeypatch):
    monkeypatch.delenv("ADMIN_PASSWORD", raising=False)
    monkeypatch.setattr(config_manager, "_data", {})

    response = app.test_client().post("/api/admin/login", json={"password": "admin"})
    assert response.status_code == 503


def test_admin_stats_matches_dashboard_data_contract(monkeypatch):
    monkeypatch.setenv("ADMIN_PASSWORD", "test-admin-password")
    client = app.test_client()
    assert client.post("/api/admin/login", json={"password": "test-admin-password"}).status_code == 200

    response = client.get("/api/admin/stats")

    assert response.status_code == 200
    data = response.get_json()
    assert {"all", "chungsuc", "locket", "mxh", "premium"} <= data["counts"].keys()
    assert "PENDING" in data["status_counts"]
    assert {"chungsuc", "locket", "mxh", "premium"} <= data["rev_by_type"].keys()
    assert client.get("/api/admin/unmatched-transactions").status_code == 200
