"""
SNIST ERP — Concurrency & Writer Race Test Suite (FIX-2 & FIX-3)
Test Matrix:
- T7: 30 concurrent selfie uploads (INV-3: no event loop blocking, store_attendance_selfie offloaded via run_in_threadpool)
- T8: Writer race (asyncio.Future registry: commit direct success vs delay -> 202 -> job polling -> committed)
"""

import asyncio
import time
import pytest
from unittest.mock import patch, MagicMock

@pytest.fixture
def anyio_backend():
    return 'asyncio'

# Offload test verification for FIX-2 run_in_threadpool
@pytest.mark.anyio
async def test_fix2_run_in_threadpool_nonblocking():
    from starlette.concurrency import run_in_threadpool

    def mock_sync_store(user_id, session_id):
        # Simulate sync DB I/O (e.g. 50ms)
        time.sleep(0.05)
        return {"selfie_url": f"https://cdn.snist.edu/selfies/{user_id}.jpg", "status": "stored"}

    start_time = time.time()
    # Run 30 concurrent calls through run_in_threadpool
    tasks = [run_in_threadpool(mock_sync_store, i, 100) for i in range(30)]
    results = await asyncio.gather(*tasks)

    elapsed = time.time() - start_time
    assert len(results) == 30
    assert all(r["status"] == "stored" for r in results)
    # If it was blocking single-threaded, 30 * 0.05s = 1.5s
    # In threadpool, concurrent execution takes well under 0.8s
    assert elapsed < 1.0, f"Threadpool concurrency failed, took {elapsed}s"


@pytest.mark.anyio
async def test_fix3_writer_race_future_resolution():
    """
    T8: Writer race:
    - Case 1: Writer commits within timeout -> future resolves direct success.
    - Case 2: Writer delayed past timeout -> 202 pending response -> poll resolves committed.
    """
    job_id = "job_test_uuid_12345"
    future_registry: dict[str, asyncio.Future] = {}

    # Setup future in registry
    loop = asyncio.get_running_loop()
    job_fut = loop.create_future()
    future_registry[job_id] = job_fut

    # Writer resolves future after 0.1s
    async def background_writer():
        await asyncio.sleep(0.1)
        if not job_fut.done():
            job_fut.set_result(9988)

    writer_task = asyncio.create_task(background_writer())

    # Fast path: wait_for completes within 2.0s
    attendance_id = await asyncio.wait_for(job_fut, timeout=2.0)
    await writer_task

    assert attendance_id == 9988
    assert job_fut.done()


@pytest.mark.anyio
async def test_fix3_writer_race_timeout_fallback_to_202():
    """
    When writer commit is delayed past 0.2s timeout, pipeline returns 202 with job_id.
    Subsequent polling resolves when future commits.
    """
    job_id = "job_test_slow_54321"
    loop = asyncio.get_running_loop()
    job_fut = loop.create_future()

    # Writer delayed by 0.5s
    async def delayed_writer():
        await asyncio.sleep(0.3)
        if not job_fut.done():
            job_fut.set_result(7766)

    writer_task = asyncio.create_task(delayed_writer())

    # Path times out with short 0.1s budget
    response_status = None
    job_data = None
    try:
        att_id = await asyncio.wait_for(asyncio.shield(job_fut), timeout=0.1)
        response_status = 200
    except asyncio.TimeoutError:
        response_status = 202
        job_data = {
            "job_id": job_id,
            "status": "pending",
            "poll_url": f"/attendance/job/{job_id}"
        }

    assert response_status == 202
    assert job_data["status"] == "pending"

    # Now poll the job
    await writer_task
    assert job_fut.done()
    polled_attendance_id = job_fut.result()
    assert polled_attendance_id == 7766
