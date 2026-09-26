const EXTRA: Record<string, string> = {
  ß: "ss",
  Æ: "AE",
  æ: "ae",
  Ø: "O",
  ø: "o",
  Đ: "D",
  đ: "d",
};

export function transliterate(input: string): string {
  const expanded = Array.from(input, (char) => EXTRA[char] ?? char).join("");
  return expanded.normalize("NFD").replace(/[̀-ͯ]/g, "");
}
