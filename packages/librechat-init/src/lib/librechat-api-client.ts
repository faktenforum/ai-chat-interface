import jwt from 'jsonwebtoken';
import {
  API_RETRY_ATTEMPTS,
  API_RETRY_DELAY_MS,
  API_TIMEOUT_MS,
  JWT_EXPIRES_IN,
} from '../utils/constants.ts';

/**
 * HTTP client for LibreChat API with JWT authentication.
 */
export class LibreChatAPIClient {
  private baseURL: string;
  private jwtSecret: string;
  private tokenCache: Map<string, string> = new Map();

  constructor(baseURL: string, jwtSecret: string) {
    this.baseURL = baseURL.replace(/\/$/, '');
    this.jwtSecret = jwtSecret;
  }

  /**
   * Generates or retrieves cached JWT token for a user.
   */
  private generateToken(userId: string): string {
    const cached = this.tokenCache.get(userId);
    if (cached) return cached;

    const token = jwt.sign({ id: userId }, this.jwtSecret, { expiresIn: JWT_EXPIRES_IN });
    this.tokenCache.set(userId, token);
    return token;
  }

  /**
   * Gets Authorization header value for a user.
   */
  private getAuthHeader(userId: string): string {
    return `Bearer ${this.generateToken(userId)}`;
  }

  /**
   * Extracts error message from various response formats (SSE, JSON, plain text).
   */
  private extractErrorMessage(responseText: string, contentType: string): string {
    const truncated = responseText.substring(0, 200);

    // Server-Sent Events format
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
      return truncated;
    }

    // JSON format
    if (contentType.includes('application/json')) {
      try {
        const parsed = JSON.parse(responseText);
        return parsed.message || parsed.error || truncated;
      } catch {
        // Fall through to plain text
      }
    }

    return truncated;
  }

  /**
   * Checks if an error response indicates a "not found" condition.
   */
  private isNotFoundError(status: number, errorMessage: string): boolean {
    if (status === 404) return true;
    const lower = errorMessage.toLowerCase();
    return lower.includes('not found') || lower.includes('agent not found');
  }

  /**
   * Common headers for all API requests.
   */
  private getRequestHeaders(userId: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: this.getAuthHeader(userId),
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
    };
  }

  /**
   * Makes an authenticated HTTP request to the LibreChat API.
   * @param allow404 - If true, returns null for 404 responses instead of throwing
   */
  private async request<T>(
    method: string,
    path: string,
    userId: string,
    body?: unknown,
    allow404 = false
  ): Promise<T | null> {
    const response = await fetch(`${this.baseURL}${path}`, {
      method,
      headers: this.getRequestHeaders(userId),
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

    // No content
    if (response.status === 204 || !responseText.trim()) {
      return undefined as unknown as T;
    }

    // Server-Sent Events error
    if (responseText.trim().startsWith('event:') || responseText.trim().startsWith('data:')) {
      const errorMatch = responseText.match(/event:\s*err\s*\n\s*data:\s*(.+)/);
      if (errorMatch) {
        throw new Error(this.extractErrorMessage(errorMatch[1], contentType));
      }
      throw new Error(`Unexpected SSE response: ${responseText.substring(0, 200)}`);
    }

    // Parse JSON
    try {
      return JSON.parse(responseText) as T;
    } catch (parseError) {
      throw new Error(
        `Failed to parse JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`
      );
    }
  }

  /**
   * Waits for the LibreChat API to become available with retries.
   */
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

  /**
   * Creates a new agent.
   */
  async createAgent(data: AgentCreateParams, userId: string): Promise<Agent> {
    const result = await this.request<Agent>('POST', '/api/agents', userId, data, false);
    if (!result) {
      throw new Error('Unexpected null response from createAgent');
    }
    return result;
  }

  /**
   * Updates an existing agent.
   */
  async updateAgent(id: string, data: AgentUpdateParams, userId: string): Promise<Agent> {
    const result = await this.request<Agent>('PATCH', `/api/agents/${id}`, userId, data, false);
    if (!result) {
      throw new Error('Unexpected null response from updateAgent');
    }
    return result;
  }

  /**
   * Gets an agent by ID. Returns null if not found.
   */
  async getAgent(id: string, userId: string): Promise<Agent | null> {
    return await this.request<Agent>('GET', `/api/agents/${id}`, userId, undefined, true);
  }

  /**
   * Gets available tools for an MCP server.
   */
  async getMCPServerTools(serverName: string, userId: string): Promise<string[]> {
    try {
      const url = `${this.baseURL}/api/mcp/tools`;
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getRequestHeaders(userId),
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

  /**
   * Finds an agent by name. Returns null if not found.
   */
  async findAgentByName(name: string, userId: string): Promise<Agent | null> {
    try {
      const url = `${this.baseURL}/api/agents?search=${encodeURIComponent(name)}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getRequestHeaders(userId),
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

  /**
   * Updates agent permissions.
   */
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

  // ========================================================================
  // Prompt Group Methods
  // ========================================================================

  /**
   * Creates a new prompt group with an initial production prompt.
   */
  async createPromptGroup(
    payload: CreatePromptGroupPayload,
    userId: string
  ): Promise<CreatePromptGroupResponse> {
    const result = await this.request<CreatePromptGroupResponse>(
      'POST',
      '/api/prompts',
      userId,
      payload,
      false
    );
    if (!result) {
      throw new Error('Unexpected null response from createPromptGroup');
    }
    return result;
  }

  /**
   * Gets all prompt groups accessible to the user.
   */
  async getAllPromptGroups(userId: string): Promise<PromptGroupListEntry[]> {
    const result = await this.request<PromptGroupListEntry[]>(
      'GET',
      '/api/prompts/all',
      userId,
      undefined,
      false
    );
    return result ?? [];
  }

  /**
   * Finds a prompt group by exact name. Returns null if not found.
   */
  async findPromptGroupByName(
    name: string,
    userId: string
  ): Promise<PromptGroupListEntry | null> {
    try {
      const groups = await this.getAllPromptGroups(userId);
      return (
        groups.find(
          (group) => group.name?.toLowerCase() === name.toLowerCase()
        ) ?? null
      );
    } catch {
      return null;
    }
  }

  /**
   * Updates prompt group metadata (name, oneliner, category, command).
   */
  async updatePromptGroupMetadata(
    groupId: string,
    payload: UpdatePromptGroupPayload,
    userId: string
  ): Promise<PromptGroupListEntry> {
    const result = await this.request<PromptGroupListEntry>(
      'PATCH',
      `/api/prompts/groups/${groupId}`,
      userId,
      payload,
      false
    );
    if (!result) {
      throw new Error('Unexpected null response from updatePromptGroupMetadata');
    }
    return result;
  }

  /**
   * Adds a new prompt version to an existing group.
   */
  async addPromptToGroup(
    groupId: string,
    prompt: PromptContent,
    userId: string
  ): Promise<CreatePromptGroupResponse> {
    const result = await this.request<CreatePromptGroupResponse>(
      'POST',
      `/api/prompts/groups/${groupId}/prompts`,
      userId,
      { prompt },
      false
    );
    if (!result) {
      throw new Error('Unexpected null response from addPromptToGroup');
    }
    return result;
  }

  /**
   * Makes a specific prompt the production version for its group.
   */
  async makePromptProduction(promptId: string, userId: string): Promise<void> {
    await this.request<unknown>(
      'PATCH',
      `/api/prompts/${promptId}/tags/production`,
      userId,
      undefined,
      false
    );
  }
}

/**
 * LibreChat agent entity.
 */
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

/**
 * Agent avatar configuration.
 */
export interface AgentAvatar {
  filepath: string;
  source: string;
}

/**
 * Parameters for creating a new agent.
 */
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

/**
 * Parameters for updating an existing agent.
 */
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

/**
 * Support contact information for an agent.
 */
export interface SupportContact {
  name?: string;
  email?: string;
}

/**
 * Permission update payload for agents.
 */
export interface PermissionUpdate {
  updated?: Principal[];
  removed?: Principal[];
  public?: boolean;
  publicAccessRoleId?: string;
}

/**
 * Permission principal (user, group, role, or public).
 */
export interface Principal {
  type: 'user' | 'group' | 'role' | 'public';
  id: string | null;
  accessRoleId: string;
  name?: string;
  source?: string;
}

/**
 * Response from agent list API endpoint.
 */
export interface AgentListResponse {
  data: Agent[];
  has_more?: boolean;
  first_id?: string | null;
  last_id?: string | null;
}

// ============================================================================
// Prompt Types
// ============================================================================

/**
 * Prompt text content for create/add operations.
 */
export interface PromptContent {
  prompt: string;
  type: 'text' | 'chat';
}

/**
 * Payload for creating a new prompt group with an initial prompt.
 */
export interface CreatePromptGroupPayload {
  prompt: PromptContent;
  group: {
    name: string;
    category?: string;
    oneliner?: string;
    command?: string;
  };
}

/**
 * Response from prompt group creation or prompt addition.
 */
export interface CreatePromptGroupResponse {
  prompt: {
    _id: string;
    groupId: string;
    prompt: string;
    type: 'text' | 'chat';
    author: string;
    createdAt?: string;
    updatedAt?: string;
  };
  group?: PromptGroupListEntry;
}

/**
 * Prompt group as returned by GET /api/prompts/all.
 */
export interface PromptGroupListEntry {
  _id: string;
  name: string;
  oneliner?: string;
  category?: string;
  command?: string;
  author?: string;
  authorName?: string;
  productionPrompt?: {
    prompt?: string;
  };
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Allowed fields for prompt group metadata updates (PATCH).
 */
export interface UpdatePromptGroupPayload {
  name?: string;
  oneliner?: string;
  category?: string;
  command?: string | null;
}
