import { and, count, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "../../db/index.js";
import { ingestLinkItems } from "../../schema/ingestLinks/ingestLinkItems.js";
import { ingestLinks } from "../../schema/ingestLinks/ingestLinks.js";
import { HttpError } from "../../utils/httpError.js";
import {
  normalizeUrl,
  validateUrl,
  validateUrlBasic,
  UrlFetchError,
} from "../../utils/fetchUtils.js";
import { parseFeedItemLinks } from "./parseFeedItemLinks.js";

export type IngestLinkDto = {
  id: number;
  url: string;
  suggestedName: string | null;
  archived: boolean;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
};

export type IngestLinkItemDto = {
  id: number;
  ingestLinkId: number;
  url: string;
  createdAt: string;
};

function mapUrlFetchError(err: UrlFetchError): HttpError {
  switch (err.code) {
    case "INVALID_URL":
      return HttpError.badRequest(err.message);
    case "SSRF_BLOCKED":
    case "DNS_FAILED":
      return HttpError.forbidden(err.message);
    case "NOT_FOUND":
      return HttpError.notFound(err.message);
    case "UNREACHABLE":
      return HttpError.serviceUnavailable(err.message);
    default:
      return HttpError.badRequest(err.message);
  }
}

/** RSS feeds only: try SSRF/DNS validation, then fall back to format-only checks. */
async function validateIngestLinkUrl(normalized: string): Promise<void> {
  try {
    await validateUrl(normalized);
  } catch (err) {
    if (
      err instanceof UrlFetchError &&
      (err.code === "SSRF_BLOCKED" || err.code === "DNS_FAILED")
    ) {
      try {
        await validateUrlBasic(normalized);
      } catch (basicErr) {
        if (basicErr instanceof UrlFetchError) throw mapUrlFetchError(basicErr);
        throw basicErr;
      }
      return;
    }
    if (err instanceof UrlFetchError) throw mapUrlFetchError(err);
    throw err;
  }
}

async function resolveUrl(rawUrl: string): Promise<string> {
  let normalized: string;
  try {
    normalized = normalizeUrl(rawUrl);
  } catch {
    throw HttpError.badRequest("URL is not valid.");
  }

  await validateIngestLinkUrl(normalized);

  return normalized;
}

async function findIngestLinkByUrl(
  tx: Pick<typeof db, "select">,
  url: string,
) {
  const [row] = await tx
    .select()
    .from(ingestLinks)
    .where(eq(ingestLinks.url, url))
    .limit(1);
  return row ?? null;
}

function toDto(
  row: typeof ingestLinks.$inferSelect,
  itemCount = 0,
): IngestLinkDto {
  return {
    id: row.id,
    url: row.url,
    suggestedName: row.suggestedName ?? null,
    archived: row.archived,
    itemCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toItemDto(row: typeof ingestLinkItems.$inferSelect): IngestLinkItemDto {
  return {
    id: row.id,
    ingestLinkId: row.ingestLinkId,
    url: row.url,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listIngestLinks(): Promise<IngestLinkDto[]> {
  const rows = await db
    .select({
      link: ingestLinks,
      itemCount: count(ingestLinkItems.id),
    })
    .from(ingestLinks)
    .leftJoin(
      ingestLinkItems,
      eq(ingestLinkItems.ingestLinkId, ingestLinks.id),
    )
    .groupBy(ingestLinks.id)
    .orderBy(ingestLinks.archived, desc(ingestLinks.createdAt));

  return rows.map((r) => toDto(r.link, Number(r.itemCount)));
}

export async function listActiveIngestLinks(): Promise<IngestLinkDto[]> {
  const rows = await db
    .select({
      link: ingestLinks,
      itemCount: count(ingestLinkItems.id),
    })
    .from(ingestLinks)
    .leftJoin(
      ingestLinkItems,
      eq(ingestLinkItems.ingestLinkId, ingestLinks.id),
    )
    .where(eq(ingestLinks.archived, false))
    .groupBy(ingestLinks.id)
    .orderBy(desc(ingestLinks.createdAt));

  return rows.map((r) => toDto(r.link, Number(r.itemCount)));
}

async function queryActiveIngestLinksByIds(ids: number[]) {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return [];

  const rows = await db
    .select({
      link: ingestLinks,
      itemCount: count(ingestLinkItems.id),
    })
    .from(ingestLinks)
    .leftJoin(
      ingestLinkItems,
      eq(ingestLinkItems.ingestLinkId, ingestLinks.id),
    )
    .where(
      and(eq(ingestLinks.archived, false), inArray(ingestLinks.id, uniqueIds)),
    )
    .groupBy(ingestLinks.id);

  const byId = new Map(rows.map((r) => [r.link.id, r]));
  return uniqueIds
    .filter((id) => byId.has(id))
    .map((id) => {
      const row = byId.get(id)!;
      return toDto(row.link, Number(row.itemCount));
    });
}

/** Return active ingest links for the given IDs, omitting missing or archived feeds. */
export async function filterActiveIngestLinksByIds(
  ids: number[],
): Promise<IngestLinkDto[]> {
  return queryActiveIngestLinksByIds(ids);
}

/** Resolve active ingest links by ID (throws if any ID is missing or archived). */
export async function resolveActiveIngestLinksByIds(
  ids: number[],
): Promise<IngestLinkDto[]> {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) {
    throw HttpError.badRequest("Select at least one feed to run.");
  }

  const links = await queryActiveIngestLinksByIds(uniqueIds);
  if (links.length !== uniqueIds.length) {
    const foundIds = new Set(links.map((link) => link.id));
    const missing = uniqueIds.filter((id) => !foundIds.has(id));
    throw HttpError.badRequest(
      `One or more selected feeds were not found (IDs: ${missing.join(", ")}). Re-select feeds and save again.`,
    );
  }

  return links;
}

/**
 * Item URLs stored by Extract, grouped by parent feed ID.
 * Only includes items for active (non-archived) feeds.
 */
export type ExtractedItemRef = {
  id: number;
  ingestLinkId: number;
  url: string;
};

/** Resolve extracted item refs by selected item IDs on active (non-archived) feeds. */
export async function resolveExtractedItemRefsByIds(
  itemIds: number[],
): Promise<ExtractedItemRef[]> {
  const uniqueIds = [...new Set(itemIds)];
  if (uniqueIds.length === 0) {
    throw HttpError.badRequest("Select at least one extracted URL to run.");
  }

  const rows = await db
    .select({
      id: ingestLinkItems.id,
      ingestLinkId: ingestLinkItems.ingestLinkId,
      url: ingestLinkItems.url,
    })
    .from(ingestLinkItems)
    .innerJoin(ingestLinks, eq(ingestLinks.id, ingestLinkItems.ingestLinkId))
    .where(
      and(
        eq(ingestLinks.archived, false),
        inArray(ingestLinkItems.id, uniqueIds),
      ),
    );

  if (rows.length !== uniqueIds.length) {
    throw HttpError.badRequest(
      "One or more selected extracted URLs were not found.",
    );
  }

  const normalizedById = new Map<number, ExtractedItemRef>();
  for (const row of rows) {
    try {
      normalizedById.set(row.id, {
        id: row.id,
        ingestLinkId: row.ingestLinkId,
        url: normalizeUrl(row.url),
      });
    } catch {
      // skip invalid stored URLs
    }
  }

  const refs = uniqueIds
    .map((id) => normalizedById.get(id))
    .filter((row): row is ExtractedItemRef => Boolean(row));

  if (refs.length === 0) {
    throw HttpError.badRequest("Selected extracted URLs are invalid.");
  }

  return refs;
}

export async function getExtractedItemRefsByIngestLinkIds(
  ids: number[],
): Promise<ExtractedItemRef[]> {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return [];

  const rows = await db
    .select({
      id: ingestLinkItems.id,
      ingestLinkId: ingestLinkItems.ingestLinkId,
      url: ingestLinkItems.url,
    })
    .from(ingestLinkItems)
    .innerJoin(ingestLinks, eq(ingestLinks.id, ingestLinkItems.ingestLinkId))
    .where(
      and(
        eq(ingestLinks.archived, false),
        inArray(ingestLinkItems.ingestLinkId, uniqueIds),
      ),
    );

  const refs: ExtractedItemRef[] = [];
  for (const row of rows) {
    try {
      refs.push({
        id: row.id,
        ingestLinkId: row.ingestLinkId,
        url: normalizeUrl(row.url),
      });
    } catch {
      // skip invalid stored URLs
    }
  }
  return refs;
}

/** @deprecated Use {@link getExtractedItemRefsByIngestLinkIds}. */
export async function getExtractedItemUrlsByIngestLinkIds(
  ids: number[],
): Promise<Map<number, string[]>> {
  const refs = await getExtractedItemRefsByIngestLinkIds(ids);
  const map = new Map<number, string[]>();
  for (const id of [...new Set(ids)]) {
    map.set(id, []);
  }
  for (const ref of refs) {
    const bucket = map.get(ref.ingestLinkId) ?? [];
    if (!bucket.includes(ref.url)) {
      bucket.push(ref.url);
    }
    map.set(ref.ingestLinkId, bucket);
  }
  return map;
}

export async function listIngestLinkItems(
  ingestLinkId: number,
): Promise<IngestLinkItemDto[]> {
  const [parent] = await db
    .select({ id: ingestLinks.id })
    .from(ingestLinks)
    .where(
      and(eq(ingestLinks.id, ingestLinkId), eq(ingestLinks.archived, false)),
    )
    .limit(1);

  if (!parent) {
    throw HttpError.notFound("Ingest link not found.");
  }

  const rows = await db
    .select()
    .from(ingestLinkItems)
    .where(eq(ingestLinkItems.ingestLinkId, ingestLinkId))
    .orderBy(desc(ingestLinkItems.createdAt));

  return rows.map(toItemDto);
}

export type CreateIngestLinkResult = {
  link: IngestLinkDto;
};

/** Save URL to ingest_links only — use Extract to parse feed XML item links. */
export async function createIngestLink(
  rawUrl: string,
  suggestedName?: string,
): Promise<CreateIngestLinkResult> {
  const normalized = await resolveUrl(rawUrl);
  const normalizedSuggestedName = suggestedName?.trim() || null;

  return db.transaction(async (tx) => {
    const existing = await findIngestLinkByUrl(tx, normalized);

    if (existing) {
      if (existing.archived) {
        throw HttpError.conflict(
          "This URL is archived. Restore it from the RSS feeds table instead of adding it again.",
        );
      }

      throw HttpError.conflict("This URL is already present.");
    }

    const [link] = await tx
      .insert(ingestLinks)
      .values({ url: normalized, suggestedName: normalizedSuggestedName })
      .returning();

    if (!link) {
      throw HttpError.internal("Could not save ingest link.");
    }

    return { link: toDto(link, 0) };
  });
}

export async function updateIngestLink(
  id: number,
  rawUrl: string,
  suggestedName?: string,
): Promise<IngestLinkDto> {
  const normalized = await resolveUrl(rawUrl);
  const normalizedSuggestedName = suggestedName?.trim() || null;

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(ingestLinks)
      .where(and(eq(ingestLinks.id, id), eq(ingestLinks.archived, false)))
      .limit(1);

    if (!current) {
      throw HttpError.notFound("Ingest link not found.");
    }

    if (current.url === normalized) {
      const [updatedCurrent] = await tx
        .update(ingestLinks)
        .set({ suggestedName: normalizedSuggestedName, updatedAt: new Date() })
        .where(eq(ingestLinks.id, id))
        .returning();

      const [countRow] = await tx
        .select({ itemCount: count(ingestLinkItems.id) })
        .from(ingestLinkItems)
        .where(eq(ingestLinkItems.ingestLinkId, id));
      return toDto(updatedCurrent ?? current, Number(countRow?.itemCount ?? 0));
    }

    const [duplicate] = await tx
      .select({ id: ingestLinks.id })
      .from(ingestLinks)
      .where(and(eq(ingestLinks.url, normalized), ne(ingestLinks.id, id)))
      .limit(1);

    if (duplicate) {
      throw HttpError.conflict("This URL is already in use.");
    }

    const [updated] = await tx
      .update(ingestLinks)
      .set({
        url: normalized,
        suggestedName: normalizedSuggestedName,
        updatedAt: new Date(),
      })
      .where(eq(ingestLinks.id, id))
      .returning();

    if (!updated) {
      throw HttpError.notFound("Ingest link not found.");
    }

    const [countRow] = await tx
      .select({ itemCount: count(ingestLinkItems.id) })
      .from(ingestLinkItems)
      .where(eq(ingestLinkItems.ingestLinkId, id));

    return toDto(updated, Number(countRow?.itemCount ?? 0));
  });
}

export type ExtractIngestLinkResult = {
  link: IngestLinkDto;
  discovered: number;
  inserted: number;
  skipped: number;
  items: IngestLinkItemDto[];
};

/** Parse feed XML at the ingest URL and store unique item links for this feed. */
export async function extractIngestLink(
  id: number,
): Promise<ExtractIngestLinkResult> {
  const [current] = await db
    .select()
    .from(ingestLinks)
    .where(and(eq(ingestLinks.id, id), eq(ingestLinks.archived, false)))
    .limit(1);

  if (!current) {
    throw HttpError.notFound("Ingest link not found.");
  }

  await validateIngestLinkUrl(current.url);

  let itemUrls: string[];
  try {
    itemUrls = await parseFeedItemLinks(current.url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw HttpError.badRequest(
      `Could not parse feed XML: ${message}`,
    );
  }

  const discovered = itemUrls.length;

  if (discovered === 0) {
    return {
      link: toDto(current, 0),
      discovered: 0,
      inserted: 0,
      skipped: 0,
      items: [],
    };
  }

  const existingRows = await db
    .select({ url: ingestLinkItems.url })
    .from(ingestLinkItems)
    .where(
      and(
        eq(ingestLinkItems.ingestLinkId, id),
        inArray(ingestLinkItems.url, itemUrls),
      ),
    );

  const existingSet = new Set(existingRows.map((row) => row.url));
  const newItemUrls = itemUrls.filter((url) => !existingSet.has(url));

  const insertedRows =
    newItemUrls.length === 0
      ? []
      : await db
          .insert(ingestLinkItems)
          .values(newItemUrls.map((url) => ({ ingestLinkId: id, url })))
          .onConflictDoNothing({
            target: [ingestLinkItems.ingestLinkId, ingestLinkItems.url],
          })
          .returning();

  const inserted = insertedRows.length;
  const skipped = discovered - inserted;

  const [countRow] = await db
    .select({ itemCount: count(ingestLinkItems.id) })
    .from(ingestLinkItems)
    .where(eq(ingestLinkItems.ingestLinkId, id));

  return {
    link: toDto(current, Number(countRow?.itemCount ?? 0)),
    discovered,
    inserted,
    skipped,
    items: insertedRows.map(toItemDto),
  };
}

export async function archiveIngestLink(id: number): Promise<IngestLinkDto> {
  const [updated] = await db
    .update(ingestLinks)
    .set({ archived: true, updatedAt: new Date() })
    .where(and(eq(ingestLinks.id, id), eq(ingestLinks.archived, false)))
    .returning();

  if (!updated) {
    throw HttpError.notFound("Ingest link not found.");
  }

  const [countRow] = await db
    .select({ itemCount: count(ingestLinkItems.id) })
    .from(ingestLinkItems)
    .where(eq(ingestLinkItems.ingestLinkId, id));

  return toDto(updated, Number(countRow?.itemCount ?? 0));
}

export async function restoreIngestLink(id: number): Promise<IngestLinkDto> {
  const [updated] = await db
    .update(ingestLinks)
    .set({ archived: false, updatedAt: new Date() })
    .where(and(eq(ingestLinks.id, id), eq(ingestLinks.archived, true)))
    .returning();

  if (!updated) {
    throw HttpError.notFound("Archived ingest link not found.");
  }

  const [countRow] = await db
    .select({ itemCount: count(ingestLinkItems.id) })
    .from(ingestLinkItems)
    .where(eq(ingestLinkItems.ingestLinkId, id));

  return toDto(updated, Number(countRow?.itemCount ?? 0));
}
