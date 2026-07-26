"""Shared test fixtures for the Oligool backend."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.main import app


@pytest.fixture(scope="session")
def client() -> TestClient:
    return TestClient(app)
