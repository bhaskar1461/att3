import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_healthz_unauthenticated_and_model_status():
    """
    Verifies the Heroku daylight scheduler health endpoint:
    - Route: GET /healthz
    - No authentication required
    - Returns HTTP 200
    - Body includes status: 'ok'
    - Body includes boolean 'models_loaded'
    """
    response = client.get("/healthz")
    assert response.status_code == 200, f"Expected 200 OK, got {response.status_code}: {response.text}"
    data = response.json()
    assert data.get("status") == "ok"
    assert "models_loaded" in data
    assert isinstance(data["models_loaded"], bool)
