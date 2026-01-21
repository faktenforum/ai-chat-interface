/**
 * Shared constants used across initialization modules
 */

// File paths
export const CONFIG_SOURCE = '/app/data/librechat.yaml';
export const CONFIG_TARGET = '/app/config/librechat.yaml';
export const CONFIG_DIR = '/app/config';
export const ASSETS_DIR = '/app/assets';
export const IMAGES_DIR = '/images';
export const ROLES_CONFIG_PATH = '/app/data/roles.json';
export const ROLES_CONFIG_FALLBACK = '../config/roles.json';
export const PUBLIC_AGENTS_PATH = '/app/data/agents.json';
export const PUBLIC_AGENTS_FALLBACK = '../config/agents.json';
export const PRIVATE_AGENTS_PATH = '/app/data/agents.private.json';
export const PRIVATE_AGENTS_FALLBACK = '../config/agents.private.json';

// Patterns
export const MCP_ICON_PATTERN = /^mcp-.*-icon\.svg$/;

// Environment variables resolved at init time
export const INIT_TIME_ENV_VARS = [
  'LIBRECHAT_CUSTOM_WELCOME',
  'LIBRECHAT_PRIVACY_POLICY_URL',
  'LIBRECHAT_TERMS_OF_SERVICE_URL',
] as const;

// System roles (cannot be modified)
export const SYSTEM_ROLES = ['ADMIN', 'USER'] as const;

// Access role IDs (matching LibreChat's AccessRoleIds)
export const ACCESS_ROLE_VIEWER = 'agent_viewer';
export const ACCESS_ROLE_EDITOR = 'agent_editor';
export const ACCESS_ROLE_OWNER = 'agent_owner';

// MCP constants (matching LibreChat's Constants)
export const MCP_DELIMITER = '_mcp_';
export const MCP_SERVER = 'sys__server__sys';

// MongoDB defaults
export const DEFAULT_MONGO_URI = 'mongodb://mongodb:27017/LibreChat';
export const MONGO_RETRY_ATTEMPTS = 30;
export const MONGO_RETRY_DELAY_MS = 2000;

// API defaults
export const DEFAULT_API_URL = 'http://api:3080';
export const API_RETRY_ATTEMPTS = 30;
export const API_RETRY_DELAY_MS = 2000;
export const API_TIMEOUT_MS = 3000;

// JWT token expiration (1 hour)
export const JWT_EXPIRES_IN = '1h';
