function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Не задана переменная окружения ${name}`);
    process.exit(1);
  }
  return value;
}

export const config = {
  botToken: required("BOT_TOKEN"),
  geminiApiKey: required("GEMINI_API_KEY"),
  accessCode: required("ACCESS_CODE"),
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.5-pro",
  imageModel: process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image",
  // Сколько сообщений в день доступно одному ученику
  dailyLimit: Number(process.env.DAILY_LIMIT ?? 50),
  // Сколько последних реплик диалога отправляем модели как контекст
  historyLength: Number(process.env.HISTORY_LENGTH ?? 20),
  // Render сам задаёт RENDER_EXTERNAL_URL; при её наличии работаем через вебхук
  webhookUrl: process.env.WEBHOOK_URL ?? process.env.RENDER_EXTERNAL_URL,
  port: Number(process.env.PORT ?? 3000),
  // Telegram user id админа (необязательно) — ему доступна /stats и нет лимита
  adminId: process.env.ADMIN_ID ? Number(process.env.ADMIN_ID) : undefined,
  usersFile: process.env.USERS_FILE ?? "users.json",
};
