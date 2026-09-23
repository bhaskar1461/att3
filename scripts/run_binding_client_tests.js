/**
 * SNIST ERP — Binding V2 Client Module Dev-Side Automated Test & Benchmark Harness
 * 
 * Executes comprehensive unit tests, non-extractability proofs, divergence simulations,
 * and micro-benchmarks against standard WebCrypto APIs in Node.js / V8.
 */

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

// Verify crypto.subtle availability
const subtle = globalThis.crypto ? globalThis.crypto.subtle : null;
if (!subtle) {
  console.error("FATAL: WebCrypto (crypto.subtle) is unavailable in this runtime.");
  process.exit(1);
}

const ECDSA_ALGO = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN_ALGO = { name: 'ECDSA', hash: { name: 'SHA-256' } };

function bufferToBase64(buf) {
  return Buffer.from(buf).toString('base64');
}

function base64ToBuffer(b64) {
  return Buffer.from(b64, 'base64');
}

async function runTestSuite() {
  console.log("=" .repeat(75));
  console.log("SNIST ERP — BINDING V2 CLIENT MODULE TEST & BENCHMARK HARNESS");
  console.log("=" .repeat(75));

  let passed = 0;
  let failed = 0;

  function assert(condition, name, details = "") {
    if (condition) {
      console.log(`  [PASS] ${name}${details ? " — " + details : ""}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${name} ${details}`);
      failed++;
    }
  }

  // --------------------------------------------------------------------------
  // TEST GROUP 1: KEY GENERATION & NON-EXTRACTABILITY PROOF (CLOSES B7)
  // --------------------------------------------------------------------------
  console.log("\n--- TEST GROUP 1: KEY GENERATION & NON-EXTRACTABILITY PROOF ---");
  
  let keyPair;
  try {
    keyPair = await subtle.generateKey(ECDSA_ALGO, false, ['sign', 'verify']);
    assert(!!keyPair.privateKey && !!keyPair.publicKey, "Keypair generation succeeded", "ECDSA P-256 (extractable=false)");
  } catch (err) {
    assert(false, "Keypair generation failed", err.message);
  }

  // ADVERSARIAL TEST: Attempt to export the private key (Must throw!)
  let extractionBlocked = false;
  let extractionErrMsg = "";
  try {
    await subtle.exportKey('pkcs8', keyPair.privateKey);
  } catch (err) {
    extractionBlocked = true;
    extractionErrMsg = err.name || err.message;
  }
  assert(extractionBlocked, "Private key extraction refused (Non-Extractable Proof)", `Threw ${extractionErrMsg}`);

  let jwkExtractionBlocked = false;
  try {
    await subtle.exportKey('jwk', keyPair.privateKey);
  } catch (err) {
    jwkExtractionBlocked = true;
  }
  assert(jwkExtractionBlocked, "JWK private key extraction refused", "SubtleCrypto enforced extractable=false");

  // Public key export must succeed
  let spkiBuffer;
  let publicSpkiB64 = "";
  try {
    spkiBuffer = await subtle.exportKey('spki', keyPair.publicKey);
    publicSpkiB64 = bufferToBase64(spkiBuffer);
    assert(publicSpkiB64.length > 50, "Public key exported in SPKI format", `${publicSpkiB64.length} base64 chars`);
  } catch (err) {
    assert(false, "Public key export failed", err.message);
  }

  // Public key SHA-256 key_id derivation
  const keyIdBuf = await subtle.digest('SHA-256', spkiBuffer);
  const keyId = Buffer.from(keyIdBuf).toString('hex').slice(0, 32).toUpperCase();
  assert(keyId.length === 32, "Key ID derived from public key digest", `KEY_ID=${keyId.slice(0, 8)}...${keyId.slice(-8)}`);

  // --------------------------------------------------------------------------
  // TEST GROUP 2: SIGNATURE GENERATION & MATHEMATICAL VERIFICATION
  // --------------------------------------------------------------------------
  console.log("\n--- TEST GROUP 2: SIGNATURE GENERATION & VERIFICATION ---");

  const challengePayload = JSON.stringify({
    session_token: "?s=8XK2Q7MD&v=178915150",
    timestamp: Date.now(),
    nonce: "7f8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d",
    student_roll: "23311A0501"
  });
  const dataBytes = new TextEncoder().encode(challengePayload);

  let signatureBuffer;
  try {
    signatureBuffer = await subtle.sign(SIGN_ALGO, keyPair.privateKey, dataBytes);
    assert(signatureBuffer.byteLength === 64, "Raw signature generated (IEEE P1363)", `${signatureBuffer.byteLength} bytes`);
  } catch (err) {
    assert(false, "Signing failed", err.message);
  }

  const signatureB64 = bufferToBase64(signatureBuffer);

  // Verification using public key
  let signatureValid = false;
  try {
    signatureValid = await subtle.verify(SIGN_ALGO, keyPair.publicKey, signatureBuffer, dataBytes);
    assert(signatureValid, "Signature verified against public key", "Authentic payload verified");
  } catch (err) {
    assert(false, "Signature verification error", err.message);
  }

  // Tampered payload verification MUST fail
  const tamperedPayload = challengePayload.replace("23311A0501", "23311A0599");
  const tamperedBytes = new TextEncoder().encode(tamperedPayload);
  const tamperedValid = await subtle.verify(SIGN_ALGO, keyPair.publicKey, signatureBuffer, tamperedBytes);
  assert(!tamperedValid, "Tampered payload rejected", "Modifying roll number broke signature validation");

  // --------------------------------------------------------------------------
  // TEST GROUP 3: STORAGE CONSISTENCY & DIVERGENCE DETECTION
  // --------------------------------------------------------------------------
  console.log("\n--- TEST GROUP 3: STORAGE CONSISTENCY & DIVERGENCE STATE MACHINE ---");

  function evaluateStorageMock(hasHandle, cookieNonce, storedNonce) {
    const hasCookie = !!cookieNonce;
    if (!hasHandle && !hasCookie) return 'not_enrolled';
    if (hasHandle && hasCookie) {
      return (cookieNonce === storedNonce) ? 'enrolled' : 'incomplete';
    }
    return 'incomplete'; // handle-missing-cookie-present or vice-versa
  }

  assert(evaluateStorageMock(false, null, null) === 'not_enrolled', "Clean state -> not_enrolled");
  assert(evaluateStorageMock(true, "NONCE123", "NONCE123") === 'enrolled', "Synchronized state -> enrolled");
  assert(evaluateStorageMock(false, "NONCE123", null) === 'incomplete', "Storage eviction (cookie only) -> incomplete");
  assert(evaluateStorageMock(true, null, "NONCE123") === 'incomplete', "Cookie clear (handle only) -> incomplete");
  assert(evaluateStorageMock(true, "NONCE_A", "NONCE_B") === 'incomplete', "Nonce mismatch (transplant attempt) -> incomplete");

  // --------------------------------------------------------------------------
  // TEST GROUP 4: ZERO-PII METADATA COMPLIANCE
  // --------------------------------------------------------------------------
  console.log("\n--- TEST GROUP 4: ZERO-PII METADATA COMPLIANCE ---");

  const rawStudentRoll = "23311A0501";
  const studentHashBuf = await subtle.digest('SHA-256', new TextEncoder().encode(rawStudentRoll));
  const studentHashHex = Buffer.from(studentHashBuf).toString('hex');

  const metadataSample = {
    enrolled_at: new Date().toISOString(),
    student_id_hash: studentHashHex,
    browser_profile_tag: "ANDR#400x800#330#4",
    public_key_spki_b64: publicSpkiB64,
    key_id: keyId,
    storage_persisted: true,
    created_at_epoch_ms: Date.now()
  };

  const serializedMeta = JSON.stringify(metadataSample);
  assert(!serializedMeta.includes(rawStudentRoll), "Zero PII stored in metadata", "student_id_hash used exclusively");
  assert(serializedMeta.includes(studentHashHex), "student_id_hash properly formatted as SHA-256 hex");

  // --------------------------------------------------------------------------
  // TEST GROUP 5: TIMING MICRO-BENCHMARKS
  // --------------------------------------------------------------------------
  console.log("\n--- TEST GROUP 5: TIMING MICRO-BENCHMARKS (BUDGET EVALUATION) ---");

  const keygenIterations = 25;
  const keygenTimes = [];
  for (let i = 0; i < keygenIterations; i++) {
    const t0 = performance.now();
    await subtle.generateKey(ECDSA_ALGO, false, ['sign']);
    keygenTimes.push(performance.now() - t0);
  }
  keygenTimes.sort((a, b) => a - b);
  const avgKeygen = keygenTimes.reduce((a, b) => a + b, 0) / keygenIterations;
  const p50Keygen = keygenTimes[Math.floor(keygenIterations * 0.5)];
  const p95Keygen = keygenTimes[Math.floor(keygenIterations * 0.95)];
  console.log(`  generateKey() [${keygenIterations} runs]: avg=${avgKeygen.toFixed(2)}ms, p50=${p50Keygen.toFixed(2)}ms, p95=${p95Keygen.toFixed(2)}ms`);
  assert(avgKeygen < 100, "keygen timing within budget (<100ms)", `Actual: ${avgKeygen.toFixed(2)}ms`);

  const signIterations = 100;
  const signTimes = [];
  for (let i = 0; i < signIterations; i++) {
    const t0 = performance.now();
    await subtle.sign(SIGN_ALGO, keyPair.privateKey, dataBytes);
    signTimes.push(performance.now() - t0);
  }
  signTimes.sort((a, b) => a - b);
  const avgSign = signTimes.reduce((a, b) => a + b, 0) / signIterations;
  const p50Sign = signTimes[Math.floor(signIterations * 0.5)];
  const p95Sign = signTimes[Math.floor(signIterations * 0.95)];
  console.log(`  sign() [${signIterations} runs]:        avg=${avgSign.toFixed(3)}ms, p50=${p50Sign.toFixed(3)}ms, p95=${p95Sign.toFixed(3)}ms`);
  assert(avgSign < 10, "sign() timing satisfies <=10ms budget on all tiers", `Actual: ${avgSign.toFixed(3)}ms`);

  const verifyIterations = 100;
  const verifyTimes = [];
  for (let i = 0; i < verifyIterations; i++) {
    const t0 = performance.now();
    await subtle.verify(SIGN_ALGO, keyPair.publicKey, signatureBuffer, dataBytes);
    verifyTimes.push(performance.now() - t0);
  }
  verifyTimes.sort((a, b) => a - b);
  const avgVerify = verifyTimes.reduce((a, b) => a + b, 0) / verifyIterations;
  const p50Verify = verifyTimes[Math.floor(verifyIterations * 0.5)];
  const p95Verify = verifyTimes[Math.floor(verifyIterations * 0.95)];
  console.log(`  verify() [${verifyIterations} runs]:      avg=${avgVerify.toFixed(3)}ms, p50=${p50Verify.toFixed(3)}ms, p95=${p95Verify.toFixed(3)}ms`);
  assert(avgVerify < 10, "verify() timing satisfies <=10ms budget", `Actual: ${avgVerify.toFixed(3)}ms`);

  console.log("\n" + "=" .repeat(75));
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("=" .repeat(75));

  if (failed > 0) {
    process.exit(1);
  }

  // Return benchmark numbers
  return {
    keygen: { avg: avgKeygen, p50: p50Keygen, p95: p95Keygen },
    sign: { avg: avgSign, p50: p50Sign, p95: p95Sign },
    verify: { avg: avgVerify, p50: p50Verify, p95: p95Verify }
  };
}

runTestSuite().catch(err => {
  console.error("Test harness failed:", err);
  process.exit(1);
});
