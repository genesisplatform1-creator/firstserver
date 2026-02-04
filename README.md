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

## Tools

### Progress Management

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
