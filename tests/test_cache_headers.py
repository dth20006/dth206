import json
from pathlib import Path

from app import app


NO_STORE = "no-store, no-cache, must-revalidate, max-age=0"


def test_pages_static_assets_and_public_apis_are_not_cached():
    client = app.test_client()

    for path in (
        "/",
        "/static/css/style.css",
        "/static/js/app.js",
        "/static/js/theme.js",
        "/api/packages",
        "/api/public/recent-history",
        "/manifest.json",
    ):
        response = client.get(path)

        assert response.headers["Cache-Control"] == NO_STORE, path
        assert response.headers["Pragma"] == "no-cache", path
        assert response.headers["Expires"] == "0", path


def test_vercel_disables_caching_for_every_route():
    vercel_config = json.loads((Path(__file__).resolve().parents[1] / "vercel.json").read_text(encoding="utf-8"))
    cache_headers = [
        header["value"]
        for rule in vercel_config["headers"]
        for header in rule["headers"]
        if header["key"].lower() == "cache-control"
    ]

    assert cache_headers
    assert all(value == NO_STORE for value in cache_headers)
