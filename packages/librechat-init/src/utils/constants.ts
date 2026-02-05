import { existsSync } from 'fs';
import { join } from 'path';

// ============================================================================
// File Paths
// ============================================================================

/** When running with host config mounted at /app/config-source (local dev), use it instead of baked-in /app/data. */
const CONFIG_SOURCE_DIR = existsSync('/app/config-source/librechat.yaml')
  ? '/app/config-source'
  : '/app/data';

export const CONFIG_SOURCE = join(CONFIG_SOURCE_DIR, 'librechat.yaml');
export const CONFIG_TARGET = '/app/config/librechat.yaml';
export const CONFIG_DIR = '/app/config';
export const ASSETS_DIR = '/app/assets';
export const IMAGES_DIR = '/images';

export const ROLES_CONFIG_PATH = join(CONFIG_SOURCE_DIR, 'roles.yaml');
export const ROLES_CONFIG_FALLBACK = '../config/roles.yaml';

export const PUBLIC_AGENTS_PATH = join(CONFIG_SOURCE_DIR, 'agents.yaml');
export const PUBLIC_AGENTS_FALLBACK = '../config/agents.yaml';

export const PRIVATE_AGENTS_PATH = join(CONFIG_SOURCE_DIR, 'agents.private.yaml');
export const PRIVATE_AGENTS_FALLBACK = '../config/agents.private.yaml';

// ============================================================================
// MCP Configuration
// ============================================================================

/** Pattern for MCP icon SVG files. */
export const MCP_ICON_PATTERN = /^mcp-.*-icon\.svg$/;

/** Delimiter used in MCP tool names (format: toolName_mcp_serverName). */
export const MCP_DELIMITER = '_mcp_';

/** Marker for MCP server reference in tools array. */
export const MCP_SERVER = 'sys__server__sys';

/** Marker for "all tools" from an MCP server. */
export const MCP_ALL = 'sys__all__sys';

// ============================================================================
// Access Control
// ============================================================================

export const ACCESS_ROLE_VIEWER = 'agent_viewer';
export const ACCESS_ROLE_EDITOR = 'agent_editor';
export const ACCESS_ROLE_OWNER = 'agent_owner';

export const SYSTEM_ROLES = ['ADMIN', 'USER'] as const;

// ============================================================================
// MongoDB Configuration
// ============================================================================

export const DEFAULT_MONGO_URI = 'mongodb://mongodb:27017/LibreChat';
export const MONGO_RETRY_ATTEMPTS = 30;
export const MONGO_RETRY_DELAY_MS = 2000;

// ============================================================================
// API Configuration
// ============================================================================

export const DEFAULT_API_URL = 'http://api:3080';
export const API_RETRY_ATTEMPTS = 30;
export const API_RETRY_DELAY_MS = 2000;
export const API_TIMEOUT_MS = 3000;

// ============================================================================
// JWT Configuration
// ============================================================================

export const JWT_EXPIRES_IN = '1h';

// ============================================================================
// Environment Variables
// ============================================================================

export const INIT_TIME_ENV_VARS = [
  'LIBRECHAT_CUSTOM_WELCOME',
  'LIBRECHAT_PRIVACY_POLICY_URL',
  'LIBRECHAT_TERMS_OF_SERVICE_URL',
] as const;
