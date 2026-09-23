"""
SNIST ERP — Scanner Engine Early Signal Benchmark Runner (Python Wrapper)
Invokes scripts/run_scanner_engine_benchmark.js in frontend context.
"""

import subprocess
import sys
import os

def main():
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    frontend_dir = os.path.join(root_dir, "frontend")
    js_script = os.path.join(root_dir, "scripts", "run_scanner_engine_benchmark.js")
    
    cmd = ["node", js_script]
    print(f"Running scanner engine benchmark: {' '.join(cmd)}")
    ret = subprocess.run(cmd, cwd=frontend_dir)
    sys.exit(ret.returncode)

if __name__ == "__main__":
    main()
