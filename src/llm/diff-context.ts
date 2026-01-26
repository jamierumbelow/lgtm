export function trimHunkContent(
  content: string,
  contextLines = 1
): string {
  const lines = content.split("\n");
  const changeIndexes = lines
    .map((line, index) => (line.startsWith("+") || line.startsWith("-") ? index : -1))
    .filter((index) => index >= 0);

  if (changeIndexes.length === 0) {
    return content;
  }

  const ranges: Array<[number, number]> = [];
  for (const index of changeIndexes) {
    const start = Math.max(0, index - contextLines);
    const end = Math.min(lines.length - 1, index + contextLines);
    ranges.push([start, end]);
  }

  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (!last || range[0] > last[1] + 1) {
      merged.push(range);
    } else {
      last[1] = Math.max(last[1], range[1]);
    }
  }

  const output: string[] = [];
  merged.forEach(([start, end], index) => {
    if (index > 0) {
      output.push("...");
    }
    for (let i = start; i <= end; i += 1) {
      output.push(lines[i]);
    }
  });

  return output.join("\n");
}
