/**
 * Minimal, SAFE markdown → HTML for the insights report. Not a full parser — just the subset
 * the judge's insights.md uses (headings, bold, inline code, bullet lists, paragraphs). HTML is
 * escaped FIRST, so nothing the LLM wrote can inject markup into the dashboard.
 */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Inline formatting applied after escaping: **bold** and `code`. */
function inline(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function renderMarkdown(md: string): string {
  const text = (md ?? '').trim();
  if (!text) return '';
  const lines = esc(text).split('\n');
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (trimmed === '') {
      closeList();
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (h) {
      closeList();
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }
    const li = /^[-*]\s+(.*)$/.exec(trimmed);
    if (li) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${inline(trimmed)}</p>`);
  }
  closeList();
  return out.join('\n');
}
