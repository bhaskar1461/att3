"""
Test Suite: Binding Phase 3 — Database-Level Invariant & Concurrency Race
Focus:
1. Structural enforcement of single active binding per student (uq_student_active_binding partial index).
2. Parallel concurrent enrollment race: multiple simultaneous transactions attempt to insert
   active bindings for the same student. Exactly ONE succeeds; all others are physically rejected
   by the database with an IntegrityError.
3. Multi-student coexistence: independent students can hold active bindings concurrently.
4. Historical retention: multiple revoked bindings for the same student coexist alongside exactly one active binding.
"""

import os
import tempfile
import unittest
import threading
import concurrent.futures
from datetime import datetime, timezone
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.exc import IntegrityError

from app.core.database import Base
from app.models.models import DeviceBinding, Student, Department


class TestBindingSchemaRace(unittest.TestCase):

    def setUp(self):
        # File-backed temporary SQLite database so concurrent threads operate with independent DB-API connections
        self.tmp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp_db.close()
        self.engine = create_engine(
            f"sqlite:///{self.tmp_db.name}",
            connect_args={"timeout": 15}
        )
        Base.metadata.create_all(bind=self.engine)
        self.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)
        self.db = self.SessionLocal()

        # Seed test department and students
        dept = Department(name="Computer Science and Engineering", code="CSE")
        self.db.add(dept)
        self.db.commit()

        s1 = Student(
            roll_number="23311A05Y1",
            name="Student One",
            email="s1@sreenidhi.edu.in",
            department_id=dept.id,
            agency="Regular"
        )
        s2 = Student(
            roll_number="23311A05Y2",
            name="Student Two",
            email="s2@sreenidhi.edu.in",
            department_id=dept.id,
            agency="Regular"
        )
        self.db.add_all([s1, s2])
        self.db.commit()
        self.s1_id = s1.id
        self.s2_id = s2.id

    def tearDown(self):
        self.db.close()
        self.engine.dispose()
        try:
            if os.path.exists(self.tmp_db.name):
                os.remove(self.tmp_db.name)
        except Exception:
            pass

    def test_single_active_binding_enforced_by_database(self):
        """
        Verify that attempting to insert two active (revoked_at IS NULL) bindings
        for the same student physically fails at the database level with IntegrityError.
        """
        # First active binding succeeds
        b1 = DeviceBinding(
            student_id=self.s1_id,
            public_key="MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEtestkey1",
            key_id="hash_key_1",
            enrolled_at=datetime.now(timezone.utc),
            enrolled_via="self",
            storage_persist_granted=True,
            revoked_at=None
        )
        self.db.add(b1)
        self.db.commit()

        # Second active binding for SAME student MUST fail with IntegrityError
        b2 = DeviceBinding(
            student_id=self.s1_id,
            public_key="MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEtestkey2",
            key_id="hash_key_2",
            enrolled_at=datetime.now(timezone.utc),
            enrolled_via="self",
            storage_persist_granted=True,
            revoked_at=None
        )
        self.db.add(b2)
        with self.assertRaises(IntegrityError):
            self.db.commit()

        self.db.rollback()

        # Confirm exactly 1 row exists
        count = self.db.query(DeviceBinding).filter(
            DeviceBinding.student_id == self.s1_id,
            DeviceBinding.revoked_at == None
        ).count()
        self.assertEqual(count, 1)

    def test_revocation_allows_new_active_binding(self):
        """
        Verify that once an active binding is revoked (revoked_at IS NOT NULL),
        a new active binding can be inserted without violating the invariant.
        """
        b1 = DeviceBinding(
            student_id=self.s1_id,
            public_key="MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEtestkey1",
            key_id="hash_key_1",
            enrolled_at=datetime.now(timezone.utc),
            enrolled_via="self",
            revoked_at=None
        )
        self.db.add(b1)
        self.db.commit()

        # Revoke b1
        b1.revoked_at = datetime.now(timezone.utc)
        b1.revoked_reason = "rebind"
        self.db.commit()

        # Now b2 can be inserted as the single active binding
        b2 = DeviceBinding(
            student_id=self.s1_id,
            public_key="MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEtestkey2",
            key_id="hash_key_2",
            enrolled_at=datetime.now(timezone.utc),
            enrolled_via="self",
            revoked_at=None
        )
        self.db.add(b2)
        self.db.commit()

        # Total rows = 2, Active rows = 1
        total_count = self.db.query(DeviceBinding).filter(
            DeviceBinding.student_id == self.s1_id
        ).count()
        active_count = self.db.query(DeviceBinding).filter(
            DeviceBinding.student_id == self.s1_id,
            DeviceBinding.revoked_at == None
        ).count()
        self.assertEqual(total_count, 2)
        self.assertEqual(active_count, 1)

    def test_multiple_revoked_rows_retention(self):
        """
        Verify audit retention: a student can accumulate multiple revoked rows over time,
        all preserved for security audits, while maintaining at most 1 active binding.
        """
        for i in range(5):
            b = DeviceBinding(
                student_id=self.s1_id,
                public_key=f"MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAErevoked_{i}",
                key_id=f"hash_revoked_{i}",
                enrolled_at=datetime.now(timezone.utc),
                enrolled_via="self",
                revoked_at=datetime.now(timezone.utc),
                revoked_reason="rebind"
            )
            self.db.add(b)
        self.db.commit()

        # Plus one active binding
        b_active = DeviceBinding(
            student_id=self.s1_id,
            public_key="MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEactive_final",
            key_id="hash_active_final",
            enrolled_at=datetime.now(timezone.utc),
            enrolled_via="self",
            revoked_at=None
        )
        self.db.add(b_active)
        self.db.commit()

        total = self.db.query(DeviceBinding).filter(DeviceBinding.student_id == self.s1_id).count()
        active = self.db.query(DeviceBinding).filter(
            DeviceBinding.student_id == self.s1_id,
            DeviceBinding.revoked_at == None
        ).count()
        self.assertEqual(total, 6)
        self.assertEqual(active, 1)

    def test_parallel_concurrent_enrollment_race(self):
        """
        PRIME DIRECTIVE TEST:
        Spawn 10 concurrent threads attempting to enroll active bindings simultaneously
        for the SAME student.
        Assert that EXACTLY 1 thread wins and 9 threads receive an IntegrityError.
        Verify that the database state contains EXACTLY ONE active binding.
        """
        num_threads = 10
        barrier = threading.Barrier(num_threads)
        results = {"success": 0, "integrity_error": 0, "other_error": 0}
        results_lock = threading.Lock()

        def attempt_enrollment(thread_idx: int):
            session = self.SessionLocal()
            try:
                # Wait until all threads reach the starting gate
                barrier.wait()
                binding = DeviceBinding(
                    student_id=self.s2_id,
                    public_key=f"MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEkey_{thread_idx}",
                    key_id=f"hash_key_thread_{thread_idx}",
                    enrolled_at=datetime.now(timezone.utc),
                    enrolled_via="self",
                    storage_persist_granted=True,
                    revoked_at=None
                )
                session.add(binding)
                session.commit()
                with results_lock:
                    results["success"] += 1
            except IntegrityError:
                session.rollback()
                with results_lock:
                    results["integrity_error"] += 1
            except Exception:
                session.rollback()
                with results_lock:
                    results["other_error"] += 1
            finally:
                session.close()

        with concurrent.futures.ThreadPoolExecutor(max_workers=num_threads) as executor:
            futures = [executor.submit(attempt_enrollment, i) for i in range(num_threads)]
            concurrent.futures.wait(futures)

        # Assert exactly one winner
        self.assertEqual(results["success"], 1, f"Expected exactly 1 winner, got {results['success']}")
        self.assertEqual(results["integrity_error"], num_threads - 1, f"Expected {num_threads - 1} integrity errors, got {results['integrity_error']}")
        self.assertEqual(results["other_error"], 0)

        # Query database to confirm strictly 1 active row exists
        active_count = self.db.query(DeviceBinding).filter(
            DeviceBinding.student_id == self.s2_id,
            DeviceBinding.revoked_at == None
        ).count()
        self.assertEqual(active_count, 1)

    def test_shared_phone_multi_student_coexistence(self):
        """
        EDGE CASE: Shared phone (User Case B5).
        Two different students enroll on the same device/browser profile.
        Both active bindings must coexist without collision because bindings
        are keyed to (student_id, keypair), not global hardware identifier.
        """
        b1 = DeviceBinding(
            student_id=self.s1_id,
            public_key="MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEshared_phone_key_s1",
            key_id="hash_shared_s1",
            enrolled_at=datetime.now(timezone.utc),
            enrolled_via="self",
            browser_profile_tag="shared_chrome_profile_1",
            revoked_at=None
        )
        b2 = DeviceBinding(
            student_id=self.s2_id,
            public_key="MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEshared_phone_key_s2",
            key_id="hash_shared_s2",
            enrolled_at=datetime.now(timezone.utc),
            enrolled_via="self",
            browser_profile_tag="shared_chrome_profile_1",
            revoked_at=None
        )
        self.db.add_all([b1, b2])
        self.db.commit()

        # Both exist as active bindings
        s1_active = self.db.query(DeviceBinding).filter(
            DeviceBinding.student_id == self.s1_id,
            DeviceBinding.revoked_at == None
        ).count()
        s2_active = self.db.query(DeviceBinding).filter(
            DeviceBinding.student_id == self.s2_id,
            DeviceBinding.revoked_at == None
        ).count()
        self.assertEqual(s1_active, 1)
        self.assertEqual(s2_active, 1)


if __name__ == "__main__":
    unittest.main()
