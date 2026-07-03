export interface AISummary {
  reason: string;
  category: 'TIMEOUT' | 'DATABASE' | 'NETWORK' | 'CODE_ERROR' | 'SYSTEM' | 'UNKNOWN';
  suggestedAction: string;
  confidence: number;
}

export function generateFailureSummary(errorMsg: string): AISummary {
  const msg = errorMsg.toLowerCase();

  if (msg.includes('timeout') || msg.includes('deadline exceeded')) {
    return {
      reason: 'The execution took longer than the configured execution timeout threshold.',
      category: 'TIMEOUT',
      suggestedAction: 'Optimize execution logic, increase the job execution timeout parameter, or break down the payload into smaller batches.',
      confidence: 0.95
    };
  }

  if (msg.includes('locked') || msg.includes('deadlock') || msg.includes('sqlite_busy')) {
    return {
      reason: 'Database write contention occurred causing concurrent write lock timeouts.',
      category: 'DATABASE',
      suggestedAction: 'Enable Write-Ahead Logging (WAL) in SQLite, implement linear retry backoffs, or throttle concurrency limits for this queue.',
      confidence: 0.90
    };
  }

  if (msg.includes('refused') || msg.includes('network') || msg.includes('fetch') || msg.includes('dns') || msg.includes('enotfound') || msg.includes('connect')) {
    return {
      reason: 'Failed to establish connection to an external dependency or service endpoint.',
      category: 'NETWORK',
      suggestedAction: 'Verify network routes, inspect the external service health, and adjust the queue retry policy to use exponential backoff to handle transient network issues.',
      confidence: 0.88
    };
  }

  if (msg.includes('syntax') || msg.includes('unexpected token') || msg.includes('undefined') || msg.includes('null') || msg.includes('typeerror') || msg.includes('not a function')) {
    return {
      reason: 'A JavaScript runtime exception occurred while parsing arguments or calling object references.',
      category: 'CODE_ERROR',
      suggestedAction: 'Inspect the code corresponding to the worker task runner. Add defensive checks against undefined/null properties and validate the input schema in the payload.',
      confidence: 0.92
    };
  }

  if (msg.includes('memory') || msg.includes('heap') || msg.includes('oom')) {
    return {
      reason: 'The worker run exceeded maximum memory limits leading to an out-of-memory crash.',
      category: 'SYSTEM',
      suggestedAction: 'Inspect memory profile for leaks, increase the worker process memory limit, or process payloads as a streaming iterator.',
      confidence: 0.95
    };
  }

  return {
    reason: 'An unhandled exception occurred during job execution.',
    category: 'UNKNOWN',
    suggestedAction: 'Review the full execution logs and stdout stack traces. Contact the developer group if error persists.',
    confidence: 0.60
  };
}
