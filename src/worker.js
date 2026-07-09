export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const repo = env.GH_REPO || 'warmrainday-tech/nora-cdn';
    const token = env.GH_TOKEN;

    if (!token) {
      return json({ error: 'server misconfigured: missing token' }, 500, corsHeaders);
    }

    const ghHeaders = {
      'Authorization': `token ${token}`,
      'User-Agent': 'nora-cdn',
      'Accept': 'application/vnd.github+json',
    };

    // ─── GET /image?path=xxx ───
    if (path === '/image' && request.method === 'GET') {
      const filePath = url.searchParams.get('path');
      if (!filePath) return json({ error: 'missing path param' }, 400, corsHeaders);

      // Sanitize: prevent path traversal
      if (filePath.includes('..')) return json({ error: 'invalid path' }, 400, corsHeaders);

      const r = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, { headers: ghHeaders });
      if (!r.ok) return json({ error: 'not found' }, r.status, corsHeaders);

      const data = await r.json();
      const ext = filePath.split('.').pop().toLowerCase();
      const mimeMap = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
        gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
      };
      const mime = mimeMap[ext] || 'application/octet-stream';

      // Large files: redirect to download_url
      if (data.size > 500000 && data.download_url) {
        const dl = await fetch(data.download_url, { headers: ghHeaders });
        return new Response(dl.body, {
          status: dl.status,
          headers: { 'Content-Type': mime, 'Cache-Control': 'public, max-age=86400', ...corsHeaders },
        });
      }

      if (!data.content) return json({ error: 'no content available' }, 500, corsHeaders);

      // Decode base64 safely
      const bytes = base64ToBytes(data.content);
      return new Response(bytes, {
        headers: { 'Content-Type': mime, 'Cache-Control': 'public, max-age=86400', ...corsHeaders },
      });
    }

    // ─── GET /config ───
    if (path === '/config' && request.method === 'GET') {
      const r = await fetch(`https://api.github.com/repos/${repo}/contents/js/config.json`, { headers: ghHeaders });
      if (!r.ok) return json({}, 200, { ...corsHeaders, 'Content-Type': 'application/json' });

      const data = await r.json();
      const text = bytesToText(base64ToBytes(data.content));
      return new Response(text, {
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
      });
    }

    // ─── POST /config ───
    if (path === '/config' && request.method === 'POST') {
      const body = await request.text();
      try { JSON.parse(body); } catch { return json({ error: 'invalid json' }, 400, corsHeaders); }

      const encoded = textToBase64(body);

      // Get current SHA for update
      let sha = '';
      const sr = await fetch(`https://api.github.com/repos/${repo}/contents/js/config.json`, { headers: ghHeaders });
      if (sr.ok) { const sd = await sr.json(); sha = sd.sha; }

      const putBody = { message: 'update config', content: encoded };
      if (sha) putBody.sha = sha;

      const r = await fetch(`https://api.github.com/repos/${repo}/contents/js/config.json`, {
        method: 'PUT',
        headers: { ...ghHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(putBody),
      });

      return json(r.ok ? { ok: true } : { ok: false, error: await r.text() }, r.ok ? 200 : 500, corsHeaders);
    }

    // ─── POST /upload ───
    if (path === '/upload' && request.method === 'POST') {
      const maxSize = 8 * 1024 * 1024; // 8MB limit (GitHub API practical limit ~100MB base64)
      const formData = await request.formData();
      const file = formData.get('file');
      if (!file) return json({ error: 'no file provided' }, 400, corsHeaders);

      const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
      if (!allowedTypes.includes(file.type)) {
        return json({ error: 'file type not allowed' }, 400, corsHeaders);
      }

      const buf = await file.arrayBuffer();
      if (buf.byteLength > maxSize) {
        return json({ error: 'file too large, max 8MB' }, 400, corsHeaders);
      }

      const ext = (file.name || 'image.jpg').split('.').pop().toLowerCase();
      const name = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const targetPath = `images/uploads/${name}`;

      const encoded = bytesToBase64(new Uint8Array(buf));

      const r = await fetch(`https://api.github.com/repos/${repo}/contents/${targetPath}`, {
        method: 'PUT',
        headers: { ...ghHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `upload ${name}`, content: encoded }),
      });

      if (!r.ok) {
        const errText = await r.text();
        return json({ error: 'upload failed', detail: errText }, 500, corsHeaders);
      }

      const proxyUrl = `${url.origin}/image?path=${encodeURIComponent(targetPath)}`;
      return json({ url: proxyUrl, path: targetPath }, 200, corsHeaders);
    }

    // ─── GET / (health check) ───
    if (path === '/' || path === '') {
      return json({ status: 'ok', service: 'nora-cdn' }, 200, corsHeaders);
    }

    return json({ error: 'not found' }, 404, corsHeaders);
  }
};

// ─── Helpers: safe base64 without spread operator ───

function base64ToBytes(b64) {
  const binary = atob(b64.replace(/\n/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function bytesToText(bytes) {
  return new TextDecoder().decode(bytes);
}

function textToBase64(text) {
  const encoded = new TextEncoder().encode(text);
  return bytesToBase64(encoded);
}

function json(obj, status, corsHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}
