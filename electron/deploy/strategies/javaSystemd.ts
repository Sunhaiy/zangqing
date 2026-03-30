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
  buildEnsureJavaCommand,
  buildEnsureNginxCommand,
  shQuote,
  withContext,
} from './base.js';

function detectBuildCommand(project: ProjectSpec) {
  if (project.packageManager === 'maven') {
    return project.files.includes('mvnw') ? './mvnw -DskipTests package' : 'mvn -DskipTests package';
  }
  return project.files.includes('gradlew') ? './gradlew build -x test' : 'gradle build -x test';
}

function renderJarStartCommand(currentDir: string) {
  return `/bin/bash -lc ${shQuote(`JAR="$(find ${currentDir} -type f \\( -path '*/target/*.jar' -o -path '*/build/libs/*.jar' \\) | head -n 1)"; if [ -z "$JAR" ]; then echo "No built jar found" >&2; exit 1; fi; exec java -jar "$JAR"`)} `;
}

export class JavaSystemdStrategy implements DeployStrategy {
  id = 'java-systemd' as const;

  supports(project: ProjectSpec, server: ServerSpec): boolean {
    return (
      (project.framework === 'java-spring-boot' || project.framework === 'java-service') &&
      server.hasSystemd &&
      (Boolean(server.runtimeVersions.java) || server.installCapabilities.canInstallJava)
    );
  }

  score(project: ProjectSpec, server: ServerSpec): number {
    if (project.framework !== 'java-spring-boot' && project.framework !== 'java-service') return 0;
    return server.hasSystemd ? 90 : 0;
  }

  async buildPlan(input: BuildPlanInput): Promise<DeployPlan> {
    const ctx = withContext(input);
    const runtimePort = ctx.profile.runtimePort || ctx.project.ports[0] || 8080;
    const envFilePath = `${ctx.sharedDir}/.env`;
    const serviceFilePath = `/etc/systemd/system/${ctx.serviceName}`;
    const finalUrl = ctx.profile.domain
      ? `${ctx.profile.enableHttps ? 'https' : 'http'}://${ctx.profile.domain}${ctx.profile.healthCheckPath || ''}`
      : `http://${ctx.connectionHost}:${runtimePort}${ctx.profile.healthCheckPath || ''}`;
    const javaRequirement = ctx.project.runtimeRequirements.find((item) => item.name === 'java');
    const ensureJava = !ctx.server.runtimeVersions.java
      ? buildEnsureJavaCommand(ctx.server, javaRequirement?.version)
      : null;
    const buildCommand = detectBuildCommand(ctx.project);

    const steps: DeployPlan['steps'] = [
      { kind: 'local_scan', id: 'scan', label: 'Analyze project' },
      ...buildArchiveTransferSteps(ctx),
      {
        kind: 'ssh_exec',
        id: 'prepare-shared',
        label: 'Prepare shared directory',
        command: `mkdir -p ${shQuote(ctx.sharedDir)}`,
        sudo: true,
      },
      ...(ensureJava
        ? [{
            kind: 'ssh_exec' as const,
            id: 'install-java',
            label: 'Install Java runtime',
            command: ensureJava,
            sudo: true,
          }]
        : []),
      ...(ctx.profile.domain && !ctx.server.hasNginx
        ? [{
            kind: 'ssh_exec' as const,
            id: 'install-nginx',
            label: 'Install Nginx',
            command: buildEnsureNginxCommand(ctx.server) || 'true',
            sudo: true,
          }]
        : []),
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
        id: 'build-java',
        label: 'Build Java artifact',
        command: buildCommand,
        cwd: ctx.projectDir,
      },
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
          description: `${ctx.profile.appName} Java service`,
          workingDirectory: ctx.currentDir,
          user: ctx.server.user,
          environmentFile: Object.keys(ctx.profile.envVars).length > 0 ? envFilePath : undefined,
          execStart: renderJarStartCommand(ctx.currentDir),
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
      summary: `Deploy ${ctx.project.name} as Java service`,
      releaseId: ctx.releaseId,
      steps,
      rollbackSteps: [
        {
          kind: 'ssh_exec',
          id: 'rollback-service',
          label: 'Restart Java service',
          command: `systemctl restart ${shQuote(ctx.serviceName)}`,
          sudo: true,
        },
      ],
    };
  }

  repairRules(context: StrategyRepairContext): DeployStep[] {
    const steps: DeployStep[] = [];
    const javaRequirement = context.project.runtimeRequirements.find((item) => item.name === 'java');
    if (context.failureClass === 'runtime_missing' || context.failureClass === 'runtime_version_mismatch') {
      const ensureJava = buildEnsureJavaCommand(context.server, javaRequirement?.version);
      if (ensureJava) {
        steps.push({
          kind: 'ssh_exec',
          id: `repair-java-runtime-${context.attempt}`,
          label: 'Repair Java runtime',
          command: ensureJava,
          sudo: true,
        });
      }
    }
    if (context.failureClass === 'service_boot_failed') {
      steps.push({
        kind: 'ssh_exec',
        id: `repair-java-service-${context.attempt}`,
        label: 'Restart Java service',
        command: `systemctl daemon-reload && systemctl restart ${shQuote(context.serviceName)}`,
        sudo: true,
      });
    }
    if (context.failureClass === 'proxy_failed' && context.profile.domain) {
      steps.push({
        kind: 'ssh_exec',
        id: `repair-java-nginx-${context.attempt}`,
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
