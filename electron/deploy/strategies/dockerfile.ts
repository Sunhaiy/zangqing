import { DeployPlan, DeployStep, ProjectSpec, ServerSpec } from '../../../src/shared/deployTypes.js';
import { renderProxyNginxConfig } from '../templates/nginx.js';
import { renderEnvTemplate } from '../templates/env.js';
import {
  BuildPlanInput,
  DeployStrategy,
  StrategyBuildContext,
  StrategyRepairContext,
  buildArchiveTransferSteps,
  buildEnsureDockerCommand,
  buildEnsureNginxCommand,
  shQuote,
  withContext,
} from './base.js';

export class DockerfileStrategy implements DeployStrategy {
  id = 'dockerfile' as const;

  supports(project: ProjectSpec, server: ServerSpec): boolean {
    return project.framework === 'dockerfile' || project.files.includes('Dockerfile');
  }

  score(project: ProjectSpec, server: ServerSpec): number {
    if (project.framework !== 'dockerfile') return 0;
    return server.hasDocker ? 110 : 88;
  }

  async buildPlan(input: BuildPlanInput): Promise<DeployPlan> {
    const ctx = withContext(input);
    const runtimePort = ctx.profile.runtimePort || ctx.project.ports[0] || 3000;
    const containerName = ctx.profile.appName;
    const imageName = `${ctx.profile.appName}:${ctx.releaseId}`;
    const envFilePath = `${ctx.projectDir}/.env`;
    const finalUrl = ctx.profile.domain
      ? `${ctx.profile.enableHttps ? 'https' : 'http'}://${ctx.profile.domain}${ctx.profile.healthCheckPath || ''}`
      : `http://${ctx.connectionHost}:${runtimePort}${ctx.profile.healthCheckPath || ''}`;

    const steps: DeployPlan['steps'] = [
      { kind: 'local_scan', id: 'scan', label: 'Analyze project' },
      ...buildArchiveTransferSteps(ctx),
      ...buildProvisionSteps(ctx.server, Boolean(ctx.profile.domain)),
      ...(Object.keys(ctx.profile.envVars).length > 0
        ? [{
            kind: 'remote_write_file' as const,
            id: 'env',
            label: 'Write env file',
            path: `${ctx.projectDir}/.env`,
            content: renderEnvTemplate(ctx.profile.envVars),
          }]
        : []),
      {
        kind: 'ssh_exec',
        id: 'docker-build',
        label: 'Build container image',
        command: `docker build -t ${shQuote(imageName)} .`,
        cwd: ctx.projectDir,
      },
      {
        kind: 'ssh_exec',
        id: 'docker-run',
        label: 'Restart container',
        command: `docker rm -f ${shQuote(containerName)} >/dev/null 2>&1 || true && docker run -d --name ${shQuote(containerName)} --restart unless-stopped -p ${runtimePort}:${runtimePort}${Object.keys(ctx.profile.envVars).length > 0 ? ` --env-file ${shQuote(envFilePath)}` : ''} ${shQuote(imageName)}`,
      },
    ];

    if (ctx.profile.domain) {
      steps.push(
        {
          kind: 'remote_write_file',
          id: 'nginx-config',
          label: 'Write Nginx config',
          path: ctx.nginxConfigPath,
          sudo: true,
          content: renderProxyNginxConfig({
            serverName: ctx.profile.domain,
            targetPort: runtimePort,
          }),
        },
        {
          kind: 'ssh_exec',
          id: 'nginx-reload',
          label: 'Reload Nginx',
          command: 'nginx -t && systemctl reload nginx',
          sudo: true,
        },
      );
    }

    steps.push(
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
    );

    return {
      id: `deploy-plan-${Date.now()}`,
      strategyId: this.id,
      summary: `Deploy ${ctx.project.name} from Dockerfile`,
      releaseId: ctx.releaseId,
      steps,
      rollbackSteps: [
        {
          kind: 'ssh_exec',
          id: 'docker-rollback-stop',
          label: 'Stop container',
          command: `docker rm -f ${shQuote(containerName)} >/dev/null 2>&1 || true`,
        },
      ],
    };
  }

  repairRules(context: StrategyRepairContext): DeployStep[] {
    const steps: DeployStep[] = [];

    if (context.failureClass === 'runtime_missing') {
      const ensureDocker = buildEnsureDockerCommand(context.server);
      if (ensureDocker) {
        steps.push({
          kind: 'ssh_exec',
          id: `repair-docker-runtime-${context.attempt}`,
          label: 'Repair Docker runtime',
          command: `${ensureDocker} && systemctl enable docker >/dev/null 2>&1 || true && systemctl start docker >/dev/null 2>&1 || true`,
          sudo: true,
        });
      }
    }

    if (context.failureClass === 'docker_run_failed' || context.failureClass === 'port_conflict') {
      steps.push({
        kind: 'ssh_exec',
        id: `repair-docker-run-${context.attempt}`,
        label: 'Remove old container',
        command: `docker rm -f ${shQuote(context.profile.appName)} >/dev/null 2>&1 || true`,
      });
    }

    if (context.failureClass === 'proxy_failed' && context.profile.domain) {
      steps.push({
        kind: 'ssh_exec',
        id: `repair-docker-nginx-${context.attempt}`,
        label: 'Reload Nginx',
        command: 'nginx -t && systemctl reload nginx',
        sudo: true,
      });
    }

    return steps;
  }

  verifyTargets(context: StrategyBuildContext) {
    return {
      urls: [context.finalUrl],
      services: [],
    };
  }
}

function buildProvisionSteps(server: ServerSpec, needsNginx: boolean) {
  const steps: DeployPlan['steps'] = [];
  const ensureDocker = !server.hasDocker ? buildEnsureDockerCommand(server) : null;
  if (ensureDocker) {
    steps.push({
      kind: 'ssh_exec',
      id: 'install-docker',
      label: 'Install Docker runtime',
      command: `${ensureDocker} && systemctl enable docker >/dev/null 2>&1 || true && systemctl start docker >/dev/null 2>&1 || true`,
      sudo: true,
    });
  }

  if (needsNginx) {
    const ensureNginx = !server.hasNginx ? buildEnsureNginxCommand(server) : null;
    if (ensureNginx) {
      steps.push({
        kind: 'ssh_exec',
        id: 'install-nginx',
        label: 'Install Nginx',
        command: ensureNginx,
        sudo: true,
      });
    }
  }

  return steps;
}
