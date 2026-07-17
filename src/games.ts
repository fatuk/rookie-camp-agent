// Текущий файл игры каждого ученика. Живёт в памяти: при рестарте сервиса
// игра забудется, но у ученика всегда остаётся скачанный code.html.
const games = new Map<number, string>();

export function getGame(userId: number): string | undefined {
  return games.get(userId);
}

export function setGame(userId: number, html: string): void {
  games.set(userId, html);
}

export function clearGame(userId: number): void {
  games.delete(userId);
}
