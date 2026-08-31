import { isIP } from "node:net";
import { z } from "zod";

const FIELD_MESSAGES = {
  querylogInterval: "must be a positive number of hours or days",
  webPort: "must be an integer from 1 to 65535",
  dns: "must be a mapping",
  "dns.port": "must be an integer from 1 to 65535",
  "dns.upstreamDns": "must be a non-empty list of non-empty strings",
  "dns.bootstrapDns": "must be a list of non-empty strings",
  "dns.upstreamMode": "must be load_balance, parallel, or fastest_addr",
  "dns.rateLimit": "must be a non-negative integer",
  "dns.rateLimitSubnetLenIpv4": "must be an integer from 0 to 32",
  "dns.rateLimitSubnetLenIpv6": "must be an integer from 0 to 128",
  "dns.rateLimitWhitelist": "must be a list of non-empty strings",
  "dns.ednsClientSubnet": "must be a mapping",
  "dns.ednsClientSubnet.enabled": "must be a boolean",
  "dns.ednsClientSubnet.useCustom": "must be a boolean",
  "dns.ednsClientSubnet.customIp": "must be empty or an IP address, and is required when useCustom is true",
  "dns.cacheSize": "must be a non-negative integer",
  "dns.cacheTtlMin": "must be a non-negative integer not greater than dns.cacheTtlMax",
  "dns.cacheTtlMax": "must be a non-negative integer not less than dns.cacheTtlMin",
  "dns.cacheOptimistic": "must be a boolean"
};

const CLI_FIELD_NAMES = {
  querylogInterval: "ADGUARD_QUERYLOG_INTERVAL",
  webPort: "ADGUARD_WEB_PORT",
  dns: "ADGUARD_DNS",
  "dns.port": "ADGUARD_DNS_PORT",
  "dns.upstreamDns": "ADGUARD_UPSTREAM_DNS",
  "dns.bootstrapDns": "ADGUARD_BOOTSTRAP_DNS",
  "dns.upstreamMode": "ADGUARD_UPSTREAM_MODE",
  "dns.rateLimit": "ADGUARD_RATE_LIMIT",
  "dns.rateLimitSubnetLenIpv4": "ADGUARD_RATE_LIMIT_SUBNET_LEN_IPV4",
  "dns.rateLimitSubnetLenIpv6": "ADGUARD_RATE_LIMIT_SUBNET_LEN_IPV6",
  "dns.rateLimitWhitelist": "ADGUARD_RATE_LIMIT_WHITELIST",
  "dns.ednsClientSubnet": "ADGUARD_EDNS_CLIENT_SUBNET",
  "dns.ednsClientSubnet.enabled": "ADGUARD_EDNS_CLIENT_SUBNET_ENABLED",
  "dns.ednsClientSubnet.useCustom": "ADGUARD_EDNS_CLIENT_SUBNET_USE_CUSTOM",
  "dns.ednsClientSubnet.customIp": "ADGUARD_EDNS_CLIENT_SUBNET_CUSTOM_IP",
  "dns.cacheSize": "ADGUARD_CACHE_SIZE",
  "dns.cacheTtlMin": "ADGUARD_CACHE_TTL_MIN",
  "dns.cacheTtlMax": "ADGUARD_CACHE_TTL_MAX",
  "dns.cacheOptimistic": "ADGUARD_CACHE_OPTIMISTIC"
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

const ednsClientSubnetSchema = z.strictObject({
  enabled: z.boolean().default(false),
  useCustom: z.boolean().default(false),
  customIp: z.string().default("")
}).superRefine((value, context) => {
  if ((value.useCustom || value.customIp !== "") && isIP(value.customIp) === 0) {
    context.addIssue({
      code: "custom",
      path: ["customIp"],
      message: "customIp must be empty or an IP address, and is required when useCustom is true"
    });
  }
});

const dnsSchema = z.strictObject({
  port,
  upstreamDns: nonEmptyStrings.refine((values) => values.length > 0),
  bootstrapDns: nonEmptyStrings.default(() => []),
  upstreamMode: z.enum(["load_balance", "parallel", "fastest_addr"]).default("load_balance"),
  rateLimit: nonNegativeInteger.default(0),
  rateLimitSubnetLenIpv4: integerRange(0, 32).default(24),
  rateLimitSubnetLenIpv6: integerRange(0, 128).default(56),
  rateLimitWhitelist: nonEmptyStrings.default(() => []),
  ednsClientSubnet: ednsClientSubnetSchema.default(() => ({
    enabled: false,
    useCustom: false,
    customIp: ""
  })),
  cacheSize: nonNegativeInteger.default(4_194_304),
  cacheTtlMin: nonNegativeInteger.default(0),
  cacheTtlMax: nonNegativeInteger.default(0),
  cacheOptimistic: z.boolean().default(false)
}).superRefine((value, context) => {
  if (value.cacheTtlMin > value.cacheTtlMax) {
    context.addIssue({
      code: "custom",
      path: ["cacheTtlMin"],
      message: "cacheTtlMin must not be greater than cacheTtlMax"
    });
  }
});

export const adguardSettingsSchema = z.strictObject({
  querylogInterval: z.string().regex(/^[1-9]\d*(?:h|d)$/u).default("6h"),
  webPort: port,
  dns: dnsSchema
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
  const issuePath = issue.path.filter((entry) => typeof entry === "string");
  const unknownField = issue.code === "unrecognized_keys" && issue.keys.length > 0
    ? issue.keys[0]
    : undefined;
  const pathParts = unknownField === undefined
    ? issuePath
    : [...issuePath, unknownField];
  const field = pathParts.join(".");

  if (unknownField !== undefined && field.length > 0) {
    throw new Error(`${fieldPrefix}.${field} is not supported`);
  }

  if (!Object.hasOwn(FIELD_MESSAGES, field)) {
    throw new Error(`${fieldPrefix} contains unsupported settings`);
  }

  const fieldName = cliNames ? CLI_FIELD_NAMES[field] : `${fieldPrefix}.${field}`;
  const valueSuffix = includeValue
    ? `: ${JSON.stringify(readPath(value, pathParts))}`
    : "";
  throw new Error(`${fieldName} ${FIELD_MESSAGES[field]}${valueSuffix}`);
}

function readPath(value, pathParts) {
  return pathParts.reduce(
    (current, key) => current !== null && typeof current === "object"
      ? current[key]
      : undefined,
    value
  );
}
