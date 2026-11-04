import time
from copy import deepcopy

import app as app_module
from app import app


def admin_client():
    client = app.test_client()
    with client.session_transaction() as admin_session:
        admin_session["is_admin"] = True
        admin_session["admin_expires_at"] = time.time() + 3600
    return client


def test_saving_premium_services_preserves_unsubmitted_services_and_packages(monkeypatch):
    config = {
        "premium_services": {
            "existing": {
                "name": "Old name",
                "custom_setting": "keep",
                "packages": {
                    "existing_package": {
                        "name": "Existing package",
                        "price": 1000,
                        "vendor_code": "legacy-code",
                    }
                },
            },
            "untouched": {
                "name": "Untouched service",
                "packages": {"untouched_package": {"name": "Untouched package", "price": 2000}},
            },
        }
    }
    saved_config = deepcopy(config)

    def load_test_config():
        return deepcopy(saved_config)

    def save_test_config(updated):
        saved_config.clear()
        saved_config.update(deepcopy(updated))
        return True

    monkeypatch.setattr(app_module, "load_config", load_test_config)
    monkeypatch.setattr(app_module, "save_config", save_test_config)

    response = admin_client().post(
        "/api/admin/premium/save-all",
        json={
            "services": {
                "existing": {"name": "Updated name"},
                "new": {
                    "name": "New service",
                    "packages": {
                        "new_package": {"name": "New package", "price": 3000},
                    },
                },
            }
        },
    )

    assert response.status_code == 200
    assert response.get_json()["success"] is True
    assert saved_config["premium_services"] == {
        "existing": {
            "name": "Updated name",
            "custom_setting": "keep",
            "packages": {
                "existing_package": {
                    "name": "Existing package",
                    "price": 1000,
                    "vendor_code": "legacy-code",
                }
            },
        },
        "untouched": config["premium_services"]["untouched"],
        "new": {
            "name": "New service",
            "packages": {
                "new_package": {
                    "name": "New package",
                    "price": 3000,
                    "id": "new_package",
                    "price_formatted": "3.000đ",
                }
            },
        },
    }


def test_saving_partial_package_configs_preserves_existing_entries(monkeypatch):
    config = {
        "premium_services": {
            "chatgpt": {
                "name": "ChatGPT",
                "packages": {
                    "existing": {"name": "Existing package", "price": 1000, "custom": "keep"},
                },
            }
        },
        "chungsuc_packages": {
            "existing": {"name": "Existing CS package", "price": 4000, "turns": 2},
        },
    }
    saved_config = deepcopy(config)

    def load_test_config():
        return deepcopy(saved_config)

    def save_test_config(updated):
        saved_config.clear()
        saved_config.update(deepcopy(updated))
        return True

    monkeypatch.setattr(app_module, "load_config", load_test_config)
    monkeypatch.setattr(app_module, "save_config", save_test_config)
    client = admin_client()

    premium_response = client.post(
        "/api/admin/premium/save-config",
        json={
            "platform": "chatgpt",
            "packages": {"added": {"name": "Added package", "price": 2000}},
        },
    )
    chung_suc_response = client.post(
        "/api/admin/chungsuc/config",
        json={"packages": {"added": {"name": "Added CS package", "price": 5000}}},
    )

    assert premium_response.status_code == 200
    assert chung_suc_response.status_code == 200
    assert saved_config["premium_services"]["chatgpt"]["packages"] == {
        "existing": config["premium_services"]["chatgpt"]["packages"]["existing"],
        "added": {"name": "Added package", "price": 2000},
    }
    assert saved_config["chungsuc_packages"] == {
        "existing": config["chungsuc_packages"]["existing"],
        "added": {"name": "Added CS package", "price": 5000},
    }
