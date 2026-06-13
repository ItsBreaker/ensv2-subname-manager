/**
 * ENSv2 Enhanced Access Control (EAC) role bitmaps — mirrored verbatim from gskril/ens-cli
 * `src/lib/v2.ts` (the booth reference). Each role occupies the low bit of a 4-bit nibble; each
 * role has an admin counterpart (role << 128) authorizing granting/revoking it. Granted per
 * resource via grantRoles(resource, roleBitmap, account).
 */

export const ROLE_REGISTRAR = 1n << 0n; // register / reserve names in a registry
export const ROLE_REGISTER_RESERVED = 1n << 4n;
export const ROLE_SET_PARENT = 1n << 8n;
export const ROLE_UNREGISTER = 1n << 12n; // burn / reclaim a name (basis for revoke)
export const ROLE_RENEW = 1n << 16n;
export const ROLE_SET_SUBREGISTRY = 1n << 20n; // attach a subregistry to a name
export const ROLE_SET_RESOLVER = 1n << 24n; // set a name's resolver
export const ROLE_SET_URI = 1n << 36n;
export const ROLE_UPGRADE = 1n << 124n;

export const ROLE_REGISTRAR_ADMIN = ROLE_REGISTRAR << 128n;
export const ROLE_UNREGISTER_ADMIN = ROLE_UNREGISTER << 128n;
export const ROLE_RENEW_ADMIN = ROLE_RENEW << 128n;
export const ROLE_SET_SUBREGISTRY_ADMIN = ROLE_SET_SUBREGISTRY << 128n;
export const ROLE_SET_RESOLVER_ADMIN = ROLE_SET_RESOLVER << 128n;

/** All roles granted (every 4-bit nibble set) — ALL_ROLES in the contracts. */
export const ALL_ROLES = BigInt(
  "0x1111111111111111111111111111111111111111111111111111111111111111",
);

export const MAX_UINT64 = (1n << 64n) - 1n;

/**
 * Roles granted to a new subname's owner on issue (ens-cli V2_DEFAULT_OWNER_ROLE_BITMAP):
 * they can unregister/renew their name, set its resolver and subregistry, and admin each of those.
 */
export const V2_DEFAULT_OWNER_ROLE_BITMAP =
  ROLE_UNREGISTER |
  ROLE_RENEW |
  ROLE_SET_SUBREGISTRY |
  ROLE_SET_RESOLVER |
  ROLE_UNREGISTER_ADMIN |
  ROLE_RENEW_ADMIN |
  ROLE_SET_SUBREGISTRY_ADMIN |
  ROLE_SET_RESOLVER_ADMIN;

/**
 * EAC "root resource" — the registry-wide resource registrar-level roles (ROLE_REGISTRAR) are
 * checked against. 0 in the current contracts.
 */
export const ROOT_RESOURCE = 0n;
