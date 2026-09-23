"""
SNIST ERP — Scanner Engine Dynamic Rollback Drill (Python Wrapper)
Invokes scripts/run_scanner_rollback_drill.js to verify zero-reload engine switching.
"""

import subprocess
import sys
import os

def main():
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    frontend_dir = os.path.join(root_dir, "frontend")
    js_script = os.path.join(root_dir, "scripts", "run_scanner_rollback_drill.js")
    
    cmd = ["node", js_script]
    print(f"Running scanner engine rollback drill: {' '.join(cmd)}")
    ret = subprocess.run(cmd, cwd=frontend_dir)
    sys.exit(ret.returncode)

if __name__ == "__main__":
    main()
