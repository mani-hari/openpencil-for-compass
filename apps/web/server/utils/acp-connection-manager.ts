import { connectAcpAgent, disconnectAcpAgent } from '@zseven-w/pen-acp';
import type { AcpConnectionState, AcpConnectResult } from '@zseven-w/pen-acp';
import type { AcpAgentConfig } from '../../../src/types/agent-settings';

const connections = new Map<string, AcpConnectionState>();

export function getAcpConnection(agentId: string): AcpConnectionState | undefined {
  return connections.get(agentId);
}

export async function connectAcp(
  agentId: string,
  config: AcpAgentConfig,
): Promise<AcpConnectResult> {
  // Server-side safety: reject local mode outside Electron
  if (config.connectionType === 'local' && !process.versions.electron) {
    return { connected: false, error: 'Local agents are only available in the desktop app' };
  }

  // Disconnect existing if any
  if (connections.has(agentId)) {
    await disconnectAcp(agentId);
  }

  try {
    const state = await connectAcpAgent(config);
    connections.set(agentId, state);
    return { connected: true, agentInfo: state.agentInfo };
  } catch (err) {
    return {
      connected: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function disconnectAcp(agentId: string): Promise<void> {
  const state = connections.get(agentId);
  if (state) {
    disconnectAcpAgent(state);
    connections.delete(agentId);
  }
}

export function cleanupAllAcp(): void {
  for (const [id, state] of connections) {
    disconnectAcpAgent(state);
    connections.delete(id);
  }
}
