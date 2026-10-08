// Replaces a crawled paginated list (/blog/, /blog/?page=2, …) with pages
// generated from the migrated content, so the list never goes stale.
//
// Adapt: the query, the page size (items on the original first page, from
// hints.json), the URL scheme (keep it in sync with "urls" in rules.json so
// links to the old ?page=N addresses land here), and the layout.

export const layout = "layouts/list.vto";
export const title = "Blog";

export default function* ({ search, paginate }: Lume.Data) {
  const posts = search.pages("type=post", "date=desc");

  for (
    const page of paginate(posts, {
      url: (n: number) => n === 1 ? "/blog/" : `/blog/${n}/`,
      size: 10,
    })
  ) {
    yield page;
  }
}
