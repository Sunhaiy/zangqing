import crypto from 'crypto';
import path from 'path';
import { promises as fs } from 'fs';
import {
  DeploySource,
  StartDeployInput,
  ResolvedCheckout,
} from '../../src/shared/deployTypes.js';

interface ParsedGitHubSource {
  repoUrl: string;
  displayUrl: string;
  ref: string;
  subdir?: string;
}

export interface ResolvedDeploySource {
  source: DeploySource;
  sourceKey: string;
  projectRoot: string;
  resolvedCheckout?: ResolvedCheckout;
}

function normalizePathSlashes(value: string) {
  return value.replace(/\\/g, '/');
}

export function isGitHubProjectUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw.trim());
    return ['github.com', 'www.github.com'].includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function parseGitHubSource(rawUrl: string): ParsedGitHubSource {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl.trim());
  } catch {
    throw new Error(`Invalid GitHub repository URL: ${rawUrl}`);
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  if (hostname !== 'github.com' && hostname !== 'www.github.com') {
    throw new Error(`Unsupported source host: ${parsedUrl.hostname}`);
  }

  const parts = parsedUrl.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts.length < 2) {
    throw new Error(`Unsupported GitHub repository URL: ${rawUrl}`);
  }

  const owner = decodeURIComponent(parts[0]);
  const repo = decodeURIComponent(parts[1].replace(/\.git$/i, ''));
  const displayUrl = `https://github.com/${owner}/${repo}`;
  const parsed: ParsedGitHubSource = {
    repoUrl: `${displayUrl}.git`,
    displayUrl,
    ref: 'HEAD',
  };

  if (parts[2] === 'tree' && parts[3]) {
    parsed.ref = decodeURIComponent(parts[3]);
    const subdir = parts
      .slice(4)
      .map((segment) => decodeURIComponent(segment))
      .join(path.sep);
    if (subdir) {
      parsed.subdir = subdir;
    }
  }

  return parsed;
}

export function buildSourceKey(source: DeploySource) {
  if (source.type === 'local') {
    return `local:${path.resolve(source.path)}`;
  }
  const url = source.url.trim().replace(/\/+$/, '');
  const ref = source.ref?.trim() || 'HEAD';
  const subdir = source.subdir?.trim() || '';
  return `github:${url}#${ref}${subdir ? `:${normalizePathSlashes(subdir)}` : ''}`;
}

function buildGitHubCheckout(source: DeploySource & { type: 'github' }): ResolvedCheckout {
  const parsed = parseGitHubSource(source.url);
  const ref = source.ref?.trim() || parsed.ref || 'HEAD';
  const subdir = source.subdir?.trim() || parsed.subdir;
  const normalizedSource: DeploySource = {
    type: 'github',
    url: parsed.displayUrl,
    ref: ref !== 'HEAD' ? ref : undefined,
    subdir,
  };
  const sourceKey = buildSourceKey(normalizedSource);
  const cacheKey = crypto.createHash('sha1').update(sourceKey).digest('hex').slice(0, 16);

  return {
    cacheKey,
    repoUrl: parsed.repoUrl,
    ref,
    subdir,
    sourceKey,
  };
}

export class SourceResolver {
  normalize(input: Pick<StartDeployInput, 'projectRoot' | 'source'>): DeploySource {
    if (input.source) {
      return input.source.type === 'local'
        ? { type: 'local', path: path.resolve(input.source.path) }
        : {
            type: 'github',
            url: input.source.url.trim(),
            ref: input.source.ref?.trim(),
            subdir: input.source.subdir?.trim(),
          };
    }

    if (isGitHubProjectUrl(input.projectRoot)) {
      const parsed = parseGitHubSource(input.projectRoot);
      return {
        type: 'github',
        url: parsed.displayUrl,
        ref: parsed.ref !== 'HEAD' ? parsed.ref : undefined,
        subdir: parsed.subdir,
      };
    }

    return {
      type: 'local',
      path: path.resolve(input.projectRoot),
    };
  }

  async resolve(input: Pick<StartDeployInput, 'projectRoot' | 'source'>): Promise<ResolvedDeploySource> {
    const source = this.normalize(input);
    if (source.type === 'local') {
      const resolvedPath = path.resolve(source.path);
      const stats = await fs.stat(resolvedPath).catch(() => null);
      if (!stats?.isDirectory()) {
        throw new Error(`Local project path does not exist: ${resolvedPath}`);
      }
      return {
        source: { type: 'local', path: resolvedPath },
        sourceKey: buildSourceKey({ type: 'local', path: resolvedPath }),
        projectRoot: resolvedPath,
      };
    }

    const resolvedCheckout = buildGitHubCheckout(source);
    return {
      source: {
        type: 'github',
        url: source.url.trim().replace(/\/+$/, ''),
        ref: source.ref?.trim(),
        subdir: source.subdir?.trim(),
      },
      sourceKey: resolvedCheckout.sourceKey,
      projectRoot: source.url.trim().replace(/\/+$/, ''),
      resolvedCheckout,
    };
  }
}
