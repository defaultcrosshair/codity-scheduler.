# REST API Documentation

All endpoints (except login and signup) require a JWT bearer token passed in the header:
`Authorization: Bearer <jwt_token>`

---

## 1. Authentication Router (`/api/auth`)

### POST `/api/auth/signup`
Creates a user and initializes an organization.
- **Request Body**:
  ```json
  {
    "email": "dev@example.com",
    "password": "password123",
    "name": "Jane Developer",
    "role": "DEVELOPER",
    "organizationName": "Antigravity Corp"
  }
  ```
- **Response (201 Created)**:
  ```json
  {
    "token": "eyJhbGciOiJIUzI1NiIsIn...",
    "user": {
      "id": "e37894e2-...",
      "email": "dev@example.com",
      "name": "Jane Developer",
      "role": "DEVELOPER",
      "organizationId": "5f3a...",
      "organizationName": "Antigravity Corp"
    }
  }
  ```

### POST `/api/auth/login`
Authenticates a user and returns a token.
- **Request Body**:
  ```json
  {
    "email": "admin@example.com",
    "password": "password123"
  }
  ```
- **Response (200 OK)**:
  Same structure as signup response.

### GET `/api/auth/profile`
Retrieves profile details of the authenticated token bearer.

---

## 2. Projects Router (`/api/projects`)

### GET `/api/projects`
Lists all projects registered under the user's organization.

### POST `/api/projects`
Creates a new project. Required roles: `ADMIN`, `DEVELOPER`.
- **Request Body**:
  ```json
  {
    "name": "Production Router Gateway"
  }
  ```

---

## 3. Queues Router (`/api/queues`)

### GET `/api/queues`
Lists all queues across projects in the user's organization, including their active retry policies.

### POST `/api/queues`
Creates a queue. Required roles: `ADMIN`, `DEVELOPER`.
- **Request Body**:
  ```json
  {
    "projectId": "project-uuid",
    "name": "email-delivery",
    "priority": "MEDIUM",
    "concurrencyLimit": 5,
    "retryPolicy": {
      "strategy": "EXPONENTIAL",
      "maxRetries": 3,
      "baseDelayMs": 1000,
      "maxDelayMs": 60000
    }
  }
  ```

### PUT `/api/queues/:id`
Updates the configuration parameters of a queue (concurrency bounds, priority, retry math). Required roles: `ADMIN`, `DEVELOPER`.

### POST `/api/queues/:id/toggle-pause`
Toggles active execution on the queue. Claim loops skip locked/paused queues. Required roles: `ADMIN`, `DEVELOPER`.

---

## 4. Jobs Scheduler Router (`/api/jobs`)

### GET `/api/jobs/stats`
Aggregates queue loads, online worker counts, 24h completed throughput, and Dead Letter Queue totals.

### POST `/api/jobs`
Creates/schedules a job. Required roles: `ADMIN`, `DEVELOPER`.
- **Payload Parameters**:
  - `queueId` (string, required)
  - `jobType` (string: `IMMEDIATE`, `DELAYED`, `SCHEDULED`, `RECURRING`, `BATCH`, required)
  - `payload` (JSON object or string, required)
  - `delayMs` (integer delay for `DELAYED` jobs)
  - `nextRunAt` (ISO timestamp for `SCHEDULED` jobs)
  - `cronExpression` (string expression for `RECURRING` jobs)
  - `dependencies` (array of parent job IDs to wait for)
  - `batchName` (associates job to a batch cluster)

- **Example (Immediate job with parent workflow dependency)**:
  ```json
  {
    "queueId": "queue-uuid",
    "jobType": "IMMEDIATE",
    "payload": {
      "taskName": "trigger_deploy_build",
      "branch": "main"
    },
    "dependencies": ["parent-job-uuid"]
  }
  ```

### GET `/api/jobs`
Lists jobs with pagination, keyword search in payloads, and filters by `status`, `jobType`, and `queueId`.
- **Response**:
  ```json
  {
    "jobs": [...],
    "pagination": {
      "page": 1,
      "limit": 10,
      "totalCount": 42,
      "totalPages": 5
    }
  }
  ```

### GET `/api/jobs/:id`
Inspects a single job details, including all historic worker executions, stdout output logs, and AI diagnostics analysis if the job failed.

### POST `/api/jobs/:id/cancel`
Cancels a `QUEUED` or `SCHEDULED` job, transitioning its status to `CANCELLED`. Required roles: `ADMIN`, `DEVELOPER`.

### POST `/api/jobs/:id/retry`
Manually resubmits a failed job. Clears its Dead Letter Queue record, resets attempts, and sets status back to `QUEUED` for immediate pickup. Required roles: `ADMIN`, `DEVELOPER`.
