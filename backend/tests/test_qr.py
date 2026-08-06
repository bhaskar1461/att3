import unittest
from app.core.security import generate_encrypted_qr_payload, decrypt_and_validate_qr_payload

class TestQRSecurity(unittest.TestCase):
    def test_qr_generation_and_decryption(self):
        student_id = 42
        roll_number = "21311A0501"
        
        payload = generate_encrypted_qr_payload(student_id, roll_number)
        
        self.assertEqual(payload["studentId"], student_id)
        self.assertEqual(payload["rollNumber"], roll_number)
        self.assertIn("encryptedToken", payload)
        self.assertIn("checksum", payload)

        decrypted = decrypt_and_validate_qr_payload(payload)
        self.assertEqual(decrypted["studentId"], student_id)
        self.assertEqual(decrypted["rollNumber"], roll_number)

    def test_qr_tamper_detection(self):
        payload = generate_encrypted_qr_payload(1, "21311A0501")
        payload["encryptedToken"] = payload["encryptedToken"][:-4] + "AAAA"
        
        with self.assertRaises(ValueError):
            decrypt_and_validate_qr_payload(payload)

if __name__ == "__main__":
    unittest.main()
