/**
 * ENS contract ABIs, mirrored from the booth reference implementation
 * (gskril/ens-cli `src/lib/contracts.ts`) — the authoritative source for the v2
 * ETHRegistrar commit/reveal flow and the onchain subname calls.
 *
 * Only the fragments our app actually calls are included. `erc20Abi` for the
 * registration payment approval comes from viem directly (see registration.ts).
 *
 * Kept `as const` so viem can infer argument/return types at the call sites.
 */

/** ENSv2 ETHRegistrar (0x8c2E…fFcA). Note: `duration` is uint64; `register` is nonpayable (ERC-20 paid). */
export const ethRegistrarAbi = [
  {
    name: "commit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "commitment", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "register",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "label", type: "string" },
      { name: "owner", type: "address" },
      { name: "secret", type: "bytes32" },
      { name: "subregistry", type: "address" },
      { name: "resolver", type: "address" },
      { name: "duration", type: "uint64" },
      { name: "paymentToken", type: "address" },
      { name: "referrer", type: "bytes32" },
    ],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
  {
    name: "getRegisterPrice",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "label", type: "string" },
      { name: "duration", type: "uint64" },
      { name: "paymentToken", type: "address" },
    ],
    outputs: [
      { name: "base", type: "uint256" },
      { name: "premium", type: "uint256" },
    ],
  },
  {
    name: "isAvailable",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "label", type: "string" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "makeCommitment",
    type: "function",
    stateMutability: "pure",
    inputs: [
      { name: "label", type: "string" },
      { name: "owner", type: "address" },
      { name: "secret", type: "bytes32" },
      { name: "subregistry", type: "address" },
      { name: "resolver", type: "address" },
      { name: "duration", type: "uint64" },
      { name: "referrer", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;

/** VerifiableFactory used to deploy per-account permissioned resolvers (resolverFactory 0xd2A6…6198). */
export const verifiableFactoryAbi = [
  {
    name: "deployProxy",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "implementation", type: "address" },
      { name: "salt", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

/** Per-account permissioned resolver — `initialize` is run via the factory's deployProxy data. */
export const permissionedResolverAbi = [
  {
    name: "initialize",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "admin", type: "address" },
      { name: "roleBitmap", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

/** ENSv1 registry — read parent owner; create subnames on unwrapped parents (onchain fallback). */
export const ensRegistryAbi = [
  {
    name: "owner",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "resolver",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "setResolver",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "resolver", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "setSubnodeRecord",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "label", type: "bytes32" },
      { name: "owner", type: "address" },
      { name: "resolver", type: "address" },
      { name: "ttl", type: "uint64" },
    ],
    outputs: [],
  },
] as const;

/** NameWrapper (0x0635…fCE8) — create subnames on wrapped parents (the proven onchain issuance path). */
export const nameWrapperAbi = [
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "setResolver",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "resolver", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "setSubnodeRecord",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "parentNode", type: "bytes32" },
      { name: "label", type: "string" },
      { name: "owner", type: "address" },
      { name: "resolver", type: "address" },
      { name: "ttl", type: "uint64" },
      { name: "fuses", type: "uint32" },
      { name: "expiry", type: "uint64" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;

/** ENSv2 registry (PermissionedRegistry 0xDEDB…B67) — read state / set resolver on a v2 name. */
export const v2RegistryAbi = [
  {
    name: "getState",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "anyId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "status", type: "uint8" },
          { name: "expiry", type: "uint64" },
          { name: "latestOwner", type: "address" },
          { name: "tokenId", type: "uint256" },
          { name: "resource", type: "uint256" },
        ],
      },
    ],
  },
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "setResolver",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "anyId", type: "uint256" },
      { name: "resolver", type: "address" },
    ],
    outputs: [],
  },
] as const;

/**
 * ENSv2 PermissionedRegistry interface used for onchain subname issuance. Mirrored from
 * ensdomains/namechain (contracts-v2): IStandardRegistry, IRegistry, IEnhancedAccessControl.
 *
 * The `.eth` registry (CONTRACTS.PermissionedRegistry) holds 2LDs; each 2LD points at its own
 * subregistry (a UserRegistry) via setSubregistry, and subnames are minted by calling register()
 * on that subregistry. Note the asymmetry: getters take the child `label` (string), setters take
 * `anyId` (uint256 = labelhash(label)).
 */
export const permissionedRegistryAbi = [
  {
    name: "register",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "label", type: "string" },
      { name: "owner", type: "address" },
      { name: "registry", type: "address" }, // the subname's OWN subregistry (0 if none)
      { name: "resolver", type: "address" },
      { name: "roleBitmap", type: "uint256" },
      { name: "expiry", type: "uint64" },
    ],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
  {
    name: "setSubregistry",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "anyId", type: "uint256" },
      { name: "registry", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "setResolver",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "anyId", type: "uint256" },
      { name: "resolver", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "getSubregistry",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "label", type: "string" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "getResolver",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "label", type: "string" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "getState",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "anyId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "status", type: "uint8" },
          { name: "expiry", type: "uint64" },
          { name: "latestOwner", type: "address" },
          { name: "tokenId", type: "uint256" },
          { name: "resource", type: "uint256" },
        ],
      },
    ],
  },
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  // EnhancedAccessControl — the org-delegation primitive (grant a manager ROLE_REGISTRAR).
  {
    name: "grantRoles",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "resource", type: "uint256" },
      { name: "roleBitmap", type: "uint256" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "hasRoles",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "resource", type: "uint256" },
      { name: "roleBitmap", type: "uint256" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  // UserRegistry proxy initializer (called via VerifiableFactory.deployProxy data).
  {
    name: "initialize",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "admin", type: "address" },
      { name: "roleBitmap", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

/**
 * Resolver records interface — unchanged between ENS v1 and v2 (architecture doc interop note), so
 * the same setAddr/setText/multicall work on the v2 per-account (Owned/Permissioned) resolver.
 * Keyed by `node` = namehash(name). Mirrors ens-cli `publicResolverAbi`, plus read getters.
 */
export const publicResolverAbi = [
  {
    name: "addr",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "text",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
    ],
    outputs: [{ name: "", type: "string" }],
  },
  {
    name: "setAddr",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "a", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "setText",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
      { name: "value", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "multicall",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "data", type: "bytes[]" }],
    outputs: [{ name: "", type: "bytes[]" }],
  },
] as const;
