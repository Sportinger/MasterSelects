// Heading ids as Starlight makes them (github-slugger rules): lower case, every character that is
// not a letter, mark, decimal or letter number, connector punctuation, hyphen or space removed,
// spaces turned into hyphens, repeats numbered -1, -2, …. Written out here so the sync and its
// unit test need no package outside docs-site.

const REMOVED = /[^\p{L}\p{M}\p{Nd}\p{Nl}\p{Pc}\- ]/gu;

export const slug = (value) => value.toLowerCase().replace(REMOVED, '').replace(/ /gu, '-');

/** Slugs that stay unique within one page, like github-slugger's BananaSlug. */
export class Slugger {
  #seen = new Map();

  slug(value) {
    const base = slug(value);
    let result = base;
    while (this.#seen.has(result)) {
      const count = this.#seen.get(base) + 1;
      this.#seen.set(base, count);
      result = `${base}-${count}`;
    }
    this.#seen.set(result, 0);
    return result;
  }
}
