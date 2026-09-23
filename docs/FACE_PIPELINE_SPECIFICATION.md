# SNIST ERP Attendance System — Face Pipeline Specification

## 1. Purpose

This document defines the future face-processing pipeline for the SNIST ERP Attendance System.

The face system is **not part of the initial attendance decision**.

The initial rollout uses:

```text
QR
+
Authenticated Student
+
Device Validation
+
GPS Geofence
```

Selfies collected after successful attendance are used to build a controlled dataset for future face verification.

---

# 2. Important Terminology

The system must distinguish between:

### Face Detection
Determines: Is there a face in the image?

### Face Alignment
Normalizes the detected face into a consistent orientation/format.

### Face Embedding
Converts a face image into a numerical representation.

Conceptually:

```text
Face image
    |
    v
Face model
    |
    v
Embedding vector
```

### Face Verification
Answers: Does this face match the claimed student's enrolled identity?

### Face Identification
Answers: Which student does this face belong to?

The attendance system should initially use verification, not unrestricted identification.

---

# 3. Critical Clarification: Training vs Inference

If a pretrained ONNX face model is used:

```text
Image
  |
  v
ONNX model
  |
  v
Embedding
```

this is:

**INFERENCE**

It is not model training.

Do not modify or "train the ONNX model" merely to create student embeddings.

The likely initial workflow is:

```text
Pretrained face model
        |
        v
Generate student embeddings
        |
        v
Store embeddings
        |
        v
Perform future verification
```

---

# 4. Initial Rollout

During the first approximately:

**15–16 days**

the system should focus on collecting quality selfies.

Flow:

```text
Student
   |
   v
Successful QR Attendance
   |
   v
Selfie Prompt
   |
   v
Front Camera
   |
   v
3–5 second countdown
   |
   v
Capture
   |
   v
Quality Validation
   |
   v
Private Storage
```

No face verification is required for attendance during this stage.

---

# 5. Why Collect Before Verification

The initial collection period allows the system to understand real deployment conditions:

- Different lighting
- Different phones
- Different camera quality
- Different poses
- Glasses
- Hair changes
- Indoor/outdoor conditions
- Projector/classroom environments

It also allows the team to identify:

- Poor images
- Multiple faces
- Blur
- Extreme angles
- Low brightness
- Overexposure
- Camera failures

before relying on face verification.

---

# 6. Face Pipeline Architecture

Future architecture:

```text
                    Attendance System
                           |
                           v
                    Selfie Storage
                           |
                           v
                    Face Processing
                           |
             +-------------+-------------+
             |             |             |
             v             v             v
       Detection       Alignment      Quality
             |             |             |
             +-------------+-------------+
                           |
                           v
                     ONNX Runtime
                           |
                           v
                     Embedding
                           |
                           v
                  Embedding Storage
```

Future verification:

```text
New Face
   |
   v
Detection
   |
   v
Alignment
   |
   v
Embedding
   |
   v
Compare against enrolled embeddings
   |
   v
Verification result
```

---

# 7. Separate Face Service

The face pipeline should preferably be isolated from the main FastAPI attendance service.

Recommended:

```text
Browser
   |
   v
FastAPI
   |
   v
Face Service
   |
   v
ONNX Runtime
```

Reasons:

- ML dependencies are isolated
- Model upgrades are easier
- CPU/GPU resources can be managed independently
- Face-processing failures do not have to bring down attendance APIs
- Security boundaries are clearer
- Future scaling is easier

---

# 8. Face Service Responsibilities

The face service may handle:

- Face detection
- Face alignment
- Image quality assessment
- Embedding generation
- Embedding comparison
- Future liveness
- Model version management

It should not directly decide:

`Student attendance`

The attendance service remains responsible for the attendance record.

---

# 9. Input Image Requirements

The system should validate:

- Valid image
- Supported format
- Reasonable file size
- Minimum resolution
- Exactly one face
- Face sufficiently visible
- Acceptable blur
- Acceptable brightness

The exact thresholds should be established through testing.

Do not invent universal image-quality numbers before evaluating real devices.

---

# 10. Face Detection

Pipeline:

```text
Input image
    |
    v
Face detector
    |
    +---- 0 faces -> REJECT
    |
    +---- 1 face -> CONTINUE
    |
    +---- >1 faces -> REJECT
```

For attendance selfies, the preferred condition is:

**Exactly one face**

---

# 11. Multiple Faces

If:

`face_count > 1`

the image should normally be rejected for enrollment/verification.

Reason:

The system must know which face belongs to the claimed student.

The student should be instructed to ensure that only their face is visible.

---

# 12. No Face

If:

`face_count == 0`

return:

`NO_FACE_DETECTED`

The system should allow the student to retry.

This should not invalidate already accepted attendance.

---

# 13. Face Alignment

After detection:

```text
Face bounding box
        |
        v
Landmarks
        |
        v
Alignment
        |
        v
Normalized face image
```

Alignment should reduce variation caused by:

- Head rotation
- Eye position
- Scale
- Face position

---

# 14. Embedding Generation

Conceptually:

```text
Aligned face
     |
     v
Pretrained ONNX model
     |
     v
Embedding vector
```

The service must record:

- `model_name`
- `model_version`
- `embedding_dimension`
- `embedding_version`

alongside the embedding.

---

# 15. Model Selection

Do not select a face model solely because it is:

- popular
- small
- fast
- ONNX-compatible

Evaluate it for:

- Accuracy
- Latency
- Mobile/CPU compatibility
- Lighting variation
- Pose variation
- Demographic robustness
- Glasses
- Real classroom conditions
- Licensing
- Deployment size

The final model should be selected after technical evaluation.

---

# 16. ONNX Runtime

The future face service may use:

`ONNX Runtime`

Conceptually:

```python
session = ort.InferenceSession(model_path)
```

The exact implementation depends on the selected model.

The model must remain server-side.

---

# 17. Model Security

Do not allow clients to upload or select the face model.

Never expose:

- model filesystem
- model path
- model weights
- threshold configuration
- embedding storage

through public APIs.

---

# 18. Embedding Storage

The database should store:

- `student_id`
- `selfie_id`
- `model_version`
- `embedding_version`
- `embedding_dimension`
- `embedding_type`
- `status`
- `created_at`

The actual vector may be stored using:

vector database or an appropriate database/vector-storage mechanism depending on the final implementation.

---

# 19. Database Relationship

Conceptually:

```text
Student
   |
   +---- Selfie
   |
   +---- Face Embedding
```

More specifically:

```text
student
   |
   +---- selfie_records
   |        |
   |        v
   |   face_embeddings
   |
   +---- canonical embedding
   |
   +---- recent verified embeddings
```

---

# 20. Canonical Embedding

Each student should eventually have a trusted:

`CANONICAL` embedding.

It should originate from a controlled enrollment process.

The canonical embedding should not be replaced automatically by every new selfie.

---

# 21. Recent Embeddings

The system should maintain up to:

**5 recent verified embeddings**

in addition to the canonical embedding.

Conceptually:

```text
Student
 |
 +-- Canonical
 |
 +-- Recent #1
 +-- Recent #2
 +-- Recent #3
 +-- Recent #4
 +-- Recent #5
```

These recent embeddings help represent normal variation over time.

---

# 22. Why Recent Embeddings Exist

A person's appearance can vary because of:

- Lighting
- Camera
- Hair
- Glasses
- Facial hair
- Pose
- Age
- Image quality

A single embedding may not represent every legitimate appearance.

Recent verified embeddings provide additional reference points.

---

# 23. Canonical Embedding Protection

Do not implement:

```text
new selfie
   |
   v
replace canonical embedding
```

automatically.

Instead:

```text
new selfie
   |
   v
verify quality
   |
   v
verify identity
   |
   v
mark as verified
   |
   v
optionally add to recent set
```

Promotion to canonical should require a controlled process.

---

# 24. Embedding Lifecycle

Possible statuses:

- `PENDING`
- `ACTIVE`
- `RETIRED`
- `REJECTED`

Example:

```text
New selfie
    |
    v
Embedding generated
    |
    v
PENDING
    |
    v
Verified
    |
    v
ACTIVE
```

---

# 25. Model Versioning

Every embedding must be associated with the model that generated it.

Example:

- `model_name`
- `model_version`
- `embedding_version`

This is necessary because changing the model may change the embedding space.

---

# 26. Model Migration

If the system changes models:

```text
Model V1
   |
   v
Model V2
```

do not assume:

`V1 embedding == V2 embedding`

The system may need to regenerate embeddings.

Migration strategy:

1. Deploy V2
2. Generate V2 embeddings
3. Validate V2
4. Maintain V1 temporarily if required
5. Switch verification
6. Retire V1

---

# 27. Similarity Comparison

A common approach is:

```text
Embedding A
      |
      v
Similarity
      ^
      |
Embedding B
```

Possible metrics include:

- Cosine similarity
- Euclidean distance

The metric must match the selected model and embedding normalization strategy.

---

# 28. Verification Decision

Conceptually:

```text
similarity >= validated_threshold
        |
        v
candidate match
```

But:

The threshold must be empirically validated.

Do not invent a threshold such as:

`0.6, 0.7, 0.8, 0.9`

and assume it is secure.

---

# 29. Threshold Evaluation

Use a representative validation dataset.

Evaluate:

- True Accepts
- False Accepts
- True Rejects
- False Rejects

Measure:

- False Acceptance Rate (FAR)
- False Rejection Rate (FRR)
- ROC/DET characteristics

The deployment threshold should be selected based on the required operating point and institutional risk tolerance.

---

# 30. Verification Types

The system should distinguish:

`1:1 Verification` from `1:N Identification`

For attendance, prefer:

```text
Claimed Student
       |
       v
Compare against that student's embeddings
```

rather than:

```text
Face
 |
 v
Search entire student database
```

unless there is a specific future requirement for identification.

---

# 31. Why 1:1 Is Preferred

1:1 verification reduces:

- Search complexity
- False-match opportunities
- Privacy exposure
- Unnecessary biometric processing

The student's authenticated account provides the claimed identity.

The face service verifies the claim.

---

# 32. Future Verification Flow

```text
Student authenticated
        |
        v
QR attendance accepted
        |
        v
Selfie captured
        |
        v
Face detected
        |
        v
Embedding generated
        |
        v
Compare against student's enrolled embeddings
        |
        v
Similarity evaluation
        |
        v
Liveness evaluation
        |
        v
Verification result
```

---

# 33. Face Verification Does Not Initially Control Attendance

During the first rollout:

`QR + GPS + Device` determines attendance.

Face verification can run in:

**shadow mode**

where it records:

- match result
- confidence/similarity
- quality
- liveness

without changing attendance.

This allows the team to evaluate real-world performance safely.

---

# 34. Shadow Mode

Example:

```text
QR attendance
     |
     v
Attendance = PRESENT
     |
     +--------------------+
     |                    |
     v                    v
Selfie               Face pipeline
                          |
                          v
                     Verification
                          |
                          v
                     Audit/metrics
```

Face verification does not modify the attendance decision.

---

# 35. Why Shadow Mode Is Important

It allows measurement of:

- False rejects
- False matches
- Poor lighting
- Poor camera quality
- Model latency
- Device differences
- Enrollment quality

before face verification becomes operationally important.

---

# 36. Liveness

A future liveness system should determine whether the presented face is likely from a live person rather than a replay.

Threats include:

- Printed photo
- Phone screen
- Recorded video
- Replay attack
- Deepfake/reconstructed media
- Mask

Liveness must be evaluated separately from face identity similarity.

---

# 37. Passive vs Active Liveness

Possible approaches:

### Passive
Analyze the captured image/video without asking the student to perform an action.

### Active
Ask the student to perform an action such as:
- Blink
- Turn head
- Look in a direction

The final choice should consider:

- Security
- Latency
- User experience
- Accessibility
- Browser support
- Spoof resistance

---

# 38. Auto Face Capture

Future workflow after QR:

```text
QR validated
    |
    v
Switch to front camera
    |
    v
Show user-facing capture UI
    |
    v
3–5 second countdown
    |
    v
Capture short burst/video
    |
    v
Quality check
    |
    v
Face pipeline
```

Do not silently activate the camera.

The user must be informed that a face image/video is being captured.

---

# 39. Camera Transition

Browser camera switching is not guaranteed to work identically on every device.

The frontend should:

```text
Stop current camera stream
        |
        v
Request front camera
        |
        v
Initialize stream
        |
        v
Show preview
        |
        v
Capture
```

If switching fails:

`fallback to explicit user action` rather than assuming success.

---

# 40. Face Capture UI

The UI should communicate:

- Face the camera
- Keep your face visible
- Use adequate lighting
- Remove obstruction if appropriate
- Only one person should be visible

A visible countdown:

```text
3
2
1
Capture
```

can improve consistency.

---

# 41. No Silent Biometric Collection

The system must not secretly collect biometric information.

The user should understand:

- What is being captured
- Why it is being captured
- How it is used

The exact consent/notice mechanism must comply with applicable institutional and legal requirements.

---

# 42. Image Quality

Potential quality signals:

- Resolution
- Blur
- Brightness
- Contrast
- Face size
- Pose
- Occlusion
- Number of faces

These should be used to determine whether an image is suitable for processing.

---

# 43. Quality Rejection

Example:

```text
Image
 |
 +-- 0 faces -> reject
 |
 +-- >1 face -> reject
 |
 +-- too blurry -> reject
 |
 +-- insufficient face visibility -> reject
 |
 +-- acceptable -> continue
```

The user should receive actionable guidance.

---

# 44. Quality vs Identity

Do not confuse:

`Image quality` with `Identity match`

An image can be:

`High quality + wrong person` or `Low quality + correct person`

The pipeline must keep these decisions separate.

---

# 45. Face Pipeline Errors

Suggested error codes:

- `NO_FACE_DETECTED`
- `MULTIPLE_FACES`
- `FACE_TOO_SMALL`
- `IMAGE_TOO_BLURRY`
- `IMAGE_TOO_DARK`
- `IMAGE_TOO_BRIGHT`
- `FACE_OCCLUDED`
- `EMBEDDING_FAILED`
- `MODEL_UNAVAILABLE`
- `VERIFICATION_FAILED`
- `LIVENESS_FAILED`

Do not expose internal model stack traces.

---

# 46. Face Service API

Internal endpoint:

`POST /internal/face/embedding`

Request:

```json
{
  "selfie_id": "uuid"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "embedding_id": "uuid",
    "model_version": "version",
    "embedding_version": "version",
    "quality_status": "ACCEPTED"
  }
}
```

The raw embedding should not be returned to the public browser.

---

# 47. Face Verification API

Internal endpoint:

`POST /internal/face/verify`

Request:

```json
{
  "student_id": "uuid",
  "selfie_id": "uuid",
  "attendance_id": "uuid"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "result": "VERIFIED",
    "model_version": "version",
    "threshold_version": "version",
    "liveness": "PASS"
  }
}
```

Exact score fields should be protected according to the API's trust boundary.

---

# 48. Face Service Authentication

FastAPI must authenticate to the face service.

Do not expose the face service directly to the public Internet.

Conceptual:

```text
Internet
   |
   v
FastAPI
   |
authenticated internal network
   |
   v
Face Service
```

---

# 49. Face Service Failure

If the face service is unavailable:

```text
QR attendance
    |
    v
Attendance remains valid
```

during the initial rollout.

The system should record:

`FACE_SERVICE_UNAVAILABLE`

for operational monitoring.

---

# 50. Face Processing Queue

As the system grows, face processing can become asynchronous.

Example:

```text
Selfie uploaded
       |
       v
Queue
       |
       v
Face Worker
       |
       v
Embedding
       |
       v
Verification
```

For the initial deployment, synchronous processing may be acceptable if performance testing supports it.

Do not introduce a message queue solely for architectural complexity.

---

# 51. Processing Latency

Measure:

```text
Upload -> Decode -> Detection -> Alignment -> Embedding -> Comparison
```

Track:

- `p50`
- `p95`
- `p99`

latency.

---

# 52. CPU/GPU Strategy

Start with CPU inference if performance is acceptable.

Use GPU acceleration only when justified by:

- Measured latency
- Concurrent workload
- Infrastructure availability
- Cost

Do not assume GPU is necessary for ~252 students.

---

# 53. Model Resource Management

Load the model efficiently.

Avoid loading the model for every request.

Prefer:

```text
Service startup
      |
      v
Load model
      |
      v
Keep model available
      |
      v
Process requests
```

The exact lifecycle depends on deployment architecture.

---

# 54. Model Warmup

After deployment:

```text
Start service
    |
    v
Load model
    |
    v
Warmup inference
    |
    v
Mark service READY
```

This prevents the first real user request from experiencing unnecessary model initialization latency.

---

# 55. Embedding Encryption

Because embeddings are sensitive, consider encryption at rest.

Possible layers:

- Database encryption
- Disk encryption
- Application-level encryption

The exact implementation should follow the deployment/security requirements.

---

# 56. Access Control to Embeddings

Only authorized backend/face-service components should access embeddings.

Normal endpoints must not expose:

- embedding vector
- model input
- internal face score

unless explicitly required.

---

# 57. Face Data Retention

Retention must be explicitly defined for:

- Raw selfies
- Embeddings
- Verification events
- Liveness data
- Quality metadata

The institution should define:

- Why data is retained
- How long
- Who can access it
- How deletion works

---

# 58. Raw Selfie vs Embedding

An embedding is not simply a harmless replacement for an image.

Treat both as sensitive.

Conceptually:

```text
Raw face image + Face embedding + Verification information
```

all require appropriate protection.

---

# 59. Enrollment Dataset

During the 15–16 day collection period, maintain metadata such as:

- `student_id`
- `selfie_id`
- `capture timestamp`
- `device/platform metadata` where justified
- `quality status`
- `face count`
- `processing status`

Avoid collecting unnecessary personal information.

---

# 60. Enrollment Quality Dashboard

A future admin dashboard may show:

- Students enrolled
- Students with insufficient selfies
- Average image quality
- Multiple-face rejection rate
- No-face rate
- Embedding generation success
- Students requiring re-enrollment

This should expose aggregate operational information rather than unnecessary biometric data.

---

# 61. Enrollment Completeness

A student should eventually reach a state such as:

- `NOT_ENROLLED`
- `COLLECTING`
- `READY`
- `VERIFIED`
- `REQUIRES_REENROLLMENT`

Do not assume one selfie automatically equals a high-quality enrollment.

---

# 62. Recommended Enrollment Flow

```text
Student attends normally
        |
        v
Selfie collected
        |
        v
Quality accepted
        |
        v
Face detected
        |
        v
Embedding generated
        |
        v
Stored as enrollment candidate
        |
        v
Additional samples collected
        |
        v
Enrollment quality reviewed
        |
        v
Canonical embedding established
```

---

# 63. Preventing Bad Enrollment

A bad enrollment contaminates future verification.

Before accepting an enrollment candidate, check:

- One face
- Good visibility
- Good quality
- Reasonable pose
- No obvious spoof
- Consistent identity

Future controlled enrollment should ideally use multiple samples.

---

# 64. Identity Verification During Enrollment

If the student is authenticated through the institutional ERP, the claimed identity is known.

The system can associate the selfie with:

`authenticated student`

But this does not automatically prove the face belongs to that student.

A stronger future enrollment workflow should include an institutional identity-verification process.

---

# 65. Spoof Detection

Potential future layers:

- Image quality
- Liveness
- Device signals
- Capture sequence analysis
- Face embedding consistency

Do not claim that any one layer eliminates spoofing.

---

# 66. Face Pipeline Audit Events

Possible events:

- `FACE_DETECTION_STARTED`
- `FACE_DETECTION_FAILED`
- `FACE_QUALITY_REJECTED`
- `FACE_EMBEDDING_CREATED`
- `FACE_EMBEDDING_FAILED`
- `FACE_VERIFICATION_STARTED`
- `FACE_VERIFICATION_PASSED`
- `FACE_VERIFICATION_FAILED`
- `LIVENESS_STARTED`
- `LIVENESS_PASSED`
- `LIVENESS_FAILED`
- `MODEL_VERSION_CHANGED`
- `ENROLLMENT_CREATED`
- `ENROLLMENT_REVOKED`

---

# 67. Model Governance

Every production face model should have:

- Model name
- Version
- Source/license
- Checksum
- Deployment date
- Validation report
- Known limitations
- Performance benchmarks
- Rollback version

Do not deploy an untracked model file.

---

# 68. Model Integrity

Before loading a model, verify its integrity where practical.

For example, `model checksum` can be recorded and compared against the expected deployment artifact.

---

# 69. Model Rollback

If a new model causes:

- Unexpected false rejects
- Latency problems
- Deployment errors
- Quality degradation

the system should be able to revert to the previous validated model.

---

# 70. Face Model Testing

Before production:

- [ ] Detection accuracy tested
- [ ] Embedding consistency tested
- [ ] Verification accuracy tested
- [ ] False acceptance measured
- [ ] False rejection measured
- [ ] Lighting tested
- [ ] Camera diversity tested
- [ ] Pose tested
- [ ] Glasses tested
- [ ] Facial hair tested
- [ ] Performance tested
- [ ] Model integrity verified
- [ ] Rollback tested

---

# 71. Security Testing

Test attacks involving:

- Photo replay
- Phone-screen replay
- Recorded video
- Modified selfie
- Wrong student's selfie
- Multiple faces
- No face
- Low-quality image
- Malformed image
- Oversized image
- Repeated verification requests
- Unauthorized embedding access

---

# 72. Privacy Testing

Verify that:

- [ ] Student cannot access another student's selfie
- [ ] Student cannot access embeddings
- [ ] Faculty cannot access unrestricted biometric data
- [ ] Object storage is private
- [ ] Signed URLs expire
- [ ] Logs do not contain raw images
- [ ] Logs do not contain embeddings
- [ ] Retention rules work
- [ ] Deletion procedures are controlled

---

# 73. Face Verification Rollout

Recommended stages:

1. **Stage 1**: Selfie collection only
2. **Stage 2**: Embedding generation
3. **Stage 3**: Offline evaluation
4. **Stage 4**: Shadow-mode verification
5. **Stage 5**: Operational monitoring
6. **Stage 6**: Controlled pilot
7. **Stage 7**: Institutional review
8. **Stage 8**: Optional integration into attendance security

Do not jump directly from selfie collection to face decides attendance.

---

# 74. Initial MVP Boundary

The MVP should NOT require:

- Face recognition
- Face identification
- Liveness
- Model training
- GPU infrastructure
- Vector database
- Deepfake detection
- Automatic canonical replacement

The MVP only needs to collect and securely store high-quality selfies for future processing.

---

# 75. Future Architecture

Final conceptual architecture:

```text
                        SNIST ERP
                            |
                            v
                    Attendance Service
                            |
                +-----------+-----------+
                |                       |
                v                       v
          QR/GPS/Device              Selfie
                |                       |
                v                       v
          Attendance DB          Private Storage
                                        |
                                        v
                                  Face Service
                                        |
                        +---------------+---------------+
                        |               |               |
                        v               v               v
                    Detector        ONNX Runtime     Liveness
                        |               |               |
                        +---------------+---------------+
                                        |
                                        v
                                  Face Embeddings
                                        |
                                        v
                                  Verification
```

---

# 76. Golden Rule

The face pipeline should follow:

```text
Capture carefully
       |
       v
Validate quality
       |
       v
Detect face
       |
       v
Generate embedding
       |
       v
Version everything
       |
       v
Verify conservatively
       |
       v
Audit the result
```

---

# 77. Non-Negotiable Rules

1. Do not confuse inference with training.
2. Do not train or fine-tune a model merely because ONNX is being used.
3. Do not make face verification part of MVP attendance without validation.
4. Do not use arbitrary similarity thresholds.
5. Do not automatically replace canonical embeddings.
6. Do not expose embeddings to the browser.
7. Do not make biometric files publicly accessible.
8. Do not silently capture selfies or video.
9. Do not let face-service failure invalidate the initial QR attendance.
10. Do not treat face similarity as equivalent to liveness.
11. Do not treat GPS, device binding, QR, or face recognition as perfect proof individually.
12. Version every production face model.
13. Keep the face service isolated from the public Internet.
14. Maintain a rollback path for model changes.
15. Treat raw selfies and embeddings as sensitive data.

---

# 78. Definition of Done

The future face pipeline is ready for controlled pilot only when:

- [ ] Selfie collection is stable
- [ ] Image quality checks work
- [ ] Face detection works on target devices
- [ ] Exactly-one-face rule works
- [ ] ONNX model selected and licensed
- [ ] Model version tracked
- [ ] Embeddings generated consistently
- [ ] Embeddings securely stored
- [ ] Canonical embedding workflow defined
- [ ] Recent embedding workflow defined
- [ ] Verification dataset created
- [ ] False acceptance measured
- [ ] False rejection measured
- [ ] Threshold empirically validated
- [ ] Liveness evaluated
- [ ] Shadow-mode testing completed
- [ ] Privacy/retention rules approved
- [ ] Access controls tested
- [ ] Model rollback tested
- [ ] Production monitoring configured

---

# 79. Final Principle

The face system should be introduced as a measured security layer, not as an assumption that an AI model automatically makes attendance secure.

The correct progression is:

```text
QR attendance
      |
      v
Secure selfie collection
      |
      v
Quality validation
      |
      v
Embedding generation
      |
      v
Offline evaluation
      |
      v
Shadow verification
      |
      v
Validated face verification
      |
      v
Controlled production integration
```
