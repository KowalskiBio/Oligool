"""Tests for importing NCBI web BLAST results by RID or XML file (/import-blast)."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

import backend.blast as blast_module
import backend.main as main_module

QUERY = "ACGTACGTACGTACGTACGT"


def _hit(accession: str, identity: int, align_len: int, hseq: str) -> str:
    return f"""
        <Hit>
          <Hit_accession>{accession}</Hit_accession>
          <Hit_def>{accession} test sequence</Hit_def>
          <Hit_hsps><Hsp>
            <Hsp_evalue>1e-5</Hsp_evalue>
            <Hsp_hit-from>1</Hsp_hit-from>
            <Hsp_hit-to>{len(hseq)}</Hsp_hit-to>
            <Hsp_identity>{identity}</Hsp_identity>
            <Hsp_align-len>{align_len}</Hsp_align-len>
            <Hsp_hseq>{hseq}</Hsp_hseq>
          </Hsp></Hit_hsps>
        </Hit>"""


def _blast_xml(query_len: int = len(QUERY)) -> str:
    hits = (
        _hit("EXACT1", 20, 20, QUERY)
        + _hit("NEAR1", 19, 20, "ACGTACGTACGAACGTACGT")
        + _hit("NEAR2", 18, 20, "ACGTACGTAC-TACGTACCT")
    )
    # A second iteration (second query) must be ignored
    other = _hit("OTHERQ", 20, 20, QUERY)
    return f"""<?xml version="1.0"?>
<BlastOutput>
  <BlastOutput_program>blastn</BlastOutput_program>
  <BlastOutput_db>core_nt</BlastOutput_db>
  <BlastOutput_query-len>{query_len}</BlastOutput_query-len>
  <BlastOutput_iterations>
    <Iteration><Iteration_hits>{hits}</Iteration_hits></Iteration>
    <Iteration><Iteration_hits>{other}</Iteration_hits></Iteration>
  </BlastOutput_iterations>
</BlastOutput>"""


@pytest.fixture
def client(monkeypatch) -> TestClient:
    # MAFFT is not under test here; echo the inputs as a fake alignment
    monkeypatch.setattr(main_module, "run_msa", lambda seqs: "\n".join(f">{s['id']}\n{s['seq']}" for s in seqs))
    return TestClient(main_module.app)


def _post(client: TestClient, body: dict) -> dict:
    resp = client.post("/import-blast", json=body)
    assert resp.status_code == 200
    return json.loads(resp.text.strip())


def test_xml_upload_imports_first_query_hits(client):
    data = _post(client, {"sequence": f">myq\n{QUERY}", "xml": _blast_xml()})
    assert "error" not in data
    assert [h["accession"] for h in data["blast_hits"]] == ["EXACT1", "NEAR1", "NEAR2"]
    meta = data["blast_meta"]
    assert meta["imported"] is True
    assert meta["rid"] == ""
    assert meta["program"] == "blastn" and meta["database"] == "core_nt"
    assert "warning" not in meta
    assert data["alignment"].startswith(">myq\n")


def test_filters_and_max_hits_apply_to_imports(client):
    data = _post(client, {"sequence": QUERY, "xml": _blast_xml(), "filter_matches": True, "max_hits": 2})
    assert [h["accession"] for h in data["filtered_hits"]] == ["EXACT1"]
    assert [h["accession"] for h in data["blast_hits"]] == ["NEAR1"]

    data = _post(client, {"sequence": QUERY, "xml": _blast_xml(), "perc_identity": 95})
    assert [h["accession"] for h in data["blast_hits"]] == ["EXACT1", "NEAR1"]


def test_query_length_mismatch_warns(client):
    data = _post(client, {"sequence": QUERY, "xml": _blast_xml(query_len=500)})
    assert "500 bp" in data["blast_meta"]["warning"]
    assert data["blast_hits"]


def test_rejects_non_blast_and_xml2_files(client):
    assert "Not a BLAST XML" in _post(client, {"sequence": QUERY, "xml": "<foo/>"})["detail"]
    xml2 = '<?xml version="1.0"?><BlastXML2 xmlns="http://www.ncbi.nlm.nih.gov"></BlastXML2>'
    assert "XML2" in _post(client, {"sequence": QUERY, "xml": xml2})["detail"]


def test_requires_rid_or_file(client):
    resp = client.post("/import-blast", json={"sequence": QUERY})
    assert resp.status_code == 400


def test_rid_ready_fetches_xml(client, monkeypatch):
    seen = {}

    def fake_fetch(rid, api_key=""):
        seen["rid"] = rid
        return _blast_xml()

    monkeypatch.setattr(blast_module, "check_rid_status", lambda rid, api_key="": "READY")
    monkeypatch.setattr(blast_module, "fetch_blast_xml", fake_fetch)
    data = _post(client, {"sequence": QUERY, "rid": " 6h1ab2cd016 "})
    assert seen["rid"] == "6H1AB2CD016"
    assert data["blast_meta"]["rid"] == "6H1AB2CD016"
    assert len(data["blast_hits"]) == 3


@pytest.mark.parametrize("status,needle", [
    ("UNKNOWN", "expire"),
    ("WAITING", "still running"),
    ("FAILED", "failed"),
])
def test_rid_status_errors(client, monkeypatch, status, needle):
    monkeypatch.setattr(blast_module, "check_rid_status", lambda rid, api_key="": status)
    data = _post(client, {"sequence": QUERY, "rid": "6H1AB2CD016"})
    assert data["error"] is True
    assert needle in data["detail"]


def test_malformed_rid_rejected_without_network(client, monkeypatch):
    def boom(*a, **k):
        raise AssertionError("must not hit NCBI")

    monkeypatch.setattr(blast_module, "check_rid_status", boom)
    data = _post(client, {"sequence": QUERY, "rid": "not a rid!"})
    assert "does not look like a BLAST RID" in data["detail"]
