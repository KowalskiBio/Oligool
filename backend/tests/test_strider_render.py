"""Tests for the POST /strider/render SVG endpoint (strider.viz backend figures)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import backend.main as main_module

try:
    import strider.viz  # noqa: F401
    _HAVE_STRIDER_VIZ = True
except Exception:
    _HAVE_STRIDER_VIZ = False


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(main_module.app)


@pytest.mark.skipif(not _HAVE_STRIDER_VIZ, reason="strider.viz not importable")
def test_render_hairpin_returns_svg(client: TestClient) -> None:
    res = client.post(
        "/strider/render",
        json={
            "sequence": "GGGAAACCCAAAGGGAAACCC",
            "dot_bracket": "(((...(((...)))...)))",
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert "<svg" in data["svg"]
    assert data["svg"].lstrip().startswith("<?xml")


@pytest.mark.skipif(not _HAVE_STRIDER_VIZ, reason="strider.viz not importable")
def test_render_multiloop_returns_svg(client: TestClient) -> None:
    # Two stems sharing a backbone: HairpinSVG can only split these into
    # side-by-side domains, Strider draws the full connected structure.
    res = client.post(
        "/strider/render",
        json={
            "sequence": "AACCCAAAGGGAAACCCAAAGGG",
            "dot_bracket": "..(((...)))...(((...)))",
        },
    )
    assert res.status_code == 200
    assert "<svg" in res.json()["svg"]


@pytest.mark.skipif(not _HAVE_STRIDER_VIZ, reason="strider.viz not importable")
def test_render_dimer_complex_returns_svg(client: TestClient) -> None:
    res = client.post(
        "/strider/render",
        json={
            "sequence": "GGGAAAAAAAA&CCCCCCCCAAA",
            "dot_bracket": "((&......))&....((...))",
        },
    )
    assert res.status_code == 200
    assert "<svg" in res.json()["svg"]


@pytest.mark.skipif(not _HAVE_STRIDER_VIZ, reason="strider.viz not importable")
def test_render_color_modes_differ(client: TestClient) -> None:
    body = {
        "sequence": "GGGAAACCCAAAGGGAAACCC",
        "dot_bracket": "(((...(((...)))...)))",
    }
    identity = client.post("/strider/render", json={**body, "color": "identity"})
    structure = client.post("/strider/render", json={**body, "color": "structure"})
    assert identity.status_code == 200
    assert structure.status_code == 200
    svg_identity = identity.json()["svg"]
    svg_structure = structure.json()["svg"]
    assert "<svg" in svg_identity and "<svg" in svg_structure
    # Element-based coloring assigns different fill colors than per-base
    # identity, so the two renderings must not be identical.
    assert svg_identity != svg_structure


@pytest.mark.skipif(not _HAVE_STRIDER_VIZ, reason="strider.viz not importable")
def test_render_arc_view(client: TestClient) -> None:
    res = client.post(
        "/strider/render",
        json={
            "sequence": "GGGAAACCCAAAGGGAAACCC",
            "dot_bracket": "(((...(((...)))...)))",
            "view": "arc",
        },
    )
    assert res.status_code == 200
    assert "<svg" in res.json()["svg"]


@pytest.mark.parametrize(
    "payload",
    [
        {"sequence": "", "dot_bracket": "((..))"},
        {"sequence": "AAAAAA", "dot_bracket": ""},
        {"sequence": "AAAAAA", "dot_bracket": "(((...)))"},  # length mismatch
        {"sequence": "AAAAAA", "dot_bracket": "......"},  # no pairs
        {"sequence": "AA#AAA", "dot_bracket": "((...))"},  # bad char
    ],
)
def test_render_validation_errors(client: TestClient, payload: dict) -> None:
    res = client.post("/strider/render", json=payload)
    assert res.status_code == 400
    assert "detail" in res.json()
