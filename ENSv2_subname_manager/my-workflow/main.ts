import {
  cre,
  Runner,
  consensusIdenticalAggregation,
  getNetwork,
  hexToBase64,
  type CronPayload,
  type HTTPSendRequester,
  type Runtime,
} from "@chainlink/cre-sdk";
import { encodeAbiParameters, keccak256, parseAbiParameters, stringToBytes } from "viem";
import type { Config } from "./types/types";

const TXT_PREFIX = "ens-subname-verify";

/**
 * Per-node compute: fetch the domain's TXT records over DNS-over-HTTPS and check whether our
 * challenge token is present. Returns a boolean; consensus is taken across the DON.
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

const onCronTrigger = (runtime: Runtime<Config>, _payload: CronPayload): string => {
  const { domain, token, evms } = runtime.config;

  // 1. Fetch the TXT across the DON and reach consensus on the boolean result.
  const httpClient = new cre.capabilities.HTTPClient();
  const verified = httpClient
    .sendRequest(runtime, checkDomainTxt, consensusIdenticalAggregation<boolean>())(domain, token)
    .result();

  runtime.log(`domain=${domain} verified=${verified}`);

  // 2. Write the verified result on-chain to DomainVerifier.
  const evm = evms[0];
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: evm.chainName });
  if (!network) throw new Error(`Unknown chain selector name: ${evm.chainName}`);
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector);

  const domainHash = keccak256(stringToBytes(domain.toLowerCase()));
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
  const cron = new cre.capabilities.CronCapability();
  return [cre.handler(cron.trigger({ schedule: config.schedule }), onCronTrigger)];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}

main();
