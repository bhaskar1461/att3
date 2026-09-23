import asyncio
import time
import statistics
import httpx

TARGET_URL = "http://127.0.0.1:8001/api/v1/auth/login"
CONCURRENCY_TIERS = [25, 50, 100, 200, 300]

async def send_login_request(client, idx):
    payload = {
        "username": "demostudent",
        "password": "demostudent@2026",
        "device_public_id": f"bench-device-{idx:04d}",
        "device_secret": f"bench-secret-{idx:04d}"
    }
    t0 = time.perf_counter()
    try:
        resp = await client.post(TARGET_URL, json=payload, timeout=30.0)
        dt = (time.perf_counter() - t0) * 1000
        return resp.status_code, dt, None
    except Exception as ex:
        dt = (time.perf_counter() - t0) * 1000
        return 0, dt, str(ex)

async def run_login_tier(tier):
    limits = httpx.Limits(max_connections=600, max_keepalive_connections=400)
    async with httpx.AsyncClient(limits=limits, verify=False) as client:
        # Warmup
        try:
            await client.post(TARGET_URL, json={"username":"demostudent","password":"demostudent@2026","device_public_id":"w","device_secret":"w"}, timeout=5.0)
        except Exception:
            pass

        t_start = time.perf_counter()
        tasks = [send_login_request(client, i) for i in range(tier)]
        results = await asyncio.gather(*tasks)
        total_time = time.perf_counter() - t_start

    status_counts = {}
    latencies = []
    errors = []
    for code, dt, err in results:
        status_counts[code] = status_counts.get(code, 0) + 1
        latencies.append(dt)
        if err:
            errors.append(err)

    latencies.sort()
    p50 = statistics.median(latencies) if latencies else 0
    p95 = latencies[int(len(latencies) * 0.95)] if latencies else 0
    rps = tier / total_time if total_time > 0 else 0

    print(f"\n--- LOGIN TIER: {tier} CONCURRENT STUDENTS ---")
    print(f"Total Time: {total_time:.3f}s | Throughput: {rps:.1f} logins/sec")
    print(f"Status Breakdown: {status_counts}")
    print(f"Latencies: Min: {min(latencies):.1f}ms | p50: {p50:.1f}ms | p95: {p95:.1f}ms | Max: {max(latencies):.1f}ms")
    if errors:
        print(f"Errors ({len(errors)}): {errors[:3]}")

    return {
        "tier": tier,
        "total_time": total_time,
        "rps": rps,
        "status_counts": status_counts,
        "p50": p50,
        "p95": p95,
        "errors": len(errors)
    }

async def main():
    print("================================================================================")
    print("STARTING EMPIRICAL BENCHMARK: CONCURRENT STUDENT LOGINS (BCRYPT + DB + JWT)")
    print("================================================================================")
    summaries = []
    for tier in CONCURRENCY_TIERS:
        res = await run_login_tier(tier)
        summaries.append(res)
        await asyncio.sleep(2.0)

    print("\n" + "=" * 80)
    print("CONCURRENT LOGIN BENCHMARK SUMMARY MATRIX")
    print("=" * 80)
    print(f"{'Concurrency':<12} | {'200 OK':<8} | {'Failures':<10} | {'Throughput':<14} | {'p50 (ms)':<10} | {'Total Burst Time'}")
    print("-" * 80)
    for s in summaries:
        ok = s["status_counts"].get(200, 0)
        fail = sum(c for k, c in s["status_counts"].items() if k != 200) + s["errors"]
        print(f"{s['tier']:<12} | {ok:<8} | {fail:<10} | {s['rps']:<6.1f} login/s | {s['p50']:<10.1f} | {s['total_time']:.2f}s")
    print("=" * 80)

if __name__ == "__main__":
    asyncio.run(main())
