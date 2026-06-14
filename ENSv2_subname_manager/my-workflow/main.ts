import {
  cre,
  Runner,
  consensusIdenticalAggregation,
  decodeJson,
  getNetwork,
  hexToBase64,
  type HTTPPayload,
  type HTTPSendRequester,
  type Runtime,
} from "@chainlink/cre-sdk";
import { encodeAbiParameters, keccak256, parseAbiParameters, stringToBytes } from "viem";
import type { Config } from "./types/types";

const TXT_PREFIX = "ens-subname-verify";

/** The per-request inputs, supplied dynamically in the HTTP trigger body. */
type VerifyInput = {
  /** Any domain the caller controls, e.g. "acme.com". */
  domain: string;
  /** The challenge token issued by /api/admin/verify/start for that domain. */
  token: string;
};

/**
 * Per-node compute: fetch the domain's TXT records over DNS-over-HTTPS and check whether our
 * challenge token is present. Returns a boolean; consensus is taken across the DON. The domain and
 * token are threaded in from the request payload (NOT baked into config), so this verifies any
 * caller's domain.
 */
const checkDomainTxt = (sendRequester: HTTPSendRequester, domain: string, token: string): boolean => {
  const resp = sendRequester
    .sendRequest({
      url: `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=TXT`,
      method: "GET",
    })
    .result();

  const text = new TextDecoder().decode(resp.body);
  const json = JSON.parse(text) as { Answer?: { data?: string }[] };
  const expected = `${TXT_PREFIX}=${token}`;
  return (json.Answer ?? []).some(
    (a) => typeof a.data === "string" && a.data.replace(/"/g, "").trim() === expected,
  );
};

const onHttpTrigger = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
  // 0. Read the domain + token from the request body (dynamic, per caller).
  const input = decodeJson(payload.input) as Partial<VerifyInput>;
  const domain = input.domain?.toLowerCase().trim();
  const token = input.token?.trim();
  if (!domain || !token) {
    throw new Error('HTTP trigger body must be {"domain": "...", "token": "..."}');
  }

  // 1. Fetch the TXT across the DON and reach consensus on the boolean result.
  const httpClient = new cre.capabilities.HTTPClient();
  const verified = httpClient
    .sendRequest(runtime, checkDomainTxt, consensusIdenticalAggregation<boolean>())(domain, token)
    .result();

  runtime.log(`domain=${domain} verified=${verified}`);

  // 2. Write the verified result on-chain to DomainVerifier (keyed by keccak256(domain)).
  const evm = runtime.config.evms[0];
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: evm.chainName });
  if (!network) throw new Error(`Unknown chain selector name: ${evm.chainName}`);
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector);

  const domainHash = keccak256(stringToBytes(domain));
  const reportData = encodeAbiParameters(parseAbiParameters("bytes32 domainHash, bool verified"), [
    domainHash,
    verified,
  ]);

  const report = runtime
    .report({
      encodedPayload: hexToBase64(reportData),
      encoderName: "evm",
      signingAlgo: "ecdsa",
      hashingAlgo: "keccak256",
    })
    .result();

  evmClient
    .writeReport(runtime, {
      receiver: evm.verifierAddress,
      report,
      gasConfig: { gasLimit: evm.gasLimit },
    })
    .result();

  return `domain=${domain} verified=${verified}`;
};

const initWorkflow = (config: Config) => {
  // HTTP trigger: the workflow is invoked per-verification with a {domain, token} body. authorizedKeys
  // gates who may invoke a DEPLOYED workflow (the backend signer's EVM address); empty is fine for
  // `cre workflow simulate`.
  const http = new cre.capabilities.HTTPCapability();
  return [cre.handler(http.trigger({ authorizedKeys: config.authorizedKeys ?? [] }), onHttpTrigger)];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}

main();
