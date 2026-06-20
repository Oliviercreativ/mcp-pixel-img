# mcp-pixel-img

MCP server for [pixel-img](https://github.com/Oliviercreativ/pixel-img) — expose the pixel-img API as MCP tools over HTTP/SSE for remote hosting (Coolify, Railway, Fly.io, etc.).

## What is this?

[pixel-img](https://github.com/Oliviercreativ/pixel-img) is a Next.js API that generates images (PNG/JPEG/WEBP) from HTML/CSS templates using Puppeteer. This MCP server wraps that API so Claude can use it directly as tools — generate social media visuals, bulk-process Airtable records, manage templates and galleries, and more.

Unlike the built-in stdio MCP (bundled inside pixel-img), **this server uses SSE transport** so it can be hosted remotely and shared across multiple Claude instances.

## Tools exposed

| Tool | Description |
|------|-------------|
| `list_templates` | List templates with optional search/category/favorite filters |
| `get_template` | Get a template by ID |
| `create_template` | Create a new template (supports `$meta.columnName` placeholders) |
| `update_template` | Update an existing template |
| `generate_image` | Generate an image from raw HTML/CSS |
| `generate_from_template` | Generate from a saved template, with optional Airtable write-back |
| `bulk_generate` | Generate one image per datasource record, save to gallery |
| `list_datasources` | List configured datasources (Airtable, Baserow, Supabase) |
| `fetch_records` | Fetch all records from a datasource |
| `get_record` | Get a specific record by index or field value |
| `list_galleries` | List image galleries |
| `create_gallery` | Create a new gallery |
| `list_presets` | List social media presets with dimensions |
| `list_fonts` | List available Google Fonts |
| `health` | Check pixel-img instance status |

## Deploy on Coolify

### 1. Add the repo to Coolify

- Source: `https://github.com/Oliviercreativ/mcp-pixel-img`
- Build pack: **Dockerfile**
- Port: `3001`

### 2. Set environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PIXEL_IMG_URL` | Yes | Your pixel-img base URL (e.g. `https://pixel-img.vercel.app`) |
| `PIXEL_IMG_API_KEY` | Yes | Your `API_PASSWORD` from pixel-img |
| `MCP_SECRET` | Recommended | Bearer token to protect the SSE endpoint |
| `PIXEL_IMG_WEBHOOK_SECRET` | Optional | For Airtable write-back via webhook |
| `PORT` | Optional | Default: `3001` |

### 3. Deploy

Coolify will build the Docker image and start the server. The SSE endpoint will be available at:

```
https://your-coolify-domain/sse
```

## Connect Claude to this server

Add this to your `~/.claude.json` (Claude Code):

```json
{
  "mcpServers": {
    "pixel-img": {
      "type": "sse",
      "url": "https://your-coolify-domain/sse",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_SECRET"
      }
    }
  }
}
```

If `MCP_SECRET` is not set, omit the `headers` block.

## Run locally

```bash
# Clone and install
git clone https://github.com/Oliviercreativ/mcp-pixel-img
cd mcp-pixel-img
npm install

# Configure
cp .env.example .env
# Edit .env with your values

# Development (hot reload)
npm run dev

# Production build
npm run build
npm start
```

The server listens on `http://localhost:3001` by default.

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /sse` | SSE stream — Claude connects here |
| `POST /messages?sessionId=xxx` | MCP message relay |
| `GET /health` | Health check (no auth required) |

## Architecture

```
Claude Code / Claude.ai
        │  SSE connection
        ▼
  mcp-pixel-img  (this server, hosted on Coolify)
        │  REST API calls (Bearer token)
        ▼
  pixel-img API  (hosted on Vercel)
        │
        ▼
  Neon Postgres + Puppeteer/Chromium
```

## License

MIT
