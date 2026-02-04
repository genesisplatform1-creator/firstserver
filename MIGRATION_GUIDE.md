# Migration Guide: Monolithic → Worker Pool Architecture

## Overview
This guide shows how to incrementally migrate the current MCP server to the worker pool architecture **without breaking anything**.

## Current Architecture (Before)

```
┌────────────────────────────────────────┐
│         MCP Server (index.ts)          │
│  ┌──────────────────────────────────┐  │
│  │ Tool: code_analysis              │  │
│  │ Tool: web_search                 │  │
│  │ Tool: file_operations            │  │
│  │ Tool: git_operations             │  │
│  │ Tool: ...                        │  │
│  └──────────────────────────────────┘  │
│                                        │
│  All tools run in same process        │
│  Blocking, sequential, no isolation   │
└────────────────────────────────────────┘
```

## Target Architecture (After)

```
┌───────────────────────────────────────────────────────┐
│            MCP Server (Coordinator)                    │
│  ┌─────────────────────────────────────────────────┐  │
│  │ Request Router (validates, routes)              │  │
│  │ Worker Pool Manager (schedules tasks)           │  │
│  │ Cache Layer (L1 in-memory)                      │  │
│  └─────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│Parser Worker │  │Search Worker │  │Git Worker    │
│(subprocess)  │  │(subprocess)  │  │(subprocess)  │
└──────────────┘  └──────────────┘  └──────────────┘

Each worker:
- Runs in isolation
- Can be restarted independently
- Can be scaled horizontally
- Communicates via worker protocol
```

---

## Migration Strategy: 4 Phases

### Phase 1: Add Worker Pool Infrastructure (Week 1)
**Goal**: Set up the worker pool without changing existing tools.

1. **Install dependencies**:
   ```bash
   npm install --save-dev @types/node
   ```

2. **Add new files** (already created):
   - `worker-types.ts` - Protocol types
   - `worker-pool.ts` - Coordinator
   - `parser-worker.ts` - Example worker

3. **Create worker directory**:
   ```bash
   mkdir -p src/workers
   ```

4. **Test worker pool in isolation**:
   ```typescript
   // test-worker-pool.ts
   import { WorkerPool } from './worker-pool';
   import { ParserWorkerProcess } from './parser-worker';

   async function test() {
     const pool = new WorkerPool({
       max_workers: 2,
       min_workers: 1,
       worker_timeout_ms: 5000,
       health_check_interval_ms: 10000,
       auto_scale: false,
       scale_up_threshold: 0.8,
       scale_down_threshold: 0.2,
     });

     // Test execution
     const result = await pool.executeTask('parse', {
       language: 'javascript',
       code: 'const x = 1;',
     });

     console.log('Result:', result);
     await pool.shutdown();
   }

   test().catch(console.error);
   ```

---

### Phase 2: Convert First Tool to Worker (Week 1-2)
**Goal**: Prove the pattern works with one real tool.

**Step 1**: Choose the simplest tool (e.g., `code_parse`)

**Step 2**: Create worker wrapper:
```typescript
// src/workers/code-analysis-worker.ts
import { ParserWorkerProcess } from '../parser-worker';
import * as babel from '@babel/parser';
import * as ts from 'typescript';

class CodeAnalysisWorker extends ParserWorkerProcess {
  protected async parse(params: any): Promise<any> {
    const { language, code, options = {} } = params;

    switch (language) {
      case 'javascript':
      case 'jsx':
        return babel.parse(code, {
          sourceType: 'module',
          plugins: ['jsx'],
          ...options,
        });

      case 'typescript':
      case 'tsx':
        return ts.createSourceFile(
          'temp.ts',
          code,
          ts.ScriptTarget.Latest,
          true
        );

      default:
        throw new Error(`Unsupported language: ${language}`);
    }
  }
}

// Entry point for worker process
if (require.main === module) {
  new CodeAnalysisWorker().start();
}
```

**Step 3**: Update MCP server to use worker pool:
```typescript
// src/index.ts (modified)
import { WorkerPool } from './worker-pool';
import { spawn } from 'child_process';
import { StdioWorker } from './parser-worker';

class MCPServer {
  private workerPool: WorkerPool;

  constructor() {
    this.workerPool = new WorkerPool({
      max_workers: 4,
      min_workers: 2,
      // ... config
    });

    this.initializeWorkers();
  }

  private initializeWorkers() {
    // Spawn code analysis workers
    for (let i = 0; i < 2; i++) {
      const proc = spawn('node', [
        require.resolve('./workers/code-analysis-worker')
      ]);
      const worker = new StdioWorker(`code-analysis-${i}`, proc);
      this.workerPool.registerWorker(worker);
    }
  }

  // MCP tool handler
  async handleToolCall(name: string, args: any) {
    if (name === 'code_parse') {
      // Use worker pool instead of direct execution
      const result = await this.workerPool.executeTask('parse', {
        language: args.language,
        code: args.code,
      });
      return result.result;
    }

    // Other tools still use old method (for now)
    return this.handleToolCallOld(name, args);
  }
}
```

**Step 4**: Test side-by-side:
- Keep old implementation as fallback
- Route 10% of traffic to new worker
- Compare results
- Monitor performance

---

### Phase 3: Migrate Remaining Tools (Week 2-3)
**Goal**: Convert all tools to workers.

**Tool Categories**:

1. **Quick Wins** (migrate first):
   - `code_parse` ✓
   - `code_format`
   - `code_lint`
   - `file_read`
   - `file_write`

2. **Medium Complexity**:
   - `git_operations` (spawn git commands)
   - `web_search` (HTTP requests)
   - `database_query`

3. **Complex** (migrate last):
   - `llm_generate` (may need GPU worker)
   - `code_transform` (may need multiple worker types)

**Worker Creation Template**:
```typescript
// src/workers/{category}-worker.ts
import { ParserWorkerProcess } from '../parser-worker';

class {Category}Worker extends ParserWorkerProcess {
  constructor() {
    super();
    // Register supported tools
    this.registerTool('tool_name', this.handleToolName.bind(this));
  }

  private async handleToolName(params: any): Promise<any> {
    // Tool implementation
    return { result: 'success' };
  }
}

if (require.main === module) {
  new {Category}Worker().start();
}
```

---

### Phase 4: Add Advanced Features (Week 3-4)
**Goal**: Leverage the new architecture for performance.

1. **Add L1 Cache**:
```typescript
// src/cache/l1-cache.ts
import LRU from 'lru-cache';

export class L1Cache {
  private cache: LRU<string, any>;

  constructor(maxSize: number) {
    this.cache = new LRU({
      max: maxSize,
      maxSize: maxSize * 1024 * 1024, // Convert MB to bytes
      sizeCalculation: (value) => JSON.stringify(value).length,
    });
  }

  get(key: string): any | undefined {
    return this.cache.get(key);
  }

  set(key: string, value: any, ttl?: number): void {
    this.cache.set(key, value, { ttl: ttl ? ttl * 1000 : undefined });
  }
}
```

2. **Add to Worker Pool**:
```typescript
// worker-pool.ts (add cache)
export class WorkerPool {
  private cache: L1Cache;

  constructor(config: WorkerPoolConfig) {
    this.cache = new L1Cache(config.cache.l1_max_size_mb);
  }

  async executeTask(tool: string, params: any): Promise<TaskResult> {
    // Check cache first
    const cacheKey = this.generateCacheKey(tool, params);
    const cached = this.cache.get(cacheKey);
    
    if (cached) {
      return {
        task_id: randomUUID(),
        success: true,
        result: cached,
        from_cache: true,
        metrics: { /* ... */ },
      };
    }

    // Execute and cache
    const result = await this.executeTaskUncached(tool, params);
    if (result.success) {
      this.cache.set(cacheKey, result.result);
    }

    return result;
  }

  private generateCacheKey(tool: string, params: any): string {
    return createHash('blake2b512')
      .update(JSON.stringify({ tool, params }))
      .digest('hex');
  }
}
```

3. **Add Metrics Dashboard**:
```typescript
// src/metrics/dashboard.ts
export class MetricsDashboard {
  constructor(private pool: WorkerPool) {}

  getSnapshot() {
    const poolMetrics = this.pool.getMetrics();
    
    return {
      timestamp: Date.now(),
      workers: {
        total: poolMetrics.workers,
        healthy: poolMetrics.workers, // TODO: track health
      },
      tasks: {
        total: poolMetrics.total_tasks,
        completed: poolMetrics.completed_tasks,
        failed: poolMetrics.failed_tasks,
        queued: poolMetrics.queue_size,
        pending: poolMetrics.pending_tasks,
      },
      performance: {
        success_rate: poolMetrics.success_rate,
        avg_queue_time_ms: poolMetrics.avg_queue_time_ms,
        avg_execution_time_ms: poolMetrics.avg_execution_time_ms,
      },
      cache: {
        // TODO: Add cache metrics
      },
    };
  }
}
```

---

## Comparison: Before vs After

### Before (Monolithic)
```typescript
// Direct execution, blocking
server.addTool({
  name: 'code_parse',
  handler: async (args) => {
    const ast = babel.parse(args.code); // Blocks event loop
    return ast;
  }
});
```

**Problems**:
- CPU-intensive parsing blocks all other requests
- No timeout handling
- No retry logic
- Memory leaks affect entire server
- Can't scale horizontally

### After (Worker Pool)
```typescript
// Delegated to worker, non-blocking
server.addTool({
  name: 'code_parse',
  handler: async (args) => {
    const result = await workerPool.executeTask('parse', args);
    return result.result;
  }
});
```

**Benefits**:
- Parsing in isolated process
- Automatic timeout handling
- Built-in retry logic
- Worker crash doesn't affect server
- Can spawn more workers on demand

---

## Testing Strategy

### Unit Tests
```typescript
// test/worker-pool.test.ts
describe('WorkerPool', () => {
  let pool: WorkerPool;

  beforeEach(() => {
    pool = new WorkerPool(testConfig);
  });

  it('should execute task successfully', async () => {
    const result = await pool.executeTask('parse', {
      language: 'javascript',
      code: 'const x = 1;',
    });

    expect(result.success).toBe(true);
    expect(result.result).toBeDefined();
  });

  it('should use cache on second call', async () => {
    const params = { language: 'javascript', code: 'const x = 1;' };
    
    const result1 = await pool.executeTask('parse', params);
    const result2 = await pool.executeTask('parse', params);

    expect(result1.from_cache).toBe(false);
    expect(result2.from_cache).toBe(true);
  });

  it('should handle worker crash gracefully', async () => {
    // Kill worker mid-execution
    // Verify task is retried on different worker
  });
});
```

### Integration Tests
```typescript
// test/integration/mcp-server.test.ts
describe('MCP Server with Worker Pool', () => {
  it('should handle concurrent requests', async () => {
    const requests = Array.from({ length: 100 }, (_, i) => 
      server.handleToolCall('code_parse', {
        language: 'javascript',
        code: `const x${i} = ${i};`,
      })
    );

    const results = await Promise.all(requests);
    expect(results).toHaveLength(100);
    expect(results.every(r => r !== null)).toBe(true);
  });
});
```

### Performance Tests
```typescript
// test/performance/throughput.test.ts
describe('Throughput', () => {
  it('should handle 1000 req/s', async () => {
    const startTime = Date.now();
    const count = 1000;

    for (let i = 0; i < count; i++) {
      pool.executeTask('parse', { /* ... */ });
    }

    const duration = Date.now() - startTime;
    const throughput = count / (duration / 1000);

    expect(throughput).toBeGreaterThan(1000);
  });
});
```

---

## Rollback Plan

If something goes wrong:

1. **Immediate Rollback** (< 5 minutes):
   ```typescript
   // Feature flag to disable worker pool
   const USE_WORKER_POOL = process.env.USE_WORKER_POOL === 'true';

   if (USE_WORKER_POOL) {
     return await workerPool.executeTask(tool, params);
   } else {
     return await legacyHandler(tool, params);
   }
   ```

2. **Gradual Rollout**:
   - Week 1: 10% of traffic
   - Week 2: 50% of traffic
   - Week 3: 100% of traffic

3. **Monitoring**:
   - Error rate
   - Latency (p50, p95, p99)
   - Memory usage
   - Worker crash rate

---

## Next Steps

1. **Immediate** (Today):
   - Review this migration plan
   - Choose first tool to migrate
   - Set up test environment

2. **This Week**:
   - Implement worker pool infrastructure
   - Convert first tool (code_parse)
   - Run side-by-side comparison

3. **Next Week**:
   - Migrate 3-5 more tools
   - Add L1 cache
   - Set up monitoring

4. **Following Weeks**:
   - Migrate remaining tools
   - Optimize worker count
   - Prepare for Rust migration

---

## Success Metrics

After migration, we should see:
- ✅ 50%+ reduction in p95 latency
- ✅ 80%+ cache hit rate (after warmup)
- ✅ 0 server crashes due to worker issues
- ✅ Ability to handle 10x concurrent requests
- ✅ < 5 minute recovery from worker crash

Ready to start? Let's begin with Phase 1!
