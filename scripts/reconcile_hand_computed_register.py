"""
Hand-computed Course Attendance Register Reconciliation Script
Validates attendance_engine against a verified hand-computed register.
"""
import math
import sys
import os

backend_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend")
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.services.attendance_engine import (
    determine_jntuh_band,
    calculate_projected_classes_needed,
    BAND_ELIGIBLE,
    BAND_CONDONABLE,
    BAND_DETAINED,
    BAND_NO_DATA
)

def run_manual_reconciliation():
    print("=" * 80)
    print("JNTUH R25 ATTENDANCE ENGINE — HAND-COMPUTED REGISTER RECONCILIATION")
    print("=" * 80)

    # Scenario 1: Standard Regular Student (Eligible)
    # Conducted: 40, Attended: 32, Approved Absence: 0
    # Hand calculation: 32 / 40 = 80.0% -> ELIGIBLE
    eff_1 = 40 - 0
    pct_1 = round((32 / eff_1) * 100, 2)
    band_1 = determine_jntuh_band(pct_1)
    needed_1 = calculate_projected_classes_needed(40, 32, eff_1)
    assert pct_1 == 80.0
    assert band_1 == BAND_ELIGIBLE
    assert needed_1 == 0
    print(f"Scenario 1 (Regular Eligible): Conducted={eff_1}, Attended=32 -> {pct_1}% [{band_1}], Needed={needed_1} -> MATCH OK")

    # Scenario 2: Approved Absence Denominator Adjustment (Condonable)
    # Total Sessions: 40, Approved Absences (Medical): 2
    # Effective Denominator: 40 - 2 = 38
    # Attended: 26
    # Hand calculation: 26 / 38 = 68.42105... -> 68.42% -> CONDONABLE
    eff_2 = 40 - 2
    pct_2 = round((26 / eff_2) * 100, 2)
    band_2 = determine_jntuh_band(pct_2)
    needed_2 = calculate_projected_classes_needed(40, 26, eff_2)
    assert pct_2 == 68.42
    assert band_2 == BAND_CONDONABLE
    # remaining = 60 - 38 = 22 sessions
    # formula: ceil((0.75 * 38 - 26) / 0.25) = ceil((28.5 - 26) / 0.25) = ceil(2.5 / 0.25) = 10
    # Verification: (26 + 10) / (38 + 10) = 36 / 48 = 0.75 = 75.00%
    assert needed_2 == 10
    print(f"Scenario 2 (Approved Absence): Conducted={eff_2}, Attended=26 -> {pct_2}% [{band_2}], Needed={needed_2} -> MATCH OK")

    # Scenario 3: Chronic Absentee (Detained / Unrecoverable)
    # Conducted: 40, Attended: 24, Approved Absence: 0
    # Hand calculation: 24 / 40 = 60.0% -> DETAINED
    eff_3 = 40
    pct_3 = round((24 / eff_3) * 100, 2)
    band_3 = determine_jntuh_band(pct_3)
    needed_3 = calculate_projected_classes_needed(40, 24, eff_3)
    assert pct_3 == 60.0
    assert band_3 == BAND_DETAINED
    # remaining = 60 - 40 = 20 sessions
    # formula: ceil((0.75 * 40 - 24) / 0.25) = ceil((30 - 24) / 0.25) = 24
    # Since 24 > 20 remaining sessions, it is mathematically NOT_RECOVERABLE and capped to remaining sessions (20).
    assert needed_3 == 20
    print(f"Scenario 3 (Chronic Absentee): Conducted={eff_3}, Attended=24 -> {pct_3}% [{band_3}], Needed={needed_3} (NOT_RECOVERABLE capped) -> MATCH OK")

    # Scenario 4: Exact Boundary Cases
    # 64.99% -> DETAINED
    assert determine_jntuh_band(64.99) == BAND_DETAINED
    # 65.00% -> CONDONABLE
    assert determine_jntuh_band(65.00) == BAND_CONDONABLE
    # 74.99% -> CONDONABLE
    assert determine_jntuh_band(74.99) == BAND_CONDONABLE
    # 75.00% -> ELIGIBLE
    assert determine_jntuh_band(75.00) == BAND_ELIGIBLE
    print("Scenario 4 (Boundary Thresholds): 64.99%->DETAINED, 65.00%->CONDONABLE, 74.99%->CONDONABLE, 75.00%->ELIGIBLE -> MATCH OK")

    # Scenario 5: Zero-session handling
    # If conducted == 0 -> None or '—'
    assert determine_jntuh_band(None) == BAND_NO_DATA
    assert calculate_projected_classes_needed(0, 0, 0) is None
    print("Scenario 5 (Zero-Session Representation): Handled gracefully as '—' -> MATCH OK")

    print("=" * 80)
    print("ALL 5 HAND-COMPUTED SCENARIOS RECONCILED WITH 100% MATHEMATICAL PRECISION!")
    print("=" * 80)

if __name__ == "__main__":
    run_manual_reconciliation()
