"""API error handling and profile validation integration tests."""


def test_get_unknown_api_route_returns_json_404(seeded_client):
    res = seeded_client.get("/api/nonexistent-route")
    assert res.status_code == 404
    assert "No route" in res.json()["error"]


def test_post_unknown_api_route_returns_json_404(seeded_client):
    res = seeded_client.post("/api/documents/nope")
    assert res.status_code == 404
    assert "No route" in res.json()["error"]


def test_post_profile_updates_fields_alias_of_put(seeded_client):
    via_post = seeded_client.post("/api/profile", json={"name": "Post Alias Name"})
    assert via_post.status_code == 200
    assert via_post.json()["profile"]["name"] == "Post Alias Name"

    via_put = seeded_client.put("/api/profile", json={"name": "Put Roundtrip"})
    assert via_put.status_code == 200
    assert via_put.json()["profile"]["name"] == "Put Roundtrip"

    back = seeded_client.get("/api/profile")
    assert back.json()["profile"]["name"] == "Put Roundtrip"


def test_rejects_malformed_email_with_400(seeded_client):
    res = seeded_client.post("/api/profile", json={"email": "not-an-email"})
    assert res.status_code == 400
    assert "email" in res.json()["error"].lower()


def test_never_wipes_stored_values_with_empty_string_updates(seeded_client):
    original = seeded_client.get("/api/profile").json()["profile"]

    res = seeded_client.put("/api/profile", json={"summary": "", "headline": "Kept headline"})
    assert res.status_code == 200
    assert res.json()["profile"]["summary"] == original["summary"]  # unchanged
    assert res.json()["profile"]["headline"] == "Kept headline"

    with_links = seeded_client.put("/api/profile", json={"links": {"github": "github.com/karma"}})
    assert with_links.status_code == 200


def test_preserves_link_not_present_in_update_payload(seeded_client):
    seeded_client.put(
        "/api/profile",
        json={"links": {"github": "github.com/keeper", "linkedin": "linkedin.com/keeper"}},
    )
    res = seeded_client.put("/api/profile", json={"links": {"github": "github.com/replacement"}})
    assert res.status_code == 200
    back = seeded_client.get("/api/profile")
    assert back.json()["profile"]["links"]["github"] == "github.com/replacement"
    assert back.json()["profile"]["links"]["linkedin"] == "linkedin.com/keeper"


def test_rejects_fully_empty_payloads_with_400(seeded_client):
    res = seeded_client.put("/api/profile", json={})
    assert res.status_code == 400
    assert "no updatable fields" in res.json()["error"].lower()


def test_document_oversize_validation_returns_400(seeded_client):
    res = seeded_client.post(
        "/api/documents",
        json={"title": "Oversize note", "content": "x" * 500001, "sourceType": "note"},
    )
    assert res.status_code == 400
    assert res.json()["error"]
