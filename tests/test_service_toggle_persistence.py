import time
from datetime import datetime, timedelta
from types import SimpleNamespace

import app as app_module
import routes.admin as admin_module
from app import app


class FakeServiceDatabase:
    def __init__(self):
        self.services = {
            "chungsuc": SimpleNamespace(
                service_key="chungsuc",
                is_active=True,
                status_state="OPERATIONAL",
                maintenance_msg="",
                reopen_at=datetime.now() - timedelta(minutes=1),
                updated_at=None,
                to_dict=lambda: {
                    "service_key": "chungsuc",
                    "is_active": self.services["chungsuc"].is_active,
                    "status_state": self.services["chungsuc"].status_state,
                    "maintenance_msg": self.services["chungsuc"].maintenance_msg,
                    "reopen_at": self.services["chungsuc"].reopen_at.isoformat()
                    if self.services["chungsuc"].reopen_at
                    else None,
                    "reopen_at_ts": None,
                    "updated_at": None,
                },
            )
        }

    def query(self, _model):
        return FakeServiceQuery(self)

    def add(self, service):
        self.services[service.service_key] = service

    def commit(self):
        pass

    def rollback(self):
        pass

    def close(self):
        pass


class FakeServiceQuery:
    def __init__(self, database):
        self.database = database
        self.service_key = None

    def filter_by(self, service_key):
        self.service_key = service_key
        return self

    def first(self):
        return self.database.services.get(self.service_key)

    def all(self):
        return list(self.database.services.values())


def test_manually_disabling_service_clears_reopen_schedule_and_hides_it(monkeypatch):
    database = FakeServiceDatabase()
    monkeypatch.setattr(admin_module.models, "SessionLocal", lambda: database)
    monkeypatch.setattr(admin_module.config_manager, "get_data", lambda: {"services_enabled": {}})
    client = app.test_client()
    with client.session_transaction() as admin_session:
        admin_session["is_admin"] = True
        admin_session["admin_expires_at"] = time.time() + 3600

    response = client.post("/api/admin/services-toggle", json={"chungsuc": False})

    assert response.status_code == 200
    assert response.get_json()["services_enabled"]["chungsuc"] is False
    service = database.services["chungsuc"]
    assert service.is_active is False
    assert service.reopen_at is None

    flags = client.get("/api/public/feature-flags").get_json()["flags"]["chungsuc"]
    assert flags["is_active"] is False
    assert flags["reopen_at"] is None

    homepage = client.get("/").get_data(as_text=True)
    assert 'id="tab-chungsuc"' not in homepage
    assert 'id="mobile-tab-chungsuc"' not in homepage


def test_service_visibility_reads_persisted_status_not_stale_config(monkeypatch):
    database = FakeServiceDatabase()
    database.services["chungsuc"].is_active = False
    monkeypatch.setattr(admin_module.models, "SessionLocal", lambda: database)
    original_load_config = app_module.load_config
    monkeypatch.setattr(
        app_module,
        "load_config",
        lambda: {
            **original_load_config(),
            "services_enabled": {"chungsuc": True, "locket": True, "mxh": True, "premium": True},
        },
    )
    monkeypatch.setattr(app_module, "is_sale_active", lambda: (False, 0))

    response = app.test_client().get("/")

    assert response.status_code == 200
    assert b'id="tab-chungsuc"' not in response.data
    assert b'id="mobile-tab-chungsuc"' not in response.data


def test_premium_visibility_and_ordering_use_persisted_status(monkeypatch):
    database = FakeServiceDatabase()
    database.services["premium"] = SimpleNamespace(service_key="premium", is_active=False)
    monkeypatch.setattr(admin_module.models, "SessionLocal", lambda: database)
    monkeypatch.setattr(
        app_module,
        "load_config",
        lambda: {
            **app_module.config_manager.get_data(),
            "services_enabled": {"chungsuc": True, "locket": True, "mxh": True, "premium": True},
        },
    )

    client = app.test_client()
    services = client.get("/api/premium/services").get_json()
    order = client.post("/api/premium/order", json={"platform": "chatgpt"}).get_json()

    assert services["market_enabled"] is False
    assert order["success"] is False
    assert "tạm đóng" in order["msg"]


def test_service_toggle_route_is_registered_only_once():
    matching_rules = [rule for rule in app.url_map.iter_rules() if rule.rule == "/api/admin/services-toggle"]

    assert len(matching_rules) == 1
    assert matching_rules[0].endpoint == "admin_bp.admin_services_toggle_bp"
