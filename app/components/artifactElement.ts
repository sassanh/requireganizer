/**
 * DOM id of the element that renders a whole-artifact subject (the
 * description text, a product overview field, ...). Renderers attach it
 * to the artifact's own content wrapper; the change queue scrolls and
 * highlights that element — never the page title.
 */
export function artifactElementId(root: string): string {
  return `artifact-${root}`;
}
