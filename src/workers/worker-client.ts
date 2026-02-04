
import { EventEmitter } from 'events';
import { createInterface } from 'readline';
import { ChildProcess } from 'child_process';
import type {
  IWorker,
  WorkerInfo,
  ExecuteRequest,
  WorkerResponse,
  PingRequest,
  ShutdownRequest,
  WorkerMessage,
} from '../types/worker-types.js';

const MAX_MESSAGE_CHARS = Number(process.env['TRAE_AI_MAX_MESSAGE_CHARS'] ?? 1_000_000);

export class StdioWorker extends EventEmitter implements IWorker {
  public info: WorkerInfo;
  private activeRequests: Map<string, {
    resolve: (response: WorkerResponse) => void;
    reject: (error: Error) => void;
  }> = new Map();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    public id: string,
    private process: ChildProcess,
  ) {
    super();

    this.info = {
      id,
      capabilities: {
        tools: [], // Will be updated on register
        languages: [],
        max_concurrent: 1,
        warm_start_ms: 0,
        features: [],
      },
      resources: {
        cpu_cores: 0,
        memory_mb: 0,
        gpu: false,
      },
      status: 'starting',
      current_load: 0,
      queue_depth: 0,
      started_at: Date.now(),
      last_ping: Date.now(),
    };

    this.setupCommunication();
  }

  private setupCommunication(): void {
    const rl = createInterface({
      input: this.process.stdout!,
      terminal: false,
      crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
      if (line.length > MAX_MESSAGE_CHARS) {
        const err = new Error(`WORKER_MESSAGE_TOO_LARGE: Message length ${line.length} exceeds limit ${MAX_MESSAGE_CHARS}`);
        this.emit('error', err);
        // Fail all active requests for this worker immediately
        for (const [id, resolver] of this.activeRequests.entries()) {
             resolver.reject(err);
             this.activeRequests.delete(id);
        }
        this.updateLoad();
        return;
      }
      try {
        const message = JSON.parse(line) as WorkerMessage;
        if (message && typeof message === 'object' && 'type' in message) {
          this.handleMessage(message);
        } else {
          this.emit('error', new Error('WORKER_MESSAGE_INVALID'));
        }
      } catch (error) {
        console.error('Failed to parse worker message:', error);
      }
    });

    // Handle process events
    this.process.on('error', (err) => {
      this.info.status = 'crashed';
      this.emit('error', err);
    });

    this.process.on('exit', (code, signal) => {
      this.info.status = 'crashed';
      this.emit('crashed', { code, signal });
    });
  }

  private send(message: WorkerMessage): void {
    const line = JSON.stringify(message);
    this.writeChain = this.writeChain.then(() => new Promise<void>((resolve) => {
      const ok = this.process.stdin!.write(line + '\n');
      if (ok) {
        resolve();
      } else {
        this.process.stdin!.once('drain', () => resolve());
      }
    })).catch(() => {});
  }

  private handleMessage(message: WorkerMessage): void {
    switch (message.type) {
      case 'register':
        this.info.capabilities = message.capabilities;
        this.info.resources = message.resources;
        this.info.status = 'ready';
        this.emit('ready');
        break;

      case 'success':
      case 'error':
        if (message.id) {
          const resolver = this.activeRequests.get(message.id);
          if (resolver) {
            resolver.resolve(message);
            this.activeRequests.delete(message.id);
            this.updateLoad();
          }
        }
        break;

      case 'pong':
        this.info.last_ping = Date.now();
        this.info.status = 'ready'; // Assume ready if responding
        break;

      default:
        // Ignore other messages
        break;
    }
  }

  async execute(request: ExecuteRequest): Promise<WorkerResponse> {
    return new Promise((resolve, reject) => {
      this.activeRequests.set(request.id, { resolve, reject });
      this.send(request);
      this.updateLoad();
    });
  }

  async ping(): Promise<boolean> {
    const id = `ping-${Date.now()}`;
    this.send({ type: 'ping', id, timestamp: Date.now() });
    // We don't wait for pong here to block, just fire and forget (or could implement wait)
    // For now, simple return true, health check relies on last_ping update
    return true;
  }

  async shutdown(graceful: boolean): Promise<void> {
    this.send({ type: 'shutdown', graceful, timeout_ms: 5000 });
  }

  private updateLoad(): void {
    const pending = this.activeRequests.size;
    const max = this.info.capabilities.max_concurrent || 1;
    this.info.current_load = pending / max;
    this.info.queue_depth = pending;
    
    if (this.info.current_load >= 1) {
      this.info.status = 'busy';
    } else {
      this.info.status = 'ready';
    }
  }
}
