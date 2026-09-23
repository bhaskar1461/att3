# SNIST ERP ATTENDANCE SYSTEM — MAINTENANCE & REBUILD GUIDE (MAINTENANCE_GUIDE.md)

> **Audience**: Core Maintainers, Backend Engineers, DevOps / Infrastructure Leads  
> **Classification**: Technical Engineering Handover Guide  
> **Associated Artifacts**: [EVIDENCE_INDEX.md](file:///c:/Users/bhask/Desktop/att2/docs/EVIDENCE_INDEX.md), [CONFIG_REFERENCE.md](file:///c:/Users/bhask/Desktop/att2/docs/CONFIG_REFERENCE.md)

---

## 1. Automated Test Suite Map (What Guards What)

The test suite consists of 222 automated unit, integration, and security tests. **All 222 tests must pass 100% green before any production release.**

| Test Suite File | Component / Guard Target | Invariant Guarded |
|---|---|---|
| `tests/test_scan_telemetry.py` | Telemetry Pipeline & Overhead | Timing overhead must be $< 2.0\text{ms}$; 12 core event schemas verified; rollup integrity. |
| `tests/test_short_token_security.py` | Crockford Base32 Short Token | Dual-format support; HMAC derivability; token space entropy ($1.1 \times 10^{12}$); zero collisions. |
| `tests/test_qr_display_and_rotation.py` | Projector QR Engine | 10s rotation steps; 3s sliding grace; ECC L module density; display type classification. |
| `tests/test_week8_ladder_and_manual_guardrails.py` | Camera Ladder & Manual Guardrails | Tier-specific timeout ladder; AMBER ($\ge 15\%$) and RED ($\ge 30\%$) threshold calculations; 25-cap modal. |
| `tests/test_week9_scale_and_offline.py` | Async Ingestion & Offline Sync | Bounded 10m offline submission window (`SUBMIT_GRACE_MINUTES`); worker pool backpressure. |
| `tests/test_device_binding.py` | Anti-Proxy Device Binding | 30-minute hardware lock; account switching lockout (HTTP 403); 5-attempt rate limit. |
| `tests/test_attendance_engine.py` | Core Attendance Logic | Single-use per student; session lifecycle; database constraints; transaction rollbacks. |
| `tests/test_compliance_hardening.py` | JNTUH R25 Regulatory Engine | 75% eligibility, 65% condonation cutoffs; late-join proration; approved absence exemptions. |
| `tests/test_frappe_blueprints_and_sync.py` | Google Sheets & ERP Sync | Multi-tenant sheet synchronization; schema translation; queue persistence. |

### Running the Full Verification Corpus
```bash
# From repository root:
cd backend
python -m unittest discover -s tests -p "test_*.py" -v
```

---

## 2. Emscripten WASM Rebuild Procedure (12-Month Guarantee)

The WebAssembly scanner binary (`zxing_scanner.wasm`) was compiled from `zxing-cpp` (v2.2.1) using Emscripten. Any future engineer can rebuild this artifact from clean source using the following verified sequence:

### Prerequisites
* Docker engine installed, OR
* Native Emscripten SDK (`emsdk` v3.1.45+) and CMake 3.22+.

### Build Instructions (Reproducible via Docker)
```bash
# 1. Clone zxing-cpp source
git clone --depth 1 --branch v2.2.1 https://github.com/zxing-cpp/zxing-cpp.git zxing-src
cd zxing-src

# 2. Run Emscripten CMake configuration
docker run --rm -v $(pwd):/src -u $(id -u):$(id -g) emscripten/emsdk:3.1.45 \
    emcmake cmake -B build-wasm \
    -DCMAKE_BUILD_TYPE=MinSizeRel \
    -DBUILD_SHARED_LIBS=OFF \
    -DBUILD_EXAMPLES=OFF \
    -DBUILD_BLACKBOX_TESTS=OFF \
    -DZXING_READERS=QRCode \
    -DZXING_WRITERS=OFF

# 3. Compile to WebAssembly with exported bindings
docker run --rm -v $(pwd):/src -u $(id -u):$(id -g) emscripten/emsdk:3.1.45 \
    emmake cmake --build build-wasm --target zxing_wasm

# 4. Copy generated artifacts into PWA assets
cp build-wasm/zxing_scanner.wasm ../frontend/public/wasm/
cp build-wasm/zxing_scanner.js ../frontend/src/services/scanner/
```

### Compiler Optimization Flags Used
* `-O3 -flto`: Maximum optimization and link-time optimization.
* `-s MODULARIZE=1 -s EXPORT_NAME="ZXingWasm"`: Clean ES module export.
* `-s ALLOW_MEMORY_GROWTH=1`: Accommodates dynamic camera frame buffers.
* `-s TOTAL_STACK=1048576`: 1MB stack size for recursive binarizers.

---

## 3. Rollback Procedures Per Feature Flag

All architectural enhancements feature immediate zero-downtime rollback controls via environment variables:

| Feature Area | Environment Flag | Normal Value | Rollback Value | Immediate Effect |
|---|---|---|---|---|
| **Scanner Engine** | `SCANNER_ENGINE` | `"wasm"` | `"jsqr"` | Reverts frontend decoding to pure JS engine. Fixes any device-specific WASM memory allocation faults. |
| **QR Payload Format** | `QR_TOKEN_FORMAT` | `"dual"` | `"legacy"` | Reverts token emission to legacy V1/V2 96-char format if any parser issue arises. |
| **QR Render Display** | `QR_RENDER_VERSION`| `"v2"` | `"v1"` | Reverts projector display to standard bordered rendering if projector clipping occurs. |
| **Offline Grace Policy**| `SUBMIT_GRACE_MINUTES`| `10` | `0` | Immediately closes offline acceptance window in the event of an active proxy investigation. |

---

## 4. Database Maintenance, Telemetry Purge & Rollups

### Daily Aggregation Rollup Job
The database pre-aggregates raw telemetry events into daily summary rows to guarantee sub-50ms dashboard query times:
```bash
# Execute daily rollup calculation (scheduled via cron at 23:45 IST)
python scripts/calculate_daily_telemetry_rollups.py
```

### Semester Purge Operation (90-Day Raw Event Purge)
Raw event telemetry table (`qr_scan_telemetry_events`) accumulates ~50,000 rows per month. To maintain MySQL query index velocity, run the retention purge script quarterly:
```bash
# Purges raw telemetry older than TELEMETRY_RETENTION_DAYS (default 90 days)
# NOTE: Pre-aggregated rollups in qr_scanner_health_daily are PRESERVED indefinitely.
python scripts/purge_stale_telemetry.py --days 90
```

---

## 5. Frontend PWA Build & Deployment
```bash
cd frontend
npm ci
npm run build
```
* **Output Directory**: `frontend/dist/`
* **Artifacts Generated**: Single-page application bundle, service worker (`sw.js`), and offline manifest (`manifest.webmanifest`).
* **Bundle Budget**: Total initial vendor JS chunk must remain $< 350\text{ KB}$ gzipped.
