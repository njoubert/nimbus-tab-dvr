# Managed Chrome tab recording sidecar: the sketch (2026-09-09)

This is the sketch the project started from, kept as written apart from the line rule.
It is a programme rather than a plan: five phases that all stand on one unproven assumption about `chrome.tabCapture`.
The plan that tests that assumption is [2026-09-09-capture-feasibility-spike.md](2026-09-09-capture-feasibility-spike.md), and the answers that narrow this sketch are in [docs/GRILLING.md](../GRILLING.md).
Where the two disagree, the grilling wins.
The diagrams are still ASCII art; they become mermaid when a phase is turned into a plan.


## Objective

Build an open-source, managed-installable Chrome extension that acts as
a recording sidecar for a web application.

The host application owns its own business logic.
Its recording contract
is intentionally small:

-   `START_RECORDING`
-   `STOP_RECORDING`

The extension owns target-tab capture, encoding, local persistence,
upload queueing, retries, recovery, upload finalization, and recording
diagnostics.

The intended deployment model is managed Chrome.
Once deployed and
configured, the host application should be able to start and stop
recordings without per-recording operator interaction, subject to the
capture behavior and enterprise policies supported by the deployed
Chrome version.

## Core architecture

Use a Manifest V3 extension with:

-   `chrome.tabCapture` for capture of the final composited browser tab;
-   a content-script/application bridge;
-   an MV3 service worker for the control plane;
-   `chrome.offscreen` for a long-lived media context;
-   `MediaRecorder` for encoding;
-   IndexedDB for durable local buffering;
-   background upload workers;
-   a pluggable backend/object-storage upload implementation.

``` text
Web application
      │
      │ START_RECORDING / STOP_RECORDING
      ▼
Application bridge
      │
      ▼
MV3 service worker
      │
      ├── validates commands/origin/tab
      ├── enforces lifecycle state
      └── provisions tab capture
                │
                ▼
        Offscreen document
        ├── MediaStream
        ├── MediaRecorder
        ├── IndexedDB spool
        └── upload workers
                │
                ▼
        configured storage/backend
```

Capture and recording lifetimes should remain separate concepts.
The
implementation may acquire a capture stream per recording or keep a
tab-capture stream alive and create separate `MediaRecorder` instances
for individual recordings.

## Browser APIs

### `chrome.tabCapture`

Capture the target tab's already-composited output.
The host application
should not need to expose or re-render its individual visual sources.

### `chrome.offscreen`

Use an offscreen extension document as the media/data-plane context.
It
should own the capture stream, `MediaRecorder`, persistence, and upload
workers rather than relying on application JavaScript or a continuously
alive MV3 service worker.

### `MediaRecorder`

Encode incrementally:

``` js
const recorder = new MediaRecorder(stream, {
  videoBitsPerSecond: 3_000_000
});

recorder.ondataavailable = ({ data }) => {
  if (data.size > 0) enqueueEncodedData(data);
};

recorder.start(5000);
```

Resolution, frame rate, bitrate, MIME type, and timeslice must be
configurable.
Avoid pinning a codec until target hardware has been
profiled.

### IndexedDB

Use IndexedDB as the durable spool for encoded data not yet durably
accepted by the remote destination.

### Extension messaging

Keep communication narrow and versioned:

``` text
host application
      ↕
content script
      ↕
service worker
      ↕
offscreen document
```

## Application-facing contract

### Start

Conceptual request:

``` json
{
  "type": "START_RECORDING",
  "requestId": "req_123",
  "recordingKey": "recording_456",
  "metadata": {}
}
```

Semantics:

-   `requestId` provides command correlation/idempotency.
-   `recordingKey` is an opaque application-provided identifier.
-   `metadata` is optional opaque application metadata.

Success:

``` json
{
  "type": "RECORDING_STARTED",
  "requestId": "req_123",
  "recordingKey": "recording_456",
  "recordingId": "..."
}
```

Failure:

``` json
{
  "type": "RECORDING_ERROR",
  "requestId": "req_123",
  "recordingKey": "recording_456",
  "code": "CAPTURE_FAILED",
  "recoverable": false
}
```

### Stop

Conceptual request:

``` json
{
  "type": "STOP_RECORDING",
  "requestId": "req_789",
  "recordingKey": "recording_456"
}
```

`STOP_RECORDING` means stop accepting new frames, flush the encoder,
persist final data, and transition into asynchronous upload
finalization.

Immediate acknowledgement:

``` json
{
  "type": "RECORDING_STOPPED",
  "requestId": "req_789",
  "recordingKey": "recording_456"
}
```

Final remote completion may be reported separately:

``` json
{
  "type": "RECORDING_FINALIZED",
  "recordingKey": "recording_456",
  "recordingId": "..."
}
```

The host application should not need to wait for remote finalization
before continuing its workflow.

## State model and idempotency

Suggested internal lifecycle:

``` text
IDLE → STARTING → RECORDING → STOPPING → FINALIZING → COMPLETE
                                      └──────────────→ FAILED
```

Commands must be idempotent:

-   duplicate starts must not create duplicate recordings;
-   duplicate stops must not corrupt finalization;
-   retries should return an established result when possible.

An optional `GET_RECORDING_STATUS` command can expose state plus
non-sensitive operational fields such as queued and uploaded byte
counts.

## Capture lifetime

Support or evaluate both models.

### Per-recording capture

``` text
START → acquire capture → record → STOP → release capture
```

### Persistent tab capture

``` text
capture stream =================================

          recording A       recording B
             [====]            [=====]
```

Persistent capture can reduce setup churn while retaining distinct
logical recording boundaries.

The public application API must not depend on which model is selected.

## Managed deployment requirement

The extension is intended to be centrally installed and configured on
managed Chrome.

Primary behavioral requirement:

> After deployment/configuration, the host application can request
> start/stop without a user clicking the extension or interacting with a
> capture chooser for each recording.

This must be proven against the exact Chrome release and enterprise
policy configuration used by a deployment.
Force-installation alone must
not be treated as proof of silent-capture capability.

The first engineering milestone should therefore prove:

``` text
web application
      │ START_RECORDING
      ▼
managed extension
      │
      ▼
chrome.tabCapture
      │
      ▼
MediaStream / MediaRecorder
```

with no per-recording interaction.

## Encoding and persistence

Reasonable initial defaults:

``` json
{
  "capture": {
    "targetFps": 15,
    "maxWidth": 1920,
    "maxHeight": 1080,
    "videoBitsPerSecond": 3000000,
    "recorderTimesliceMs": 5000
  }
}
```

These are tuning defaults only.

Never accumulate an entire long recording in memory.
The pipeline should
be:

``` text
MediaRecorder
      │
      ▼
small encoded Blob
      │
      ▼
IndexedDB
      │
      ▼
upload queue
```

A persisted unit should include enough state for independent recovery,
for example:

``` text
recordingId
recordingKey
sequence
createdAt
mimeType
byteLength
payload
uploadState
retryCount
```

Version the persistence schema.

## Upload subsystem

Treat encoding and uploading as producer/consumer systems:

``` text
Encoder                         Upload workers
   │                                  │
   ├── chunk ──> persistent queue ─────┤
   ├── chunk ──> persistent queue ─────┤
   └── chunk ──> persistent queue ─────┤
                                      ▼
                                remote storage
```

Network latency must not block recorder event handling.

Start with low upload concurrency, such as one or two workers.
Use
exponential backoff with jitter for transient errors and distinguish
authentication expiration from permanent failures.

The core project should not be coupled to one storage provider.
Define
an abstraction such as:

``` ts
interface UploadProvider {
  createRecording(context): Promise<UploadSession>;
  uploadPart(session, part): Promise<UploadedPart>;
  refreshAuthorization?(session): Promise<UploadSession>;
  complete(session, parts, metadata): Promise<void>;
  abort?(session): Promise<void>;
}
```

Reference implementations can target an application backend or
object-storage multipart APIs.

Never embed permanent storage credentials in the extension.
Prefer
short-lived, recording-scoped authorization from a trusted backend.

MediaRecorder chunks and remote upload parts should remain separate
concepts.
Frequent small chunks can be persisted and then aggregated
into larger network parts.

## Recovery and failure behavior

-   **Network failure:** continue writing to IndexedDB within configured
    limits and resume uploads later.
-   **Service-worker restart:** durable state must not depend on
    service-worker memory.
-   **Browser/OS crash:** recover previously committed IndexedDB data on
    restart.
-   **Host application reload/disconnect:** recording must not depend on
    the application's component lifecycle.
Define a bounded policy for
    loss of communication.
-   **Target tab closed:** stop capture, persist available final data,
    and mark the recording abnormal/incomplete.
-   **Duplicate commands:** use request IDs, recording identities,
    sequence numbers, and idempotency.
-   **Upload completion failure:** retain enough remote/local state to
    retry completion without retransmitting successful parts.
-   **Storage quota exhaustion:** never silently discard encoded data;
    transition to an explicit error/degraded state and emit diagnostics.

## Security boundary

The application-to-extension bridge is a trust boundary.

The extension should:

-   restrict allowed host origins;
-   validate the target tab;
-   validate every application message;
-   expose only the minimum protocol;
-   treat application identifiers/metadata as opaque;
-   avoid permanent backend/storage credentials;
-   use HTTPS;
-   use short-lived scoped upload authorization;
-   avoid sensitive data in logs;
-   keep remote recording authorization as a backend concern.

Deployment-specific values should be managed configuration rather than
hard-coded into the open-source core.

## Example managed configuration

``` json
{
  "allowedOrigins": [
    "https://application.example.com"
  ],
  "apiBaseUrl": "https://api.example.com",
  "capture": {
    "targetFps": 15,
    "maxWidth": 1920,
    "maxHeight": 1080,
    "videoBitsPerSecond": 3000000,
    "recorderTimesliceMs": 5000
  },
  "upload": {
    "targetPartBytes": 8388608,
    "maxConcurrentUploads": 2
  }
}
```

## Observability

Expose structured, non-sensitive diagnostics for:

-   extension and Chrome versions;
-   recording lifecycle transitions;
-   capture startup latency/failures;
-   actual capture dimensions/frame rate;
-   selected MIME type;
-   encoded byte rate;
-   locally queued bytes;
-   age of oldest queued data;
-   upload throughput/retries;
-   finalization latency;
-   IndexedDB/quota failures;
-   abnormal termination;
-   incomplete recordings.

Do not log recording contents, credentials, signed URLs, or arbitrary
host-application metadata by default.

## Suggested source layout

``` text
src/
├── bridge/
│   ├── protocol.ts
│   ├── content-script.ts
│   └── validation.ts
├── background/
│   ├── service-worker.ts
│   ├── state-machine.ts
│   └── capture-controller.ts
├── recorder/
│   ├── offscreen.html
│   ├── offscreen.ts
│   ├── media-recorder.ts
│   └── capture-stream.ts
├── persistence/
│   ├── db.ts
│   ├── schema.ts
│   └── queue.ts
├── upload/
│   ├── provider.ts
│   ├── worker.ts
│   ├── aggregation.ts
│   └── retry.ts
├── config/
│   └── managed-config.ts
└── diagnostics/
    ├── events.ts
    └── metrics.ts
```

Keep the recording and upload-provider layers independently testable
without a real host application.

## Implementation phases

### Phase 1 --- Capture feasibility

Build the smallest MV3 extension that:

1.  can be managed/force installed;
2.  recognizes an allowed web application;
3.  receives `START_RECORDING`;
4.  captures the intended tab;
5.  starts `MediaRecorder`;
6.  receives `STOP_RECORDING`;
7.  produces a valid recording;
8.  requires no per-recording interaction under the documented managed
    configuration.

This is the highest-risk platform assumption and should be proven first.

### Phase 2 --- Application contract

Implement and document protocol versioning, start/stop,
acknowledgements, errors/status, idempotency, origin validation, and the
lifecycle state machine.
Include a minimal example web application.

### Phase 3 --- Durable persistence

Add timeslicing, IndexedDB schema, persistent queueing, restart
recovery, and bounded-storage behavior.

### Phase 4 --- Upload subsystem

Add the provider abstraction, aggregation, concurrency control,
retry/backoff, authorization refresh, asynchronous finalization, and at
least one reference provider.

### Phase 5 --- Hardening

Test long recordings, repeated start/stop, network interruption,
slow/failing backend, application reload, target-tab closure,
extension/service-worker restart, browser restart, quota exhaustion,
duplicate commands, and extension upgrades.

## Acceptance criteria

An initial production-quality integration should demonstrate:

-   a small documented `START_RECORDING` / `STOP_RECORDING` contract;
-   zero per-recording interaction under a documented managed-Chrome
    configuration;
-   correct target-tab capture;
-   independent capture, recording, and upload lifecycles;
-   bounded memory usage;
-   durable local queueing;
-   recovery of persisted pending uploads;
-   idempotent lifecycle commands;
-   explicit incomplete/error states;
-   pluggable upload integration;
-   no permanent storage credentials in the extension;
-   configurable capture/upload parameters;
-   useful non-sensitive diagnostics.

## First engineering spike

Prove this path before building the full upload system:

``` text
example web application
      │
      │ START_RECORDING
      ▼
managed MV3 extension
      │
      ▼
chrome.tabCapture
      │
      ▼
offscreen MediaRecorder
      │
      ▼
5-second encoded chunks
      │
      ▼
IndexedDB
```

Then issue `STOP_RECORDING`, verify a valid recording boundary, and
confirm the entire start/stop flow requires no per-recording user
interaction in the target managed configuration.
