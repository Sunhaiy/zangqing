import { DeployPlan, DeployStep, ProjectSpec, ServerSpec } from '../../../src/shared/deployTypes.js';
import { renderProxyNginxConfig } from '../templates/nginx.js';
import { renderEnvTemplate } from '../templates/env.js';
import { renderSystemdService } from '../templates/systemd.js';
import {
  BuildPlanInput,
  DeployStrategy,
  StrategyBuildContext,
  StrategyRepairContext,
  buildArchiveTransferSteps,
  buildEnsureNginxCommand,
  buildEnsurePythonCommand,
  canProvidePythonRuntime,
  shQuote,
  withOptionalEnvFile,
  withContext,
} from './base.js';

export class PythonSystemdStrategy implements DeployStrategy {
  id = 'python-systemd' as const;

  supports(project: ProjectSpec, server: ServerSpec): boolean {
    return (
      (project.framework === 'python-fastapi' ||
        project.framework === 'python-flask' ||
        project.framework === 'python-service') &&
      canProvidePythonRuntime(server) &&
      server.hasSystemd
    );
  }

  score(project: ProjectSpec, server: ServerSpec): number {
    if (
      project.framework !== 'python-fastapi' &&
      project.framework !== 'python-flask' &&
      project.framework !== 'python-service'
    ) {
      return 0;
    }
    return server.hasSystemd ? 76 : 0;
  }

  async buildPlan(input: BuildPlanInput): Promise<DeployPlan> {
    const ctx = withContext(input);
    const runtimePort = ctx.profile.runtimePort || ctx.project.ports[0] || 8000;
    const envFilePath = `${ctx.sharedDir}/.env`;
    const runtimeEnvFilePath = Object.keys(ctx.profile.envVars).length > 0 ? envFilePath : undefined;
    const serviceFilePath = `/etc/systemd/system/${ctx.serviceName}`;
    const defaultStart =
      ctx.project.framework === 'python-flask'
        ? `.venv/bin/flask run --host 0.0.0.0 --port ${runtimePort}`
        : `.venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port ${runtimePort}`;
    const finalUrl = ctx.profile.domain
      ? `${ctx.profile.enableHttps ? 'https' : 'http'}://${ctx.profile.domain}${ctx.profile.healthCheckPath || ''}`
      : `http://${ctx.connectionHost}:${runtimePort}${ctx.profile.healthCheckPath || ''}`;
    const runtimeProvisionSteps = buildRuntimeProvisionSteps(ctx.server, Boolean(ctx.profile.domain));
    const migrationSteps = buildMigrationSteps(ctx.project.migrationCommands, runtimeEnvFilePath, ctx.releaseDir);

    return {
      id: `deploy-plan-${Date.now()}`,
      strategyId: this.id,
      summary: `Deploy ${ctx.project.name} as Python service`,
      releaseId: ctx.releaseId,
      steps: [
        { kind: 'local_scan', id: 'scan', label: 'Analyze project' },
        ...buildArchiveTransferSteps(ctx),
        {
          kind: 'ssh_exec',
          id: 'prepare-shared',
          label: 'Prepare shared directory',
          command: `mkdir -p ${shQuote(ctx.sharedDir)}`,
          sudo: true,
        },
        ...runtimeProvisionSteps,
        ...(Object.keys(ctx.profile.envVars).length > 0
          ? [{
              kind: 'remote_write_file' as const,
              id: 'env',
              label: 'Write env file',
              path: envFilePath,
              sudo: true,
              content: renderEnvTemplate(ctx.profile.envVars),
            }]
          : []),
        {
          kind: 'ssh_exec',
          id: 'venv',
          label: 'Create virtual environment',
          command: 'python3 -m venv .venv',
          cwd: ctx.projectDir,
        },
        {
          kind: 'ssh_exec',
          id: 'install',
          label: 'Install Python dependencies',
          command: '.venv/bin/pip install -r requirements.txt',
          cwd: ctx.projectDir,
        },
        ...migrationSteps.map((step) => ({ ...step, cwd: ctx.projectDir })),
        {
          kind: 'ssh_exec',
          id: 'snapshot-current',
          label: 'Snapshot current release',
          command: `if [ -L ${shQuote(ctx.currentDir)} ]; then PREV="$(readlink -f ${shQuote(ctx.currentDir)})"; printf "%s" "$PREV" > ${shQuote(`${ctx.profile.remoteRoot}/.previous_release`)}; fi`,
          sudo: true,
        },
        {
          kind: 'switch_release',
          id: 'switch',
          label: 'Switch current release',
          currentLink: ctx.currentDir,
          targetDir: ctx.releaseDir,
        },
        {
          kind: 'remote_write_file',
          id: 'systemd',
          label: 'Write systemd service',
          path: serviceFilePath,
          sudo: true,
          content: renderSystemdService({
            description: `${ctx.profile.appName} Python service`,
            workingDirectory: ctx.currentDir,
            user: ctx.server.user,
            environmentFile: Object.keys(ctx.profile.envVars).length > 0 ? envFilePath : undefined,
            execStart: `/bin/bash -lc ${shQuote(ctx.project.startCommand || defaultStart)}`,
          }),
        },
        {
          kind: 'ssh_exec',
          id: 'systemd-reload',
          label: 'Reload and restart service',
          command: `systemctl daemon-reload && systemctl enable ${shQuote(ctx.serviceName)} && systemctl restart ${shQuote(ctx.serviceName)}`,
          sudo: true,
        },
        {
          kind: 'service_verify',
          id: 'service-verify',
          label: 'Verify service status',
          serviceName: ctx.serviceName,
        },
        ...(ctx.profile.domain && ctx.server.hasNginx
          ? [
              {
                kind: 'remote_write_file' as const,
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
                kind: 'ssh_exec' as const,
                id: 'nginx-reload',
                label: 'Reload Nginx',
                command: 'nginx -t && systemctl reload nginx',
                sudo: true,
              },
            ]
          : []),
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
          id: 'rollback-switch',
          label: 'Restore previous release',
          command: `if [ -f ${shQuote(`${ctx.profile.remoteRoot}/.previous_release`)} ]; then PREV="$(cat ${shQuote(`${ctx.profile.remoteRoot}/.previous_release`)})"; ln -sfn "$PREV" ${shQuote(ctx.currentDir)}; fi`,
          sudo: true,
        },
        {
          kind: 'ssh_exec',
          id: 'rollback-service',
          label: 'Restart service',
          command: `systemctl restart ${shQuote(ctx.serviceName)}`,
          sudo: true,
        },
      ],
    };
  }

  repairRules(context: StrategyRepairContext): DeployStep[] {
    const steps: DeployStep[] = [];
    if (context.failureClass === 'runtime_missing' || context.failureClass === 'runtime_version_mismatch') {
      const ensurePython = buildEnsurePythonCommand(context.server);
      if (ensurePython) {
        steps.push({
          kind: 'ssh_exec',
          id: `repair-python-runtime-${context.attempt}`,
          label: 'Repair Python runtime',
          command: ensurePython,
          sudo: true,
        });
      }
    }
    if (context.failureClass === 'service_boot_failed') {
      steps.push({
        kind: 'ssh_exec',
        id: `repair-python-service-${context.attempt}`,
        label: 'Restart Python service',
        command: `systemctl daemon-reload && systemctl restart ${shQuote(context.serviceName)}`,
        sudo: true,
      });
    }
    if (context.failureClass === 'proxy_failed' && context.profile.domain) {
      steps.push({
        kind: 'ssh_exec',
        id: `repair-python-nginx-${context.attempt}`,
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
      services: [context.serviceName],
    };
  }
}

function buildMigrationSteps(commands: string[], envFilePath: string | undefined, cwd: string) {
  return commands.map((command, index) => ({
    kind: 'ssh_exec' as const,
    id: `migrate-${index + 1}`,
    label: `Run migration: ${command}`,
    command: withOptionalEnvFile(command, envFilePath),
    cwd,
  })) as DeployPlan['steps'];
}

function buildRuntimeProvisionSteps(server: ServerSpec, needsNginx: boolean) {
  const steps: DeployPlan['steps'] = [];
  const ensurePython = !server.hasPython ? buildEnsurePythonCommand(server) : null;
  if (ensurePython) {
    steps.push({
      kind: 'ssh_exec',
      id: 'install-python',
      label: 'Install Python runtime',
      command: ensurePython,
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
