import jwt from 'jsonwebtoken';

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
   * Token is valid for 1 hour
   */
  private generateToken(userId: string): string {
    // Check cache first
    if (this.tokenCache.has(userId)) {
      return this.tokenCache.get(userId)!;
    }

    const token = jwt.sign({ id: userId }, this.jwtSecret, { expiresIn: '1h' });
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
   * Make HTTP request to LibreChat API
   * Handles authentication, error parsing (including SSE format), and response parsing
   * @param method - HTTP method (GET, POST, PATCH, PUT, DELETE)
   * @param path - API path (e.g., '/api/agents')
   * @param userId - User ID for JWT authentication
   * @param body - Request body (will be JSON stringified)
   * @param allow404 - If true, 404 errors return null instead of throwing
   * @returns Parsed response data or null (if allow404 and 404)
   * @throws Error on non-404 failures or if allow404 is false
   */
  private async request<T>(
    method: string,
    path: string,
    userId: string,
    body?: unknown,
    allow404 = false
  ): Promise<T | null> {
    const url = `${this.baseURL}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: this.getAuthHeader(userId),
      // User-Agent required by LibreChat's uaParser middleware
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };

    const options: RequestInit = {
      method,
      headers,
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const contentType = response.headers.get('content-type') || '';

    // Read response text once (can only be read once)
    const responseText = await response.text();

    if (!response.ok) {
      // Handle 404 specially if allow404 is true
      if (allow404 && response.status === 404) {
        return null;
      }

      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      let parsedError: { error?: string; message?: string } | null = null;

      try {
        // Check if it's SSE format
        if (responseText.trim().startsWith('event:') || responseText.trim().startsWith('data:')) {
          const errorMatch = responseText.match(/event:\s*err\s*\n\s*data:\s*(.+)/);
          if (errorMatch) {
            try {
              parsedError = JSON.parse(errorMatch[1]);
              const extractedError = parsedError.error || parsedError.message || errorMatch[1];
              errorMessage = extractedError;
            } catch {
              errorMessage = errorMatch[1];
            }
          } else {
            errorMessage += ` - ${responseText.substring(0, 200)}`;
          }
        } else if (contentType.includes('application/json')) {
          parsedError = JSON.parse(responseText);
          if (parsedError.error) {
            errorMessage = parsedError.error;
            if (parsedError.message) {
              errorMessage = parsedError.message;
            }
          }
        } else if (responseText) {
          errorMessage += ` - ${responseText.substring(0, 200)}`;
        }

        // Check if it's a "not found" error when allow404 is true
        // Check both status code and error message content
        if (allow404) {
          const errorText = errorMessage.toLowerCase();
          if (
            response.status === 404 ||
            errorText.includes('not found') ||
            errorText.includes('agent not found') ||
            (parsedError && (parsedError.error?.toLowerCase().includes('not found') || parsedError.message?.toLowerCase().includes('not found')))
          ) {
            return null;
          }
        }
      } catch {
        // If parsing fails, still check for "not found" in raw text
        if (allow404 && responseText && responseText.toLowerCase().includes('not found')) {
          return null;
        }
        // Ignore parse errors, use default message
      }
      throw new Error(errorMessage);
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return (undefined as unknown) as T;
    }

    // Handle empty response
    if (!responseText || responseText.trim().length === 0) {
      return (undefined as unknown) as T;
    }

    // Check if it's SSE format (even for successful responses - should not happen)
    if (responseText.trim().startsWith('event:') || responseText.trim().startsWith('data:')) {
      const errorMatch = responseText.match(/event:\s*err\s*\n\s*data:\s*(.+)/);
      if (errorMatch) {
        try {
          const errorData = JSON.parse(errorMatch[1]);
          throw new Error(
            errorData.error || errorData.message || `SSE Error: ${errorMatch[1].substring(0, 200)}`
          );
        } catch {
          throw new Error(`SSE Error response: ${errorMatch[1].substring(0, 200)}`);
        }
      }
      throw new Error(`Unexpected SSE response from API: ${responseText.substring(0, 200)}`);
    }

    // Parse JSON response
    try {
      return JSON.parse(responseText) as T;
    } catch (parseError) {
      throw new Error(
        `Failed to parse JSON response: ${parseError instanceof Error ? parseError.message : String(parseError)}. Response: ${responseText.substring(0, 200)}`
      );
    }
  }

  /**
   * Check if API is available with retries
   * Returns true if API is ready, false otherwise (no error thrown)
   * @param maxRetries - Maximum number of retry attempts (default: 30 for post-init, 5 for pre-init)
   * @param delayMs - Delay between retries in milliseconds (default: 2000)
   * @returns true if API is available, false otherwise
   */
  async waitForAPI(maxRetries = 30, delayMs = 2000): Promise<boolean> {
    console.log('  Checking LibreChat API availability...');

    for (let i = 0; i < maxRetries; i++) {
      try {
        const url = `${this.baseURL}/api/config`;
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
          signal: AbortSignal.timeout(3000), // 3 second timeout per attempt
        });

        if (response.ok) {
          console.log('  ✓ LibreChat API is available');
          return true;
        }
      } catch (error) {
        // Ignore errors, continue retrying
      }

      if (i < maxRetries - 1) {
        // Only log first and last attempt to reduce noise
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
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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
        servers?: Record<string, { tools?: Array<{ pluginKey?: string; name?: string }> }>;
      };
      const server = data.servers?.[serverName];

      if (!server?.tools || server.tools.length === 0) {
        console.warn(`  ⚠ No tools found for MCP server: ${serverName}`);
        return [];
      }

      // Extract tool keys (pluginKey format: "toolName_mcp_serverName")
      const toolKeys = server.tools
        .map((tool) => tool.pluginKey)
        .filter((key): key is string => !!key);

      return toolKeys;
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
   * Uses search API and filters for exact name match
   * @param name - Agent name to search for
   * @param userId - User ID for API authentication
   * @returns Matching agent or null if not found
   */
  async findAgentByName(name: string, userId: string): Promise<Agent | null> {
    try {
      // Use search parameter to find agents by name
      // The API searches both name and description, so we filter for exact name match
      const url = `${this.baseURL}/api/agents?search=${encodeURIComponent(name)}`;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: this.getAuthHeader(userId),
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      };

      const response = await fetch(url, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as AgentListResponse;
      const agents = data.data || [];

      // Find exact name match (case-insensitive)
      const exactMatch = agents.find(
        (agent) => agent.name?.toLowerCase() === name.toLowerCase()
      );

      return exactMatch || null;
    } catch (error) {
      // If search fails, return null (non-blocking)
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
