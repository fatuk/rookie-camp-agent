import { createServer } from "node:http";
import { Bot, Context, InputFile } from "grammy";
import { config } from "./config.js";
import { askGemini, BaseArt, drawImage, resetHistory } from "./gemini.js";
import { escapeHtml, fileNameFor, looksLikeHtml, splitSegments, toTelegramHtml } from "./format.js";
import { allUsers, authorize, getUser, remainingToday, tryConsume } from "./store.js";

const bot = new Bot(config.botToken);

const TELEGRAM_MESSAGE_LIMIT = 4096;
// Код длиннее этого шлём файлом: в сообщении такой блок уже неудобно копировать
const CODE_FILE_THRESHOLD = 2500;

// Последний присланный учеником рисунок — ждёт команды «нарисуй …»
const pendingArt = new Map<number, BaseArt>();

async function downloadPhoto(ctx: Context): Promise<BaseArt> {
  const file = await ctx.getFile(); // grammY сам берёт самый крупный размер фото
  const url = `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Не удалось скачать фото: ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer()).toString("base64");
  const mimeType = file.file_path?.endsWith(".png") ? "image/png" : "image/jpeg";
  return { data, mimeType };
}

async function drawAndSend(ctx: Context, userId: number, description: string, baseArt?: BaseArt): Promise<void> {
  await ctx.replyWithChatAction("upload_photo");
  try {
    const { image, caption } = await drawImage(userId, description, baseArt);
    await ctx.replyWithPhoto(new InputFile(image, "art.png"), {
      caption: caption?.slice(0, 1024),
    });
  } catch (err) {
    console.error("Ошибка генерации картинки:", err);
    await reply(ctx, "Кисточка сломалась 🖌️ Попробуй описать картинку по-другому или чуть позже!");
  }
}

async function sendHtml(ctx: Context, html: string, plain: string): Promise<void> {
  try {
    await ctx.reply(html, { parse_mode: "HTML" });
  } catch {
    // На случай кривой разметки — отправляем как обычный текст
    await ctx.reply(plain);
  }
}

async function reply(ctx: Context, text: string): Promise<void> {
  let codeIndex = 0;

  for (const segment of splitSegments(text)) {
    // Модель может прислать HTML-документ вообще без фенса — это тоже игра, шлём файлом
    if (segment.type === "text" && looksLikeHtml(segment.content)) {
      segment.type = "code";
      segment.lang = "html";
    }
    if (segment.type === "code") {
      codeIndex += 1;
      const isHtml = segment.lang?.toLowerCase() === "html" || looksLikeHtml(segment.content);
      // HTML — всегда файлом (это игра, её открывают в браузере), остальное — файлом только если длинное
      if (isHtml || segment.content.length > CODE_FILE_THRESHOLD) {
        await ctx.replyWithDocument(
          new InputFile(Buffer.from(segment.content, "utf8"), fileNameFor(segment.lang, codeIndex)),
          {
            caption: isHtml
              ? "Твоя игра! 🎮 Скачай файл и открой его в браузере."
              : segment.lang
                ? `Код (${segment.lang}) 📄`
                : "Код 📄",
          }
        );
      } else {
        // Короткий код — моноширинным блоком: тап по нему в Telegram копирует всё целиком
        const langClass = segment.lang ? ` class="language-${segment.lang}"` : "";
        await sendHtml(ctx, `<pre><code${langClass}>${escapeHtml(segment.content)}</code></pre>`, segment.content);
      }
      continue;
    }

    for (let i = 0; i < segment.content.length; i += TELEGRAM_MESSAGE_LIMIT) {
      const chunk = segment.content.slice(i, i + TELEGRAM_MESSAGE_LIMIT);
      await sendHtml(ctx, toTelegramHtml(chunk), chunk);
    }
  }
}

bot.command("start", async (ctx) => {
  const user = ctx.from && getUser(ctx.from.id);
  if (user?.authorized) {
    await reply(ctx, "Привет снова! 👋 Я Руби, твоя напарница по созданию игр. Просто напиши, что делаем!");
  } else {
    await reply(
      ctx,
      "Привет! 👋 Я Руби — напарница по вайбкодингу и созданию игр.\n\n" +
        "Чтобы начать, напиши **кодовое слово**, которое тебе дал преподаватель."
    );
  }
});

bot.command("help", async (ctx) => {
  await reply(
    ctx,
    "Я помогаю учиться программировать! 🤖\n\n" +
      "Просто пиши мне, например:\n" +
      "• «Придумай механику для моего платформера»\n" +
      "• «Помоги найти ошибку в моём коде»\n" +
      "• «Нарисуй пиксельного дракона для игры» 🎨\n\n" +
      "А ещё пришли фото своего рисунка — и я нарисую по нему игровой арт! 🖼️\n\n" +
      "Команды:\n" +
      "/reset — начать разговор заново\n" +
      "/limit — сколько сообщений осталось сегодня"
  );
});

bot.command("reset", async (ctx) => {
  if (ctx.from) resetHistory(ctx.from.id);
  await reply(ctx, "Начинаем с чистого листа! 📝 О чём поговорим?");
});

bot.command("limit", async (ctx) => {
  if (!ctx.from) return;
  await reply(ctx, `Сегодня у тебя осталось сообщений: **${remainingToday(ctx.from.id)}** из ${config.dailyLimit}.`);
});

bot.command("stats", async (ctx) => {
  if (!ctx.from || ctx.from.id !== config.adminId) return;
  const lines = allUsers().map(
    ([id, u]) => `${u.name} (${id}): сегодня ${u.day === new Date().toISOString().slice(0, 10) ? u.usedToday : 0}, всего ${u.totalMessages}`
  );
  await reply(ctx, lines.length ? lines.join("\n") : "Пока никто не авторизовался.");
});

bot.on("message:photo", async (ctx) => {
  const from = ctx.from;
  if (!getUser(from.id)?.authorized) {
    await reply(ctx, "Сначала напиши кодовое слово от преподавателя, а потом присылай свои рисунки! 🔑");
    return;
  }

  const caption = ctx.message.caption?.trim();

  // Фото с подписью — сразу рисуем по подписи на основе арта
  if (caption) {
    if (!tryConsume(from.id)) {
      await reply(ctx, "На сегодня сообщения закончились! ⏰ Лимит обновится завтра.");
      return;
    }
    try {
      const baseArt = await downloadPhoto(ctx);
      const description = caption.replace(/^(?:нарисуй|draw)\s+/i, "");
      await drawAndSend(ctx, from.id, description, baseArt);
    } catch (err) {
      console.error("Ошибка обработки фото:", err);
      await reply(ctx, "Не смог разглядеть картинку 🙈 Попробуй прислать ещё раз!");
    }
    return;
  }

  // Фото без подписи — запоминаем и ждём команды
  try {
    pendingArt.set(from.id, await downloadPhoto(ctx));
    await reply(
      ctx,
      "Классный арт! 🎨 Что мне с ним сделать?\n" +
        "Напиши, например: «нарисуй его в пиксельном стиле» или «нарисуй этого героя в тёмной пещере»."
    );
  } catch (err) {
    console.error("Ошибка скачивания фото:", err);
    await reply(ctx, "Не смог разглядеть картинку 🙈 Попробуй прислать ещё раз!");
  }
});

bot.on("message:text", async (ctx) => {
  const from = ctx.from;
  const text = ctx.message.text.trim();
  const user = getUser(from.id);

  // Неавторизованный пользователь: любое сообщение считаем попыткой ввести кодовое слово
  if (!user?.authorized) {
    if (text.toLowerCase() === config.accessCode.toLowerCase()) {
      authorize(from.id, from.first_name ?? "ученик");
      await reply(
        ctx,
        `Кодовое слово верное — добро пожаловать, ${from.first_name}! 🎉\n\n` +
          "Теперь просто пиши мне вопросы про программирование. Например: «Что такое цикл?»"
      );
    } else {
      await reply(ctx, "Хм, это не кодовое слово 🤔 Спроси его у преподавателя и напиши мне.");
    }
    return;
  }

  if (!tryConsume(from.id)) {
    await reply(
      ctx,
      "На сегодня сообщения закончились! ⏰ Лимит обновится завтра.\n" +
        "А пока попробуй сам поэкспериментировать с кодом — это лучшая тренировка! 💪"
    );
    return;
  }

  // «нарисуй …» / «draw …» → генерация картинки (с присланным артом за основу, если он есть)
  const drawMatch = text.match(/^(?:нарисуй|draw)\s+(.+)/is);
  if (drawMatch) {
    const baseArt = pendingArt.get(from.id);
    pendingArt.delete(from.id);
    await drawAndSend(ctx, from.id, drawMatch[1].trim(), baseArt);
    return;
  }

  await ctx.replyWithChatAction("typing");
  try {
    const answer = await askGemini(from.id, text);
    await reply(ctx, answer);
  } catch (err) {
    console.error("Ошибка Gemini:", err);
    await reply(ctx, "Ой, у меня что-то заискрило в проводах 🔌 Попробуй ещё раз через минутку!");
  }
});

bot.catch((err) => {
  console.error("Ошибка бота:", err.error);
});

async function main(): Promise<void> {
  if (config.webhookUrl) {
    // Режим вебхука — для Render: входящие запросы Telegram будят сервис
    const path = `/webhook/${config.botToken}`;
    await bot.init();

    // Telegram ретраит апдейт, если вебхук не ответил быстро или упал.
    // Поэтому: отвечаем 200 сразу, обрабатываем в фоне, повторные апдейты отбрасываем.
    const seenUpdates = new Set<number>();

    const server = createServer((req, res) => {
      if (req.method === "POST" && req.url === path) {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          res.writeHead(200);
          res.end();
          try {
            const update = JSON.parse(body);
            if (typeof update.update_id === "number") {
              if (seenUpdates.has(update.update_id)) return;
              seenUpdates.add(update.update_id);
              if (seenUpdates.size > 1000) {
                seenUpdates.delete(seenUpdates.values().next().value!);
              }
            }
            bot.handleUpdate(update).catch((err) => console.error("Ошибка обработки апдейта:", err));
          } catch (err) {
            console.error("Некорректный апдейт от Telegram:", err);
          }
        });
      } else {
        // health check для Render
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
      }
    });

    server.listen(config.port, async () => {
      await bot.api.setWebhook(`${config.webhookUrl}${path}`, { drop_pending_updates: true });
      console.log(`Бот запущен в режиме вебхука на порту ${config.port}`);
    });
  } else {
    // Локальная разработка — long polling
    await bot.api.deleteWebhook({ drop_pending_updates: true });
    console.log("Бот запущен в режиме polling");
    await bot.start();
  }
}

main().catch((err) => {
  console.error("Не удалось запустить бота:", err);
  process.exit(1);
});
