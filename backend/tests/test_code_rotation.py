import pytest
import time
import hashlib
import os
import sys

# Ensure backend directory is in sys.path
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.core.security import (
    generate_rotating_code, verify_rotating_code, hash_rotating_code
)

def test_code_generation_format():
    session_id = 42
    secret = "test_super_secret_prox_presence_key"
    
    code, code_hash, remaining_sec = generate_rotating_code(session_id, secret)
    
    # 1. Must be exactly 4 uppercase characters
    assert len(code) == 4
    assert code.isupper()
    
    # 2. Characters must be unambiguous (no 0, 1, I, O)
    for ch in code:
        assert ch not in "01IO"
        
    # 3. Hash must be SHA-256 of code (never stored plaintext in DB)
    expected_hash = hashlib.sha256(code.encode('utf-8')).hexdigest()
    assert code_hash == expected_hash
    assert code_hash == hash_rotating_code(code)
    
    # 4. Remaining seconds within 15-second window
    assert 0 <= remaining_sec <= 15

def test_code_rotation_grace_window_edges():
    """
    Test edge cases for grace window:
    Rotation period = 15s. Tolerance = +-30s (tolerance_windows = 2).
    At verification time T (aligned to bucket boundary):
      t - 14s: PASS (within 1 bucket)
      t - 15s: PASS (boundary of 1st preceding bucket)
      t - 16s: PASS (in 2nd preceding bucket, <= 30s)
      t - 31s: MUST FAIL (outside 30s tolerance window, delta = -3)
    """
    session_id = 99
    secret = "snist_cryptographic_session_secret_2026"
    
    # Use a reference time aligned to a bucket boundary: 1500 is 100 * 15
    t_verify = 1500.0
    
    # 1. t - 14s: generated 14 seconds ago (should pass)
    code_minus_14, _, _ = generate_rotating_code(session_id, secret, current_time=t_verify - 14.0)
    assert verify_rotating_code(code_minus_14, session_id, secret, current_time=t_verify) is True, \
        "Code at t - 14s must be ACCEPTED within grace window"

    # 2. t - 15s: generated 15 seconds ago (should pass)
    code_minus_15, _, _ = generate_rotating_code(session_id, secret, current_time=t_verify - 15.0)
    assert verify_rotating_code(code_minus_15, session_id, secret, current_time=t_verify) is True, \
        "Code at t - 15s must be ACCEPTED within grace window"

    # 3. t - 16s: generated 16 seconds ago (should pass)
    code_minus_16, _, _ = generate_rotating_code(session_id, secret, current_time=t_verify - 16.0)
    assert verify_rotating_code(code_minus_16, session_id, secret, current_time=t_verify) is True, \
        "Code at t - 16s must be ACCEPTED within +-30s grace window"

    # 4. t - 31s: generated 31 seconds ago (MUST FAIL)
    code_minus_31, _, _ = generate_rotating_code(session_id, secret, current_time=t_verify - 31.0)
    assert verify_rotating_code(code_minus_31, session_id, secret, current_time=t_verify) is False, \
        "Code at t - 31s MUST FAIL as it exceeds the 30s grace window"

def test_code_rotation_multiple_bucket_boundaries():
    """
    Verify grace window edges across multiple distinct bucket boundaries.
    """
    session_id = 105
    secret = "multi_boundary_secret_verification"
    
    for base_multiplier in [10, 50, 100, 200, 1000]:
        t_ref = float(base_multiplier * 15)
        
        c_14, _, _ = generate_rotating_code(session_id, secret, current_time=t_ref - 14.0)
        c_15, _, _ = generate_rotating_code(session_id, secret, current_time=t_ref - 15.0)
        c_16, _, _ = generate_rotating_code(session_id, secret, current_time=t_ref - 16.0)
        c_31, _, _ = generate_rotating_code(session_id, secret, current_time=t_ref - 31.0)
        
        assert verify_rotating_code(c_14, session_id, secret, current_time=t_ref) is True
        assert verify_rotating_code(c_15, session_id, secret, current_time=t_ref) is True
        assert verify_rotating_code(c_16, session_id, secret, current_time=t_ref) is True
        assert verify_rotating_code(c_31, session_id, secret, current_time=t_ref) is False

def test_cross_session_and_cross_secret_isolation():
    session_a = 1001
    session_b = 1002
    secret_a = "secret_for_session_a"
    secret_b = "secret_for_session_b"
    
    t_now = 2000.0
    code_a, _, _ = generate_rotating_code(session_a, secret_a, current_time=t_now)
    
    # Must fail for different session
    assert verify_rotating_code(code_a, session_b, secret_a, current_time=t_now) is False
    
    # Must fail for different secret
    assert verify_rotating_code(code_a, session_a, secret_b, current_time=t_now) is False

def test_case_insensitivity_and_whitespace_handling():
    session_id = 200
    secret = "whitespace_test_secret"
    t_now = 3000.0
    
    code, _, _ = generate_rotating_code(session_id, secret, current_time=t_now)
    
    # Lowercase should be accepted
    assert verify_rotating_code(code.lower(), session_id, secret, current_time=t_now) is True
    
    # With surrounding whitespace should be accepted
    assert verify_rotating_code(f"  {code}  ", session_id, secret, current_time=t_now) is True
    
    # Invalid empty or none
    assert verify_rotating_code("", session_id, secret, current_time=t_now) is False
    assert verify_rotating_code(None, session_id, secret, current_time=t_now) is False
