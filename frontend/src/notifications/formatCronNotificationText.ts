/** User-facing notification copy uses CRON instead of cron. */
export function formatCronNotificationText(text: string): string {
  return text.replace(/\bcron\b/gi, "CRON");
}
