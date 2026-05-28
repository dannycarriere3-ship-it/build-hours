from fastapi.testclient import TestClient


def test_seed_stores_r2_inputs_with_nested_manifest_paths(client: TestClient) -> None:
    tasks = client.post(
        "/api/demo/reset", json={"state": "ready_for_agent_demo"}
    ).json()

    assert [task["issue_key"] for task in tasks] == ["CLS-102", "CLS-101"]
    editorial = next(task for task in tasks if task["issue_key"] == "CLS-101")
    assets = next(task for task in tasks if task["issue_key"] == "CLS-102")
    paths = {attachment["storage_path"] for attachment in assets["attachments"]}
    editorial_paths = {
        attachment["storage_path"] for attachment in editorial["attachments"]
    }
    assert "input/original/speaker-bio.docx" in editorial_paths
    assert "input/original/speaker-bio.txt" not in editorial_paths
    assert "input/original/speaker-headshot-original.png" in paths
    assert "input/original/slides-draft.pdf" in paths
    assert "input/original/publishing-brief.json" in paths
    assert "input/original/event-page-template.html" in paths
    content_types = {
        attachment["storage_path"]: attachment["content_type"]
        for attachment in assets["attachments"]
    }
    assert content_types["input/original/speaker-headshot-original.png"] == "image/png"
    assert content_types["input/original/slides-draft.pdf"] == "application/pdf"
    template = next(
        attachment
        for attachment in assets["attachments"]
        if attachment["storage_path"] == "input/original/event-page-template.html"
    )
    download = client.get(f"/api/tasks/{assets['id']}/attachments/{template['id']}/download")
    assert download.status_code == 200
    assert b"<!doctype html>" in download.content.lower()

    assert client.post("/api/demo/reset", json={"state": "empty"}).json() == []
    assert client.get("/api/tasks").json() == []
