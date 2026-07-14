import { GoogleGenAI } from "@google/genai";
import { config } from "./config.js";
import { IMAGE_STYLE_SUFFIX, SYSTEM_PROMPT } from "./prompts.js";

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

export interface ChatTurn {
  role: "user" | "model";
  text: string;
}

// История диалогов держится в памяти: после рестарта бот просто начнёт разговор заново
const histories = new Map<number, ChatTurn[]>();

export function resetHistory(userId: number): void {
  histories.delete(userId);
}

// Запасная модель на случай, если у основной кончилась квота или её отключили
const FALLBACK_MODEL = "gemini-3.5-flash";

/** Квота исчерпана или модель недоступна этому ключу — стоит попробовать запасную */
function isFallbackWorthy(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes("429") ||
    message.includes("RESOURCE_EXHAUSTED") ||
    message.includes("NOT_FOUND") ||
    message.includes("no longer available")
  );
}

export async function askGemini(userId: number, message: string): Promise<string> {
  const history = histories.get(userId) ?? [];
  history.push({ role: "user", text: message });

  const request = (model: string) =>
    ai.models.generateContent({
      model,
      contents: history.map((turn) => ({
        role: turn.role,
        parts: [{ text: turn.text }],
      })),
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.7,
        // У 2.5-pro размышления тратят выходной бюджет — лимит должен быть щедрым,
        // иначе ответ обрежется в пустоту; краткость задаём промптом
        maxOutputTokens: 8192,
      },
    });

  let response;
  try {
    response = await request(config.geminiModel);
  } catch (err) {
    if (config.geminiModel !== FALLBACK_MODEL && isFallbackWorthy(err)) {
      console.warn(`Модель ${config.geminiModel} недоступна (квота/404), пробую ${FALLBACK_MODEL}`);
      response = await request(FALLBACK_MODEL);
    } else {
      history.pop();
      throw err;
    }
  }

  const answer = response.text?.trim();
  if (!answer) {
    // Не сохраняем неудачный обмен, чтобы не засорять контекст
    history.pop();
    throw new Error("Gemini вернул пустой ответ");
  }

  history.push({ role: "model", text: answer });
  // Храним только хвост диалога, чтобы не раздувать запросы
  histories.set(userId, history.slice(-config.historyLength));
  return answer;
}

export interface GeneratedImage {
  image: Buffer;
  caption?: string;
}

export interface BaseArt {
  data: string; // base64
  mimeType: string;
}

export async function drawImage(
  userId: number,
  description: string,
  baseArt?: BaseArt
): Promise<GeneratedImage> {
  const prompt = baseArt
    ? `Это рисунок ребёнка. Используй его как основу и сохрани идею и характер оригинала. Задание: ${description}. ${IMAGE_STYLE_SUFFIX}`
    : `${description}. ${IMAGE_STYLE_SUFFIX}`;

  const parts = baseArt
    ? [{ inlineData: { data: baseArt.data, mimeType: baseArt.mimeType } }, { text: prompt }]
    : [{ text: prompt }];

  const response = await ai.models.generateContent({
    model: config.imageModel,
    contents: [{ role: "user", parts }],
    config: {
      responseModalities: ["IMAGE", "TEXT"],
    },
  });

  let image: Buffer | undefined;
  let caption: string | undefined;
  for (const part of response.candidates?.[0]?.content?.parts ?? []) {
    if (part.inlineData?.data) {
      image = Buffer.from(part.inlineData.data, "base64");
    } else if (part.text) {
      caption = part.text.trim();
    }
  }
  if (!image) {
    throw new Error("Модель не вернула картинку");
  }

  // Кладём факт рисования в историю чата, чтобы Руби помнила, что уже нарисовала
  const history = histories.get(userId) ?? [];
  history.push(
    { role: "user", text: baseArt ? `Нарисуй на основе моего рисунка: ${description}` : `Нарисуй: ${description}` },
    { role: "model", text: `(Нарисовала картинку: ${description})` }
  );
  histories.set(userId, history.slice(-config.historyLength));

  return { image, caption };
}
