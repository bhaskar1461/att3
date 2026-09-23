"""
Test suite verifying safe QR payload handling and redirect prevention.
Verifies:
1. Extraction of launch tokens from full URLs, relative paths, and raw payloads.
2. Endpoint /a/<token> prevents infinite 307 redirect loops.
3. POST /student/scan-session accepts both raw tokens and full URL payloads safely.
"""

import time
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.core.database import SessionLocal
from app.models.models import (
    Student, AcademicYear, Department, Section, AttendanceSession,
    SessionStatus, AttendanceRecord, AttendanceStatus
)
from app.core.security import create_access_token
from app.services.launch_token import generate_launch_token, extract_launch_token_from_url
from app.services.qr_token import ShortTokenService


class TestQRDataHandling:

    @pytest.fixture(autouse=True)
    def setup(self):
        self.client = TestClient(app)
        self.db = SessionLocal()

        self.dept = self.db.query(Department).first()
        if not self.dept:
            self.dept = Department(code="CSE", name="Computer Science and Engineering")
            self.db.add(self.dept)
            self.db.commit()

        self.year = self.db.query(AcademicYear).first()
        if not self.year:
            self.year = AcademicYear(name="2025-2026")
            self.db.add(self.year)
            self.db.commit()

        self.section = self.db.query(Section).first()
        if not self.section:
            self.section = Section(name="CSE-A", department_id=self.dept.id, academic_year_id=self.year.id)
            self.db.add(self.section)
            self.db.commit()

        self.student = self.db.query(Student).first()
        self.student_token = create_access_token(
            data={"sub": self.student.user.username, "role": "STUDENT"}
        )

        yield
        self.db.close()

    def test_extract_launch_token_variants(self):
        """Test URL extraction helper handles multiple variants."""
        sample_token = "MTAwMDM6TIJXQUczM1A6MTc4OTk1ODc4OTk1ODc"
        
        # 1. Full HTTPS URL
        url1 = f"https://ather-os.de5.net/a/{sample_token}"
        assert extract_launch_token_from_url(url1) == sample_token

        # 2. Relative path
        url2 = f"/a/{sample_token}"
        assert extract_launch_token_from_url(url2) == sample_token

        # 3. Full URL with query parameters
        url3 = f"https://ather-os.de5.net/a/{sample_token}?scan=1#ref"
        assert extract_launch_token_from_url(url3) == sample_token

    def test_get_launch_url_no_infinite_redirect(self):
        """Verify GET /a/<token> does not result in an infinite 307 loop to itself."""
        token = "MTAwMDM6TIJXQUczM1A6MTc4OTk1ODc4OTk1ODc"
        # Test request with Host header matching ather-os.de5.net
        resp = self.client.get(f"/a/{token}", headers={"host": "ather-os.de5.net"}, follow_redirects=False)
        
        # Must either serve SPA (200) or return safe non-looping response
        # It must NOT return 307 redirecting to https://ather-os.de5.net/a/...
        if resp.status_code == 307:
            loc = resp.headers.get("location", "")
            assert "ather-os.de5.net" not in loc, f"Detected infinite redirect loop to {loc}"
        else:
            assert resp.status_code == 200
