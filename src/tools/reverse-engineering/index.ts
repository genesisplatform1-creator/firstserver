/**
 * Reverse Engineering Intelligence
 * Tools for binary analysis, structure recovery, protocol analysis, API tracing
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createEntity, EntityType, serializeEntity } from '../../ecs/index.js';
import { getEventStore } from '../../durability/index.js';

// Binary format signatures
const BINARY_SIGNATURES: Record<string, { sig: number[]; desc: string }> = {
    'PE': { sig: [0x4D, 0x5A], desc: 'Windows PE Executable' },
    'ELF': { sig: [0x7F, 0x45, 0x4C, 0x46], desc: 'Linux ELF' },
    'MachO-64': { sig: [0xCF, 0xFA, 0xED, 0xFE], desc: 'macOS 64-bit' },
    'DEX': { sig: [0x64, 0x65, 0x78, 0x0A], desc: 'Android DEX' },
};

// API categories for risk analysis
const API_CATEGORIES: Record<string, { fns: string[]; risk: string }> = {
    'File': { fns: ['CreateFile', 'ReadFile', 'WriteFile', 'fopen', 'open'], risk: 'medium' },
    'Network': { fns: ['socket', 'connect', 'send', 'recv', 'WSASocket'], risk: 'high' },
    'Process': { fns: ['CreateProcess', 'VirtualAlloc', 'mmap', 'fork', 'exec'], risk: 'high' },
    'Injection': { fns: ['WriteProcessMemory', 'CreateRemoteThread', 'SetWindowsHookEx'], risk: 'critical' },
    'Anti-Analysis': { fns: ['IsDebuggerPresent', 'CheckRemoteDebuggerPresent', 'rdtsc'], risk: 'critical' },
};

export function registerReverseEngineeringTools(server: McpServer): void {
    // Tool 1: binary_disassemble
    server.tool(
        'binary_disassemble',
        'Analyze binary structure, detect format, provide disassembly guidance',
        {
            filename: z.string(),
            hexDump: z.string().optional(),
            architecture: z.enum(['x86', 'x86-64', 'arm', 'arm64', 'auto']).default('auto'),
        },
        async ({ filename, hexDump, architecture }) => {
            const entity = createEntity(EntityType.TASK);
            const entityId = serializeEntity(entity);
            const store = getEventStore();
            const ext = filename.split('.').pop()?.toLowerCase() ?? '';

            let format = 'unknown';
            const extMap: Record<string, string> = { exe: 'PE', dll: 'PE', so: 'ELF', dylib: 'MachO-64' };
            if (extMap[ext]) format = extMap[ext]!;

            if (hexDump) {
                const bytes = hexDump.replace(/\s/g, '').match(/.{2}/g)?.map(b => parseInt(b, 16)) ?? [];
                for (const [f, s] of Object.entries(BINARY_SIGNATURES)) {
                    if (s.sig.every((b, i) => bytes[i] === b)) { format = f; break; }
                }
            }

            store.append(entityId, 're.disassembled', { filename, format, architecture });

            return {
                content: [{
                    type: 'text', text: JSON.stringify({
                        entityId, format, description: BINARY_SIGNATURES[format]?.desc ?? 'Unknown',
                        tools: ['ghidra', 'radare2', 'x64dbg', 'ida-pro'],
                        steps: ['Entry point', 'Imports', 'Function boundaries', 'Strings', 'Crypto ops'],
                    }, null, 2)
                }]
            };
        }
    );

    // Tool 2: struct_reconstruct
    server.tool(
        'struct_reconstruct',
        'Recover data structures from access patterns',
        {
            accessPatterns: z.array(z.string()),
            fieldOffsets: z.array(z.object({ offset: z.number(), size: z.number() })).optional(),
        },
        async ({ accessPatterns, fieldOffsets }) => {
            const entity = createEntity(EntityType.TASK);
            const entityId = serializeEntity(entity);
            const store = getEventStore();

            let structType = 'Unknown';
            const patternStr = accessPatterns.join(' ').toLowerCase();
            if (patternStr.includes('next') || patternStr.includes('prev')) structType = 'LinkedList';
            else if (patternStr.includes('left') || patternStr.includes('right')) structType = 'TreeNode';
            else if (patternStr.includes('bucket')) structType = 'HashTable';

            const fields = fieldOffsets?.map(f => ({
                offset: f.offset,
                type: f.size === 8 ? 'ptr/u64' : f.size === 4 ? 'u32' : f.size === 1 ? 'u8' : `u8[${f.size}]`,
            })) ?? [];

            store.append(entityId, 're.struct_reconstructed', { structType, fieldCount: fields.length });

            return { content: [{ type: 'text', text: JSON.stringify({ entityId, structType, fields, confidence: structType !== 'Unknown' ? 'medium' : 'low' }, null, 2) }] };
        }
    );

    // Tool 3: protocol_analyze
    server.tool(
        'protocol_analyze',
        'Analyze network protocol from traffic',
        {
            sample: z.string(),
            port: z.number().optional(),
            encrypted: z.boolean().default(false),
        },
        async ({ sample, port, encrypted }) => {
            const entity = createEntity(EntityType.TASK);
            const entityId = serializeEntity(entity);
            const store = getEventStore();

            let protocol = 'Unknown';
            const s = sample.toUpperCase();
            if (port === 80 || s.includes('HTTP')) protocol = 'HTTP';
            else if (port === 443 || s.startsWith('1603')) protocol = 'TLS';
            else if (port === 53) protocol = 'DNS';
            else if (s.includes('UPGRADE')) protocol = 'WebSocket';

            store.append(entityId, 're.protocol_analyzed', { protocol, port, encrypted });

            return {
                content: [{
                    type: 'text', text: JSON.stringify({
                        entityId, protocol, encrypted,
                        approach: encrypted ? ['TLS interception', 'Check cert pinning', 'Find hardcoded keys'] : ['Capture pairs', 'Find length fields', 'Map state machine'],
                        tools: ['wireshark', 'mitmproxy', 'scapy'],
                    }, null, 2)
                }]
            };
        }
    );

    // Tool 4: api_trace
    server.tool(
        'api_trace',
        'Map and categorize API calls for security analysis',
        {
            imports: z.array(z.string()),
            platform: z.enum(['windows', 'linux', 'macos']).default('windows'),
        },
        async ({ imports, platform }) => {
            const entity = createEntity(EntityType.TASK);
            const entityId = serializeEntity(entity);
            const store = getEventStore();

            const categorized: Record<string, string[]> = {};
            let riskScore = 0;

            for (const imp of imports) {
                for (const [cat, info] of Object.entries(API_CATEGORIES)) {
                    if (info.fns.some(f => imp.toLowerCase().includes(f.toLowerCase()))) {
                        if (!categorized[cat]) categorized[cat] = [];
                        categorized[cat]!.push(imp);
                        riskScore += info.risk === 'critical' ? 30 : info.risk === 'high' ? 15 : 5;
                    }
                }
            }

            store.append(entityId, 're.api_traced', { importCount: imports.length, riskScore: Math.min(100, riskScore) });

            return {
                content: [{
                    type: 'text', text: JSON.stringify({
                        entityId, platform, categorized,
                        risk: { score: Math.min(100, riskScore), level: riskScore >= 70 ? 'critical' : riskScore >= 40 ? 'high' : 'medium' },
                    }, null, 2)
                }]
            };
        }
    );
}
