export type CaptionSource = "description" | "firstComment" | "descriptionOrFirstComment" | "none";

export interface TimelineComment {
  author: string;
  text: string;
  createdAt: string;
}

export interface TimelineAsset {
  id: string;
  type: "image" | "video";
  takenAt: string;
  localDateTime: string;
  caption: string | null;
  comments: TimelineComment[];
  lat: number | null;
  lng: number | null;
  width: number | null;
  height: number | null;
  city: string | null;
  country: string | null;
}

export interface Timeline {
  title: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  captionSource: CaptionSource;
  albumComments: TimelineComment[];
  assets: TimelineAsset[];
}

export interface ShareDto {
  id: number;
  albumId: string;
  url: string;
  titleOverride: string | null;
  enabled: boolean;
  expiresAt: string | null;
  expired: boolean;
  hasPassword: boolean;
  captionSource: CaptionSource;
  showComments: boolean;
  createdAt: string;
  createdBy: string | null;
}

export interface AdminAlbum {
  id: string;
  albumName: string;
  description: string | null;
  assetCount: number;
  thumbnailAssetId: string | null;
  startDate: string | null;
  endDate: string | null;
  shares: ShareDto[];
}
