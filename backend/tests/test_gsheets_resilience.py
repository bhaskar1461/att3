import unittest
from unittest.mock import MagicMock
from app.services.gsheets_service import GoogleSheetsService

class TestGSheetsResilience(unittest.TestCase):
    def test_execute_with_retry_immediate_success(self):
        op = MagicMock(return_value="success_val")
        res = GoogleSheetsService._execute_with_retry(op, max_retries=3, base_delay=0.01)
        self.assertEqual(res, "success_val")
        self.assertEqual(op.call_count, 1)

    def test_execute_with_retry_transient_429_success(self):
        op = MagicMock(side_effect=[Exception("429 Quota Exceeded"), "recovered_val"])
        res = GoogleSheetsService._execute_with_retry(op, max_retries=3, base_delay=0.01)
        self.assertEqual(res, "recovered_val")
        self.assertEqual(op.call_count, 2)

    def test_execute_with_retry_transient_503_success(self):
        op = MagicMock(side_effect=[
            Exception("503 Service Unavailable"),
            Exception("The server encountered a temporary error and could not complete your request"),
            "recovered_val_2"
        ])
        res = GoogleSheetsService._execute_with_retry(op, max_retries=3, base_delay=0.01)
        self.assertEqual(res, "recovered_val_2")
        self.assertEqual(op.call_count, 3)

    def test_execute_with_retry_exhausted(self):
        op = MagicMock(side_effect=Exception("429 Resource Exhausted"))
        with self.assertRaises(Exception) as ctx:
            GoogleSheetsService._execute_with_retry(op, max_retries=3, base_delay=0.01)
        self.assertIn("429", str(ctx.exception))
        self.assertEqual(op.call_count, 3)

    def test_execute_with_retry_permanent_error_no_spurious_retries(self):
        op = MagicMock(side_effect=ValueError("Invalid sheet format or syntax"))
        with self.assertRaises(ValueError):
            GoogleSheetsService._execute_with_retry(op, max_retries=3, base_delay=0.01)
        # Should NOT retry on non-transient errors
        self.assertEqual(op.call_count, 1)
