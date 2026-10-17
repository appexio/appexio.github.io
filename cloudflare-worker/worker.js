/* AppExio multi-source catalog proxy.
 * Deploy as a Cloudflare Worker if provider CORS policies block browser requests.
 * Public metadata only; download links remain with the publisher/repository.
 */
const ALLOWED_ORIGINS = new Set([
  "https://appexio.github.io",
  "https://appexiodev.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
  "http://localhost:5500",
  "http://127.0.0.1:5500"
]);

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : "https://appexio.github.io";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}
function json(body, status, origin, cache = 300) {
  return new Response(JSON.stringify(body), { status, headers: {
    ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": `public, max-age=${cache}`
  }});
}
async function getJson(url, ttl = 300, extraHeaders = {}) {
  const response = await fetch(url, {
    headers: { "Accept": "application/json", "User-Agent": "AppExio-MultiSource-Catalog/2.0", ...extraHeaders },
    cf: { cacheTtl: ttl, cacheEverything: true }
  });
  if (!response.ok) throw new Error(`Upstream returned ${response.status}`);
  return response.json();
}
function itemText(item) {
  return [item?.name, item?.token, item?.full_name, item?.desc, item?.description, item?.homepage].filter(Boolean).join(" ").toLowerCase();
}
function filterHomebrew(items, q, kind) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return (Array.isArray(items) ? items : []).filter(item => {
    if (kind === "cask" && !item.token) return false;
    if (kind === "formula" && !item.full_name && !item.name) return false;
    const text = itemText(item);
    return words.every(word => text.includes(word));
  }).slice(0, 12).map(item => ({ ...item, _appexioSource: "Homebrew", _appexioKind: kind }));
}
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405, origin, 0);
    if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: "Origin not allowed" }, 403, origin, 0);
    const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
    const path = url.pathname;
    if (path.endsWith("/search") && q.length < 1) return json({ error: "Query is required" }, 400, origin, 0);
    try {
      let data;
      let ttl = 300;
      if (path === "/api/fdroid/search") {
        data = await getJson(`https://search.f-droid.org/api/search_apps?q=${encodeURIComponent(q)}`);
      } else if (path === "/api/winget/search") {
        data = await getJson(`https://api.winget.run/v2/packages?query=${encodeURIComponent(q)}&take=20`);
      } else if (path === "/api/winget/featured") {
        data = await getJson("https://api.winget.run/v2/featured", 900);
      } else if (path === "/api/flathub/search") {
        data = await getJson(`https://flathub.org/api/v2/search?query=${encodeURIComponent(q)}`);
      } else if (path === "/api/repology/search") {
        data = await getJson(`https://repology.org/api/v1/projects/?search=${encodeURIComponent(q)}`, 900, { "User-Agent": "AppExio catalog contact: https://appexio.github.io/" });
      } else if (path === "/api/gitlab/search") {
        data = await getJson(`https://gitlab.com/api/v4/projects?search=${encodeURIComponent(q)}&simple=true&per_page=8&order_by=star_count&sort=desc`, 300);
      } else if (path === "/api/homebrew/search") {
        // The official Homebrew API publishes separate full JSON indexes for formulae and casks.
        // Cloudflare's edge cache reduces repeat downloads; only matching entries are returned.
        const [formulae, casks] = await Promise.all([
          getJson("https://formulae.brew.sh/api/formula.json", 3600),
          getJson("https://formulae.brew.sh/api/cask.json", 3600)
        ]);
        data = [...filterHomebrew(formulae, q, "formula"), ...filterHomebrew(casks, q, "cask")];
        ttl = 600;
      } else if (path === "/api/npm/search") {
        data = await getJson(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}&size=10`, 600);
      } else if (path === "/api/maven/search") {
        data = await getJson(`https://search.maven.org/solrsearch/select?q=${encodeURIComponent(q)}&rows=10&wt=json`, 600);
      } else if (path === "/api/crates/search") {
        data = await getJson(`https://crates.io/api/v1/crates?q=${encodeURIComponent(q)}&per_page=10`, 600, { "User-Agent": "AppExio catalog (https://appexio.github.io/)" });
      } else if (path === "/api/nuget/search") {
        data = await getJson(`https://azuresearch-usnc.nuget.org/query?q=${encodeURIComponent(q)}&take=10&prerelease=false`, 600);
      } else if (path === "/api/docker/search") {
        data = await getJson(`https://hub.docker.com/v2/search/repositories/?query=${encodeURIComponent(q)}&page_size=10`, 600);
      } else if (path === "/api/archive/search") {
        const archiveQuery = `(${q}) AND mediatype:software`;
        data = await getJson(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(archiveQuery)}&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=description&rows=10&page=1&output=json`, 900);
      } else if (path === "/api/apple/search") {
        const [mac, ios] = await Promise.all([
          getJson(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=macSoftware&limit=10`, 900),
          getJson(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=software&limit=10`, 900)
        ]);
        data = { results: [...(mac.results || []), ...(ios.results || [])] };
        ttl = 900;
      } else if (path === "/api/pubdev/search") {
        data = await getJson(`https://pub.dev/api/search?q=${encodeURIComponent(q)}`, 600);
      } else if (path === "/api/rubygems/search") {
        data = await getJson(`https://rubygems.org/api/v1/search.json?query=${encodeURIComponent(q)}`, 600);
      } else if (path === "/api/packagist/search") {
        data = await getJson(`https://packagist.org/search.json?q=${encodeURIComponent(q)}&per_page=10`, 600);
      } else if (path === "/api/openvsx/search") {
        data = await getJson(`https://open-vsx.org/api/-/search?query=${encodeURIComponent(q)}&size=10`, 600);
      } else {
        return json({ error: "Unknown endpoint" }, 404, origin, 0);
      }
      return json(data, 200, origin, ttl);
    } catch (error) {
      return json({ error: "This catalog is temporarily unavailable", provider: path.split("/").filter(Boolean)[1] || "unknown" }, 502, origin, 60);
    }
  }
};
