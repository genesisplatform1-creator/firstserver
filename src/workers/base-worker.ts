import { createInterface } from 'node:readline';
import type {
    WorkerMessage,
    ExecuteRequest,
    PingRequest,
    ShutdownRequest,
    WorkerResponse,
    SuccessResponse,
    ErrorResponse,
    PongResponse,
    WorkerMessageType
} from '../types/worker-types.js';

export abstract class BaseWorker {
    protected readonly id: string;
    private rl: ReturnType<typeof createInterface>;

    constructor() {
        this.id = process.env.WORKER_ID || 'unknown';
        this.rl = createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: false
        });

        this.setupSignalHandlers();
        this.startLoop();
    }

    private setupSignalHandlers() {
        process.on('SIGTERM', () => this.handleShutdown({ type: 'shutdown', graceful: true, timeout_ms: 5000 }));
        process.on('SIGINT', () => this.handleShutdown({ type: 'shutdown', graceful: true, timeout_ms: 5000 }));
    }

    private startLoop() {
        this.rl.on('line', async (line) => {
            try {
                const message = JSON.parse(line) as WorkerMessage;
                await this.handleMessage(message);
            } catch (error) {
                console.error('Failed to parse message:', error);
                this.sendError('unknown', 'INVALID_JSON', 'Failed to parse JSON message');
            }
        });

        // Send ready signal
        this.send({
            type: 'register',
            id: this.id,
            protocol_version: '1.0.0',
            capabilities: this.getCapabilities(),
            resources: {
                cpu_cores: 1,
                memory_mb: 512,
                gpu: false
            }
        });
    }

    protected abstract getCapabilities(): any;

    protected async handleMessage(message: WorkerMessage) {
        switch (message.type) {
            case 'execute':
                await this.handleExecute(message as ExecuteRequest);
                break;
            case 'ping':
                this.handlePing(message as PingRequest);
                break;
            case 'shutdown':
                await this.handleShutdown(message as ShutdownRequest);
                break;
            default:
                // Ignore other messages for now
                break;
        }
    }

    protected abstract handleExecute(request: ExecuteRequest): Promise<void>;

    protected handlePing(request: PingRequest) {
        const response: PongResponse = {
            type: 'pong',
            id: request.id,
            timestamp: Date.now(),
            status: {
                queue_depth: 0, // TODO: Implement queue tracking
                cpu_usage: 0,
                memory_usage: process.memoryUsage().heapUsed,
                uptime: process.uptime()
            }
        };
        this.send(response);
    }

    protected async handleShutdown(request: ShutdownRequest) {
        if (request.graceful) {
            // TODO: Wait for pending tasks
            setTimeout(() => process.exit(0), 100);
        } else {
            process.exit(0);
        }
    }

    protected sendSuccess(id: string, result: unknown) {
        const response: SuccessResponse = {
            type: 'success',
            id,
            result
        };
        this.send(response);
    }

    protected sendError(id: string | undefined, code: string, message: string, details?: unknown) {
        const response: ErrorResponse = {
            type: 'error',
            id: id || 'unknown',
            error: {
                code,
                message,
                details
            }
        };
        this.send(response);
    }

    protected send(message: any) {
        console.log(JSON.stringify(message));
    }
}
