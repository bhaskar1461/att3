#!/usr/bin/env python3
"""
SNIST ERP — Phase 2 Authentication & Token Throughput Benchmark
Evaluates:
1. Password Verification Throughput (Cold Bcrypt vs Warm HMAC-Salted In-Memory Cache)
2. Launch Token In-Memory Resolution Throughput (Zero-DB Fast-Path)
3. Scan Pipeline Pre-Filter Fast-Rejection Throughput (< 0.05ms)
4. Full FastAPI Authentication Endpoint (/api/v1/auth/login) Throughput (> 50 logins/sec requirement)
"""

import os
import sys
import time
import statistics
from concurrent.futures import ThreadPoolExecutor

# Set up paths
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend"))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from fastapi.testclient import TestClient
from app.main import app
from app.core.database import SessionLocal
from app.models.models import User, UserRole
from app.core.security import (
    get_password_hash,
    verify_password,
    clear_password_verify_cache,
    get_password_verify_cache_stats
)
from app.services.qr_token import ShortTokenService, _SHORT_CODE_CACHE, _CACHE_LOCK
from app.services.launch_token import generate_launch_token
from app.services.attendance_pipeline.scan_token_verifier import (
    verify_and_resolve_scan_token,
    clear_invalid_token_prefilter_cache,
    get_invalid_token_prefilter_stats
)


def format_stats(latencies_ms: list) -> str:
    if not latencies_ms:
        return "N/A"
    latencies_sorted = sorted(latencies_ms)
    n = len(latencies_sorted)
    avg = statistics.mean(latencies_sorted)
    p50 = latencies_sorted[int(n * 0.50)]
    p95 = latencies_sorted[min(n - 1, int(n * 0.95))]
    p99 = latencies_sorted[min(n - 1, int(n * 0.99))]
    return f"avg={avg:.3f}ms | p50={p50:.3f}ms | p95={p95:.3f}ms | p99={p99:.3f}ms | min={latencies_sorted[0]:.3f}ms | max={latencies_sorted[-1]:.3f}ms"


def run_benchmarks():
    print("=" * 80)
    print("  SNIST ERP — PHASE 2 AUTHENTICATION & TOKEN BENCHMARK HARNESS")
    print("=" * 80)

    # -------------------------------------------------------------------------
    # Benchmark 1: Password Hash Verification (Cold vs Warm)
    # -------------------------------------------------------------------------
    print("\n[1/4] Benchmarking Password Verification Layer...")
    clear_password_verify_cache()
    test_pwd = "BurstStudent@2026"
    test_hash = get_password_hash(test_pwd)

    # Cold verification
    t0 = time.perf_counter()
    res_cold = verify_password(test_pwd, test_hash)
    t_cold_ms = (time.perf_counter() - t0) * 1000
    print(f"  • Cold Bcrypt Verification: {t_cold_ms:.2f} ms (Result: {res_cold})")

    # Warm verifications (1,000 iterations)
    N_pwd = 1000
    warm_latencies = []
    t_start = time.perf_counter()
    for _ in range(N_pwd):
        t0 = time.perf_counter()
        verify_password(test_pwd, test_hash)
        warm_latencies.append((time.perf_counter() - t0) * 1000)
    t_warm_total = time.perf_counter() - t_start
    pwd_ops_per_sec = N_pwd / t_warm_total

    print(f"  • Warm In-Memory Verification ({N_pwd:,} ops in {t_warm_total:.3f}s):")
    print(f"    - {format_stats(warm_latencies)}")
    print(f"    - Throughput: {pwd_ops_per_sec:,.1f} verifications/sec (Speedup: {t_cold_ms / statistics.mean(warm_latencies):,.1f}x)")
    cache_stats = get_password_verify_cache_stats()
    print(f"    - Cache State: {cache_stats}")

    # -------------------------------------------------------------------------
    # Benchmark 2: Launch Token In-Memory Resolution (< 0.05ms)
    # -------------------------------------------------------------------------
    print("\n[2/4] Benchmarking Launch Token Fast-Path Resolution (Zero-DB)...")
    from unittest.mock import MagicMock
    session_id = 999
    short_code = "7XYZ8ABC"
    now_ts = time.time()
    current_step = int(now_ts // 10)

    with _CACHE_LOCK:
        _SHORT_CODE_CACHE[short_code] = {
            "session_id": session_id,
            "period_count": 2,
            "issued_slot": current_step,
            "expires_slot": current_step + 100,
            "is_active": True
        }

    token = generate_launch_token(session_id=session_id, short_code=short_code, v=current_step)
    mock_db = MagicMock()

    # Prime
    ShortTokenService.validate_attendance_token(db=mock_db, payload_or_code=token, v=current_step, now_ts=now_ts)

    N_token = 2000
    token_latencies = []
    t_start = time.perf_counter()
    for _ in range(N_token):
        t0 = time.perf_counter()
        ShortTokenService.validate_attendance_token(db=mock_db, payload_or_code=token, v=current_step, now_ts=now_ts)
        token_latencies.append((time.perf_counter() - t0) * 1000)
    t_token_total = time.perf_counter() - t_start
    token_ops_per_sec = N_token / t_token_total

    print(f"  • Launch Token Validations ({N_token:,} ops in {t_token_total:.3f}s):")
    print(f"    - {format_stats(token_latencies)}")
    print(f"    - Throughput: {token_ops_per_sec:,.1f} validations/sec")
    print(f"    - DB Queries Executed: {mock_db.query.call_count} (Mandatory Zero DB calls on hits)")

    # -------------------------------------------------------------------------
    # Benchmark 3: Scan Pipeline Pre-Filter Fast-Rejection (< 0.05ms)
    # -------------------------------------------------------------------------
    print("\n[3/4] Benchmarking Scan Pipeline Pre-Filter Fast-Rejection...")
    clear_invalid_token_prefilter_cache()
    req = MagicMock()
    req.claim_token = None
    req.session_token = "REPLAYED_INVALID_TOKEN_TEST"
    req.short_code = None
    req.v = 50
    req.is_offline_submission = False

    student = MagicMock()
    student.roll_number = "21951A0501"
    request = MagicMock()
    request.headers = {}
    mock_tracker = MagicMock()

    # Cold rejection
    try:
        verify_and_resolve_scan_token(req, "tr_key", student, request, mock_db, mock_tracker, now_ts)
    except Exception:
        pass

    N_prefilter = 2000
    prefilter_latencies = []
    t_start = time.perf_counter()
    for _ in range(N_prefilter):
        t0 = time.perf_counter()
        try:
            verify_and_resolve_scan_token(req, "tr_key", student, request, mock_db, mock_tracker, now_ts)
        except Exception:
            pass
        prefilter_latencies.append((time.perf_counter() - t0) * 1000)
    t_prefilter_total = time.perf_counter() - t_start
    prefilter_ops_sec = N_prefilter / t_prefilter_total

    print(f"  • Pre-Filter Fast-Rejections ({N_prefilter:,} ops in {t_prefilter_total:.3f}s):")
    print(f"    - {format_stats(prefilter_latencies)}")
    print(f"    - Throughput: {prefilter_ops_sec:,.1f} rejections/sec")
    print(f"    - Pre-Filter Stats: {get_invalid_token_prefilter_stats()}")

    # -------------------------------------------------------------------------
    # Benchmark 4: End-to-End HTTP /api/v1/auth/login Throughput (> 50 req/s)
    # -------------------------------------------------------------------------
    print("\n[4/4] Benchmarking End-to-End HTTP /api/v1/auth/login Endpoint...")
    db = SessionLocal()
    bench_user = db.query(User).filter(User.username == "PERF_BENCH_TEACHER").first()
    if not bench_user:
        bench_user = User(
            username="PERF_BENCH_TEACHER",
            password_hash=get_password_hash("PerfTestPass@2026"),
            role=UserRole.TEACHER,
            is_active=True
        )
        db.add(bench_user)
        db.commit()
    else:
        bench_user.password_hash = get_password_hash("PerfTestPass@2026")
        db.commit()
    db.close()

    client = TestClient(app)
    login_payload = {
        "username": "PERF_BENCH_TEACHER",
        "password": "PerfTestPass@2026"
    }

    # Cold HTTP login
    t0 = time.perf_counter()
    resp_cold = client.post("/api/v1/auth/login", json=login_payload)
    t_http_cold_ms = (time.perf_counter() - t0) * 1000
    print(f"  • Cold HTTP Login: {t_http_cold_ms:.2f} ms (Status: {resp_cold.status_code})")

    # Warm HTTP logins (burst simulation of 100 requests)
    N_http = 100
    http_latencies = []
    t_start = time.perf_counter()
    for _ in range(N_http):
        t0 = time.perf_counter()
        resp = client.post("/api/v1/auth/login", json=login_payload)
        http_latencies.append((time.perf_counter() - t0) * 1000)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    t_http_total = time.perf_counter() - t_start
    http_throughout_rps = N_http / t_http_total

    print(f"  • Warm HTTP Logins ({N_http:,} requests in {t_http_total:.3f}s):")
    print(f"    - {format_stats(http_latencies)}")
    print(f"    - Sequential Throughput: {http_throughout_rps:,.1f} logins/sec")

    # Concurrent burst simulation (4 threads, 50 requests each = 200 requests)
    def worker_login(_):
        c = TestClient(app)
        t0 = time.perf_counter()
        r = c.post("/api/v1/auth/login", json=login_payload)
        return (time.perf_counter() - t0) * 1000, r.status_code

    t_start = time.perf_counter()
    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(worker_login, range(200)))
    t_conc_total = time.perf_counter() - t_start
    conc_latencies = [lat for lat, status_code in results if status_code == 200]
    conc_throughput_rps = len(results) / t_conc_total

    print(f"  • Concurrent Multi-Threaded Burst (4 workers, 200 requests in {t_conc_total:.3f}s):")
    print(f"    - {format_stats(conc_latencies)}")
    print(f"    - Concurrent Throughput: {conc_throughput_rps:,.1f} logins/sec")

    # Verification of Target Criterion (> 50 logins/sec)
    passed_target = conc_throughput_rps > 50.0
    print("\n" + "=" * 80)
    print(f"  PHASE 2 TARGET CRITERION (> 50 logins/sec): {'[PASSED]' if passed_target else '[FAILED]'}")
    print(f"  Achieved: {conc_throughput_rps:,.1f} logins/sec ({conc_throughput_rps / 50.0:.1f}x the requirement)")
    print("=" * 80)


if __name__ == "__main__":
    run_benchmarks()
