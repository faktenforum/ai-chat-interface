# SearXNG Engines Configuration

This document describes the search engines and features enabled in our SearXNG instance.

## Enabled Search Engines

### General Search Engines

#### Bing (`bi`)
- **Status**: Enabled
- **Purpose**: Microsoft's search engine as additional search provider
- **API Key**: Not required
- **Categories**: General web search

### IT & Development

#### GitHub (`gh`)
- **Status**: Enabled
- **Purpose**: Search for code repositories, issues, and pull requests
- **API Key**: Not required
- **Categories**: IT, repositories

#### npm (`npm`)
- **Status**: Enabled
- **Purpose**: Search for Node.js packages
- **API Key**: Not required
- **Categories**: IT, packages

### Images

#### Pixabay Images (`pixi`)
- **Status**: Enabled
- **Purpose**: Free stock images (CC-licensed)
- **API Key**: Not required
- **Categories**: Images

### Science & Research

#### OpenAlex (`oa`)
- **Status**: Enabled
- **Purpose**: Scientific literature and research papers
- **API Key**: Not required (but recommended to join polite pool with email)
- **Categories**: Science
- **Note**: Consider adding email address for polite pool access (see configuration)

#### Springer Nature (`springer`)
- **Status**: Enabled (requires API key)
- **Purpose**: Scientific publications from Springer Nature
- **API Key**: Required - set via `SPRINGER_NATURE_API_KEY` environment variable
- **Categories**: Science
- **Documentation**: https://docs.searxng.org/dev/engines/online/springer.html
- **API Key Registration**: https://dev.springernature.com/

**API Key Registration Guide:**

1. **Visit**: https://dev.springernature.com/subscription/
2. **Create Account**: Sign up with your email
3. **Fill Registration Form**:
   - **Which API are you interested in?**: Select **Meta API** (not Open Access API)
   - **Which industry do you work for?**: Select **Academic**
   - **Your organization name**: Enter **Correctiv**
   - **Your job role**: Select appropriate role (e.g., "Researcher", "Journalist", "Data Analyst")
   - **Your country**: Select **Germany**
   - **Which fields are you interested in?**: Select relevant fields (e.g., Social Sciences, Arts and Humanities, etc.)
4. **Complete Registration**: Submit the form and verify your email
5. **Get API Key**: After approval, you'll receive your API key (hexadecimal format)
6. **Add to Environment**: Add `SPRINGER_NATURE_API_KEY=your-key-here` to your `.env` or `.env.prod` file
7. **Restart SearXNG**: `docker compose restart searxng`

**Note**: The engine uses the **Meta API v2**, which provides access to Springer Nature's metadata and publications. The API key is free for academic use.

## Disabled Engines

The following engines are intentionally disabled:

- **ahmia** - Tor search engine (requires Tor proxy)
- **torch** - Tor search engine (requires Tor proxy)
- **radio browser** - Internet radio stations (may fail locally but works in production)

## Enabled Plugins

### Infinite Scroll
- **Status**: Enabled
- **Purpose**: Automatically loads more results as user scrolls
- **Benefit**: Better user experience for long result lists

### Other Active Plugins
- Calculator
- Hash Plugin (MD5, SHA, etc.)
- Self Info
- Unit Converter
- Ahmia Filter
- Hostnames
- Time Zone
- Tracker URL Remover

## Configuration

### Environment Variables

Add the following to your `.env` or `.env.prod` file:

```bash
# SearXNG default language for search results
# Options: 'de' (German), 'en' (English), 'all' (all languages), 'auto' (auto-detect)
# Set to 'de' or 'en' to filter out unwanted languages (e.g., Chinese results)
SEARXNG_DEFAULT_LANG=de

# Springer Nature API Key (optional - only if you want to use Springer Nature engine)
SPRINGER_NATURE_API_KEY=your-api-key-here
```

### Language Configuration

By default, SearXNG searches in all languages, which can result in unwanted results (e.g., Chinese content). To filter results by language:

1. **Set `SEARXNG_DEFAULT_LANG`** in your `.env` or `.env.prod` file:
   - `de` - German results only
   - `en` - English results only
   - `all` - All languages (default, may include unwanted results)
   - `auto` - Auto-detect language from query

2. **Restart services** after changing the language:
   ```bash
   docker compose restart searxng librechat
   ```

The language setting is applied both in SearXNG's configuration and in LibreChat's search requests, ensuring consistent filtering across all search operations.

### Getting API Keys

#### Springer Nature API Key

1. Visit https://dev.springernature.com/
2. Sign up for a free account
3. Create a new application
4. Copy the API key
5. Add it to your environment variables

**Note**: The Springer Nature engine will remain inactive until an API key is provided.

## Default Engines (Always Active)

The following engines are enabled by default in SearXNG:

- **DuckDuckGo** (`ddg`) - Main search engine
- **Startpage** (`sp`) - Privacy-focused search
- **Qwant** (`qw`) - European search engine
- **Wikipedia** (`wp`) - Wikipedia articles
- **Wikidata** (`wd`) - Structured data
- **Bing Images** (`bii`) - Image search
- **Bing News** (`bin`) - News search
- **Bing Videos** (`biv`) - Video search
- **DeviantArt** (`da`) - Art & illustrations
- **Pinterest** (`pin`) - Images & pins
- **Openverse** (`opv`) - Open-source images
- **YouTube** (`yt`) - Video platform
- **Dailymotion** (`dm`) - Video platform
- **Vimeo** (`vm`) - Video platform
- **Bandcamp** (`bc`) - Music & albums
- **PodcastIndex** (`podcast`) - Podcasts
- **Docker Hub** (`dh`) - Docker images
- **Arch Linux Wiki** (`al`) - Arch Linux documentation
- **Mankier** (`man`) - Man pages
- **ArXiv** (`arx`) - Scientific papers
- **Semantic Scholar** (`se`) - Scientific literature
- **OpenStreetMap** (`osm`) - Maps & geodata
- **Currency** (`cc`) - Currency conversion
- **Photon** (`ph`) - Geocoding

## Engine Categories

Engines are organized into the following categories:

- **General** - Web search engines
- **Images** - Image search engines
- **Videos** - Video search engines
- **News** - News search engines
- **Music** - Music and audio search
- **IT** - IT and development resources
- **Science** - Scientific literature and research
- **Files** - File search engines
- **Social Media** - Social media platforms

## Usage

### Using Engine Shortcuts

You can search specific engines using shortcuts:

- `!bi python` - Search Bing for "python"
- `!gh librechat` - Search GitHub for "librechat"
- `!npm express` - Search npm for "express"
- `!pixi nature` - Search Pixabay for "nature" images
- `!oa machine learning` - Search OpenAlex for "machine learning"
- `!springer AI` - Search Springer Nature for "AI" (requires API key)

### Combining Engines

You can combine multiple engines in a single search by using multiple shortcuts or selecting engines in the UI.

## Troubleshooting

### Engine Not Working

1. Check if the engine is enabled in the configuration
2. Verify API keys are set correctly (if required)
3. Check SearXNG logs: `docker logs searxng`
4. Test the engine directly using its shortcut

### API Key Issues

- Ensure the API key is set in the environment variables
- Restart SearXNG after adding API keys: `docker compose restart searxng`
- Check that the API key is valid and has the required permissions

## References

- [SearXNG Documentation](https://docs.searxng.org/)
- [SearXNG Engine List](https://docs.searxng.org/user/configured_engines.html)
- [Springer Nature API](https://dev.springernature.com/)
- [OpenAlex Documentation](https://docs.openalex.org/)
