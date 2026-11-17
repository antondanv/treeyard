/**
 * A node's title is what the person reads in a tree row: the gist in a few words.
 * Everything else lives in "done when" and the description. Agents drift into
 * titles that are whole paragraphs, so `add` points at `--note` past this length.
 */
export const TITLE_LIMIT = 60;

export function isLongTitle(title: string): boolean {
  return [...title.trim()].length > TITLE_LIMIT;
}
