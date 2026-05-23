import type { QueryResultRow } from 'pg';
import { query } from '../db/pool.js';
import type { AssetRecord, AssetWithData } from '../types/assets.js';

interface AssetRow extends QueryResultRow {
  id: string;
  owner_user_id: string | null;
  name: string;
  mime: string;
  file: string;
  size: number | string;
  created_at: number | string;
  data?: Buffer | null;
}

function toAsset(row?: AssetRow): AssetRecord | null {
  if (!row) return null;
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    mime: row.mime,
    file: row.file,
    size: Number(row.size || 0),
    createdAt: Number(row.created_at || 0)
  };
}

function toAssetWithData(row?: AssetRow): AssetWithData | null {
  const asset = toAsset(row);
  if (!asset) return null;
  return {
    ...asset,
    data: row?.data || null
  };
}

export async function listAssets(): Promise<AssetRecord[]> {
  const res = await query<AssetRow>('SELECT * FROM assets ORDER BY created_at DESC');
  return res.rows.map(row => toAsset(row)).filter((asset): asset is AssetRecord => Boolean(asset));
}

export async function insertAsset(record: AssetWithData): Promise<void> {
  await query(
    `INSERT INTO assets (id, owner_user_id, name, mime, file, size, created_at, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [record.id, record.ownerUserId, record.name, record.mime, record.file, record.size, record.createdAt, record.data]
  );
}

export async function findAssetById(id: string): Promise<AssetRecord | null> {
  const res = await query<AssetRow>('SELECT * FROM assets WHERE id = $1', [id]);
  return toAsset(res.rows[0]);
}

export async function findAssetWithDataById(id: string): Promise<AssetWithData | null> {
  const res = await query<AssetRow>('SELECT * FROM assets WHERE id = $1', [id]);
  return toAssetWithData(res.rows[0]);
}

export async function deleteAssetById(id: string): Promise<void> {
  await query('DELETE FROM assets WHERE id = $1', [id]);
}
