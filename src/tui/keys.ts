const RU = 'йцукенгшщзхъфывапролджэячсмитьбюё';
const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const SHIFT_EN = 'QWERTYUIOP{}ASDFGHJKL:"ZXCVBNM<>~';

const shortcuts = new Map(
  [...RU].flatMap((letter, index) => [
    [letter, EN[index]!],
    [letter.toUpperCase(), SHIFT_EN[index]!],
  ]),
);

/** Match a shortcut by keyboard position; text fields and pane input keep their original bytes. */
export function shortcutKey(input: string): string {
  return shortcuts.get(input) ?? input;
}
