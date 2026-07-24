const CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'";

const SVG_VIEWPORT_STYLE =
  "html,body{width:100%;height:100%;margin:0;overflow:hidden}" +
  "body{display:grid;place-items:center}" +
  "body>svg{display:block;width:100%;height:100%;max-width:100%;max-height:100%}";

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export function normalizeGeneratedHtml(raw: string) {
  let html = raw.trim();
  const fenced = html.match(
    /^```(?:html|svg)?\s*([\s\S]*?)\s*```$/i,
  );
  if (fenced) html = fenced[1].trim();

  const standaloneSvg =
    /^(?:<\?xml[\s\S]*?\?>\s*)?<svg[\s>]/i.test(html) ||
    /<body(?:\s[^>]*)?>\s*(?:<\?xml[\s\S]*?\?>\s*)?<svg[\s>][\s\S]*?<\/svg>\s*<\/body>/i.test(
      html,
    );

  const doctypeStart = html.search(/<!doctype html>/i);
  const htmlStart = html.search(/<html[\s>]/i);
  const documentStart =
    doctypeStart >= 0 ? doctypeStart : htmlStart >= 0 ? htmlStart : -1;
  if (documentStart > 0) html = html.slice(documentStart);

  const htmlEnd = html.toLowerCase().lastIndexOf("</html>");
  if (htmlEnd >= 0) html = html.slice(0, htmlEnd + 7);

  if (!/<html[\s>]/i.test(html)) {
    if (!/<(body|main|div|canvas|svg)[\s>]/i.test(html)) {
      html = `<main><pre>${escapeHtml(html)}</pre></main>`;
    }
    html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
  }

  const guard =
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    (standaloneSvg ? `<style>${SVG_VIEWPORT_STYLE}</style>` : "");

  if (/<head[\s>]/i.test(html)) {
    html = html.replace(/<head([^>]*)>/i, `<head$1>${guard}`);
  } else {
    html = html.replace(/<html([^>]*)>/i, `<html$1><head>${guard}</head>`);
  }

  return html;
}
