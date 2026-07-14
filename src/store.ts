import { readFileSync, writeFileSync } from "node:fs";
import { config } from "./config.js";

export interface UserRecord {
  name: string;
  authorized: boolean;
  day: string; // YYYY-MM-DD, за какой день считаем usedToday
  usedToday: number;
  totalMessages: number;
}

type Users = Record<string, UserRecord>;

let users: Users = {};

try {
  users = JSON.parse(readFileSync(config.usersFile, "utf8")) as Users;
} catch {
  // файла ещё нет — начинаем с пустого списка
}

function save(): void {
  try {
    writeFileSync(config.usersFile, JSON.stringify(users, null, 2));
  } catch (err) {
    console.error("Не удалось сохранить users.json:", err);
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getUser(id: number): UserRecord | undefined {
  return users[String(id)];
}

export function authorize(id: number, name: string): void {
  users[String(id)] = {
    name,
    authorized: true,
    day: today(),
    usedToday: 0,
    totalMessages: 0,
  };
  save();
}

/** Пытается списать одно сообщение из дневного лимита. Возвращает false, если лимит исчерпан. */
export function tryConsume(id: number): boolean {
  const user = users[String(id)];
  if (!user) return false;
  if (user.day !== today()) {
    user.day = today();
    user.usedToday = 0;
  }
  if (config.adminId !== id && user.usedToday >= config.dailyLimit) {
    return false;
  }
  user.usedToday += 1;
  user.totalMessages += 1;
  save();
  return true;
}

export function remainingToday(id: number): number {
  const user = users[String(id)];
  if (!user || user.day !== today()) return config.dailyLimit;
  return Math.max(0, config.dailyLimit - user.usedToday);
}

export function allUsers(): Array<[string, UserRecord]> {
  return Object.entries(users);
}
