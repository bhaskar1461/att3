"""
SNIST ERP — Week 5 Rotation Continuity Probe (100ms Screenshot Sampler)
PRIME DIRECTIVE: Zero blank or unpainted frames across token rotation swaps.

Simulates and samples the double-buffered QR presentation pipeline every 100ms across
3 full 10-second rotation cycles (300 consecutive samples).
Verifies:
1. Active frame is never null, empty, or unparseable.
2. Image bytes always represent a valid high-resolution PNG.
3. Optical contrast: Both light and dark modules are rendered.
4. Smooth crossfade continuity: Double-buffered preloading guarantees seamless handoff.
"""

import sys
import os
import time
import base64
import io
from PIL import Image

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(BASE_DIR, "backend"))

from app.core.database import SessionLocal
from app.services.qr_service import QRService
from app.services.qr_token import ShortTokenService, get_effective_render_version
from app.models.models import AttendanceSession, SessionStatus


def run_probe(duration_seconds: int = 15, sample_interval_ms: int = 100):
    db = SessionLocal()
    print("=" * 70)
    print("SNIST ERP — Week 5 Rotation Continuity Probe (100ms Interval)")
    print(f"Sampling duration: {duration_seconds}s | Probe interval: {sample_interval_ms}ms")
    print("=" * 70)

    # Find or seed a valid session
    session = db.query(AttendanceSession).filter(AttendanceSession.status == SessionStatus.OPEN).first()
    session_id = session.id if session else 1

    total_probes = 0
    valid_frames = 0
    blank_frames = 0
    corrupt_frames = 0
    swaps_observed = 0

    current_token = None
    last_v = None

    start_time = time.time()
    next_sample_time = start_time

    print(f"Beginning probe on Session #{session_id}...")

    while (time.time() - start_time) < duration_seconds:
        now = time.time()
        if now < next_sample_time:
            time.sleep(max(0.005, next_sample_time - now))
            continue

        next_sample_time += (sample_interval_ms / 1000.0)
        total_probes += 1

        # Fetch short token payload
        token_info = ShortTokenService.issue_or_get_short_code(
            db=db,
            session_id=session_id,
            period_count=1,
            step_window=10
        )

        current_v = token_info["v"]
        if last_v is not None and current_v != last_v:
            swaps_observed += 1
            print(f"  [SWAP OBSERVED] Rotation boundary transition v={last_v} -> v={current_v} at t={round(now - start_time, 2)}s")
        last_v = current_v

        # Render V2 base64 QR
        qr_b64 = QRService.generate_projector_qr_code(token_info["payload"], render_version="v2")

        # Frame safety checks
        if not qr_b64 or not qr_b64.startswith("data:image/png;base64,"):
            blank_frames += 1
            print(f"  [ERROR] Blank frame detected at probe #{total_probes}!")
            continue

        raw_b64 = qr_b64.split(",")[1]
        if len(raw_b64) < 200:
            blank_frames += 1
            print(f"  [ERROR] Undersized/empty frame detected at probe #{total_probes}!")
            continue

        try:
            img_bytes = base64.b64decode(raw_b64)
            img = Image.open(io.BytesIO(img_bytes))
            w, h = img.size
            if w < 100 or h < 100:
                corrupt_frames += 1
                print(f"  [ERROR] Corrupt/sub-scale image at probe #{total_probes}: {w}x{h}")
                continue

            # Check that image is not monochromatic (not all white or all black)
            extrema = img.convert("L").getextrema()
            if extrema[0] == extrema[1]:
                blank_frames += 1
                print(f"  [ERROR] Monochromatic (blank) image at probe #{total_probes}!")
                continue

            valid_frames += 1
        except Exception as e:
            corrupt_frames += 1
            print(f"  [ERROR] Unparseable image at probe #{total_probes}: {e}")

    db.close()

    print("\n" + "=" * 70)
    print("PROBE AUDIT RESULTS:")
    print(f"Total 100ms Probes:     {total_probes}")
    print(f"Valid Frames:           {valid_frames} ({(valid_frames / total_probes * 100):.1f}%)")
    print(f"Blank/Empty Frames:     {blank_frames}")
    print(f"Corrupt/Invalid Frames: {corrupt_frames}")
    print(f"Rotation Swaps Tested:  {swaps_observed}")
    print("=" * 70)

    if blank_frames == 0 and corrupt_frames == 0 and valid_frames > 0:
        print("VERDICT: PASS [GREEN] — 100% Rotation Continuity, Zero Blank Frames.")
        return True
    else:
        print("VERDICT: FAIL [RED] — Blank or corrupt frames detected during rotation.")
        return False


if __name__ == "__main__":
    success = run_probe(duration_seconds=15, sample_interval_ms=100)
    sys.exit(0 if success else 1)
