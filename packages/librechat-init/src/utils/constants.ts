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

export const MCP_ICON_PATTERN = /^mcp-.*-icon\.svg$/;

export const INIT_TIME_ENV_VARS = [
  'LIBRECHAT_CUSTOM_WELCOME',
  'LIBRECHAT_PRIVACY_POLICY_URL',
  'LIBRECHAT_TERMS_OF_SERVICE_URL',
] as const;

export const SYSTEM_ROLES = ['ADMIN', 'USER'] as const;

export const ACCESS_ROLE_VIEWER = 'agent_viewer';
export const ACCESS_ROLE_EDITOR = 'agent_editor';
export const ACCESS_ROLE_OWNER = 'agent_owner';

export const MCP_DELIMITER = '_mcp_';
export const MCP_SERVER = 'sys__server__sys';
export const MCP_ALL = 'sys__all__sys';

export const DEFAULT_MONGO_URI = 'mongodb://mongodb:27017/LibreChat';
export const MONGO_RETRY_ATTEMPTS = 30;
export const MONGO_RETRY_DELAY_MS = 2000;

export const DEFAULT_API_URL = 'http://api:3080';
export const API_RETRY_ATTEMPTS = 30;
export const API_RETRY_DELAY_MS = 2000;
export const API_TIMEOUT_MS = 3000;

export const JWT_EXPIRES_IN = '1h';
