export function getScrollBehavior(
  prefersReducedMotion: boolean,
): ScrollBehavior {
  return prefersReducedMotion ? "auto" : "smooth";
}

export function isDocumentEnd(
  scrollY: number,
  viewportHeight: number,
  documentHeight: number,
  tolerance = 2,
): boolean {
  return documentHeight - viewportHeight - scrollY <= tolerance;
}
