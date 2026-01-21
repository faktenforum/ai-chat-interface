import jwt from 'jsonwebtoken';
import {
  API_RETRY_ATTEMPTS,
  API_RETRY_DELAY_MS,
  API_TIMEOUT_MS,
  JWT_EXPIRES_IN,
} from '../utils/constants.ts';

/**
 * LibreChat API Client for agent management
 * Provides HTTP client interface to LibreChat API endpoints
 */
export class LibreChatAPIClient {
  private baseURL: string;
  private jwtSecret: string;
  private tokenCache: Map<string, string> = new Map();

  constructor(baseURL: string, jwtSecret: string) {
    this.baseURL = baseURL.replace(/\/$/, ''); // Remove trailing slash
    this.jwtSecret = jwtSecret;
  }

  /**
   * Generate JWT token for API authentication
   */
  private generateToken(userId: string): string {
    if (this.tokenCache.has(userId)) {
      return this.tokenCache.get(userId)!;
    }

    const token = jwt.sign({ id: userId }, this.jwtSecret, { expiresIn: JWT_EXPIRES_IN });
    this.tokenCache.set(userId, token);
    return token;
  }

  /**
   * Get authorization header with JWT token
   */
  private getAuthHeader(userId: string): string {
    const token = this.generateToken(userId);
    return `Bearer ${token}`;
  }

  /**
   * Extract error message from response (handles JSON, SSE, and plain text)
   */
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

  /**
   * Check if error indicates "not found"
   */
  private isNotFoundError(status: number, errorMessage: string): boolean {
    if (status === 404) return true;
    const lower = errorMessage.toLowerCase();
    return lower.includes('not found') || lower.includes('agent not found');
  }

  /**
   * Make HTTP request to LibreChat API
   * @param method - HTTP method
   * @param path - API path
   * @param userId - User ID for JWT authentication
   * @param body - Request body (will be JSON stringified)
   * @param allow404 - If true, 404 errors return null instead of throwing
   * @returns Parsed response data or null (if allow404 and 404)
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
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.getAuthHeader(userId),
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const contentType = response.headers.get('content-type') || '';
    const responseText = await response.text();

    // Handle errors
    if (!response.ok) {
      if (allow404 && this.isNotFoundError(response.status, responseText)) {
        return null;
      }

      const errorMessage = this.extractErrorMessage(responseText, contentType);
      throw new Error(errorMessage || `HTTP ${response.status}: ${response.statusText}`);
    }

    // Handle empty responses
    if (response.status === 204 || !responseText.trim()) {
      return undefined as unknown as T;
    }

    // Handle SSE errors in successful responses (should not happen)
    if (responseText.trim().startsWith('event:') || responseText.trim().startsWith('data:')) {
      const errorMatch = responseText.match(/event:\s*err\s*\n\s*data:\s*(.+)/);
      if (errorMatch) {
        throw new Error(this.extractErrorMessage(errorMatch[1], contentType));
      }
      throw new Error(`Unexpected SSE response: ${responseText.substring(0, 200)}`);
    }

    // Parse JSON response
    try {
      return JSON.parse(responseText) as T;
    } catch (parseError) {
      throw new Error(
        `Failed to parse JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`
      );
    }
  }

  /**
   * Check if API is available with retries
   * @param maxRetries - Maximum number of retry attempts
   * @param delayMs - Delay between retries in milliseconds
   * @returns true if API is available, false otherwise
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
        // Ignore errors, continue retrying
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
   * Create a new agent
   */
  async createAgent(data: AgentCreateParams, userId: string): Promise<Agent> {
    const result = await this.request<Agent>('POST', '/api/agents', userId, data, false);
    if (result === null) {
      throw new Error('Unexpected null response from createAgent');
    }
    return result;
  }

  /**
   * Update an existing agent
   */
  async updateAgent(id: string, data: AgentUpdateParams, userId: string): Promise<Agent> {
    const result = await this.request<Agent>('PATCH', `/api/agents/${id}`, userId, data, false);
    if (result === null) {
      throw new Error('Unexpected null response from updateAgent');
    }
    return result;
  }

  /**
   * Get an agent by ID
   * Returns null if agent not found (404)
   */
  async getAgent(id: string, userId: string): Promise<Agent | null> {
    return await this.request<Agent>('GET', `/api/agents/${id}`, userId, undefined, true);
  }

  /**
   * Get MCP tools for a specific server
   * Returns array of tool keys (e.g., ["generate_image_mcp_image-gen", ...])
   * Returns empty array on error (non-blocking)
   */
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

  /**
   * Find an agent by name (exact match, case-insensitive)
   * @param name - Agent name to search for
   * @param userId - User ID for API authentication
   * @returns Matching agent or null if not found
   */
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

  /**
   * Update agent permissions
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
}

/**
 * Type definitions matching LibreChat API
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
