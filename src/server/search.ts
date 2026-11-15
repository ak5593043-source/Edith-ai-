export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export async function searchWeb(query: string, limit = 5): Promise<SearchResult[]> {
  try {
    // Query DuckDuckGo HTML / API for real-time web results
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      throw new Error(`Search request failed with status: ${res.status}`);
    }

    const html = await res.text();
    const results: SearchResult[] = [];

    // Parse DuckDuckGo html results
    // Results are contained in <div class="result ..."> or class="results_links"
    // Extract title, link, snippet
    const resultRegex = /<div[^>]*class="[^"]*(?:result__body|result\s+results_links)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
    let match: RegExpExecArray | null;

    while ((match = resultRegex.exec(html)) !== null && results.length < limit) {
      const block = match[1];

      // Extract url & title
      const linkMatch = /<a[^>]*class="result__url"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block) ||
                         /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
      
      const snippetMatch = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i.exec(block) ||
                           /<div[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i.exec(block);

      if (linkMatch) {
        let rawUrl = linkMatch[1];
        // DDG wraps urls in /l/?kh=-1&uddg=...
        if (rawUrl.includes('uddg=')) {
          const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
          if (uddgMatch) {
            try {
              rawUrl = decodeURIComponent(uddgMatch[1]);
            } catch {
              // ignore
            }
          }
        }
        // Clean title
        const title = linkMatch[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
        const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim() : '';

        if (title && rawUrl.startsWith('http')) {
          results.push({
            title,
            url: rawUrl,
            snippet,
          });
        }
      }
    }

    // Fallback: If DDG HTML didn't parse results (e.g. rate-limit or captcha), fallback to Wikipedia search API
    if (results.length === 0) {
      const wikiUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=${limit}&namespace=0&format=json`;
      const wikiRes = await fetch(wikiUrl, { signal: AbortSignal.timeout(6000) });
      if (wikiRes.ok) {
        const data = await wikiRes.json() as [string, string[], string[], string[]];
        const titles = data[1] || [];
        const snippets = data[2] || [];
        const links = data[3] || [];
        for (let i = 0; i < titles.length; i++) {
          if (titles[i] && links[i]) {
            results.push({
              title: titles[i],
              url: links[i],
              snippet: snippets[i] || '',
            });
          }
        }
      }
    }

    return results;
  } catch (err: any) {
    console.error('Web search error:', err.message);
    return [];
  }
}
