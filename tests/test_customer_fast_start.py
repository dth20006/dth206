import app as app_module
from app import app


def test_enabled_announcement_is_rendered_open_without_waiting_for_api(monkeypatch):
    announcement = {
        "enabled": True,
        "title": "Thông báo bảo trì",
        "content": "Chung Sức dự kiến sáng ngày mai.",
        "updated_at": 1234567890,
    }
    monkeypatch.setattr(app_module.config_manager, "get_popup_announcement", lambda: announcement)
    monkeypatch.setattr(
        app_module,
        "get_services_enabled",
        lambda *_args: {"chungsuc": True, "locket": True, "mxh": True, "premium": True},
    )
    monkeypatch.setattr(app_module, "is_sale_active", lambda: (False, 0))

    response = app.test_client().get("/")

    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert 'id="popupAnnouncementModal" style="display: flex;"' in html
    assert "Chung Sức dự kiến sáng ngày mai." in html
    assert "window.dthPopupAnnouncement" in html


def test_locket_uid_input_skips_profile_lookup(monkeypatch):
    uid = "a" * 28

    class DirectUidLocketAPI:
        def get_full_profile(self, _username):
            raise AssertionError("A direct UID must not trigger username profile resolution")

        def check_subscriber_gold(self, _uid):
            return False

    monkeypatch.setattr(app_module, "LocketAPI", DirectUidLocketAPI)
    monkeypatch.setattr(app_module, "check_locket_already_purchased", lambda *_args: (False, None))

    response = app.test_client().post("/api/locket/user-info", json={"username": uid})

    assert response.status_code == 200
    assert response.get_json()["user"]["uid"] == uid
