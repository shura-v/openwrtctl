import { z } from "zod";

const FIELD_MESSAGES = {
  querylogInterval: "must be a positive number of hours or days",
  webPort: "must be an integer from 1 to 65535",
  dnsPort: "must be an integer from 1 to 65535",
  upstreamDns: "must be a non-empty list of non-empty strings",
  bootstrapDns: "must be a list of non-empty strings",
  upstreamMode: "must be load_balance, parallel, or fastest_addr",
  rateLimit: "must be a non-negative integer",
  rateLimitSubnetLenIpv4: "must be an integer from 0 to 32",
  rateLimitSubnetLenIpv6: "must be an integer from 0 to 128",
  rateLimitWhitelist: "must be a list of non-empty strings",
  ednsClientSubnet: "must be a boolean"
};

const CLI_FIELD_NAMES = {
  querylogInterval: "ADGUARD_QUERYLOG_INTERVAL",
  webPort: "ADGUARD_WEB_PORT",
  dnsPort: "ADGUARD_DNS_PORT",
  upstreamDns: "ADGUARD_UPSTREAM_DNS",
  bootstrapDns: "ADGUARD_BOOTSTRAP_DNS",
  upstreamMode: "ADGUARD_UPSTREAM_MODE",
  rateLimit: "ADGUARD_RATE_LIMIT",
  rateLimitSubnetLenIpv4: "ADGUARD_RATE_LIMIT_SUBNET_LEN_IPV4",
  rateLimitSubnetLenIpv6: "ADGUARD_RATE_LIMIT_SUBNET_LEN_IPV6",
  rateLimitWhitelist: "ADGUARD_RATE_LIMIT_WHITELIST",
  ednsClientSubnet: "ADGUARD_EDNS_CLIENT_SUBNET"
};

const nonEmptyStrings = z.array(z.string()).refine(
  (values) => values.every((value) => value.trim().length > 0)
);

const port = z.number().refine(
  (value) => Number.isInteger(value) && value >= 1 && value <= 65535
);

const nonNegativeInteger = z.number().refine(
  (value) => Number.isInteger(value) && value >= 0
);

function integerRange(minimum, maximum) {
  return z.number().refine(
    (value) => Number.isInteger(value) && value >= minimum && value <= maximum
  );
}

export const adguardSettingsSchema = z.strictObject({
  querylogInterval: z.string().regex(/^[1-9]\d*(?:h|d)$/u).default("6h"),
  webPort: port,
  dnsPort: port,
  upstreamDns: nonEmptyStrings.refine((values) => values.length > 0),
  bootstrapDns: nonEmptyStrings.default(() => []),
  upstreamMode: z.enum(["load_balance", "parallel", "fastest_addr"]).default("load_balance"),
  rateLimit: nonNegativeInteger.default(0),
  rateLimitSubnetLenIpv4: integerRange(0, 32).default(24),
  rateLimitSubnetLenIpv6: integerRange(0, 128).default(56),
  rateLimitWhitelist: nonEmptyStrings.default(() => []),
  ednsClientSubnet: z.boolean().default(false)
});

export function parseAdguardSettings(value, {
  fieldPrefix = "adguard",
  cliNames = false,
  includeValue = false
} = {}) {
  const result = adguardSettingsSchema.safeParse(value);

  if (result.success) {
    return result.data;
  }

  const issue = result.error.issues[0];
  const field = typeof issue.path[0] === "string" ? issue.path[0] : undefined;

  if (field === undefined || !Object.hasOwn(FIELD_MESSAGES, field)) {
    throw new Error(`${fieldPrefix} contains unsupported settings`);
  }

  const fieldName = cliNames ? CLI_FIELD_NAMES[field] : `${fieldPrefix}.${field}`;
  const valueSuffix = includeValue
    ? `: ${JSON.stringify(value?.[field])}`
    : "";
  throw new Error(`${fieldName} ${FIELD_MESSAGES[field]}${valueSuffix}`);
}
