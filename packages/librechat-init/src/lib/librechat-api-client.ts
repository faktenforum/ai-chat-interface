import jwt from 'jsonwebtoken';
import {
  API_RETRY_ATTEMPTS,
  API_RETRY_DELAY_MS,
  API_TIMEOUT_MS,
  JWT_EXPIRES_IN,
} from '../utils/constants.ts';

export class LibreChatAPIClient {
  private baseURL: string;
  private jwtSecret: string;
  private tokenCache: Map<string, string> = new Map();

  constructor(baseURL: string, jwtSecret: string) {
    this.baseURL = baseURL.replace(/\/$/, ''); // Remove trailing slash
    this.jwtSecret = jwtSecret;
  }

  private generateToken(userId: string): string {
    if (this.tokenCache.has(userId)) {
      return this.tokenCache.get(userId)!;
    }

    const token = jwt.sign({ id: userId }, this.jwtSecret, { expiresIn: JWT_EXPIRES_IN });
    this.tokenCache.set(userId, token);
    return token;
  }

  private getAuthHeader(userId: string): string {
    const token = this.generateToken(userId);
    return `Bearer ${token}`;
  }

  private extractErrorMessage(responseText: string, contentType: string): string {
    if (responseText.trim().startsWith('event:') || responseText.trim().startsWith('data:')) {
      const errorMatch = responseText.match(/event:\s*err\s*\n\s*data:\s*(.+)/);
      if (errorMatch) {
        try {
          const errorData = JSON.parse(errorMatch[1]);
          return errorData.error || errorData.message || errorMatch[1];
        } catch {
          return errorMatch[1];
        }
      }
      return responseText.substring(0, 200);
    }

    if (contentType.includes('application/json')) {
      try {
        const parsed = JSON.parse(responseText);
        return parsed.message || parsed.error || responseText.substring(0, 200);
      } catch {
        // Fall through to plain text
      }
    }

    return responseText.substring(0, 200);
  }

  private isNotFoundError(status: number, errorMessage: string): boolean {
    if (status === 404) return true;
    const lower = errorMessage.toLowerCase();
    return lower.includes('not found') || lower.includes('agent not found');
  }

  private async request<T>(
    method: string,
    path: string,
    userId: string,
    body?: unknown,
    allow404 = false
  ): Promise<T | null> {
    const response = await fetch(`${this.baseURL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.getAuthHeader(userId),
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const contentType = response.headers.get('content-type') || '';
    const responseText = await response.text();

    if (!response.ok) {
      if (allow404 && this.isNotFoundError(response.status, responseText)) {
        return null;
      }

      const errorMessage = this.extractErrorMessage(responseText, contentType);
      throw new Error(errorMessage || `HTTP ${response.status}: ${response.statusText}`);
    }

    if (response.status === 204 || !responseText.trim()) {
      return undefined as unknown as T;
    }

    if (responseText.trim().startsWith('event:') || responseText.trim().startsWith('data:')) {
      const errorMatch = responseText.match(/event:\s*err\s*\n\s*data:\s*(.+)/);
      if (errorMatch) {
        throw new Error(this.extractErrorMessage(errorMatch[1], contentType));
      }
      throw new Error(`Unexpected SSE response: ${responseText.substring(0, 200)}`);
    }

    try {
      return JSON.parse(responseText) as T;
    } catch (parseError) {
      throw new Error(
        `Failed to parse JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`
      );
    }
  }

  async waitForAPI(
    maxRetries = API_RETRY_ATTEMPTS,
    delayMs = API_RETRY_DELAY_MS
  ): Promise<boolean> {
    console.log('  Checking LibreChat API availability...');

    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(`${this.baseURL}/api/config`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
          },
          signal: AbortSignal.timeout(API_TIMEOUT_MS),
        });

        if (response.ok) {
          console.log('  ✓ LibreChat API is available');
          return true;
        }
      } catch {
        // Continue retrying
      }

      if (i < maxRetries - 1) {
        if (i === 0 || i === maxRetries - 1) {
          console.log(`  Attempt ${i + 1}/${maxRetries}...`);
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    console.log('  ⚠ LibreChat API not available after retries');
    return false;
  }

  async createAgent(data: AgentCreateParams, userId: string): Promise<Agent> {
    const result = await this.request<Agent>('POST', '/api/agents', userId, data, false);
    if (result === null) {
      throw new Error('Unexpected null response from createAgent');
    }
    return result;
  }

  async updateAgent(id: string, data: AgentUpdateParams, userId: string): Promise<Agent> {
    const result = await this.request<Agent>('PATCH', `/api/agents/${id}`, userId, data, false);
    if (result === null) {
      throw new Error('Unexpected null response from updateAgent');
    }
    return result;
  }

  async getAgent(id: string, userId: string): Promise<Agent | null> {
    return await this.request<Agent>('GET', `/api/agents/${id}`, userId, undefined, true);
  }

  async getMCPServerTools(serverName: string, userId: string): Promise<string[]> {
    try {
      const url = `${this.baseURL}/api/mcp/tools`;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: this.getAuthHeader(userId),
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
      };

      const response = await fetch(url, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        console.warn(`  ⚠ Failed to fetch MCP tools: HTTP ${response.status}`);
        return [];
      }

      const data = (await response.json()) as {
        servers?: Record<string, { tools?: Array<{ pluginKey?: string }> }>;
      };

      const server = data.servers?.[serverName];
      if (!server?.tools?.length) {
        console.warn(`  ⚠ No tools found for MCP server: ${serverName}`);
        return [];
      }

      return server.tools
        .map((tool) => tool.pluginKey)
        .filter((key): key is string => !!key);
    } catch (error) {
      console.warn(
        `  ⚠ Error fetching MCP tools for ${serverName}:`,
        error instanceof Error ? error.message : String(error)
      );
      return [];
    }
  }

  async findAgentByName(name: string, userId: string): Promise<Agent | null> {
    try {
      const url = `${this.baseURL}/api/agents?search=${encodeURIComponent(name)}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.getAuthHeader(userId),
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as AgentListResponse;
      const agents = data.data || [];

      return (
        agents.find((agent) => agent.name?.toLowerCase() === name.toLowerCase()) || null
      );
    } catch {
      return null;
    }
  }

  async updateAgentPermissions(
    agentId: string,
    permissions: PermissionUpdate,
    userId: string
  ): Promise<void> {
    await this.request<void>(
      'PUT',
      `/api/permissions/agent/${agentId}`,
      userId,
      permissions
    );
  }
}

export interface Agent {
  _id?: string;
  id: string;
  name: string | null;
  author?: string | null;
  authorName?: string | null;
  description: string | null;
  instructions: string | null;
  avatar?: AgentAvatar | null;
  provider: string;
  model: string | null;
  model_parameters?: Record<string, unknown>;
  tools?: string[];
  category?: string;
  conversation_starters?: string[];
  recursion_limit?: number;
  isCollaborative?: boolean;
  isPublic?: boolean;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface AgentAvatar {
  filepath: string;
  source: string;
}

export interface AgentCreateParams {
  name?: string | null;
  description?: string | null;
  instructions?: string | null;
  avatar?: AgentAvatar | null;
  provider: string;
  model: string | null;
  model_parameters?: Record<string, unknown>;
  tools?: string[];
  category?: string;
  conversation_starters?: string[];
  recursion_limit?: number;
  artifacts?: string;
  support_contact?: SupportContact;
  edges?: unknown[];
  end_after_tools?: boolean;
  hide_sequential_outputs?: boolean;
  agent_ids?: string[];
}

export interface AgentUpdateParams {
  name?: string | null;
  description?: string | null;
  instructions?: string | null;
  avatar?: AgentAvatar | null;
  provider?: string;
  model?: string | null;
  model_parameters?: Record<string, unknown>;
  tools?: string[];
  category?: string;
  conversation_starters?: string[];
  recursion_limit?: number;
  artifacts?: string;
  support_contact?: SupportContact;
  edges?: unknown[];
  end_after_tools?: boolean;
  hide_sequential_outputs?: boolean;
  agent_ids?: string[];
  isCollaborative?: boolean;
  projectIds?: string[];
  removeProjectIds?: string[];
}

export interface SupportContact {
  name?: string;
  email?: string;
}

export interface PermissionUpdate {
  updated?: Principal[];
  removed?: Principal[];
  public?: boolean;
  publicAccessRoleId?: string;
}

export interface Principal {
  type: 'user' | 'group' | 'role' | 'public';
  id: string | null;
  accessRoleId: string;
  name?: string;
  source?: string;
}

export interface AgentListResponse {
  data: Agent[];
  has_more?: boolean;
  first_id?: string | null;
  last_id?: string | null;
}
