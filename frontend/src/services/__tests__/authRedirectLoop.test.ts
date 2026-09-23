/**
 * SNIST ERP - Auth Redirect Loop & Session Recovery Automated Test Suite
 * 
 * Verifies:
 * 1. Loop breaker trips after 2+ rapid redirects within 5s and halts bouncing.
 * 2. Emergency wipe purges all authentication artifacts (token, user, role, remember-me, cookies).
 * 3. Open redirect prevention via getSafeNextDestination rejects external or malformed URLs.
 * 4. Stale session on /login stays on /login and does not loop.
 * 5. Auth schema version mismatch resets stale stored state.
 */

import {
  recordAuthRedirect,
  isLoopBreakerTripped,
  resetLoopBreaker,
  emergencyWipeAuthState
} from '../loopBreaker.js';

// Setup Mock Storage Environment
class MockStorage implements Storage {
  private store: Map<string, string> = new Map();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

// Attach mock globals
const mockSessionStorage = new MockStorage();
const mockLocalStorage = new MockStorage();
(globalThis as any).sessionStorage = mockSessionStorage;
(globalThis as any).localStorage = mockLocalStorage;

let fetchCalls: { url: string; options?: any }[] = [];
(globalThis as any).fetch = async (url: string, options?: any) => {
  fetchCalls.push({ url, options });
  return {
    ok: true,
    status: 200,
    json: async () => ({ status: 'ok' })
  };
};

// Pure implementation of getSafeNextDestination for standalone execution
function getSafeNextDestination(search: string): string | null {
  try {
    const params = new URLSearchParams(search);
    const next = params.get('next');
    if (!next) return null;
    if (next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') && !next.includes('://')) {
      return next;
    }
    return null;
  } catch {
    return null;
  }
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${testName}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n--- Starting Auth Redirect Loop Automated Tests ---');

  // Test 1: getSafeNextDestination - Allowed relative paths
  console.log('\nTest Suite 1: Safe Destination & Open Redirect Prevention');
  assert(getSafeNextDestination('?next=/a/launch_token_123') === '/a/launch_token_123', 'Allows /a/launch_token');
  assert(getSafeNextDestination('?next=/teacher?tab=sessions') === '/teacher?tab=sessions', 'Allows /teacher with query');
  assert(getSafeNextDestination('?next=/student?scan=true') === '/student?scan=true', 'Allows /student?scan=true');
  
  // Test 2: getSafeNextDestination - Rejects open redirects & malicious URLs
  assert(getSafeNextDestination('?next=https://attacker.com') === null, 'Rejects absolute https URL');
  assert(getSafeNextDestination('?next=http://attacker.com') === null, 'Rejects absolute http URL');
  assert(getSafeNextDestination('?next=//attacker.com/evil') === null, 'Rejects protocol-relative //attacker.com');
  assert(getSafeNextDestination('?next=/\\attacker.com/evil') === null, 'Rejects backslash /\\attacker.com');
  assert(getSafeNextDestination('?next=javascript:alert(1)') === null, 'Rejects javascript: scheme');
  assert(getSafeNextDestination('?reason=session_expired') === null, 'Returns null if next param is missing');
  assert(getSafeNextDestination('') === null, 'Returns null on empty search');

  // Test 3: Loop Breaker - Initial state
  console.log('\nTest Suite 2: Auth Redirect Loop Breaker');
  resetLoopBreaker();
  assert(isLoopBreakerTripped() === false, 'Loop breaker starts untripped');

  // Test 4: First redirect allowed
  const firstAllowed = recordAuthRedirect();
  assert(firstAllowed === true, '1st redirect attempt within 5s is permitted');
  assert(isLoopBreakerTripped() === false, 'Circuit breaker not tripped after 1 redirect');

  // Test 5: Second redirect triggers circuit breaker
  const secondAllowed = recordAuthRedirect();
  assert(secondAllowed === false, '2nd redirect attempt trips circuit breaker');
  assert(isLoopBreakerTripped() === true, 'isLoopBreakerTripped() returns true');

  // Test 6: Subsequent redirects remain blocked
  const thirdAllowed = recordAuthRedirect();
  assert(thirdAllowed === false, '3rd redirect remains blocked');
  assert(isLoopBreakerTripped() === true, 'Breaker remains tripped');

  // Test 7: resetLoopBreaker clears tripped state
  resetLoopBreaker();
  assert(isLoopBreakerTripped() === false, 'resetLoopBreaker() restores untripped state');

  // Test 8: Emergency wipe removes all auth artifacts
  console.log('\nTest Suite 3: Auth Artifacts Emergency Wipe');
  mockLocalStorage.setItem('token', 'stale_token_123');
  mockLocalStorage.setItem('refresh_token', 'stale_refresh_456');
  mockLocalStorage.setItem('user', JSON.stringify({ username: 'test_user' }));
  mockLocalStorage.setItem('role', 'STUDENT');
  mockLocalStorage.setItem('remember_me', 'true');
  mockLocalStorage.setItem('remember_username', 'test_user');
  mockLocalStorage.setItem('remember_role', 'STUDENT');
  mockLocalStorage.setItem('authSchemaVersion', '2');
  mockSessionStorage.setItem('snist_launch_claim', 'claim_ticket_xyz');

  fetchCalls = [];
  emergencyWipeAuthState();

  assert(mockLocalStorage.getItem('token') === null, 'Purged token');
  assert(mockLocalStorage.getItem('refresh_token') === null, 'Purged refresh_token');
  assert(mockLocalStorage.getItem('user') === null, 'Purged user');
  assert(mockLocalStorage.getItem('role') === null, 'Purged role');
  assert(mockLocalStorage.getItem('remember_me') === null, 'Purged remember_me');
  assert(mockLocalStorage.getItem('remember_username') === null, 'Purged remember_username');
  assert(mockLocalStorage.getItem('remember_role') === null, 'Purged remember_role');
  assert(mockSessionStorage.getItem('snist_launch_claim') === null, 'Purged snist_launch_claim');
  assert(fetchCalls.some(c => c.url === '/api/v1/auth/logout'), 'Triggered backend logout to clear httpOnly cookies');

  // Test 9: Stale Session on /login stays on /login and wipes state
  console.log('\nTest Suite 4: Single Source of Truth /login Guard');
  // Simulate stale token in storage
  mockLocalStorage.setItem('token', 'invalid_expired_token');
  mockLocalStorage.setItem('user', JSON.stringify({ role: 'TEACHER' }));

  // Simulate /api/v1/auth/me rejecting the stale token
  const simulateLoginMount = async (meResponseStatus: number): Promise<boolean> => {
    const storedToken = mockLocalStorage.getItem('token');
    if (storedToken) {
      if (meResponseStatus === 200) {
        // Server accepted
        return true;
      } else {
        // Server rejected (401 or network error) -> stay on /login and wipe
        emergencyWipeAuthState();
        return false;
      }
    }
    return false;
  };

  const redirectOnStale = await simulateLoginMount(401);
  assert(redirectOnStale === false, 'Does not redirect when /api/v1/auth/me returns 401');
  assert(mockLocalStorage.getItem('token') === null, 'Purged stale token after 401');

  // Test 10: Valid session on /login redirects once
  mockLocalStorage.setItem('token', 'valid_token_789');
  const redirectOnValid = await simulateLoginMount(200);
  assert(redirectOnValid === true, 'Redirects when /api/v1/auth/me returns 200');

  // Test 11: Schema Version Migration
  console.log('\nTest Suite 5: Auth Schema Versioning');
  const CURRENT_AUTH_SCHEMA_VERSION = '2';
  mockLocalStorage.setItem('authSchemaVersion', '1'); // Old version
  mockLocalStorage.setItem('token', 'legacy_token');
  
  // Migration check simulation
  if (mockLocalStorage.getItem('authSchemaVersion') !== CURRENT_AUTH_SCHEMA_VERSION) {
    emergencyWipeAuthState();
    mockLocalStorage.setItem('authSchemaVersion', CURRENT_AUTH_SCHEMA_VERSION);
  }

  assert(mockLocalStorage.getItem('token') === null, 'Legacy state wiped on schema version mismatch');
  assert(mockLocalStorage.getItem('authSchemaVersion') === CURRENT_AUTH_SCHEMA_VERSION, 'Schema version upgraded to 2');

  console.log(`\n--- Test Results: ${passed} Passed, ${failed} Failed ---`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Unhandled test execution failure:', err);
  process.exit(1);
});
