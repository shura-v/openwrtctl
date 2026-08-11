import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const RESOURCE_KINDS = ["domain", "domain_suffix", "ip_cidr"];
const ROUTES = new Set(["dns", "proxy"]);

export async function loadRouterResources(singBoxConfigPath, ruleSetsDirectoryPath) {
  const generatedResources = await readGeneratedProfileResources(singBoxConfigPath);
  const metadata = await readRuleSetMetadata(ruleSetsDirectoryPath);

  return generatedResources.map((resource) => {
    const entry = metadata.get(resource.key);

    if (!entry) {
      throw new Error(`Generated router resource is missing from tracked rule sets: ${resource.key}`);
    }

    return {
      kind: resource.kind,
      value: resource.value,
      route: entry.route,
      ruleSetNames: [...entry.ruleSetNames].sort((left, right) => left.localeCompare(right))
    };
  });
}

async function readGeneratedProfileResources(configPath) {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const routeRules = config?.route?.rules;

  if (!Array.isArray(routeRules)) {
    throw new Error(`Generated sing-box config has no route.rules array: ${configPath}`);
  }

  const resources = new Map();

  for (const rule of routeRules) {
    if (rule?.action !== "route" || rule.outbound !== "proxy") {
      continue;
    }

    for (const kind of RESOURCE_KINDS) {
      if (rule[kind] === undefined) {
        continue;
      }

      if (!Array.isArray(rule[kind])) {
        throw new Error(`Generated sing-box ${kind} rule must be an array: ${configPath}`);
      }

      for (const value of rule[kind]) {
        const resource = parseResource(kind, value, configPath);
        resources.set(resource.key, resource);
      }
    }
  }

  return [...resources.values()];
}

async function readRuleSetMetadata(ruleSetsDirectoryPath) {
  const entries = await readdir(ruleSetsDirectoryPath, { withFileTypes: true });
  const fileNames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const metadata = new Map();

  for (const fileName of fileNames) {
    const filePath = path.join(ruleSetsDirectoryPath, fileName);
    const ruleSet = JSON.parse(await readFile(filePath, "utf8"));
    const ruleSetName = fileName.replace(/\.json$/u, "");
    const route = validateRoute(ruleSet, filePath);

    if (!Array.isArray(ruleSet.rules)) {
      throw new Error(`Rule set has no rules array: ${filePath}`);
    }

    for (const rawResource of ruleSet.rules) {
      const resource = parseResourceEntry(rawResource, filePath);
      const existing = metadata.get(resource.key);

      if (existing && existing.route !== route) {
        throw new Error(
          `Resource ${resource.key} has conflicting routes in ${[...existing.ruleSetNames, ruleSetName].join(", ")}`
        );
      }

      if (existing) {
        existing.ruleSetNames.add(ruleSetName);
        continue;
      }

      metadata.set(resource.key, {
        route,
        ruleSetNames: new Set([ruleSetName])
      });
    }
  }

  return metadata;
}

function validateRoute(ruleSet, filePath) {
  if (Object.hasOwn(ruleSet, "routes")) {
    throw new Error(`Legacy routes field in ${filePath}; use optional route: "dns" or "proxy"`);
  }

  if (ruleSet.route === undefined) {
    return undefined;
  }

  if (!ROUTES.has(ruleSet.route)) {
    throw new Error(`Invalid route in ${filePath}: ${JSON.stringify(ruleSet.route)}`);
  }

  return ruleSet.route;
}

function parseResourceEntry(entry, sourcePath) {
  if (typeof entry !== "string") {
    throw new Error(`Rule must be a string in ${sourcePath}: ${JSON.stringify(entry)}`);
  }

  const separatorIndex = entry.indexOf(":");

  if (separatorIndex === -1) {
    throw new Error(`Invalid rule in ${sourcePath}: ${entry}`);
  }

  return parseResource(entry.slice(0, separatorIndex), entry.slice(separatorIndex + 1), sourcePath);
}

function parseResource(kind, value, sourcePath) {
  if (!RESOURCE_KINDS.includes(kind) || typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid ${kind} resource in ${sourcePath}: ${JSON.stringify(value)}`);
  }

  return {
    key: `${kind}:${value}`,
    kind,
    value
  };
}
