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
  const tail = answer.slice(cursor);
  // Незакрытый фенс: модель оборвала ответ или забыла ``` — хвост всё равно считаем кодом,
  // иначе он уйдёт «текстом» и расползётся на несколько сообщений
  const unclosed = /```([\w+#-]*)\n?([\s\S]*)$/.exec(tail);
  if (unclosed) {
    const before = tail.slice(0, unclosed.index).trim();
    if (before) segments.push({ type: "text", content: before });
    const code = unclosed[2].trim();
    if (code) segments.push({ type: "code", content: code, lang: unclosed[1] || undefined });
  } else if (tail.trim()) {
    segments.push({ type: "text", content: tail.trim() });
  }

  return segments;
}

/** Похоже на цельный HTML-документ (даже если модель не пометила блок как ```html) */
export function looksLikeHtml(code: string): boolean {
  const head = code.trimStart().slice(0, 200).toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html");
}

export interface Patch {
  search: string;
  replace: string;
}

/** Разбирает блоки правок «НАЙТИ → ЗАМЕНИТЬ», которыми модель меняет текущий файл игры */
export function parsePatches(code: string): Patch[] {
  const patches: Patch[] = [];
  const re = /<{4,}\s*НАЙТИ\s*\r?\n([\s\S]*?)\r?\n={4,}\r?\n([\s\S]*?)\r?\n>{4,}\s*ЗАМЕНИТЬ/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(code)) !== null) {
    patches.push({ search: match[1], replace: match[2] });
  }
  return patches;
}

/** Применяет патчи по очереди. null — если какой-то фрагмент НАЙТИ не нашёлся в файле. */
export function applyPatches(html: string, patches: Patch[]): string | null {
  let result = html;
  for (const patch of patches) {
    let search = patch.search;
    if (!result.includes(search)) {
      // Модель могла прислать другой стиль переводов строк
      search = search.replace(/\r\n/g, "\n");
      if (!result.includes(search)) return null;
    }
    result = result.replace(search, patch.replace);
  }
  return result;
}

/** Убирает код из текста, оставляя пометку — для компактной истории диалога */
export function stripCodeBlocks(text: string): string {
  return text
    .replace(/```[\w+#-]*\n?[\s\S]*?```/g, "(код отправлен ученику файлом)")
    .replace(/```[\w+#-]*\n?[\s\S]*$/, "(код отправлен ученику файлом)")
    .trim();
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
