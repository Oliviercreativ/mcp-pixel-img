import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";

const BASE_URL = (process.env.PIXEL_IMG_URL ?? "http://localhost:3000").replace(/\/$/, "");
const API_KEY  = process.env.PIXEL_IMG_API_KEY ?? "";
const MCP_SECRET = process.env.MCP_SECRET ?? "";
const PORT = parseInt(process.env.PORT ?? "3001", 10);

if (!API_KEY)    console.error("[pixel-img MCP] ⚠️  PIXEL_IMG_API_KEY not set");
if (!MCP_SECRET) console.warn("[pixel-img MCP] ⚠️  MCP_SECRET not set — server is open to anyone");

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function api(path: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`,
      ...(options.headers as Record<string, string> ?? {}),
    },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = ((await res.json()) as any).message ?? msg; } catch {}
    throw new Error(`pixel-img API ${res.status}: ${msg}`);
  }
  return res;
}

async function apiJSON<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  return (await api(path, options)).json() as Promise<T>;
}

// ─── MCP Server ───────────────────────────────────────────────────────────────

function createServer() {
  const server = new McpServer({ name: "pixel-img", version: "1.0.0" });

  // ── Templates ────────────────────────────────────────────────────────────────

  server.tool("list_templates", "List available image templates", {
    search:   z.string().optional(),
    category: z.string().optional(),
    favorite: z.boolean().optional(),
  }, async ({ search, category, favorite }) => {
    const p = new URLSearchParams();
    if (search)   p.set("search", search);
    if (category) p.set("category", category);
    if (favorite) p.set("favorite", "true");
    const data = await apiJSON(`/api/templates?${p}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("get_template", "Get a specific template by ID", {
    id: z.number(),
  }, async ({ id }) => {
    const data = await apiJSON(`/api/templates?id=${id}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("create_template", "Create a new image template. Use $meta.columnName placeholders for dynamic data.", {
    name:         z.string(),
    html_content: z.string(),
    css_content:  z.string().optional(),
    description:  z.string().optional(),
    preset:       z.string().optional(),
    width:        z.number().optional(),
    height:       z.number().optional(),
    category:     z.string().optional(),
  }, async (params) => {
    const data = await apiJSON("/api/templates", { method: "POST", body: JSON.stringify(params) });
    return { content: [{ type: "text", text: `✅ Template créé :\n${JSON.stringify(data, null, 2)}` }] };
  });

  server.tool("update_template", "Update an existing template", {
    id:           z.number(),
    name:         z.string().optional(),
    html_content: z.string().optional(),
    css_content:  z.string().optional(),
    description:  z.string().optional(),
    preset:       z.string().optional(),
    width:        z.number().optional(),
    height:       z.number().optional(),
    category:     z.string().optional(),
    is_favorite:  z.boolean().optional(),
  }, async (params) => {
    const data = await apiJSON("/api/templates", { method: "PUT", body: JSON.stringify(params) });
    return { content: [{ type: "text", text: `✅ Template mis à jour :\n${JSON.stringify(data, null, 2)}` }] };
  });

  // ── Image generation ─────────────────────────────────────────────────────────

  server.tool("generate_image", "Generate an image from raw HTML/CSS.", {
    html:            z.string(),
    css:             z.string().optional(),
    preset:          z.string().optional(),
    width:           z.number().optional(),
    height:          z.number().optional(),
    format:          z.enum(["png", "jpeg", "webp"]).optional().default("jpeg"),
    quality:         z.number().min(1).max(100).optional().default(90),
    google_font:     z.string().optional(),
    record_data:     z.record(z.any()).optional(),
    save_to_gallery: z.boolean().optional(),
    gallery_id:      z.number().optional(),
    image_name:      z.string().optional(),
    template_id:     z.number().optional(),
  }, async ({ html, css, preset, width, height, format = "jpeg", quality, google_font, record_data, save_to_gallery, gallery_id, image_name, template_id }) => {
    const res = await api("/api/generate", {
      method: "POST",
      body: JSON.stringify({ html, css, preset, width, height, format, quality, googleFont: google_font, recordData: record_data, save_to_gallery, gallery_id, image_name, template_id }),
    });
    if (save_to_gallery) {
      return { content: [{ type: "text", text: `✅ Image sauvegardée dans la galerie${gallery_id ? ` #${gallery_id}` : ""}.` }] };
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    return { content: [{ type: "image", data: buffer.toString("base64"), mimeType: `image/${format}` as `image/${string}` }] };
  });

  server.tool("generate_from_template", "Generate an image using a saved template. Optionally write back to Airtable.", {
    template_id:         z.number(),
    record_data:         z.record(z.any()).optional(),
    datasource_id:       z.number().optional(),
    format:              z.enum(["png", "jpeg", "webp"]).optional().default("jpeg"),
    save_to_gallery:     z.boolean().optional(),
    gallery_id:          z.number().optional(),
    image_name:          z.string().optional(),
    airtable_record_id:  z.string().optional(),
    airtable_table_id:   z.string().optional(),
    airtable_field_name: z.string().optional(),
  }, async ({ template_id, record_data, datasource_id, format = "jpeg", save_to_gallery, gallery_id, image_name, airtable_record_id, airtable_table_id, airtable_field_name }) => {
    const tpl: any = await apiJSON(`/api/templates?id=${template_id}`);
    if (!tpl?.html_content) throw new Error(`Template #${template_id} introuvable`);
    const imageName = image_name ?? `${tpl.name} — ${new Date().toLocaleDateString("fr-FR")}`;
    const hasWriteback = !!(airtable_record_id && airtable_table_id && airtable_field_name);

    if (hasWriteback) {
      const result: any = await apiJSON("/api/webhook", {
        method: "POST",
        body: JSON.stringify({ webhook_secret: process.env.PIXEL_IMG_WEBHOOK_SECRET, template_id, record_data, datasource_id, format, image_name: imageName, save_to_gallery, gallery_id, airtable_record_id, airtable_table_id, airtable_field_name }),
      });
      const status = result.airtable?.ok ? "✅ Image écrite dans Airtable" : `⚠️ Airtable write-back échoué: ${result.airtable?.error}`;
      return { content: [{ type: "text", text: `${status}\nBlob URL: ${result.blob_url ?? "—"}` }] };
    }

    const res = await api("/api/generate", {
      method: "POST",
      body: JSON.stringify({ html: tpl.html_content, css: tpl.css_content ?? "", preset: tpl.preset, width: tpl.width, height: tpl.height, format, recordData: record_data, save_to_gallery, gallery_id, image_name: imageName, template_id }),
    });
    if (save_to_gallery) {
      return { content: [{ type: "text", text: `✅ Image générée depuis "${tpl.name}" et sauvegardée.` }] };
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    return { content: [{ type: "image", data: buffer.toString("base64"), mimeType: `image/${format}` as `image/${string}` }] };
  });

  server.tool("bulk_generate", "Generate one image per record from a datasource. Saves to gallery + optional Airtable write-back.", {
    template_id:         z.number(),
    datasource_id:       z.number(),
    gallery_id:          z.number(),
    limit:               z.number().optional(),
    format:              z.enum(["png", "jpeg", "webp"]).optional().default("jpeg"),
    name_field:          z.string().optional(),
    airtable_table_id:   z.string().optional(),
    airtable_field_name: z.string().optional(),
  }, async ({ template_id, datasource_id, gallery_id, limit, format = "jpeg", name_field, airtable_table_id, airtable_field_name }) => {
    const tpl: any = await apiJSON(`/api/templates?id=${template_id}`);
    if (!tpl?.html_content) throw new Error(`Template #${template_id} introuvable`);
    const { records, count }: any = await apiJSON("/api/fetch-all-records", { method: "POST", body: JSON.stringify({ datasourceId: datasource_id }) });
    const toProcess: any[] = limit ? records.slice(0, limit) : records;
    let ok = 0, ko = 0;
    const log: string[] = [];
    const hasWriteback = !!(airtable_table_id && airtable_field_name);

    for (let i = 0; i < toProcess.length; i++) {
      const rec = toProcess[i];
      const imageName = (name_field ? rec[name_field] : null) ?? rec.name_shop ?? rec.Name ?? rec.name ?? `${tpl.name} — #${i + 1}`;
      try {
        if (hasWriteback && rec.id) {
          const result: any = await apiJSON("/api/webhook", {
            method: "POST",
            body: JSON.stringify({ webhook_secret: process.env.PIXEL_IMG_WEBHOOK_SECRET, template_id, record_data: rec, datasource_id, format, image_name: imageName, save_to_gallery: true, gallery_id, airtable_record_id: rec.id, airtable_table_id, airtable_field_name }),
          });
          ok++;
          log.push(`✅ ${imageName}${result.airtable?.ok ? " → Airtable ✓" : " → Airtable ✗"}`);
        } else {
          await api("/api/generate", {
            method: "POST",
            body: JSON.stringify({ html: tpl.html_content, css: tpl.css_content ?? "", preset: tpl.preset, width: tpl.width, height: tpl.height, format, recordData: rec, save_to_gallery: true, gallery_id, image_name: imageName, template_id }),
          });
          ok++;
          log.push(`✅ ${imageName}`);
        }
      } catch (err) {
        ko++;
        log.push(`❌ ${imageName}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { content: [{ type: "text", text: [`Bulk terminé : ${ok} succès, ${ko} erreurs / ${toProcess.length} records`, `(total datasource : ${count} records)`, "", log.join("\n")].join("\n") }] };
  });

  // ── Datasources ───────────────────────────────────────────────────────────────

  server.tool("list_datasources", "List configured datasources", {}, async () => {
    const data = await apiJSON("/api/datasources");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("fetch_records", "Fetch all records from a datasource", {
    datasource_id: z.number(),
  }, async ({ datasource_id }) => {
    const data: any = await apiJSON("/api/fetch-all-records", { method: "POST", body: JSON.stringify({ datasourceId: datasource_id }) });
    return { content: [{ type: "text", text: `${data.count} records :\n${JSON.stringify(data.records, null, 2)}` }] };
  });

  server.tool("get_record", "Fetch a specific record by index or field value.", {
    datasource_id: z.number(),
    record_index:  z.number().optional(),
    filter_field:  z.string().optional(),
    filter_value:  z.string().optional(),
  }, async ({ datasource_id, record_index, filter_field, filter_value }) => {
    const data: any = await apiJSON("/api/fetch-all-records", { method: "POST", body: JSON.stringify({ datasourceId: datasource_id }) });
    const records: any[] = data.records ?? [];
    let result = records;
    if (filter_field && filter_value !== undefined) {
      const needle = String(filter_value).toLowerCase();
      result = records.filter(r => r[filter_field] !== undefined && String(r[filter_field]).toLowerCase().includes(needle));
    } else if (record_index !== undefined) {
      result = records[record_index] ? [records[record_index]] : [];
    }
    if (!result.length) return { content: [{ type: "text", text: `Aucun record trouvé (total : ${records.length}).` }] };
    return { content: [{ type: "text", text: `${result.length} record(s) sur ${records.length} :\n${JSON.stringify(result, null, 2)}` }] };
  });

  // ── Galleries ─────────────────────────────────────────────────────────────────

  server.tool("list_galleries", "List image galleries", {}, async () => {
    const data = await apiJSON("/api/galleries");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("create_gallery", "Create a new image gallery", {
    name:        z.string(),
    description: z.string().optional(),
  }, async (params) => {
    const data = await apiJSON("/api/galleries", { method: "POST", body: JSON.stringify(params) });
    return { content: [{ type: "text", text: `✅ Galerie créée :\n${JSON.stringify(data, null, 2)}` }] };
  });

  // ── Presets & misc ────────────────────────────────────────────────────────────

  server.tool("list_presets", "List available social media presets with dimensions", {}, async () => {
    const data = await apiJSON("/api/presets");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("list_fonts", "List available Google Fonts", {}, async () => {
    const data = await apiJSON("/api/fonts");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("health", "Check pixel-img instance status", {}, async () => {
    const data = await apiJSON("/api/health");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  return server;
}

// ─── Express + SSE transport ──────────────────────────────────────────────────

const app = express();
app.use(express.json());

// Auth middleware
function requireSecret(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!MCP_SECRET) return next();
  const auth = req.headers.authorization ?? req.query.secret;
  if (auth !== `Bearer ${MCP_SECRET}` && auth !== MCP_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

// One transport per SSE session
const transports = new Map<string, SSEServerTransport>();

app.get("/sse", requireSecret, async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  const server = createServer();
  transports.set(transport.sessionId, transport);
  res.on("close", () => transports.delete(transport.sessionId));
  await server.connect(transport);
  console.log(`[pixel-img MCP] SSE session opened: ${transport.sessionId}`);
});

app.post("/messages", requireSecret, async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports.get(sessionId);
  if (!transport) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  await transport.handlePostMessage(req, res);
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, target: BASE_URL, sessions: transports.size });
});

app.listen(PORT, () => {
  console.log(`[pixel-img MCP] ✅ SSE server running on port ${PORT}`);
  console.log(`[pixel-img MCP] Target: ${BASE_URL}`);
  console.log(`[pixel-img MCP] Auth: ${MCP_SECRET ? "enabled" : "disabled (MCP_SECRET not set)"}`);
});
