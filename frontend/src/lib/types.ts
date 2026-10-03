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

/** A place picked in the admin, e.g. the start of a trip. */
export interface Place {
  name: string;
  lat: number;
  lng: number;
}

/** Where a trip starts and ends; shown on the map and in the tour without photos. */
export interface Trip {
  start: Place | null;
  end: Place | null;
}

export interface Timeline {
  title: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  captionSource: CaptionSource;
  albumComments: TimelineComment[];
  tour: TourSettings;
  /** Missing in timelines from older servers (and the demo before it had one). */
  trip?: Trip;
  assets: TimelineAsset[];
}

export interface TourSettings {
  intervalSeconds: number;
  radiusMeters: number;
  /** 0 = play videos to the end. */
  videoMaxSeconds: number;
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
  tourIntervalSeconds: number;
  tourRadiusMeters: number;
  tourVideoMaxSeconds: number;
  tripStart: Place | null;
  tripEnd: Place | null;
  tripEndSameAsStart: boolean;
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
