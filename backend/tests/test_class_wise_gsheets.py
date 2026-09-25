import unittest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.models.models import User, UserRole, Teacher, Department, AcademicYear, Section, Subject, TeacherAssignment
from app.core.security import get_password_hash, create_access_token
from app.main import app

class TestClassWiseGSheets(unittest.TestCase):

    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(bind=self.engine)
        TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)
        self.db = TestingSessionLocal()

        def override_get_db():
            try:
                yield self.db
            finally:
                pass

        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app)

        # 1. Setup Department & Academic Year
        self.dept = Department(code="CSE", name="Computer Science & Engineering")
        self.db.add(self.dept)
        self.db.flush()

        self.ay = AcademicYear(name="3rd Year")
        self.db.add(self.ay)
        self.db.flush()

        # 2. Setup Sections (CSE-A & CSE-B)
        self.sec_a = Section(name="CSE-A", department_id=self.dept.id, academic_year_id=self.ay.id)
        self.sec_b = Section(name="CSE-B", department_id=self.dept.id, academic_year_id=self.ay.id)
        self.db.add_all([self.sec_a, self.sec_b])
        self.db.flush()

        # 3. Setup Subjects (CET & CN)
        self.subj_cet = Subject(name="Career Enhancement Training (CET)", code="CS301", department_id=self.dept.id, academic_year_id=self.ay.id)
        self.subj_cn = Subject(name="Computer Networks (CN)", code="CS302", department_id=self.dept.id, academic_year_id=self.ay.id)
        self.db.add_all([self.subj_cet, self.subj_cn])
        self.db.flush()

        # 4. Setup Faculty 1 (Sowjanya)
        self.user_t1 = User(
            username="demoteacher",
            email="demoteacher@sreenidhi.edu.in",
            password_hash=get_password_hash("demoteacher@2026"),
            role=UserRole.TEACHER,
            is_active=True
        )
        self.db.add(self.user_t1)
        self.db.flush()

        self.teacher1 = Teacher(
            user_id=self.user_t1.id,
            teacher_code="T_SOWJANYA",
            name="Mrs. N. Sowjanya",
            department_id=self.dept.id,
            google_sheet_id="faculty_default_sheet_123"
        )
        self.db.add(self.teacher1)
        self.db.flush()

        # 5. Setup Faculty 2 (Other faculty)
        self.user_t2 = User(
            username="otherteacher",
            email="other@sreenidhi.edu.in",
            password_hash=get_password_hash("demoteacher@2026"),
            role=UserRole.TEACHER,
            is_active=True
        )
        self.db.add(self.user_t2)
        self.db.flush()

        self.teacher2 = Teacher(
            user_id=self.user_t2.id,
            teacher_code="T_OTHER",
            name="Other Faculty",
            department_id=self.dept.id
        )
        self.db.add(self.teacher2)
        self.db.flush()

        # 6. Assign Class 1 (CET, CSE-A) and Class 2 (CN, CSE-B) to Faculty 1
        self.asgn1 = TeacherAssignment(
            teacher_id=self.teacher1.id,
            subject_id=self.subj_cet.id,
            section_id=self.sec_a.id,
            google_sheet_id="sheet_csea_cet_001"
        )
        self.asgn2 = TeacherAssignment(
            teacher_id=self.teacher1.id,
            subject_id=self.subj_cn.id,
            section_id=self.sec_b.id,
            google_sheet_id=None
        )
        self.asgn_other = TeacherAssignment(
            teacher_id=self.teacher2.id,
            subject_id=self.subj_cn.id,
            section_id=self.sec_a.id
        )
        self.db.add_all([self.asgn1, self.asgn2, self.asgn_other])
        self.db.commit()

        self.t1_token = create_access_token(data={"sub": "demoteacher"})
        self.t2_token = create_access_token(data={"sub": "otherteacher"})
        self.t1_headers = {"Authorization": f"Bearer {self.t1_token}"}
        self.t2_headers = {"Authorization": f"Bearer {self.t2_token}"}

    def tearDown(self):
        app.dependency_overrides.clear()
        self.db.close()

    def test_get_assigned_classes_returns_class_google_sheets(self):
        """Verify GET /api/v1/teacher/assigned-classes includes class-wise google_sheet_id and url."""
        res = self.client.get("/api/v1/teacher/assigned-classes", headers=self.t1_headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(len(data), 2)

        # Class 1 should have sheet configured
        c1 = next(c for c in data if c["assignment_id"] == self.asgn1.id)
        self.assertEqual(c1["google_sheet_id"], "sheet_csea_cet_001")
        self.assertEqual(c1["google_sheet_url"], "https://docs.google.com/spreadsheets/d/sheet_csea_cet_001/edit")

        # Class 2 has no sheet yet
        c2 = next(c for c in data if c["assignment_id"] == self.asgn2.id)
        self.assertEqual(c2["google_sheet_id"], "")
        self.assertEqual(c2["google_sheet_url"], "")

    def test_update_class_sheet_from_full_url(self):
        """Verify faculty can update class-specific Google Sheet using a full browser URL."""
        sheet_url = "https://docs.google.com/spreadsheets/d/1vzYIYhjQnutZfPLSthGw--CeF0_MJCWE/edit#gid=0"
        res = self.client.put(
            f"/api/v1/teacher/assignments/{self.asgn2.id}/sheet",
            headers=self.t1_headers,
            json={"google_sheet_id": sheet_url}
        )
        self.assertEqual(res.status_code, 200)
        payload = res.json()
        self.assertEqual(payload["status"], "SUCCESS")
        self.assertEqual(payload["google_sheet_id"], "1vzYIYhjQnutZfPLSthGw--CeF0_MJCWE")
        self.assertEqual(payload["google_sheet_url"], "https://docs.google.com/spreadsheets/d/1vzYIYhjQnutZfPLSthGw--CeF0_MJCWE/edit")

        # Verify persisted in database
        refreshed = self.db.query(TeacherAssignment).filter(TeacherAssignment.id == self.asgn2.id).first()
        self.assertEqual(refreshed.google_sheet_id, "1vzYIYhjQnutZfPLSthGw--CeF0_MJCWE")

    def test_unauthorized_faculty_cannot_update_other_class_sheet(self):
        """Verify a faculty member cannot update another faculty's class assignment sheet."""
        res = self.client.put(
            f"/api/v1/teacher/assignments/{self.asgn_other.id}/sheet",
            headers=self.t1_headers,
            json={"google_sheet_id": "malicious_sheet_id"}
        )
        self.assertEqual(res.status_code, 403)

    def test_multiple_classes_have_distinct_sheets(self):
        """Verify that multiple classes assigned to the same faculty maintain distinct Google Sheet IDs."""
        self.client.put(
            f"/api/v1/teacher/assignments/{self.asgn1.id}/sheet",
            headers=self.t1_headers,
            json={"google_sheet_id": "sheet_cet_class_a"}
        )
        self.client.put(
            f"/api/v1/teacher/assignments/{self.asgn2.id}/sheet",
            headers=self.t1_headers,
            json={"google_sheet_id": "sheet_cn_class_b"}
        )

        res = self.client.get("/api/v1/teacher/assigned-classes", headers=self.t1_headers)
        data = res.json()
        c1 = next(c for c in data if c["assignment_id"] == self.asgn1.id)
        c2 = next(c for c in data if c["assignment_id"] == self.asgn2.id)

        self.assertEqual(c1["google_sheet_id"], "sheet_cet_class_a")
        self.assertEqual(c2["google_sheet_id"], "sheet_cn_class_b")
        self.assertNotEqual(c1["google_sheet_id"], c2["google_sheet_id"])
