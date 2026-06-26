/** Port of `app.filters.SkipIngest`. */
export class SkipIngest extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = "SkipIngest";
    this.reason = reason;
  }
}
