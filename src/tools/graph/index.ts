
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerStructuralGraphTools } from './structural/index.js';
import { registerMatroidTools } from './matroid/index.js';
import { registerSpectralTools } from './spectral/index.js';
import { registerTopologyTools } from './topology/index.js';

export function registerGraphTools(server: McpServer): void {
    registerStructuralGraphTools(server);
    registerMatroidTools(server);
    registerSpectralTools(server);
    registerTopologyTools(server);
}
