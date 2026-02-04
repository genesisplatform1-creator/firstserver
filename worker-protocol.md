# Worker Protocol Specification v1.0

## Overview
Language-agnostic protocol for coordinator-worker communication.
Designed to work seamlessly across Node.js → Rust migration.

## Transport
- **Primary**: stdin/stdout (JSON lines)
- **Alternative**: HTTP/2 (for remote workers)
- **Future**: gRPC (for advanced features)

## Message Format

### Request (Coordinator → Worker)
```json
{
  "id": "unique-request-id",
  "type": "execute",
  "tool": "code_analysis",
  "params": {
    "language": "python",
    "code": "def hello(): pass",
    "analysis_type": "ast"
  },
  "timeout_ms": 5000,
  "priority": "high"
}
```

### Response (Worker → Coordinator)
```json
{
  "id": "unique-request-id",
  "type": "success",
  "result": {
    "ast": {...},
    "metrics": {
      "parse_time_ms": 12,
      "memory_mb": 4.2
    }
  },
  "cache_key": "blake3:abc123...",
  "cache_ttl_seconds": 3600
}
```

### Error Response
```json
{
  "id": "unique-request-id",
  "type": "error",
  "error": {
    "code": "PARSE_ERROR",
    "message": "Syntax error at line 5",
    "details": {...}
  }
}
```

### Streaming Response (for long operations)
```json
{
  "id": "unique-request-id",
  "type": "stream",
  "chunk": {
    "progress": 0.45,
    "message": "Analyzing module 23/50",
    "partial_result": {...}
  }
}
```

## Worker Lifecycle

### 1. Registration
Worker starts and sends capabilities:
```json
{
  "type": "register",
  "worker_id": "python-worker-001",
  "capabilities": {
    "tools": ["parse", "type_check", "lint"],
    "languages": ["python"],
    "max_concurrent": 4,
    "warm_start_ms": 50
  },
  "resources": {
    "cpu_cores": 2,
    "memory_mb": 1024,
    "gpu": false
  }
}
```

### 2. Health Check
Coordinator periodically pings:
```json
{
  "type": "ping",
  "timestamp": 1704123456789
}
```

Worker responds:
```json
{
  "type": "pong",
  "timestamp": 1704123456789,
  "status": {
    "queue_depth": 3,
    "cpu_usage": 0.42,
    "memory_usage_mb": 512
  }
}
```

### 3. Shutdown
```json
{
  "type": "shutdown",
  "graceful": true,
  "timeout_ms": 5000
}
```

## Tool Categories

### Static Analysis Tools
- `parse` - Generate AST
- `type_check` - Type inference
- `lint` - Code quality checks
- `complexity` - Cyclomatic complexity, etc.

### Code Transformation Tools
- `format` - Auto-formatting
- `refactor` - Automated refactoring
- `transpile` - Language-to-language

### Search/Query Tools
- `semantic_search` - Vector similarity
- `symbol_search` - Find definitions/references
- `dependency_graph` - Import analysis

### AI/ML Tools
- `generate_code` - LLM-based generation
- `explain_code` - Documentation generation
- `embeddings` - Code vectorization

### Formal Methods Tools
- `verify` - Formal verification (Z3, Coq)
- `test_gen` - Automated test generation
- `proof` - Theorem proving

## Performance Requirements

| Tool Category | Target Latency | Max Memory | Cache TTL |
|--------------|---------------|------------|-----------|
| Parse | <50ms | 100MB | 1 hour |
| Type Check | <200ms | 500MB | 30 min |
| Lint | <100ms | 200MB | 1 hour |
| Format | <20ms | 50MB | infinite |
| LLM Generate | <2s | 2GB | 1 day |
| Embeddings | <500ms | 1GB | 1 week |
| Formal Verify | <10s | 4GB | 1 week |

## Caching Strategy

### Cache Key Generation
```
cache_key = blake3(
  tool_name +
  tool_version +
  canonical(params) +  // Normalized, sorted
  dependency_hash      // For dependent operations
)
```

### Cache Metadata
```json
{
  "key": "blake3:...",
  "created_at": 1704123456789,
  "ttl_seconds": 3600,
  "size_bytes": 1024,
  "hit_count": 42,
  "dependencies": ["file:main.py", "config:v2"]
}
```

## Error Codes

- `PARSE_ERROR` - Syntax error in input
- `TIMEOUT` - Operation exceeded timeout
- `RESOURCE_LIMIT` - Memory/CPU limit hit
- `UNSUPPORTED_LANGUAGE` - Language not supported
- `WORKER_CRASHED` - Worker process died
- `INVALID_PARAMS` - Bad request parameters

## Extension Points

### Custom Tools
Workers can register custom tools:
```json
{
  "type": "register_tool",
  "tool_name": "custom_analyzer",
  "schema": {
    "params": {...},
    "returns": {...}
  }
}
```

### Middleware Hooks
- `before_execute` - Transform request
- `after_execute` - Post-process result
- `on_error` - Error handling

## Implementation Notes

### Node.js Workers
```typescript
// Simple stdio-based worker
process.stdin.on('line', (line) => {
  const request = JSON.parse(line);
  const result = execute(request);
  process.stdout.write(JSON.stringify(result) + '\n');
});
```

### Rust Workers
```rust
// Same protocol, different language
use serde_json::Value;
use std::io::{self, BufRead, Write};

fn main() {
    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let request: Value = serde_json::from_str(&line?)?;
        let result = execute(request);
        writeln!(io::stdout(), "{}", serde_json::to_string(&result)?)?;
    }
}
```

### Python Workers
```python
import sys
import json

for line in sys.stdin:
    request = json.loads(line)
    result = execute(request)
    print(json.dumps(result), flush=True)
```

## Versioning
Protocol uses semantic versioning. Workers declare supported version:
```json
{
  "protocol_version": "1.0.0",
  "min_coordinator_version": "1.0.0"
}
```
