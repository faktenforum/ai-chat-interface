# LibreChat Features Documentation

This documentation explains all configured features in `docker-compose.librechat.yml` and additional available options.

## Table of Contents

1. [Cache](#cache)
2. [Interface Features](#interface-features)
3. [Memory System](#memory-system)
4. [Endpoints & Model Specs](#endpoints--model-specs)
5. [Web Search](#web-search)
6. [Registration](#registration)
7. [Unused Features](#unused-features)

---

## Cache

**Line 16:** `cache: true`

### What it is
Enables LibreChat's caching system for better performance.

### How it works
- **Redis-based** (if `USE_REDIS=true`): Uses Redis for distributed caching in multi-instance setups
- **In-Memory** (fallback): Uses local memory when Redis is unavailable
- Caches: Model lists, endpoint configurations, MCP server configs, etc.

### Configuration
- **Environment variables:**
  - `USE_REDIS=true/false` - Enables Redis caching
  - `REDIS_URI=redis://...` - Redis connection URI (required if USE_REDIS=true)
  - `REDIS_KEY_PREFIX` - Optional: Prefix for cache keys (for multi-deployment)
  - `FORCED_IN_MEMORY_CACHE_NAMESPACES` - Comma-separated list of namespaces that always stay in-memory

### Testing
1. **Check Redis caching:**
   ```bash
   docker exec -it mongodb redis-cli -h <redis-host> ping
   docker exec -it mongodb redis-cli -h <redis-host> KEYS "*"
   ```

2. **Performance monitoring:**
   - Check logs for cache hits/misses
   - Measure API response times (should be faster on repeated requests)

---

## Interface Features

### customWelcome

**Line 19:** `customWelcome: 'Hi {{user.name}}! Welcome...'`

- Personalized welcome message on landing page
- Supports template variables: `{{user.name}}` is replaced with actual username
- If not configured: Shows time-based greetings

### fileSearch

**Line 20:** `fileSearch: true`

- **UI Feature:** Shows checkbox in chat input for "File Search"
- **Agent Capability:** Enables agents to semantically search uploaded files
- **RAG Integration:** Uses RAG API (`/query`) for semantic document search
- Requires: Working RAG API (`RAG_API_URL`)

### privacyPolicy & termsOfService

**Lines 21-36:** Legal links and modal dialogs

- **Privacy Policy:** External URL link (opens in new tab)
- **Terms of Service:** External URL + modal dialog on first use
  - `modalAcceptance: true` - Shows modal for new users
  - `modalContent` - Markdown content (rendered as HTML)

### UI Elements

**Lines 37-53:** Various UI features

- `endpointsMenu: true` - Dropdown for AI endpoint selection
- `modelSelect: true` - Model selection dropdown
- `parameters: true` - Side panel for advanced parameters
- `sidePanel: true` - Right-side panel (files, prompts, memories, etc.)
- `presets: true` - Save/load chat presets (BookCopy icon in header)
- `prompts: true` - Create and use prompt templates
- `bookmarks: true` - Bookmark conversations
- `multiConvo: true` - Multiple simultaneous conversations
- `agents: true` - Agent functionality
- `peoplePicker: {users, groups, roles}` - User/group/role mentions for sharing and ACL
  - **Note:** NOT used in chat messages. Only in sharing dialogs and access management
  - Requires permissions: `VIEW_USERS`, `VIEW_GROUPS`, `VIEW_ROLES`
  - API: `/api/principals/search?q=<query>&types=<user|group|role>`
- `marketplace: {use: true}` - Agent marketplace
- `fileCitations: true` - Shows source citations for file content
- `search: true` - Global search function

---

## Memory System

**Lines 55-75:** Memory configuration

### What it is
Persistent memory system that stores relevant user information and includes it in conversations.

### Configuration
- `disabled: false` - Memory is enabled
- `personalize: true` - Users see "Personalization" tab in settings
- `tokenLimit: 2000` - Maximum tokens per memory value
- `messageWindowSize: 5` - Number of last messages analyzed

### Memory Agent
- `provider: "OpenRouter"` - Endpoint for memory processing
- `model: "deepseek/deepseek-chat"` - Model for memory operations
- `temperature: 0.2` - Low temperature for consistent memory creation
- `instructions` - System prompt defining what information to store

### How it works
1. After each conversation, analyzes last 5 messages
2. Extracts relevant information (preferences, work info, personal facts, skills, interests)
3. Stores with 2000 token limit per value
4. Automatically includes stored memories in future conversations

### Memory Categories (validKeys)
- `preferences`, `work_info`, `personal_info`, `skills`, `interests`, `context`

---

## Endpoints & Model Specs

### Local development: config mount (no image rebuild)

In `docker-compose.local-dev.yml` and `docker-compose.local.yml`, `packages/librechat-init/config` is mounted at `/app/config-source` for the `librechat-init` service. The init script reads from that path when present (instead of the baked-in `/app/data`). After editing `librechat.yaml`, `roles.yaml`, or `agents.yaml`, re-run init and restart the API; no image rebuild is required.

```bash
docker compose -f docker-compose.local-dev.yml run --rm librechat-init
docker compose -f docker-compose.local-dev.yml restart api
```

### Endpoints Configuration

**Lines 77-101:** OpenRouter endpoint

- `name: "OpenRouter"` - Endpoint name
- `apiKey` - OpenRouter API key (from environment variable)
- `baseURL` - OpenRouter API URL
- `models.default` - Fallback list if `fetch: false` or fetch fails
- `models.fetch: true` - Automatically fetches available models from OpenRouter
- `titleConvo: true` - Auto-generates conversation titles
- `summarize: true` - Enables summarization for long conversations

### Scaleway: parallel tool calls

**Config:** Scaleway endpoint uses `addParams: { parallel_tool_calls: false }`.

Scaleway’s docs state: **“Meta models do not support parallel tool calls.”**  
If the client sends multiple tool calls in one request, the API returns `400 This model only supports single tool-calls at once!`.

**Models affected (Meta/Llama on Scaleway):**
- `llama-3.1-8b-instruct`, `llama-3.1-70b-instruct`
- `llama-3.3-70b-instruct`

Other Scaleway models (Mistral, Qwen, etc.) may support parallel tool calls; the setting is applied endpoint-wide, so all Scaleway models use single-tool-calls. Sequential execution still works.

**Sources:** [Scaleway – How to use function calling](https://www.scaleway.com/en/docs/generative-apis/how-to/use-function-calling) (“Meta models do not support parallel tool calls”); [Managed Inference – function calling support](https://www.scaleway.com/en/docs/managed-inference/reference-content/function-calling-support/).

### Scaleway: unsupported parameters

**Config:** Scaleway endpoint uses `dropParams` to strip parameters the Scaleway Chat Completions API does not support.

Scaleway's [OpenAI compatibility docs](https://www.scaleway.com/en/docs/managed-inference/reference-content/openai-compatibility/) list the following as **unsupported**: `frequency_penalty`, `n`, `top_logprobs`, `logit_bias`, `user`. If sent, they can cause errors or undefined behaviour. LibreChat strips them for the Scaleway endpoint via `dropParams` (camelCase keys: `frequencyPenalty`, `n`, `topLogprobs`, `logitBias`, `user`).

**Supported by Scaleway (no change needed):** `messages`, `model`, `max_tokens`, `temperature`, `top_p`, `presence_penalty`, `response_format`, `logprobs`, `stop`, `seed`, `stream`, `tools`, `tool_choice`.

### Model Specs

**Lines 133-330:** Predefined model configurations

#### What it is
Predefined model presets that appear as simple selections in the UI.

#### Configuration Options

**Basic:**
- `name` - Unique identifier
- `label` - Display name in UI
- `description` - Model description (displayed in UI)
- `default: true` - Default model for new users
- `preset` - Complete preset configuration (endpoint, model, etc.)

**Grouping:**
- `group` - Groups model specs in UI
  - If matches endpoint name (e.g., "openAI"): Nests under that endpoint
  - If custom name: Creates separate collapsible group
  - If omitted: Appears as standalone item
- `groupIcon` - Icon for the group
  - Set on first spec in group (used for entire group)
  - Can be: Endpoint name (`"openAI"`, `"anthropic"`, `"google"`, `"custom"`), URL, or Data URI
- `order` - Sort order within group

**Icons:**
- `iconURL` - Custom icon URL for individual model
  - Can be: Endpoint name, URL, or Data URI (SVG as base64)
  - **Note:** Data URIs and URLs are rendered as `<img>` tags, so `currentColor` doesn't work for theme support
  - For theme support: Use built-in endpoint icons or place SVGs in `/images/` folder (still rendered as `<img>`)
- `showIconInMenu` - Show icon in menu (default: true)
- `showIconInHeader` - Show icon in header (default: true)

**Feature Flags:**
- `webSearch: true` - Auto-enables web search when model is selected
- `fileSearch: true` - Auto-enables file search when model is selected
- `executeCode: true` - Auto-enables code execution (requires Code Interpreter API)
- `mcpServers: []` - List of MCP servers for this model

**Available Built-in Icons:**
- `"openAI"`, `"anthropic"`, `"google"`, `"custom"`, `"azureOpenAI"`, `"bedrock"`, `"assistants"`, `"agents"`

**Custom Icons:**
- URLs: `"https://example.com/icon.png"`
- Data URIs: `"data:image/svg+xml;base64,..."` or `"data:image/svg+xml;charset=utf-8,..."`
- Local files: `"/images/my-icon.svg"`

**Theme Support:**
- Built-in endpoint icons automatically adapt to light/dark themes
- Custom icons (URLs/Data URIs) are rendered as `<img>` tags and cannot use `currentColor`
- For theme support, use built-in icons or implement CSS filters (limited)

#### Current Model Groups

1. **Vision Models (Open Source)**
   - Qwen2.5-VL 72B (default)
   - Qwen2.5-VL 32B
   - Llama 3.2 Vision 90B

2. **Vision Models (Proprietary)**
   - Claude Sonnet 4.5
   - Gemini 2.5 Flash Lite

3. **Text Models (Open Source)**
   - DeepSeek V3.2
   - Llama 3.3 70B
   - MiMo-V2-Flash
   - DeepSeek Chat 67B
   - Llama 3.1 8B

4. **Text Models (Proprietary)**
   - GPT-5.2
   - GPT-5 Mini
   - Mistral Large 2411
   - Mistral Nemo
   - GLM 4.7

#### Testing
1. Open model selector → Should show all configured specs in groups
2. Select model → Should apply preset configuration
3. Check feature flags → Tools should auto-enable if configured

---

## Web Search

**Lines 223-236:** Web search configuration

### Configuration
- `enabled: true` - Web search is enabled
- `searchProvider: "searxng"` - Search provider (self-hosted)
- `scraperProvider: "firecrawl"` - Content scraper
- `rerankerType: "jina"` - Reranker for better relevance
- `scraperTimeout: 7500` - Timeout in milliseconds
- `safeSearch: 1` - SafeSearch level (0=Off, 1=Moderate, 2=Strict)

### Components
1. **SearXNG:** `searxngInstanceUrl`, `searxngApiKey` (optional)
2. **Firecrawl:** `firecrawlApiKey`, `firecrawlApiUrl`, `firecrawlVersion`
3. **Jina:** `jinaApiKey`, `jinaApiUrl`

### Workflow
1. User enables web search
2. AI sends query to SearXNG
3. SearXNG returns results
4. Firecrawl scrapes content from URLs
5. Jina reranks results
6. AI uses ranked results for answer

---

## Agent-Specific Features

### Agent Capabilities (Agents only)
- `execute_code` - Code execution (Python, Node.js, etc.)
- `file_search` - Semantic file search (as agent capability)
- `web_search` - Web search (as agent capability)
- `actions` - OpenAPI actions (HTTP requests)
- `tools` - MCP tools and other tools
- `artifacts` - Artifact generation
- `context` - Extended context
- `ocr` - Optical character recognition

### UI Features (All endpoints)
- `fileSearch: true` - UI checkbox (works in normal chats if RAG available)
- `webSearch: true` - UI checkbox (works in normal chats)
- `fileCitations: true` - Shows source citations

**Difference:**
- **Agent Capabilities:** Used automatically by agents
- **UI Features:** Activated by user (checkbox in chat input)

---

## Message Feedback / Rating System

### What it is
Rating system for AI responses with thumbs up/down and detailed tags.

### How it works
- **UI:** Thumbs up/down buttons with tag popovers
- **Tags:** Positive (Accurate, Clear, Creative, etc.) and Negative (Inaccurate, Not Helpful, etc.)
- **Storage:** MongoDB `messages` collection, field `message.feedback`
- **API:** `PUT /api/messages/:conversationId/:messageId/feedback`

### Data Reuse
- Currently only stored, not automatically reused
- No automatic fine-tuning integration
- Can be used for: Analytics, quality monitoring, model selection (manual implementation)

---

## Registration

**Lines 238-241:** Domain restrictions

- `allowedDomains` - List of allowed email domains
- Checks domain for: Normal registration, social login, SAML/OpenID login
- Currently allowed: `correctiv.org`, `faktenforum.org`

---

## Unused Features

**Note:** All features below are available in `docker-compose.librechat.yml` but **commented out** (disabled) with their default settings. To enable, remove comments and adjust values.

### Balance System
- Token balance system for API usage (cost-based limits)
- `enabled: false`, `startBalance: 20000`, `autoRefillEnabled: false`

### Transactions
- Transaction logs for balance tracking
- `enabled: false` (default: true)
- Auto-enabled if `balance.enabled: true`

### Speech (TTS/STT)
- **STT**: Via **Scaleway** ([Audio Transcriptions API](https://www.scaleway.com/en/docs/generative-apis/how-to/query-audio-models/), `whisper-large-v3`). Requires `SCALEWAY_PROJECT_ID` and `SCALEWAY_API_KEY`; init injects the transcriptions URL.
- **TTS**: Browser (no key) or later OpenAI `TTS_API_KEY`. Scaleway TTS coming soon.
- **Audio format**: Scaleway accepts `flac`, `mp3`, `mpeg`, `mpga`, `oga`, `ogg`, `wav`. Use a browser that records ogg/wav (e.g. Firefox) or upload mp3/wav.

### Turnstile (Cloudflare)
- CAPTCHA for registration/login
- `siteKey: "your-site-key-here"`

### Rate Limits
- Rate limiting for file uploads and conversation imports
- Configurable per IP and user with time windows

### File Config
- Granular file upload configuration per endpoint
- Limits: `fileLimit`, `fileSizeLimit`, `totalSizeLimit`, `supportedMimeTypes`

### MCP Servers (Interface Config)
- Model Context Protocol server management
- `use: false`, `create: false`, `share: false` (default: `use: true`, `create: true`, `share: false`)

### Temporary Chat Retention
- Auto-delete temporary chats after X hours
- `temporaryChatRetention: 1` (hours, min: 1, max: 8760, default: 720)

### Actions Domain Restrictions
- SSRF protection for agent actions (OpenAPI)
- `allowedDomains: ['swapi.dev', 'librechat.ai', ...]`

### MCP Settings
- SSRF protection for MCP server remote transports
- `allowedDomains: ['host.docker.internal', 'localhost', ...]`

### OCR
- Optical character recognition for images
- `strategy: "mistral_ocr"` (default, not `provider: "tesseract"`)

### File Strategy (Granular)
- Different storage strategies for different file types
- `fileStrategies: {avatar: "s3", image: "firebase", document: "local"}`
- Default fallback: `"local"` for all types if not specified

---

## Testing Checklist

### Basic Features
- [ ] Cache works (Redis or In-Memory)
- [x] Custom welcome shows username
- [x] File search works with uploaded files
- [ ] Privacy policy link works
- [x] Terms of service modal appears for new users

### Interface Features
- [ ] Endpoints menu visible
- [x] Model select works
- [ ] Parameters panel opens
- [x] Side panel works
- [ ] Presets can be created/loaded
- [ ] Prompts can be created
- [x] Bookmarks work
- [x] Multi-convo works
- [ ] Agents can be created
- [ ] People picker works (in sharing dialogs)
- [ ] Marketplace accessible
- [ ] File citations displayed
- [x] Search works

### Memory
- [ ] Memory automatically created
- [ ] Memory included in conversations
- [ ] Personalization tab visible
- [ ] Memory can be manually edited

### Endpoints & Models
- [x] OpenRouter endpoint works
- [x] Model specs displayed in groups
- [x] Default model (Qwen2.5-VL 72B) used
- [x] Model switching works
- [x] Title generation works
- [ ] Group icons displayed correctly

### Web Search
- [ ] Web search can be enabled
- [ ] Search results included
- [ ] Source citations displayed
- [ ] SearXNG/Firecrawl/Jina work

### Registration
- [ ] Registration with allowed domain works
- [ ] Registration with disallowed domain rejected
- [ ] Social login with allowed domain works

---

*Last updated: 2025-01-09*
