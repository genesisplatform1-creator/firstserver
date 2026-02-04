/**
 * Worker Protocol Types
 * 
 * These interfaces define the contract between coordinator and workers.
 * Designed to map 1:1 to Rust types for easy migration.
 */

// ============================================================================
// Core Message Types
// ============================================================================

export type WorkerMessageType =
  | 'register'
  | 'execute'
  | 'ping'
  | 'pong'
  | 'shutdown'
  | 'success'
  | 'error'
  | 'stream';

export interface BaseMessage {
  type: WorkerMessageType;
  id?: string; // Request/response correlation
}

// ============================================================================
// Request Messages (Coordinator → Worker)
// ============================================================================

export interface ExecuteRequest extends BaseMessage {
  type: 'execute';
  id: string;
  tool: string;
  params: Record<string, unknown>;
  timeout_ms?: number;
  priority?: 'critical' | 'high' | 'normal' | 'low' | 'batch';
  context?: {
    project_root?: string;
    file_path?: string;
    language?: string;
  };
}

export interface PingRequest extends BaseMessage {
  type: 'ping';
  timestamp: number;
}

export interface ShutdownRequest extends BaseMessage {
  type: 'shutdown';
  graceful: boolean;
  timeout_ms: number;
}

// ============================================================================
// Response Messages (Worker → Coordinator)
// ============================================================================

export interface SuccessResponse extends BaseMessage {
  type: 'success';
  id: string;
  result: unknown;
  cache_key?: string;
  cache_ttl_seconds?: number;
  metrics?: {
    execution_time_ms: number;
    memory_mb?: number;
    cpu_percent?: number;
  };
}

export interface ErrorResponse extends BaseMessage {
  type: 'error';
  id: string;
  error: {
    code: string;
    message: string;
    details?: unknown;
    stack?: string;
  };
}

export interface StreamResponse extends BaseMessage {
  type: 'stream';
  id: string;
  chunk: {
    progress?: number; // 0.0 to 1.0
    message?: string;
    partial_result?: unknown;
  };
  final?: boolean;
}

export interface PongResponse extends BaseMessage {
  type: 'pong';
  timestamp: number;
  status: {
    queue_depth: number;
    cpu_usage: number;
    memory_usage_mb: number;
    uptime_seconds: number;
  };
}

// ============================================================================
// Worker Lifecycle
// ============================================================================

export interface WorkerCapabilities {
  tools: string[];
  languages?: string[];
  max_concurrent: number;
  warm_start_ms?: number;
  features?: string[]; // e.g., ['incremental', 'streaming', 'gpu']
}

export interface WorkerResources {
  cpu_cores: number;
  memory_mb: number;
  gpu: boolean;
  disk_mb?: number;
}

export interface RegisterMessage extends BaseMessage {
  type: 'register';
  worker_id: string;
  capabilities: WorkerCapabilities;
  resources: WorkerResources;
  protocol_version: string;
}

// ============================================================================
// Worker Pool Types
// ============================================================================

export interface WorkerInfo {
  id: string;
  capabilities: WorkerCapabilities;
  resources: WorkerResources;
  status: 'starting' | 'ready' | 'busy' | 'overloaded' | 'crashed';
  current_load: number; // 0.0 to 1.0
  queue_depth: number;
  started_at: number;
  last_ping: number;
}

export interface WorkerMetrics {
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
  p99_latency_ms: number;
  cache_hit_rate: number;
}

// ============================================================================
// Task/Job Types
// ============================================================================

export type TaskPriority = 'critical' | 'high' | 'normal' | 'low' | 'batch';

export interface Task {
  id: string;
  tool: string;
  params: Record<string, unknown>;
  priority: TaskPriority;
  timeout_ms: number;
  created_at: number;
  started_at?: number;
  completed_at?: number;
  worker_id?: string;
  retries: number;
  max_retries: number;
}

export interface TaskResult {
  task_id: string;
  success: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  metrics: {
    queue_time_ms: number;
    execution_time_ms: number;
    total_time_ms: number;
  };
  from_cache: boolean;
  cache_key?: string;
}

// ============================================================================
// Cache Types
// ============================================================================

export interface CacheEntry {
  key: string;
  value: unknown;
  created_at: number;
  ttl_seconds: number;
  size_bytes: number;
  hit_count: number;
  dependencies?: string[];
  metadata?: Record<string, unknown>;
}

export interface CacheStats {
  total_entries: number;
  total_size_bytes: number;
  hit_count: number;
  miss_count: number;
  hit_rate: number;
  eviction_count: number;
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface WorkerPoolConfig {
  max_workers: number;
  min_workers: number;
  worker_timeout_ms: number;
  health_check_interval_ms: number;
  auto_scale: boolean;
  scale_up_threshold: number; // Load percentage
  scale_down_threshold: number;
  max_queue_size?: number;
  cache?: Partial<CacheConfig>;
}

export interface CacheConfig {
  l1_enabled: boolean;
  l1_max_size_mb: number;
  l1_ttl_seconds: number;
  l2_enabled: boolean;
  l2_redis_url?: string;
  l2_max_size_mb: number;
  l3_enabled: boolean;
  l3_s3_bucket?: string;
}

export interface CoordinatorConfig {
  worker_pool: WorkerPoolConfig;
  cache: CacheConfig;
  request_timeout_ms: number;
  max_queue_size: number;
  backpressure_threshold: number;
}

// ============================================================================
// Type Guards (useful for runtime validation)
// ============================================================================

export function isExecuteRequest(msg: unknown): msg is ExecuteRequest {
  return typeof msg === 'object' && msg !== null &&
    (msg as BaseMessage).type === 'execute';
}

export function isSuccessResponse(msg: unknown): msg is SuccessResponse {
  return typeof msg === 'object' && msg !== null &&
    (msg as BaseMessage).type === 'success';
}

export function isErrorResponse(msg: unknown): msg is ErrorResponse {
  return typeof msg === 'object' && msg !== null &&
    (msg as BaseMessage).type === 'error';
}

// ============================================================================
// Utility Types
// ============================================================================

export type WorkerMessage =
  | ExecuteRequest
  | PingRequest
  | ShutdownRequest
  | SuccessResponse
  | ErrorResponse
  | StreamResponse
  | PongResponse
  | RegisterMessage;

export type WorkerRequest =
  | ExecuteRequest
  | PingRequest
  | ShutdownRequest;

export type WorkerResponse =
  | SuccessResponse
  | ErrorResponse
  | StreamResponse
  | PongResponse
  | RegisterMessage;

// ============================================================================
// Worker Interface
// ============================================================================

export interface IWorker {
  id: string;
  info: WorkerInfo;

  execute(request: ExecuteRequest): Promise<WorkerResponse>;
  ping(): Promise<boolean>;
  shutdown(graceful: boolean): Promise<void>;

  on(event: 'ready', listener: () => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'crashed', listener: () => void): this;
}
