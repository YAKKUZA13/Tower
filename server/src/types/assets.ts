export interface AssetRecord {
  id: string;
  ownerUserId: string | null;
  name: string;
  mime: string;
  file: string;
  size: number;
  createdAt: number;
}

export interface AssetWithData extends AssetRecord {
  data: Buffer | null;
}
