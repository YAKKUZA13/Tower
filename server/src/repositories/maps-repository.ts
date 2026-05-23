import type { QueryResultRow } from 'pg';
import { query } from '../db/pool.js';
import type { MapDocument } from '../types/map.js';

interface MapRow extends QueryResultRow {
  document: MapDocument;
}

export async function readMapDocument(ownerId: string): Promise<MapDocument | null> {
  const res = await query<MapRow>('SELECT document FROM maps WHERE owner_id = $1', [ownerId]);
  return res.rows[0]?.document || null;
}

export async function writeMapDocument(ownerId: string, document: MapDocument): Promise<void> {
  const now = Date.now();
  await query(
    `INSERT INTO maps (owner_id, document, version, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'draft', $4, $5)
     ON CONFLICT (owner_id)
     DO UPDATE SET document = EXCLUDED.document, version = EXCLUDED.version, updated_at = EXCLUDED.updated_at`,
    [ownerId, document, Number(document.version || 1), now, now]
  );
}
