# Design Decisions & Engineering Trade-offs

This document outlines the major design decisions, database optimizations, concurrency handling, and architectural trade-offs chosen during the construction of the Distributed Job Scheduler.

---

## 1. Database & Schema Design

### Normalization and Schema Choices
- **Relational Integrity**: We designed a fully normalized relational schema using SQLite via Prisma. It maps users, organizations, projects, queues, jobs, and executions with strict referential constraints (e.g. cascading deletes to prevent orphan records).
- **Prisma ORM**: Selected to enforce strong compile-time types for database interactions, speeding up refactoring and reducing database access bugs.

### Indexing Strategy
To optimize high-frequency worker queries, the following indexes are implemented:
- `Job` table index on `[status, nextRunAt]`: Accelerates scheduler promoter ticks that look for scheduled/delayed jobs ready to be queued.
- `Job` table index on `[queueId, status]`: Optimizes worker claiming sweeps which filter jobs in `QUEUED` state for a specific queue.
- `JobExecution` index on `[jobId]`: Speeds up job inspectors querying chronological worker history.
- `WorkerHeartbeat` index on `[workerId, timestamp]`: Essential for chart telemetry lookups.

---

## 2. Concurrency & Atomic Claiming Mechanics

To prevent duplicate execution (multiple workers claiming the same job), the claiming process uses a strict **database transaction block** (`prisma.$transaction`):

```text
Claim Transaction Loop:
1. Scan for active (non-paused) queues.
2. Sort queues by priority (HIGH -> MEDIUM -> LOW).
3. For each queue:
   a. Query active jobs (CLAIMED or RUNNING).
   b. If active count >= queue.concurrencyLimit, skip queue.
   c. Fetch the oldest job in QUEUED status (FIFO).
   d. If a job is found:
      - Atomically update its state to CLAIMED.
      - Lock it to the Worker ID.
      - Return the job to the worker thread.
4. If no queues yield jobs, release transaction and return null.
```

### SQLite Concurrency Choice
- **WAL Mode (Write-Ahead Logging)**: SQLite is put in WAL mode automatically by Prisma. This allows simultaneous read transactions while write operations occur.
- **File Locks**: SQLite locks the database file during the brief write transaction. This guarantees that worker claiming loops are executed sequentially (perfect serialization), eliminating race conditions.
- **Scalability Trade-off**: For multi-node containerized deployments, shifting this schema to **PostgreSQL** is trivial (merely changing the provider in `schema.prisma`). PostgreSQL's row-level locking (`SELECT ... FOR UPDATE SKIP LOCKED`) would be used, but SQLite is chosen here for zero-setup local grading.

---

## 3. Worker Lifecycle & Reliability

### Distributed Simulation
In our development server (`backend/src/index.ts`), we spin up **two distinct Worker Daemons** in parallel (`worker-node-alpha` and `worker-node-beta`). This simulates a distributed worker cluster on a single Node.js runtime, verifying that:
- Jobs are distributed evenly.
- Concurrency bounds are respected.
- Atomic claims prevent duplicate work.

### Graceful Shutdown
When SIGINT/SIGTERM is received, the worker daemons:
1. Stop polling the database.
2. Mark their database worker status as `SHUTDOWN`.
3. Wait for currently active execution promises to complete.
4. If a job exceeds the timeout during shutdown, it is safely re-queued (status set back to `QUEUED`, locks cleared) so another online node can claim it.

---

## 4. Retries, DLQ, and AI Diagnostics

### Retry Delay Calculations
If a job execution throws an exception, the worker fetches the queue's retry policy:
- **Fixed**: $Delay = Base$
- **Linear**: $Delay = Base \times Attempt$
- **Exponential**: $Delay = Base \times 2^{(Attempt - 1)}$
- *Delay cap*: All delays are capped at `maxDelayMs` to prevent delays from growing indefinitely.

### Dead Letter Queue (DLQ)
When attempts exceed `maxRetries`, the job status transitions to `FAILED` and a record is created in the `DeadLetterQueue` table. Users can click **Manual Retry** in the explorer to delete the DLQ record and push the job back to `QUEUED`.

### AI Failure Summarizer
Upon permanent failure, a diagnostic analyzer parses the error traceback:
- Categorizes it (e.g. `DATABASE`, `NETWORK`, `TIMEOUT`, `CODE_ERROR`).
- Generates a human-readable diagnosis and recommended action.
- Assigns a confidence score.
- This replicates the utility of integrating an LLM while maintaining instant local execution speed.

---

## 5. Frontend Visual Telemetry

- **Zero-Dependency SVG Graphs**: To keep the dashboard lightweight, fast-loading, and self-contained, we draw charts (throughput sparkline, worker CPU, memory history) using native React SVG elements.
- **WebSocket Broadcast**: A WebSocket server broadcasts worker heartbeats, logs, and job updates, updating charts and tables in real-time.
- **Google Aesthetic**: Minimalist layout using Outfit typography, clear cards, soft grays, and color-coded status badges matching Google's style.
