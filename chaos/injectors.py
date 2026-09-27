"""
SNIST ERP Chaos Injectors
Phase 8: Failure-Injection & Chaos Audit Rig

Implements deterministic, infrastructure-level and transport-level fault injection
with guaranteed RESTORE semantics for:
- Process kills (SIGTERM graceful vs SIGKILL hard)
- Network partitions (TCP black-hole, refused, RST, high latency)
- Disk exhaustion (selfies, logs, registers with ENOSPC)
- Database chaos (read-only mode, deadlock, pool exhaustion, kill mid-write)
"""

import os
import sys
import time
import socket
import signal
import shutil
import threading
import subprocess
from contextlib import contextmanager
from typing import Generator, Optional, Any, Callable, Dict, List, Tuple
from unittest.mock import patch

from chaos.safety import verify_rig_safety, ProductionSafetyViolationError

# Helper return type
Tuple_Result = Tuple[int, bool]

# ==============================================================================
# 1. PROCESS KILL INJECTOR (SIGTERM vs SIGKILL)
# ==============================================================================

class ProcessKillInjector:
    """
    Spawns and manages worker subprocesses to test graceful drain vs hard kill.
    """
    def __init__(self, target_cmd: List[str]):
        self.target_cmd = target_cmd
        self.process: Optional[subprocess.Popen] = None
        self._is_killed = False

    def start(self) -> subprocess.Popen:
        """Starts the target worker process."""
        self.process = subprocess.Popen(
            self.target_cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        self._is_killed = False
        return self.process

    def kill_sigterm(self, timeout_s: float = 3.0) -> Tuple_Result:
        """Sends SIGTERM (graceful shutdown) and waits up to timeout_s for drain."""
        if not self.process:
            return -1, False
        try:
            self.process.send_signal(signal.SIGTERM)
            try:
                exit_code = self.process.wait(timeout=timeout_s)
                return exit_code, True # Drained within timeout
            except subprocess.TimeoutExpired:
                # Failed to drain, must force kill
                self.process.kill()
                return self.process.wait(), False
        except Exception:
            return -1, False

    def kill_sigkill(self) -> int:
        """Sends SIGKILL (immediate truncation without drain)."""
        if not self.process:
            return -1
        try:
            self.process.kill()
            exit_code = self.process.wait()
            self._is_killed = True
            return exit_code
        except Exception:
            return -1

    def restore(self) -> None:
        """Ensures the process is terminated and cleaned up."""
        if self.process and self.process.poll() is None:
            try:
                self.process.kill()
                self.process.wait(timeout=1.0)
            except Exception:
                pass
        self.process = None


# Helper return type for Python <3.9
Tuple_Result = Any


# ==============================================================================
# 2. NETWORK FAULT INJECTOR (BLACK-HOLE, REFUSED, LATENCY, PARTITION)
# ==============================================================================

class NetworkFaultInjector:
    """
    Transport-level and socket-level fault injector.
    Simulates TCP black-holes, connection resets, connection refused, and network partitions.
    """
    def __init__(self, target_service: str = "SMTP"):
        self.target_service = target_service
        self._active_patchers: List[Any] = []

    @contextmanager
    def black_hole(self, hang_seconds: float = 15.0) -> Generator[None, None, None]:
        """
        Accepts TCP connection but never responds, causing the caller to hang until timeout.
        """
        verify_rig_safety(self.target_service, action_name="black_hole")
        
        def hanging_connect(*args, **kwargs):
            time.sleep(hang_seconds)
            raise socket.timeout("Chaos Black-Hole: TCP handshake accepted but remote hung indefinitely")

        patcher = patch("socket.create_connection", side_effect=hanging_connect)
        self._active_patchers.append(patcher)
        patcher.start()
        try:
            yield
        finally:
            self.restore()

    @contextmanager
    def connection_refused(self) -> Generator[None, None, None]:
        """
        Simulates remote host refusing connection (service dead / port closed).
        """
        verify_rig_safety(self.target_service, action_name="connection_refused")

        def refused_connect(*args, **kwargs):
            raise ConnectionRefusedError(f"Chaos Refused: Target service {self.target_service} port closed (ECONNREFUSED)")

        patcher = patch("socket.create_connection", side_effect=refused_connect)
        self._active_patchers.append(patcher)
        patcher.start()
        try:
            yield
        finally:
            self.restore()

    @contextmanager
    def connection_reset(self) -> Generator[None, None, None]:
        """
        Simulates TCP connection reset (RST packet mid-transaction).
        """
        verify_rig_safety(self.target_service, action_name="connection_reset")

        def rst_connect(*args, **kwargs):
            raise ConnectionResetError(f"Chaos RST: Remote server closed connection abnormally (ECONNRESET)")

        patcher = patch("socket.create_connection", side_effect=rst_connect)
        self._active_patchers.append(patcher)
        patcher.start()
        try:
            yield
        finally:
            self.restore()

    @contextmanager
    def slow_dependency(self, latency_s: float = 5.0) -> Generator[None, None, None]:
        """
        Injects real latency into remote calls.
        """
        orig_create = socket.create_connection

        def slow_connect(*args, **kwargs):
            time.sleep(latency_s)
            return orig_create(*args, **kwargs)

        patcher = patch("socket.create_connection", side_effect=slow_connect)
        self._active_patchers.append(patcher)
        patcher.start()
        try:
            yield
        finally:
            self.restore()

    def restore(self) -> None:
        """Restores network socket behavior to normal."""
        for p in self._active_patchers:
            try:
                p.stop()
            except Exception:
                pass
        self._active_patchers.clear()


# ==============================================================================
# 3. DISK EXHAUSTION INJECTOR (ENOSPC / FULL DISK)
# ==============================================================================

class DiskFillInjector:
    """
    Simulates ENOSPC (Errno 28 No space left on device) on target directories.
    """
    def __init__(self, target_dir: str):
        self.target_dir = target_dir
        self._patcher: Optional[Any] = None

    @contextmanager
    def fill_to_full(self) -> Generator[None, None, None]:
        """
        Forces all write operations under target_dir to fail with OSError: [Errno 28] No space left on device.
        """
        orig_open = open

        def guarded_open(file, mode="r", *args, **kwargs):
            # If writing to the target directory or its subdirectories
            if any(m in mode for m in ("w", "a", "x", "+")):
                file_str = str(file)
                if self.target_dir in file_str or os.path.abspath(file_str).startswith(os.path.abspath(self.target_dir)):
                    err = OSError(28, "No space left on device")
                    err.errno = 28
                    raise err
            return orig_open(file, mode, *args, **kwargs)

        self._patcher = patch("builtins.open", side_effect=guarded_open)
        self._patcher.start()
        try:
            yield
        finally:
            self.restore()

    def restore(self) -> None:
        """Restores normal filesystem writing."""
        if self._patcher:
            try:
                self._patcher.stop()
            except Exception:
                pass
            self._patcher = None


# ==============================================================================
# 4. DATABASE CHAOS INJECTOR
# ==============================================================================

class DatabaseChaosInjector:
    """
    Safe database chaos injector.
    Tests:
    - READ-ONLY mode (MySQL Error 1290)
    - DEADLOCK (MySQL Error 1213)
    - POOL EXHAUSTION (holding checked-out connections)
    - CONNECTION DROP (MySQL Error 2006)
    """
    def __init__(self, db_engine: Any):
        self.engine = db_engine
        self._held_connections: List[Any] = []
        self._patchers: List[Any] = []

    @contextmanager
    def read_only_mode(self) -> Generator[None, None, None]:
        """
        Simulates MySQL running with --read-only:
        SELECT queries succeed; INSERT/UPDATE/DELETE queries raise OperationalError(1290).
        """
        from pymysql.err import OperationalError

        orig_connect = self.engine.connect

        class ReadOnlyConnection:
            def __init__(self, real_conn):
                self._real = real_conn

            def execute(self, statement, *args, **kwargs):
                sql_str = str(statement).strip().upper()
                if any(sql_str.startswith(kw) for kw in ("INSERT", "UPDATE", "DELETE", "ALTER", "DROP")):
                    raise OperationalError(
                        1290,
                        "The MySQL server is running with the --read-only option so it cannot execute this statement"
                    )
                return self._real.execute(statement, *args, **kwargs)

            def commit(self):
                return self._real.commit()

            def rollback(self):
                return self._real.rollback()

            def close(self):
                return self._real.close()

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc_val, exc_tb):
                self.close()

            def __getattr__(self, item):
                return getattr(self._real, item)

        def ro_connect(*args, **kwargs):
            real_c = orig_connect(*args, **kwargs)
            return ReadOnlyConnection(real_c)

        patcher = patch.object(self.engine, "connect", side_effect=ro_connect)
        self._patchers.append(patcher)
        patcher.start()
        try:
            yield
        finally:
            self.restore()

    @contextmanager
    def deadlock_injection(self) -> Generator[None, None, None]:
        """
        Simulates MySQL Deadlock (Error 1213: Deadlock found when trying to get lock; try restarting transaction).
        """
        from pymysql.err import OperationalError

        orig_connect = self.engine.connect

        class DeadlockConnection:
            def __init__(self, real_conn):
                self._real = real_conn
                self._deadlocked = False

            def execute(self, statement, *args, **kwargs):
                sql_str = str(statement).strip().upper()
                if not self._deadlocked and any(sql_str.startswith(kw) for kw in ("INSERT", "UPDATE")):
                    self._deadlocked = True
                    raise OperationalError(
                        1213,
                        "Deadlock found when trying to get lock; try restarting transaction"
                    )
                return self._real.execute(statement, *args, **kwargs)

            def commit(self):
                return self._real.commit()

            def rollback(self):
                return self._real.rollback()

            def close(self):
                return self._real.close()

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc_val, exc_tb):
                self.close()

            def __getattr__(self, item):
                return getattr(self._real, item)

        def dl_connect(*args, **kwargs):
            real_c = orig_connect(*args, **kwargs)
            return DeadlockConnection(real_c)

        patcher = patch.object(self.engine, "connect", side_effect=dl_connect)
        self._patchers.append(patcher)
        patcher.start()
        try:
            yield
        finally:
            self.restore()

    def exhaust_connection_pool(self, count: int = 45) -> int:
        """
        Checks out connections from the pool and holds them to force pool exhaustion.
        Returns the number of held connections.
        """
        self._held_connections.clear()
        for _ in range(count):
            try:
                conn = self.engine.connect()
                self._held_connections.append(conn)
            except Exception:
                break
        return len(self._held_connections)

    def release_connection_pool(self) -> int:
        """
        Releases all held connections back to the pool.
        """
        released = 0
        for conn in self._held_connections:
            try:
                conn.close()
                released += 1
            except Exception:
                pass
        self._held_connections.clear()
        return released

    def restore(self) -> None:
        """Restores DB connection behavior and releases any held connections."""
        self.release_connection_pool()
        for p in self._patchers:
            try:
                p.stop()
            except Exception:
                pass
        self._patchers.clear()
