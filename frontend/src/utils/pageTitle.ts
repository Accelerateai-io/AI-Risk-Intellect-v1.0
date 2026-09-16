/** Product name shown before `|` in `document.title` for every route. */
export const APP_DOCUMENT_TITLE = "AI Risk Intelligence";

/** Sets tab title to `AI Risk Intelligence | <page>` (page-specific part after `|`). */
export function setDocumentPageTitle(pageLabel: string): void {
  const segment = pageLabel.trim() || "Page";
  document.title = `${APP_DOCUMENT_TITLE} | ${segment}`;
}
