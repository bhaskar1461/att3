"""
SNIST ERP — Automated Verification Suite for Admin Overview Aggregates
Verifies:
1. GET /api/v1/admin/overview/rollup (today, week, month) matches OverviewStatsRollupSchema
2. GET /api/v1/admin/overview/heatmap matches HourlyHeatmapSchema
3. GET /api/v1/admin/overview/sources matches CheckInSourcesBreakdownSchema
4. GET /api/v1/admin/overview/trends matches AttendanceTrendsRollupSchema
5. Role gating: SUPER_ADMIN and TEACHER allowed (200), STUDENT rejected (403), Unauthenticated (401)
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.main import app
from app.core.database import SessionLocal
from app.models.models import User, UserRole
from app.core.security import create_access_token


class TestAdminOverviewAggregates:

    @pytest.fixture(autouse=True)
    def setup_method(self):
        self.client = TestClient(app)
        self.db: Session = SessionLocal()

        # Ensure admin user exists
        self.admin_user = self.db.query(User).filter(User.username == "admin").first()
        if not self.admin_user:
            self.admin_user = User(
                username="admin",
                password_hash="testpasshash",
                role=UserRole.SUPER_ADMIN,
                is_active=True
            )
            self.db.add(self.admin_user)
            self.db.commit()

        # Ensure teacher user exists
        self.teacher_user = self.db.query(User).filter(User.username == "test_teacher_agg").first()
        if not self.teacher_user:
            self.teacher_user = User(
                username="test_teacher_agg",
                password_hash="testpasshash",
                role=UserRole.TEACHER,
                is_active=True
            )
            self.db.add(self.teacher_user)
            self.db.commit()

        # Ensure student user exists
        self.student_user = self.db.query(User).filter(User.username == "test_student_agg").first()
        if not self.student_user:
            self.student_user = User(
                username="test_student_agg",
                password_hash="testpasshash",
                role=UserRole.STUDENT,
                is_active=True
            )
            self.db.add(self.student_user)
            self.db.commit()

        self.admin_token = create_access_token({"sub": self.admin_user.username, "role": "SUPER_ADMIN"})
        self.teacher_token = create_access_token({"sub": self.teacher_user.username, "role": "TEACHER"})
        self.student_token = create_access_token({"sub": self.student_user.username, "role": "STUDENT"})

        yield

        self.db.close()

    def test_rollup_today_admin_success(self):
        """Test 1: Rollup endpoint returns valid structure for 'today'."""
        headers = {"Authorization": f"Bearer {self.admin_token}"}
        res = self.client.get("/api/v1/admin/overview/rollup?range=today", headers=headers)
        assert res.status_code == 200, res.text
        data = res.json()

        assert data["range"] == "today"
        assert isinstance(data["totalStudents"], int)
        assert isinstance(data["presentCount"], int)
        assert isinstance(data["absentCount"], int)
        assert isinstance(data["attendanceRate"], (int, float))
        assert isinstance(data["rateDelta"], (int, float))
        assert isinstance(data["liveSessions"], int)
        assert isinstance(data["flaggedDevices"], int)

    def test_rollup_week_and_month(self):
        """Test 2: Rollup endpoint handles 'week' and 'month' ranges cleanly."""
        headers = {"Authorization": f"Bearer {self.admin_token}"}
        
        res_week = self.client.get("/api/v1/admin/overview/rollup?range=week", headers=headers)
        assert res_week.status_code == 200
        assert res_week.json()["range"] == "week"

        res_month = self.client.get("/api/v1/admin/overview/rollup?range=month", headers=headers)
        assert res_month.status_code == 200
        assert res_month.json()["range"] == "month"

    def test_heatmap_structure(self):
        """Test 3: Heatmap endpoint returns cells conforming to HourlyHeatmapSchema."""
        headers = {"Authorization": f"Bearer {self.admin_token}"}
        res = self.client.get("/api/v1/admin/overview/heatmap?range=today", headers=headers)
        assert res.status_code == 200, res.text
        cells = res.json()
        assert isinstance(cells, list)
        assert len(cells) > 0

        for cell in cells:
            assert "day" in cell and isinstance(cell["day"], str)
            assert "hour" in cell and isinstance(cell["hour"], int)
            assert "count" in cell and isinstance(cell["count"], int)
            assert "rate" in cell and isinstance(cell["rate"], (int, float))

    def test_sources_breakdown_structure(self):
        """Test 4: Sources breakdown conforms to CheckInSourcesBreakdownSchema."""
        headers = {"Authorization": f"Bearer {self.admin_token}"}
        res = self.client.get("/api/v1/admin/overview/sources?range=today", headers=headers)
        assert res.status_code == 200, res.text
        items = res.json()
        assert isinstance(items, list)
        assert len(items) == 4

        sources_found = set()
        for item in items:
            assert item["source"] in ["qr", "face", "manual", "offline"]
            sources_found.add(item["source"])
            assert isinstance(item["count"], int)
            assert isinstance(item["percentage"], (int, float))

        assert sources_found == {"qr", "face", "manual", "offline"}

    def test_trends_rollup_structure(self):
        """Test 5: Trends endpoint conforms to AttendanceTrendsRollupSchema."""
        headers = {"Authorization": f"Bearer {self.admin_token}"}
        
        # Test week range
        res_week = self.client.get("/api/v1/admin/overview/trends?range=week", headers=headers)
        assert res_week.status_code == 200, res_week.text
        items_week = res_week.json()
        assert isinstance(items_week, list)
        assert len(items_week) == 7
        for item in items_week:
            assert "date" in item and isinstance(item["date"], str)
            assert "present" in item and isinstance(item["present"], int)
            assert "absent" in item and isinstance(item["absent"], int)
            assert "percentage" in item and isinstance(item["percentage"], (int, float))

        # Test today range (hourly breakdown)
        res_today = self.client.get("/api/v1/admin/overview/trends?range=today", headers=headers)
        assert res_today.status_code == 200, res_today.text
        items_today = res_today.json()
        assert isinstance(items_today, list)
        assert len(items_today) == 8  # 9:00 to 16:00
        for item in items_today:
            assert ":00" in item["date"]

    def test_teacher_role_allowed(self):
        """Test 6: Teacher accounts are allowed to query overview endpoints."""
        headers = {"Authorization": f"Bearer {self.teacher_token}"}
        res = self.client.get("/api/v1/admin/overview/rollup?range=today", headers=headers)
        assert res.status_code == 200, res.text

    def test_student_role_rejected_403(self):
        """Test 7: Student accounts are rejected with 403 Forbidden."""
        headers = {"Authorization": f"Bearer {self.student_token}"}
        res = self.client.get("/api/v1/admin/overview/rollup?range=today", headers=headers)
        assert res.status_code == 403, res.text

    def test_unauthenticated_rejected_401(self):
        """Test 8: Unauthenticated requests are rejected with 401 Unauthorized."""
        res = self.client.get("/api/v1/admin/overview/rollup?range=today")
        assert res.status_code == 401, res.text
