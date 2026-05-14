const STORAGE_BUCKET = 'tool_exports';
const STORAGE_SLOTS: Record<string, string> = {
  main: 'first-line-troubleshooting/main/current.html',
  export: 'first-line-troubleshooting/export/current.html',
};

function getSlot(req: Request): string {
  const url = new URL(req.url);
  const slot = (url.searchParams.get('slot') || 'main').trim().toLowerCase();
  return STORAGE_SLOTS[slot] ? slot : 'main';
}

function getSlotPath(slot: string): string {
  return STORAGE_SLOTS[slot] || STORAGE_SLOTS.main;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function injectBaseHref(html: string, href: string): string {
  const baseTag = `<base href="${href}">`;
  if (/<base\s/i.test(html)) return html;
  if (/<head([^>]*)>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
  }
  return `${baseTag}${html}`;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function logToolView(req: Request, supabaseUrl: string, slot: string, storagePath: string) {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    || Deno.env.get('SERVICE_ROLE_KEY')
    || Deno.env.get('SUPABASE_ANON_KEY')
    || Deno.env.get('ANON_KEY')
    || '';
  if (!serviceKey) return;

  const forwarded = req.headers.get('x-forwarded-for') || '';
  const ip = forwarded.split(',')[0].trim() || req.headers.get('x-real-ip') || '';
  const payload = {
    slot,
    path: storagePath,
    referrer: (req.headers.get('referer') || '').slice(0, 500),
    user_agent: (req.headers.get('user-agent') || '').slice(0, 500),
    ip_hash: ip ? await sha256Hex(ip) : null,
  };

  await fetch(`${supabaseUrl}/rest/v1/hosted_html_tool_views`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      prefer: 'return=minimal',
    },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = (Deno.env.get('SUPABASE_URL') || '').replace(/\/+$/, '');
  if (!supabaseUrl) {
    return new Response('SUPABASE_URL is not configured for this function.', {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const slot = getSlot(req);
  const storagePath = getSlotPath(slot);

  if (req.method !== 'GET') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const objectUrl = `${supabaseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${storagePath}`;
  const assetBaseUrl = `${supabaseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/first-line-troubleshooting/`;
  const storageRes = await fetch(objectUrl, { cache: 'no-store' });

  if (!storageRes.ok) {
    return new Response(`Hosted HTML file not found (${storageRes.status}).`, {
      status: storageRes.status,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const html = injectBaseHref(await storageRes.text(), assetBaseUrl);
  await logToolView(req, supabaseUrl, slot, storagePath);
  return new Response(html, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
});
