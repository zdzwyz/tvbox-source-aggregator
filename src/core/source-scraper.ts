// 自动抓取源列表（私有功能）
// 1. juwanhezi.com — TVBox 配置源
// 2. MacCMS 萌芽采集插件 — MacCMS 资源站

import type { SourceEntry, MacCMSSourceEntry } from './types';

const SCRAPE_URL = 'https://www.juwanhezi.com/ajax/load';
const REFERER = 'https://www.juwanhezi.com/jsonlist';
const MAX_PAGES = 10;

/**
 * 从 juwanhezi.com 抓取 TVBox 源列表
 * 返回 SourceEntry[]（名称 + URL）
 */
export async function scrapeSourceList(): Promise<SourceEntry[]> {
  const allSources: SourceEntry[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    try {
      const html = await fetchPage(page);
      if (!html || !html.trim()) break;

      const sources = parsePage(html);
      if (sources.length === 0) break;

      allSources.push(...sources);
      console.log(`[source-scraper] Page ${page}: ${sources.length} sources`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[source-scraper] Page ${page} failed: ${msg}`);
      break;
    }
  }

  console.log(`[source-scraper] Total scraped: ${allSources.length} sources`);
  return allSources;
}

async function fetchPage(page: number): Promise<string> {
  const resp = await fetch(SCRAPE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'okhttp/3.12.0',
      'Referer': REFERER,
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: `action=load&page=source&type=one&paged=${page}`,
  });

  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.text();
}

function parsePage(html: string): SourceEntry[] {
  const sources: SourceEntry[] = [];
  const nameRegex = /col-form-label">([^<]+)</g;
  const urlRegex = /value="([^"]+)"/g;

  const names: string[] = [];
  const urls: string[] = [];

  let m;
  while ((m = nameRegex.exec(html)) !== null) names.push(m[1].trim());
  while ((m = urlRegex.exec(html)) !== null) urls.push(m[1].trim());

  for (let i = 0; i < names.length && i < urls.length; i++) {
    const url = urls[i];
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      sources.push({ name: names[i], url });
    }
  }

  return sources;
}

// ============================================================
// MacCMS 萌芽采集资源站自动抓取
// 直接调用 mycj.pro API → AES 解密 → 提取资源站列表
// 无需 MacCMS 实例、无需登录
// ============================================================

const MYCJ_API_URL = 'https://collect.mycj.pro/collect/v10/cjdata.json';
const MYCJ_AES_KEY = 'msqmEd4S6W5EBRLn';
const MYCJ_AES_IV = '8848474575383635';

interface MycjRow {
  flag?: string;
  name?: string;
  apis?: string;
  xml_api?: string;
  rema?: string;
  mid?: number;
  type?: number;
}

/**
 * 从 mycj.pro API 直接抓取 MacCMS 资源站列表
 * GET API → AES-128-CBC 解密 → 提取 zanzhu+m3u8 → 按 flag 去重
 * 无需任何配置，零依赖
 */
export async function scrapeMacCMSSources(): Promise<MacCMSSourceEntry[]> {
  console.log('[maccms-scraper] Fetching from mycj.pro API...');

  const url = `${MYCJ_API_URL}?t=${Math.floor(Date.now() / 1000)}`;
  const resp = await fetch(url);

  if (!resp.ok) {
    throw new Error(`mycj.pro API HTTP ${resp.status}`);
  }

  const json = await resp.json() as { code?: number; data?: string };
  if (json.code !== 200 || !json.data) {
    throw new Error(`mycj.pro API error: code=${json.code}`);
  }

  // AES-128-CBC 解密
  const decrypted = await decryptMycjData(json.data);
  const parsed = JSON.parse(decrypted) as {
    list?: Record<string, { rows?: MycjRow[] }>;
  };

  if (!parsed.list) {
    throw new Error('Decrypted data has no list field');
  }

  // 只取 zanzhu(推荐) + m3u8(切片)
  const sections = ['zanzhu', 'm3u8'] as const;
  const seen = new Map<string, MacCMSSourceEntry>();

  for (const section of sections) {
    const rows = parsed.list[section]?.rows || [];
    for (const row of rows) {
      if (!row.flag || !row.apis || !row.name) continue;
      // 按 flag 去重（zanzhu 优先，m3u8 补充）
      if (!seen.has(row.flag)) {
        seen.set(row.flag, {
          key: row.flag,
          name: row.name,
          api: row.apis,
        });
      }
    }
  }

  const entries = Array.from(seen.values());
  console.log(`[maccms-scraper] Scraped ${entries.length} unique MacCMS sources (zanzhu + m3u8 deduped by flag)`);
  return entries;
}

/**
 * AES-128-CBC 解密萌芽插件数据
 * Web Crypto API (CF Worker / Node.js 18+ 兼容)
 */
async function decryptMycjData(base64Data: string): Promise<string> {
  const keyBytes = new TextEncoder().encode(MYCJ_AES_KEY);
  const ivBytes = new TextEncoder().encode(MYCJ_AES_IV);

  // base64 → Uint8Array
  const binaryStr = atob(base64Data);
  const ciphertext = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    ciphertext[i] = binaryStr.charCodeAt(i);
  }

  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt'],
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: ivBytes }, cryptoKey, ciphertext,
  );

  return new TextDecoder().decode(decrypted);
}
