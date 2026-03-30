import { DeployPlan, DeployStep, ProjectSpec, ServerSpec } from '../../../src/shared/deployTypes.js';
import {
  BuildPlanInput,
  DeployStrategy,
  StrategyBuildContext,
  StrategyRepairContext,
  buildArchiveTransferSteps,
  buildEnsureDockerCommand,
  buildEnsureDockerComposeCommand,
  shQuote,
  withContext,
} from './base.js';

function composeCommand(server: ServerSpec) {
  return server.dockerComposeVariant === 'docker-compose-v1' ? 'docker-compose' : 'docker compose';
}

function renderEnvFile(envVars: Record<string, string>) {
  return Object.entries(envVars)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

export class DockerComposeStrategy implements DeployStrategy {
  id = 'docker-compose' as const;

  supports(project: ProjectSpec, server: ServerSpec): boolean {
    return (
      project.framework === 'docker-compose' &&
      (server.hasDocker || server.installCapabilities.canInstallDocker)
    );
  }

  score(project: ProjectSpec, server: ServerSpec): number {
    if (project.framework !== 'docker-compose') return 0;
    return server.hasDocker && server.hasDockerCompose ? 120 : 95;
  }

  async buildPlan(input: BuildPlanInput): Promise<DeployPlan> {
    const ctx = withContext(input);
    const runtimePort = ctx.profile.runtimePort || ctx.project.ports[0] || 3000;
    const finalUrl = ctx.profile.domain
      ? `${ctx.profile.enableHttps ? 'https' : 'http'}://${ctx.profile.domain}${ctx.profile.healthCheckPath || ''}`
      : `http://${ctx.connectionHost}:${runtimePort}${ctx.profile.healthCheckPath || ''}`;
    const compose = composeCommand(ctx.server);
    const provisionSteps: DeployPlan['steps'] = [];
    const ensureDocker = !ctx.server.hasDocker ? buildEnsureDockerCommand(ctx.server) : null;
    const ensureCompose = !ctx.server.hasDockerCompose ? buildEnsureDockerComposeCommand(ctx.server) : null;

    if (ensureDocker) {
      provisionSteps.push({
        kind: 'ssh_exec',
        id: 'install-docker',
        label: 'Install Docker runtime',
        command: `${ensureDocker} && systemctl enable docker >/dev/null 2>&1 || true && systemctl start docker >/dev/null 2>&1 || true`,
        sudo: true,
      });
    }
    if (ensureCompose) {
      provisionSteps.push({
        kind: 'ssh_exec',
        id: 'install-docker-compose',
        label: 'Install Docker Compose',
        command: ensureCompose,
        sudo: true,
      });
    }

    return {
      id: `deploy-plan-${Date.now()}`,
      strategyId: this.id,
      summary: `Deploy ${ctx.project.name} with docker compose`,
      releaseId: ctx.releaseId,
      steps: [
        { kind: 'local_scan', id: 'scan', label: 'Analyze project' },
        ...buildArchiveTransferSteps(ctx),
        ...provisionSteps,
        ...(Object.keys(ctx.profile.envVars).length > 0
          ? [{
              kind: 'remote_write_file' as const,
              id: 'env',
              label: 'Write compose env file',
              path: `${ctx.projectDir}/.env`,
              content: renderEnvFile(ctx.profile.envVars),
            }]
          : []),
        {
          kind: 'ssh_exec',
          id: 'compose-up',
          label: 'Run docker compose',
          command: `${compose} up -d --build`,
          cwd: ctx.projectDir,
        },
        {
          kind: 'http_verify',
          id: 'verify',
          label: 'Verify application',
          url: finalUrl,
          expectedStatus: 200,
        },
        {
          kind: 'set_output',
          id: 'output',
          label: 'Publish final URL',
          url: finalUrl,
        },
      ],
      rollbackSteps: [
        {
          kind: 'ssh_exec',
          id: 'compose-down',
          label: 'Stop docker compose stack',
          command: `${compose} down --remove-orphans || true`,
          cwd: ctx.projectDir,
        },
      ],
    };
  }

  repairRules(context: StrategyRepairContext): DeployStep[] {
    const repairSteps: DeployStep[] = [];
    const compose = composeCommand(context.server);

    if (context.failureClass === 'compose_variant_mismatch' || context.failureClass === 'runtime_missing') {
      const ensureCompose = buildEnsureDockerComposeCommand(context.server);
      if (ensureCompose) {
        repairSteps.push({
          kind: 'ssh_exec',
          id: `repair-compose-runtime-${context.attempt}`,
          label: 'Repair Docker Compose runtime',
          command: ensureCompose,
          sudo: true,
        });
      }
    }

    if (
      context.failureClass === 'docker_build_failed' ||
      context.failureClass === 'docker_run_failed' ||
      context.failureClass === 'port_conflict'
    ) {
        repairSteps.push({
          kind: 'ssh_exec',
          id: `repair-compose-reset-${context.attempt}`,
          label: 'Reset docker compose stack',
          command: `${compose} down --remove-orphans || true`,
          cwd: context.projectDir,
        });
    }

    if (context.failureClass === 'env_missing' && Object.keys(context.profile.envVars).length > 0) {
        repairSteps.push({
          kind: 'remote_write_file',
          id: `repair-compose-env-${context.attempt}`,
          label: 'Rewrite compose env file',
          path: `${context.projectDir}/.env`,
          content: renderEnvFile(context.profile.envVars),
        });
    }

    return repairSteps;
  }

  verifyTargets(context: StrategyBuildContext) {
    return {
      urls: [context.finalUrl],
      services: [],
    };
  }
}
