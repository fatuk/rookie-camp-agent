export interface Segment {
  type: "text" | "code";
  content: string;
  lang?: string;
}

/** Режем ответ модели на обычный текст и фенсед-блоки кода ```lang ... ``` */
export function splitSegments(answer: string): Segment[] {
  const segments: Segment[] = [];
  const fence = /```([\w+#-]*)\n?([\s\S]*?)```/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = fence.exec(answer)) !== null) {
    const before = answer.slice(cursor, match.index).trim();
    if (before) segments.push({ type: "text", content: before });
    const code = match[2].replace(/\s+$/, "");
    if (code) segments.push({ type: "code", content: code, lang: match[1] || undefined });
    cursor = match.index + match[0].length;
  }
  const tail = answer.slice(cursor).trim();
  if (tail) segments.push({ type: "text", content: tail });

  return segments;
}

/** Markdown от модели → HTML-разметка Telegram (жирный, инлайн-код, ссылки) */
export function toTelegramHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const EXTENSIONS: Record<string, string> = {
  python: "py",
  py: "py",
  gdscript: "gd",
  gd: "gd",
  javascript: "js",
  js: "js",
  typescript: "ts",
  ts: "ts",
  html: "html",
  css: "css",
  json: "json",
  lua: "lua",
  cpp: "cpp",
  "c++": "cpp",
  c: "c",
  csharp: "cs",
  cs: "cs",
  java: "java",
  sh: "sh",
  bash: "sh",
};

export function fileNameFor(lang: string | undefined, index: number): string {
  const ext = (lang && EXTENSIONS[lang.toLowerCase()]) ?? "txt";
  return index > 1 ? `code-${index}.${ext}` : `code.${ext}`;
}
