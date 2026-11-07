/**
 * @local/knowledge-base — Host half.
 *
 * A local knowledge base backed by a versionable JSON file. It provides:
 *  - agent tools (kb_search / kb_add / kb_capture / kb_list / kb_delete)
 *  - automatic context injection (lightweight RAG on `agent/pre-step`)
 *  - an HTTP API under `/kb-api` consumed by the sidebar panel
 *
 * Data model (one entry):
 *   { id, title, content, summary?, tags[], category?, sourceUrl?,
 *     status: 'active' | 'pending', createdAt, updatedAt }
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import z from '@deepseek-ai/schemastery';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

export const name = '@local/knowledge-base';
export const inject = ['tools'];

export const Config = z.object({
  rootDir: z.string().default(path.join(os.homedir(), '.dsh-knowledge-base')),
  autoInject: z.boolean().default(true),
  injectTop: z.natural().min(1).max(20).default(5),
  injectChars: z.natural().min(100).default(2000),
  autoCaptureConfirm: z.boolean().default(true),
});

const DEFAULT_CONFIG = {
  rootDir: path.join(os.homedir(), '.dsh-knowledge-base'),
  autoInject: true,
  injectTop: 5,
  injectChars: 2000,
  autoCaptureConfirm: true,
};

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

class KnowledgeStore {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.file = path.join(rootDir, 'entries.json');
    this.entries = new Map();
    this.loaded = false;
    this.writeChain = Promise.resolve();
    this.loadPromise = this.load();
  }

  async load() {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        for (const entry of arr) {
          if (entry && typeof entry.id === 'string') this.entries.set(entry.id, entry);
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    this.loaded = true;
  }

  async ready() {
    await this.loadPromise;
  }

  async persist() {
    await fs.mkdir(this.rootDir, { recursive: true });
    const arr = [...this.entries.values()];
    const tmp = `${this.file}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(arr, null, 2), 'utf8');
    await fs.rename(tmp, this.file);
  }

  enqueue(operation) {
    const run = this.writeChain.then(operation, operation);
    this.writeChain = run.catch(() => {});
    return run;
  }

  all() {
    return [...this.entries.values()];
  }

  get(id) {
    return this.entries.get(id);
  }

  async put(entry) {
    return this.enqueue(async () => {
      this.entries.set(entry.id, entry);
      await this.persist();
      return entry;
    });
  }

  async remove(id) {
    return this.enqueue(async () => {
      const existed = this.entries.delete(id);
      if (existed) await this.persist();
      return existed;
    });
  }
}

function now() {
  return Date.now();
}

function newEntry(input, status = 'active') {
  const ts = now();
  return {
    id: crypto.randomUUID(),
    title: String(input.title ?? '').trim(),
    content: String(input.content ?? '').trim(),
    summary: input.summary === undefined ? '' : String(input.summary).trim(),
    tags: normalizeTags(input.tags),
    category: input.category === undefined ? '' : String(input.category).trim(),
    sourceUrl: input.sourceUrl === undefined ? '' : String(input.sourceUrl).trim(),
    status,
    createdAt: ts,
    updatedAt: ts,
  };
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) {
    return [...new Set(tags.map((t) => String(t).trim()).filter(Boolean))];
  }
  if (typeof tags === 'string' && tags.trim() !== '') {
    return [...new Set(tags.split(/[,，;；]/).map((t) => t.trim()).filter(Boolean))];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Keyword search
// ---------------------------------------------------------------------------

function tokenize(text) {
  const t = String(text ?? '').toLowerCase();
  const tokens = new Set();
  for (const m of t.matchAll(/[a-z0-9]+/g)) tokens.add(m[0]);
  const han = t.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const seg of han) {
    for (const ch of seg) tokens.add(ch);
    for (let i = 0; i + 1 < seg.length; i += 1) tokens.add(seg.slice(i, i + 2));
  }
  return [...tokens];
}

function searchableText(entry) {
  return [
    entry.title,
    entry.content,
    entry.summary,
    entry.category,
    ...(entry.tags ?? []),
  ].join(' ');
}

function scoreEntry(entry, queryTokens, haystack, titleLower) {
  let score = 0;
  for (const token of queryTokens) {
    if (haystack.includes(token)) score += 1;
    if (titleLower.includes(token)) score += 2;
  }
  return score;
}

function search(store, query, limit = 5) {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const active = store.all().filter((entry) => entry.status === 'active');
  if (active.length === 0) return [];

  // Term frequencies and length per document.
  const docs = active.map((entry) => {
    const tokens = tokenize(searchableText(entry));
    const tf = new Map();
    for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
    return { entry, tf, length: tokens.length, title: String(entry.title ?? '').toLowerCase() };
  });

  // Document frequency per term.
  const df = new Map();
  for (const doc of docs) {
    for (const token of doc.tf.keys()) df.set(token, (df.get(token) ?? 0) + 1);
  }
  const total = docs.length;
  const avgLen = docs.reduce((sum, doc) => sum + doc.length, 0) / total || 1;

  const k1 = 1.5;
  const b = 0.75;
  const scored = [];
  for (const doc of docs) {
    let score = 0;
    for (const token of queryTokens) {
      const f = doc.tf.get(token) ?? 0;
      if (f === 0) continue;
      const n = df.get(token) ?? 0;
      const idf = Math.log(1 + (total - n + 0.5) / (n + 0.5));
      score += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * doc.length) / avgLen));
    }
    // Title matches are strong signals; add a flat boost per matching query token.
    for (const token of queryTokens) {
      if (doc.title.includes(token)) score += 0.6;
    }
    if (score > 0) scored.push({ entry: doc.entry, score });
  }
  scored.sort((a, c) => c.score - a.score || (c.entry.updatedAt ?? 0) - (a.entry.updatedAt ?? 0));
  return scored.slice(0, limit).map((x) => x.entry);
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function jsonResult(value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
}

function entryBrief(entry) {
  return {
    id: entry.id,
    title: entry.title,
    summary: entry.summary,
    tags: entry.tags,
    category: entry.category,
    sourceUrl: entry.sourceUrl,
    status: entry.status,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

function truncate(text, max) {
  const s = String(text ?? '');
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

function renderInjectedContext(hits, maxChars) {
  const blocks = hits.map((entry, index) => {
    const head = [
      `[${index + 1}] ${entry.title}`,
      entry.category ? `分类：${entry.category}` : '',
      entry.tags?.length ? `标签：${entry.tags.join(', ')}` : '',
    ].filter(Boolean).join(' · ');
    const body = truncate(entry.summary || entry.content, maxChars);
    return `${head}\n${body}`;
  });
  return (
    '以下是与当前问题相关的知识库条目（供参考，可能并非全部相关）：\n\n' +
    blocks.join('\n\n')
  );
}

function extractQuery(messages) {
  const parts = [];
  for (const message of messages ?? []) {
    if (!message || message.role !== 'user') continue;
    for (const block of message.content ?? []) {
      if (block && block.type === 'text' && typeof block.text === 'string') {
        parts.push(block.text);
      }
    }
  }
  return parts.join('\n').trim();
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

function toolParameters(properties, required) {
  return { type: 'object', properties, required, additionalProperties: false };
}

function outputOf(schema, description) {
  return { schema: { ...schema, description }, render: (_args, value) => jsonResult(value) };
}

function kbSearchTool(store) {
  return {
    name: 'kb_search',
    description:
      '在本地知识库中按关键词检索条目。用于查找知识库中与当前问题相关的知识。返回匹配的条目（含标题、摘要、正文、标签、分类）。',
    parameters: toolParameters(
      {
        query: { type: 'string', description: '检索关键词或问题。' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: '返回条数上限，默认 5。' },
      },
      ['query'],
    ),
    output: outputOf(
      {
        type: 'object',
        properties: {
          results: { type: 'array', items: { type: 'object' } },
        },
        required: ['results'],
      },
      '匹配的知识库条目列表。',
    ),
    async execute(args) {
      await store.ready();
      const hits = search(store, String(args.query ?? ''), Number(args.limit) || 5);
      return { results: hits };
    },
  };
}

function kbListTool(store) {
  return {
    name: 'kb_list',
    description: '列出知识库中的条目，可按分类或标签过滤。',
    parameters: toolParameters(
      {
        category: { type: 'string', description: '按分类过滤（可选）。' },
        tag: { type: 'string', description: '按标签过滤（可选）。' },
        query: { type: 'string', description: '按关键词过滤（可选）。' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: '返回条数上限，默认 50。' },
      },
      [],
    ),
    output: outputOf(
      {
        type: 'object',
        properties: {
          entries: { type: 'array', items: { type: 'object' } },
        },
        required: ['entries'],
      },
      '知识库条目列表。',
    ),
    async execute(args) {
      await store.ready();
      let entries = store.all();
      const category = args.category ? String(args.category).trim() : '';
      const tag = args.tag ? String(args.tag).trim() : '';
      const query = args.query ? String(args.query).trim() : '';
      if (category) entries = entries.filter((e) => (e.category ?? '').includes(category));
      if (tag) entries = entries.filter((e) => (e.tags ?? []).includes(tag));
      if (query) {
        const queryTokens = tokenize(query);
        entries = entries.filter((e) => scoreEntry(e, queryTokens, searchableText(e).toLowerCase(), String(e.title ?? '').toLowerCase()) > 0);
      }
      entries = entries.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      return { entries: entries.slice(0, Number(args.limit) || 50) };
    },
  };
}

function kbAddTool(store) {
  return {
    name: 'kb_add',
    description:
      '向知识库添加一条结构化知识条目（用户明确要求记录时使用）。条目包含标题、正文、摘要、标签、分类、来源 URL。',
    parameters: toolParameters(
      {
        title: { type: 'string', description: '条目标题。' },
        content: { type: 'string', description: '条目正文内容。' },
        summary: { type: 'string', description: '简短摘要（可选）。' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签数组（可选）。' },
        category: { type: 'string', description: '分类（可选，层级用 / 分隔）。' },
        sourceUrl: { type: 'string', description: '来源 URL（可选）。' },
      },
      ['title', 'content'],
    ),
    output: outputOf(
      {
        type: 'object',
        properties: { entry: { type: 'object' } },
        required: ['entry'],
      },
      '已保存的知识库条目。',
    ),
    async execute(args) {
      await store.ready();
      const entry = newEntry(args, 'active');
      await store.put(entry);
      return { entry };
    },
  };
}

function kbCaptureTool(store, approval, cfg) {
  return {
    name: 'kb_capture',
    description:
      '把对话中值得沉淀的知识拟稿为一条知识库条目，并请求用户确认后写入。用于 AI 主动识别到值得长期保存的知识时。',
    parameters: toolParameters(
      {
        title: { type: 'string', description: '条目标题。' },
        content: { type: 'string', description: '条目正文内容。' },
        summary: { type: 'string', description: '简短摘要（可选）。' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签数组（可选）。' },
        category: { type: 'string', description: '分类（可选）。' },
        sourceUrl: { type: 'string', description: '来源 URL（可选）。' },
      },
      ['title', 'content'],
    ),
    output: outputOf(
      {
        type: 'object',
        properties: {
          outcome: { type: 'string' },
          entry: { type: 'object' },
        },
        required: ['outcome'],
      },
      '确认结果与（写入成功时的）条目。',
    ),
    async execute(args, exec) {
      await store.ready();
      const entry = newEntry(args, 'active');
      if (cfg.autoCaptureConfirm && approval && exec.agent) {
        const outcome = await approval.request({
          agent: exec.agent,
          toolName: 'kb_capture',
          reason: `保存知识条目「${entry.title}」`,
          displayReason: {
            en: `Save knowledge entry "${entry.title}"`,
            zh: `保存知识条目「${entry.title}」`,
          },
          signal: exec.signal,
        });
        if (outcome !== 'allowed-once') {
          return { outcome, entry: null };
        }
      }
      await store.put(entry);
      return { outcome: 'saved', entry };
    },
  };
}

function kbDeleteTool(store) {
  return {
    name: 'kb_delete',
    description: '按 id 删除一条知识库条目。',
    parameters: toolParameters(
      { id: { type: 'string', description: '要删除的条目 id。' } },
      ['id'],
    ),
    output: outputOf(
      {
        type: 'object',
        properties: { ok: { type: 'boolean' } },
        required: ['ok'],
      },
      '是否删除成功。',
    ),
    async execute(args) {
      await store.ready();
      const ok = await store.remove(String(args.id ?? ''));
      return { ok };
    },
  };
}

// ---------------------------------------------------------------------------
// Import parsing
// ---------------------------------------------------------------------------

function parseMarkdownEntries(text) {
  const source = String(text ?? '');
  const blocks = source.split(/^(?=#\s)/m).filter((block) => block.trim() !== '');
  if (blocks.length === 0) return [];
  if (blocks.length === 1) {
    const lines = blocks[0].split('\n');
    let title = '';
    let start = 0;
    if (/^#\s+/.test(lines[0])) {
      title = lines[0].replace(/^#\s+/, '').trim();
      start = 1;
    } else {
      title = (lines[0] || '').trim() || '未命名';
    }
    return [{ title, content: lines.slice(start).join('\n').trim() }];
  }
  const entries = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const title = (lines[0] || '').replace(/^#\s+/, '').trim();
    const content = lines.slice(1).join('\n').trim();
    if (title) entries.push({ title, content });
  }
  return entries;
}

function parseJsonEntries(text) {
  let data;
  try {
    data = JSON.parse(String(text ?? ''));
  } catch {
    return [];
  }
  const arr = Array.isArray(data) ? data : Array.isArray(data && data.entries) ? data.entries : [data];
  const entries = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    if (typeof item.title !== 'string' || typeof item.content !== 'string') continue;
    entries.push({
      title: item.title,
      content: item.content,
      summary: typeof item.summary === 'string' ? item.summary : '',
      tags: item.tags,
      category: typeof item.category === 'string' ? item.category : '',
      sourceUrl: typeof item.sourceUrl === 'string' ? item.sourceUrl : '',
    });
  }
  return entries;
}

function importEntries(store, format, text) {
  const parsed = format === 'json' ? parseJsonEntries(text) : parseMarkdownEntries(text);
  const created = [];
  for (const item of parsed) {
    created.push(newEntry(item, 'active'));
  }
  return created;
}

function kbImportTool(store) {
  return {
    name: 'kb_import',
    description: '批量导入知识条目：支持 Markdown（按 # 标题拆分为多条）或 JSON 数组。',
    parameters: toolParameters(
      {
        format: { type: 'string', enum: ['markdown', 'json'], description: '内容格式。' },
        text: { type: 'string', description: '要导入的文本（Markdown 或 JSON）。' },
      },
      ['format', 'text'],
    ),
    output: outputOf(
      {
        type: 'object',
        properties: {
          imported: { type: 'integer' },
          entries: { type: 'array', items: { type: 'object' } },
        },
        required: ['imported'],
      },
      '导入结果。',
    ),
    async execute(args) {
      await store.ready();
      const format = String(args.format ?? 'markdown').toLowerCase();
      const created = importEntries(store, format, args.text);
      for (const entry of created) await store.put(entry);
      return { imported: created.length, entries: created };
    },
  };
}

// ---------------------------------------------------------------------------
// HTTP API (for the sidebar panel)
// ---------------------------------------------------------------------------

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : null);
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

async function handleKbHttp(req, res, store) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  const method = (req.method || 'GET').toUpperCase();
  const idMatch = pathname.match(/^\/kb-api\/entries\/([^/]+)$/);

  await store.ready();

  // GET /kb-api/entries
  if (method === 'GET' && pathname === '/kb-api/entries') {
    const query = url.searchParams.get('query') ?? '';
    const category = url.searchParams.get('category') ?? '';
    const tag = url.searchParams.get('tag') ?? '';
    const limit = Number(url.searchParams.get('limit')) || 100;
    let entries = store.all();
    if (category) entries = entries.filter((e) => (e.category ?? '').includes(category));
    if (tag) entries = entries.filter((e) => (e.tags ?? []).includes(tag));
    if (query) {
      const queryTokens = tokenize(query);
      entries = entries.filter((e) => scoreEntry(e, queryTokens, searchableText(e).toLowerCase(), String(e.title ?? '').toLowerCase()) > 0);
    }
    entries = entries.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    return send(res, 200, { entries: entries.slice(0, limit) });
  }

  // GET /kb-api/tags — distinct tags across the knowledge base, with counts.
  if (method === 'GET' && pathname === '/kb-api/tags') {
    const counts = new Map();
    for (const entry of store.all()) {
      if (entry.status !== 'active') continue;
      for (const tag of entry.tags ?? []) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    const tags = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
      .map(([name, count]) => ({ name, count }));
    return send(res, 200, { tags });
  }

  // DELETE /kb-api/tags/:name — remove a tag from every entry.
  if (method === 'DELETE' && pathname.startsWith('/kb-api/tags/')) {
    const name = decodeURIComponent(pathname.slice('/kb-api/tags/'.length));
    let changed = 0;
    for (const entry of store.all()) {
      if ((entry.tags ?? []).includes(name)) {
        entry.tags = entry.tags.filter((tag) => tag !== name);
        changed += 1;
      }
    }
    if (changed > 0) await store.persist();
    return send(res, 200, { ok: true, changed, tag: name });
  }

  // GET /kb-api/explore?tags=a,b — progressive co-occurrence facets.
  if (method === 'GET' && pathname === '/kb-api/explore') {
    const wanted = (url.searchParams.get('tags') || '')
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const active = store.all().filter((entry) => entry.status === 'active');
    const matched = wanted.length === 0
      ? active
      : active.filter((entry) => wanted.every((tag) => (entry.tags ?? []).includes(tag)));
    const counts = new Map();
    for (const entry of matched) {
      for (const tag of entry.tags ?? []) {
        if (wanted.includes(tag)) continue;
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    const candidates = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
      .map(([name, count]) => ({ name, count }));
    // Co-occurrence edges among all matched tags, for the nebula graph.
    const edgeCounts = new Map();
    for (const entry of matched) {
      const tags = entry.tags ?? [];
      for (let i = 0; i < tags.length; i += 1) {
        for (let j = i + 1; j < tags.length; j += 1) {
          const key = [tags[i], tags[j]].sort().join('\u0000');
          edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
        }
      }
    }
    const edges = [...edgeCounts.entries()].map(([key, count]) => {
      const [a, b] = key.split('\u0000');
      return { a, b, count };
    });
    const entries = [...matched].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    return send(res, 200, { selected: wanted, candidates, edges, entries, total: entries.length });
  }

  // POST /kb-api/entries
  if (method === 'POST' && pathname === '/kb-api/entries') {
    const body = await readBody(req);
    if (!body || typeof body.title !== 'string' || typeof body.content !== 'string') {
      return send(res, 400, { error: 'title and content are required' });
    }
    const entry = newEntry(body, 'active');
    await store.put(entry);
    return send(res, 201, { entry });
  }

  // POST /kb-api/entries/batch-delete — delete several entries at once.
  if (method === 'POST' && pathname === '/kb-api/entries/batch-delete') {
    const body = await readBody(req);
    const ids = Array.isArray(body && body.ids) ? body.ids.map(String) : [];
    let removed = 0;
    for (const id of ids) {
      if (store.get(id)) {
        await store.remove(id);
        removed += 1;
      }
    }
    return send(res, 200, { ok: true, removed });
  }

  // POST /kb-api/related-tags — suggest existing tags relevant to the text.
  // Text matches are seeds; other tags score by co-occurrence strength with
  // those seeds, so the tag graph itself drives relevance.
  if (method === 'POST' && pathname === '/kb-api/related-tags') {
    const body = await readBody(req);
    const text = String((body && body.text) || '');
    const lower = text.toLowerCase();
    const tokens = new Set(tokenize(text));
    const active = store.all().filter((entry) => entry.status === 'active');

    const usage = new Map();
    for (const entry of active) {
      for (const tag of entry.tags ?? []) {
        usage.set(tag, (usage.get(tag) ?? 0) + 1);
      }
    }

    // Seeds: tags whose name appears in the text.
    const seeds = new Set();
    for (const name of usage.keys()) {
      const tagTokens = tokenize(name);
      const matched = tagTokens.some((t) => tokens.has(t)) || (name.length > 0 && lower.includes(name.toLowerCase()));
      if (matched) seeds.add(name);
    }

    // Co-occurrence strength: how often each tag appears alongside the seeds.
    const co = new Map();
    for (const entry of active) {
      const tags = entry.tags ?? [];
      const hits = tags.filter((tag) => seeds.has(tag)).length;
      if (hits === 0) continue;
      for (const tag of tags) {
        if (seeds.has(tag)) continue;
        co.set(tag, (co.get(tag) ?? 0) + hits);
      }
    }

    const related = [];
    for (const name of usage.keys()) {
      const used = usage.get(name) ?? 0;
      if (seeds.has(name)) related.push({ name, count: used, score: 100000 + used });
    }
    // Strong co-occurrence only (shared by >= 2 entries), capped at 8.
    const coList = [...co.entries()]
      .filter(([, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    for (const [name, c] of coList) {
      const used = usage.get(name) ?? 0;
      related.push({ name, count: used, score: c * 1000 + used });
    }
    if (related.length === 0) {
      // No seed: fall back to the most used tags.
      for (const [name, used] of [...usage.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
        related.push({ name, count: used, score: used });
      }
    }
    related.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'zh'));
    return send(res, 200, { tags: related.slice(0, 12).map(({ name, count }) => ({ name, count })) });
  }

  // POST /kb-api/import
  if (method === 'POST' && pathname === '/kb-api/import') {
    const body = await readBody(req);
    if (!body || typeof body.text !== 'string') {
      return send(res, 400, { error: 'text is required' });
    }
    const format = String(body.format ?? 'markdown').toLowerCase();
    const created = importEntries(store, format, body.text);
    for (const entry of created) await store.put(entry);
    return send(res, 200, { imported: created.length, entries: created });
  }

  // PUT /kb-api/entries/:id
  if (method === 'PUT' && idMatch) {
    const id = decodeURIComponent(idMatch[1]);
    const existing = store.get(id);
    if (!existing) return send(res, 404, { error: 'not found' });
    const body = await readBody(req);
    if (!body || typeof body !== 'object') return send(res, 400, { error: 'invalid body' });
    const updated = {
      ...existing,
      title: body.title === undefined ? existing.title : String(body.title).trim(),
      content: body.content === undefined ? existing.content : String(body.content).trim(),
      summary: body.summary === undefined ? existing.summary : String(body.summary).trim(),
      tags: body.tags === undefined ? existing.tags : normalizeTags(body.tags),
      category: body.category === undefined ? existing.category : String(body.category).trim(),
      sourceUrl: body.sourceUrl === undefined ? existing.sourceUrl : String(body.sourceUrl).trim(),
      status: body.status === undefined ? existing.status : String(body.status),
      updatedAt: now(),
    };
    await store.put(updated);
    return send(res, 200, { entry: updated });
  }

  // DELETE /kb-api/entries/:id
  if (method === 'DELETE' && idMatch) {
    const id = decodeURIComponent(idMatch[1]);
    const ok = await store.remove(id);
    return send(res, 200, { ok });
  }

  return send(res, 404, { error: 'not found' });
}

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

export function apply(ctx, config) {
  const cfg = { ...DEFAULT_CONFIG, ...(config ?? {}) };
  const store = new KnowledgeStore(cfg.rootDir);
  const approval = ctx.get('approval');

  // Agent tools.
  ctx.effect(() => {
    const disposers = [
      ctx.tools.register(kbSearchTool(store), {}),
      ctx.tools.register(kbListTool(store), {}),
      ctx.tools.register(kbAddTool(store), {}),
      ctx.tools.register(kbCaptureTool(store, approval, cfg), {}),
      ctx.tools.register(kbDeleteTool(store), {}),
      ctx.tools.register(kbImportTool(store), {}),
    ];
    return () => disposers.forEach((dispose) => dispose());
  }, 'knowledge-base.tools');

  // Lightweight RAG injection on every agent pre-step.
  if (cfg.autoInject) {
    const agentDisposers = new Map();

    ctx.on('agent/created', ({ agent }) => {
      if (!agent || !agent.ctx) return;
      const disposer = agent.ctx.effect(() => {
        return agent.ctx.on('agent/pre-step', async (payload, next) => {
          const decision = await next();
          if (decision.kind !== 'enter') return decision;
          const query = extractQuery(decision.messages);
          if (!query) return decision;
          await store.ready();
          const hits = search(store, query, cfg.injectTop);
          if (hits.length === 0) return decision;
          const text = renderInjectedContext(hits, cfg.injectChars);
          const message = createUserMessage({
            content: [{ type: 'text', text }],
            source: { kind: 'user' },
          });
          return { ...decision, messages: [message, ...decision.messages] };
        });
      }, 'knowledge-base.rag');
      agentDisposers.set(agent.id, disposer);
    });

    ctx.on('agent/disposed', ({ agent }) => {
      const disposer = agentDisposers.get(agent?.id);
      if (disposer) {
        disposer();
        agentDisposers.delete(agent.id);
      }
    });

    ctx.effect(() => () => {
      for (const disposer of agentDisposers.values()) disposer();
      agentDisposers.clear();
    }, 'knowledge-base.rag-cleanup');
  }

  // HTTP API for the sidebar panel: wait until webServer is available.
  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => scope.webServer.register({
      kind: 'prefix',
      path: '/kb-api',
      handler: (req, res) => handleKbHttp(req, res, store),
    }), 'knowledge-base.http-api');
  });
}
