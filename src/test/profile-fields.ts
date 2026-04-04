/**
 * Profile field key constants matching the frontend domain profile system.
 */

// Base Profile Fields
export const FIELD_NAME = "name";
export const FIELD_BIO = "bio";
export const FIELD_AVATAR = "avatar";
export const FIELD_WEBSITE = "website";
export const FIELD_TWITTER = "twitter";
export const FIELD_GITHUB = "github";

// System / Auto-populated Fields
export const FIELD_PROFILE_TYPE = "profile_type";
export const FIELD_EPK = "epk";

// Social Platforms
export const FIELD_DISCORD = "discord";
export const FIELD_DISCORD_ID = "discord_id";
export const FIELD_DISCORD_VERIFY = "discord_verify";
export const FIELD_TELEGRAM = "telegram";
export const FIELD_TWITCH = "twitch";
export const FIELD_YOUTUBE = "youtube";
export const FIELD_INSTAGRAM = "instagram";
export const FIELD_TIKTOK = "tiktok";
export const FIELD_EMAIL = "email";

// Extended Profile Fields
export const FIELD_TICKER = "ticker";
export const FIELD_LOCATION = "location";
export const FIELD_PLATFORM = "platform";
export const FIELD_BANNER = "banner";
export const FIELD_DESCRIPTION = "description";

// Profile Types
export type ProfileType = "personal" | "dao" | "company" | "game" | "creator";

export const PROFILE_TYPES: readonly ProfileType[] = [
  "personal",
  "dao",
  "company",
  "game",
  "creator",
] as const;

// Helpers

export function personalFields(opts: {
  name: string;
  bio?: string;
  avatar?: string;
  website?: string;
  twitter?: string;
  github?: string;
  email?: string;
  telegram?: string;
}, extra?: [string, string][]): [string, string][] {
  return buildFields({ ...opts, [FIELD_PROFILE_TYPE]: "personal" }, extra);
}

export function daoFields(opts: {
  name: string;
  bio?: string;
  avatar?: string;
  website?: string;
  twitter?: string;
  github?: string;
  ticker?: string;
  discord?: string;
}, extra?: [string, string][]): [string, string][] {
  return buildFields({ ...opts, [FIELD_PROFILE_TYPE]: "dao" }, extra);
}

export function companyFields(opts: {
  name: string;
  bio?: string;
  avatar?: string;
  website?: string;
  twitter?: string;
  github?: string;
  email?: string;
  location?: string;
}, extra?: [string, string][]): [string, string][] {
  return buildFields({ ...opts, [FIELD_PROFILE_TYPE]: "company" }, extra);
}

export function gameFields(opts: {
  name: string;
  bio?: string;
  avatar?: string;
  website?: string;
  twitter?: string;
  github?: string;
  platform?: string;
  discord?: string;
  twitch?: string;
}, extra?: [string, string][]): [string, string][] {
  return buildFields({ ...opts, [FIELD_PROFILE_TYPE]: "game" }, extra);
}

export function creatorFields(opts: {
  name: string;
  bio?: string;
  avatar?: string;
  website?: string;
  twitter?: string;
  github?: string;
  youtube?: string;
  instagram?: string;
  tiktok?: string;
}, extra?: [string, string][]): [string, string][] {
  return buildFields({ ...opts, [FIELD_PROFILE_TYPE]: "creator" }, extra);
}

function buildFields(
  record: Record<string, string | undefined>,
  extra?: [string, string][],
): [string, string][] {
  const fields: [string, string][] = [];
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined && value !== "") {
      fields.push([key, value]);
    }
  }
  if (extra) {
    for (const pair of extra) {
      fields.push(pair);
    }
  }
  return fields;
}
