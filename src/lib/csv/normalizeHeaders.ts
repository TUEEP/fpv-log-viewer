export function normalizeHeaders(headers: string[]): string[] {
  const counts = new Map<string, number>();

  return headers.map((rawHeader) => {
    const header = rawHeader.trim();
    const count = (counts.get(header) ?? 0) + 1;
    counts.set(header, count);
    return count === 1 ? header : `${header}#${count}`;
  });
}
