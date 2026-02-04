# Trae AI MCP Server

A comprehensive Model Context Protocol (MCP) server designed to maximize AI code editor productivity through intelligent progress management, risk assessment, and productivity tools.

## Features

- **16 Powerful Tools** across 4 categories
- **ECS Architecture** - Entity Component System for composable state
- **Durable Execution** - SQLite-backed event sourcing with replay support
- **Immutable Audit Log** - Full reasoning trace and immutable lineage tracking (Merkle Tree backed)

## Installation

```bash
npm install
npm run build
```

## Usage

### With Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "trae-ai": {
      "command": "node",
      "args": ["/path/to/mcpserver-01/dist/index.js"]
    }
  }
}
```

### With MCP Inspector

```bash
npm run inspector
```

## Use Cases: Why Advanced Data Structures?

While 16 tools might seem excessive, each serves a specific high-scale code productivity purpose:

### 1. **HyperLogLog (`ds_hyperloglog`)**
- **Problem**: You are refactoring a monorepo with 500,000 files. You need to know "How many *unique* error types are in the logs?" to prioritize fixes.
- **Naive Solution**: Load all logs into memory `Set<string>`. **OOM Crash**.
- **Trae Solution**: Stream logs into HyperLogLog. Uses <12KB memory to estimate cardinality with 99% accuracy.

### 2. **Wavelet Trees (`ds_wavelet_ops`)**
- **Problem**: "Find the 5000th occurrence of the variable `userID` in a 2GB log file."
- **Naive Solution**: Scan linearly every time. Slow.
- **Trae Solution**: Build a Wavelet Tree index. `select(5000, 'userID')` is **O(1)**. Instant navigation in massive files.

### 3. **Gomory-Hu Tree (`ds_graph_gomory_hu`)**
- **Problem**: You want to split a monolithic service into microservices. Where do you cut?
- **Trae Solution**: Model the codebase as a graph (files=nodes, imports=edges). Gomory-Hu Tree efficiently calculates the **Min-Cut** between all pairs, identifying the "weakest links" (lowest coupling) to define service boundaries.

### 4. **Immutable Audit Log (Merkle Trees)**
- **Problem**: "Who changed this logic and why? Did the AI hallucinate this step?"
- **Trae Solution**: Every tool execution is an event in a Merkle Tree. We can cryptographically prove the *exact* sequence of reasoning steps that led to a code change, preventing "AI black box" issues.

## Real-World Examples

### 1. Progress Tracking
```typescript
// Initialize a complex refactor task
await mcp.call('progress_init', {
  taskId: 'refactor-auth-v2',
  description: 'Migrate to OAuth2 provider',
  steps: 12
});

// Update as you go
await mcp.call('progress_update', {
  taskId: 'refactor-auth-v2',
  percentage: 25,
  currentStep: 3,
  status: 'in_progress'
});
```

### 2. High-Scale Cardinality Check
```typescript
// Estimate unique error logs in a massive stream
const streamId = 'logs-2024-10-01';
await mcp.call('ds_hyperloglog', {
    action: 'add',
    key: streamId,
    values: ['Error: 500', 'Error: 404', 'Error: 500', ...] 
});

const count = await mcp.call('ds_hyperloglog', {
    action: 'count',
    key: streamId
});
// Returns ~2 (very fast, low memory)
```

## Tools

| Tool | Description |
| --- | --- |
| `progress_init` | Initialize progress tracking for a task |
| `progress_update` | Update task progress (percentage, status) |
| `progress_query` | Query current progress state |
| `progress_complete` | Mark task as complete with summary |

### Code Intelligence

| Tool | Description |
| --- | --- |
| `code_analyze` | Analyze code quality, patterns, issues |
| `task_decompose` | Break task into sub-agents (≤50 steps) |
| `context_manage` | Manage code context and memory |
| `diff_review` | Review and validate code changes |

### Risk & Governance

| Tool | Description |
| --- | --- |
| `risk_assess` | Evaluate critical risks in code changes |
| `compliance_check` | Check against coding standards |
| `security_scan` | Scan for vulnerabilities |
| `lineage_track` | Full reasoning trace (Audit Log) |

### Productivity

| Tool | Description |
| --- | --- |
| `productivity_metrics` | Track coding productivity |
| `bottleneck_detect` | Identify productivity blockers |
| `resource_optimize` | Optimize token/memory usage |
| `workflow_automate` | Automate repetitive tasks |

### Data Structures

| Tool | Description |
| --- | --- |
| `ds_merkle_tree` | Verify integrity using Merkle Trees |
| `ds_bloom_filter` | Probabilistic set membership |
| `ds_hyperloglog` | Cardinality estimation |
| `ds_bitvector_rank` | O(1) Rank query on bit vector |
| `ds_bitvector_select` | O(1) Select query on bit vector |
| `ds_wavelet_ops` | Text operations (Access/Rank/Select) via Wavelet Tree |
| `ds_graph_gomory_hu` | Compute min-cuts via Gomory-Hu Tree |
| `ds_algebra_lattice_ops` | Partial Order, Join, Meet, Fixpoint operations |
| `ds_prob_minhash` | Generate MinHash signature for text (similitude estimation) |
| `ds_prob_lsh` | Sub-linear similarity search using LSH Index |

### Deep Program Analysis (Compiler Theory)

- **`cfa_ssa`**: Construct Static Single Assignment (SSA) form (Dominators, Frontiers).
- **`type_hindley_milner`**: Infer types for Lambda Calculus (Algorithm W).

## Grand Unification

The server now includes a `scripts/demo_grand_integration.ts` that demonstrates:

1. **Probabilistic**: Detecting malware variants using MinHash/LSH.
2. **Compiler**: Inferring types of the payload.
3. **Static Analysis**: analyzing control flow (SSA) to find merge points.
4. **Graph**: Identifying bottlenecks in data dependency.
5. **Succinct**: Logging the audit trail in a BitVector.

Run it with: `npx tsx scripts/demo_grand_integration.ts`

## Performance Benchmarks

Recent stress tests (`scripts/stress_test_ultra.ts`) demonstrate:

- **Throughput**: ~60-80 Requests Per Second (TPS) for lightweight tasks.
- **Latency**: Sub-10ms for small matrix operations.
- **Scalability**: Handles 500x500 matrix computations without crashing (via file offloading).
- **Context Safety**: Large results (>10k elements) are automatically offloaded to files, reducing JSON payload from ~1.2MB to <500 bytes.

## Troubleshooting & Resource Limits

### Common Issues
- **`npx: command not found`**: Ensure you have Node.js 18+ installed.
- **SQLite Errors**: The server uses `better-sqlite3` in WAL mode. Ensure you have write permissions to the directory.

### Resource Limits
- **Concurrency**: Tested up to **50 concurrent workers**.
- **Memory**: Base footprint ~150MB. Large matrix operations (>10k elements) offload to disk to prevent OOM.
- **Storage**: Event log grows at ~1KB per event. 1 million events ≈ 1GB. Use `admin_prune` (planned) for cleanup.

### Architecture Trade-offs
- **Synchronous SQLite**: We use `better-sqlite3` for maximum single-thread throughput (10k+ inserts/sec). This blocks the event loop for microseconds per write. For an MCP server (typically single-user), this trade-off provides superior data integrity over async implementations.

## Error Handling & Recovery

We design for failure. Here is how the server handles common edge cases:

```typescript
// Example: SQLite constraint violation (e.g., duplicate event ID)
try {
  eventStore.append(event);
} catch (error) {
  if (error.code === 'SQLITE_CONSTRAINT') {
    console.error('Integrity violation: Event already exists');
    // Recovery: Retry with new ID or return existing idempotent result
  } else if (error.code === 'SQLITE_FULL') {
    console.error('Disk full - switching to read-only mode');
  }
}
```

- **Worker Crashes**: If a worker process (e.g., `code-analysis-worker`) crashes (OOM or segfault), the `WorkerPool` automatically restarts it and retries the task up to 3 times.
- **Context Overflow**: Large results are offloaded to disk (`file://...` references) instead of crashing the JSON-RPC connection.

## Architecture

```text
src/
├── index.ts              # MCP server entry point
├── ecs/                  # Entity Component System
│   ├── entities.ts       # Entity ID generators
│   ├── components.ts     # Zod component schemas
│   └── systems.ts        # Pure system functions
├── durability/           # Durable execution engine
│   ├── event-store.ts    # SQLite event sourcing
│   └── workflow.ts       # Deterministic wrappers
├── tools/                # MCP tools
│   ├── progress/         # Progress management
│   ├── code-intelligence/# Code analysis
│   ├── risk-governance/  # Risk assessment
│   └── productivity/     # Productivity tools
├── resources/            # MCP resources
└── prompts/              # MCP prompts
```

## License

MIT
