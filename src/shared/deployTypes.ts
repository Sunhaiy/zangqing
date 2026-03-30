export type DeploymentStrategyId =
  | 'static-nginx'
  | 'node-systemd'
  | 'next-standalone'
  | 'dockerfile'
  | 'docker-compose'
  | 'python-systemd'
  | 'java-systemd';

export type ProjectFramework =
  | 'vite-static'
  | 'react-spa'
  | 'nextjs'
  | 'node-service'
  | 'dockerfile'
  | 'docker-compose'
  | 'python-fastapi'
  | 'python-flask'
  | 'python-service'
  | 'java-spring-boot'
  | 'java-service'
  | 'unknown';

export type PackageManager =
  | 'npm'
  | 'pnpm'
  | 'yarn'
  | 'bun'
  | 'pip'
  | 'poetry'
  | 'maven'
  | 'gradle';

export type ProjectLanguage = 'node' | 'python' | 'java' | 'static' | 'docker-native' | 'unknown';

export type ProjectPackaging =
  | 'source'
  | 'static-build'
  | 'jar'
  | 'docker-compose'
  | 'docker-image'
  | 'unknown';

export type DependencyService =
  | 'postgres'
  | 'mysql'
  | 'redis'
  | 'mongodb'
  | 'kafka'
  | 'database';

export type DockerComposeVariant = 'docker-compose-v2' | 'docker-compose-v1' | 'none';

export type FailureClass =
  | 'source_checkout_failed'
  | 'runtime_missing'
  | 'runtime_version_mismatch'
  | 'compose_variant_mismatch'
  | 'docker_build_failed'
  | 'docker_run_failed'
  | 'build_failed'
  | 'env_missing'
  | 'dependency_service_missing'
  | 'port_conflict'
  | 'proxy_failed'
  | 'service_boot_failed'
  | 'health_check_failed'
  | 'llm_overloaded'
  | 'unknown';

export interface RuntimeRequirement {
  name: 'node' | 'python' | 'java' | 'docker' | 'docker-compose' | 'nginx';
  version?: string;
  notes?: string;
}

export interface InstallCapabilities {
  canInstallPackages: boolean;
  canInstallDocker: boolean;
  canInstallNode: boolean;
  canInstallPython: boolean;
  canInstallJava: boolean;
  canInstallNginx: boolean;
}

export interface DeploySourceLocal {
  type: 'local';
  path: string;
}

export interface DeploySourceGitHub {
  type: 'github';
  url: string;
  ref?: string;
  subdir?: string;
}

export type DeploySource = DeploySourceLocal | DeploySourceGitHub;

export interface ResolvedCheckout {
  cacheKey: string;
  repoUrl: string;
  ref: string;
  localPath?: string;
  commit?: string;
  subdir?: string;
  sourceKey: string;
  analysisRemotePath?: string;
}

export interface ProjectSpec {
  id: string;
  rootPath: string;
  name: string;
  fingerprints: string[];
  framework: ProjectFramework;
  language: ProjectLanguage;
  packaging: ProjectPackaging;
  packageManager?: PackageManager;
  buildCommand?: string;
  startCommand?: string;
  outputDir?: string;
  envFiles: string[];
  ports: number[];
  evidence: string[];
  packageJson?: {
    name?: string;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    engines?: Record<string, string>;
  };
  files: string[];
  requiredEnvVars: string[];
  suggestedEnvVars: Record<string, string>;
  serviceDependencies: DependencyService[];
  migrationScripts: string[];
  migrationCommands: string[];
  healthCheckCandidates: string[];
  persistentPaths: string[];
  runtimeRequirements: RuntimeRequirement[];
  buildCommands: string[];
  startCommands: string[];
  deploymentHints: string[];
  confidence: number;
  readmePath?: string;
  readmeSummary?: string;
}

export interface ServerSpec {
  host: string;
  user: string;
  homeDir: string;
  os: string;
  arch: string;
  packageManager: 'apt' | 'dnf' | 'yum' | 'apk' | 'unknown';
  hasDocker: boolean;
  hasDockerCompose: boolean;
  dockerComposeVariant: DockerComposeVariant;
  hasNginx: boolean;
  hasPm2: boolean;
  hasNode: boolean;
  hasPython: boolean;
  hasSystemd: boolean;
  sudoMode: 'root' | 'passwordless' | 'unavailable';
  openPorts: number[];
  publicIp?: string;
  runtimeVersions: Partial<Record<'node' | 'python' | 'java' | 'docker', string>>;
  installCapabilities: InstallCapabilities;
}

export interface DeployProfile {
  id: string;
  serverProfileId: string;
  projectRoot: string;
  sourceKey?: string;
  appName: string;
  remoteRoot: string;
  domain?: string;
  preferredStrategy?: DeploymentStrategyId;
  runtimePort?: number;
  envVars: Record<string, string>;
  installMissingDependencies: boolean;
  enableHttps: boolean;
  healthCheckPath?: string;
}

export interface DeployStepBase {
  id: string;
  label: string;
}

export interface LocalScanStep extends DeployStepBase {
  kind: 'local_scan';
}

export interface LocalPackStep extends DeployStepBase {
  kind: 'local_pack';
  sourceDir: string;
  outFile: string;
  ignorePatterns?: string[];
}

export interface LocalExecStep extends DeployStepBase {
  kind: 'local_exec';
  command: string;
  cwd?: string;
  env?: Record<string, string>;
}

export interface RemoteGitCheckoutStep extends DeployStepBase {
  kind: 'remote_git_checkout';
  repoUrl: string;
  ref?: string;
  subdir?: string;
  targetDir: string;
}

export interface SSHExecStep extends DeployStepBase {
  kind: 'ssh_exec';
  command: string;
  cwd?: string;
  sudo?: boolean;
}

export interface SFTPUploadStep extends DeployStepBase {
  kind: 'sftp_upload';
  localPath: string;
  remotePath: string;
}

export interface RemoteWriteFileStep extends DeployStepBase {
  kind: 'remote_write_file';
  path: string;
  content: string;
  sudo?: boolean;
  mode?: string;
}

export interface RemoteExtractStep extends DeployStepBase {
  kind: 'remote_extract';
  archivePath: string;
  targetDir: string;
}

export interface SwitchReleaseStep extends DeployStepBase {
  kind: 'switch_release';
  currentLink: string;
  targetDir: string;
}

export interface HTTPVerifyStep extends DeployStepBase {
  kind: 'http_verify';
  url: string;
  expectedStatus?: number;
}

export interface ServiceVerifyStep extends DeployStepBase {
  kind: 'service_verify';
  serviceName: string;
}

export interface SetOutputStep extends DeployStepBase {
  kind: 'set_output';
  url: string;
}

export type DeployStep =
  | LocalScanStep
  | LocalPackStep
  | LocalExecStep
  | RemoteGitCheckoutStep
  | SSHExecStep
  | SFTPUploadStep
  | RemoteWriteFileStep
  | RemoteExtractStep
  | SwitchReleaseStep
  | HTTPVerifyStep
  | ServiceVerifyStep
  | SetOutputStep;

export interface DeployPlan {
  id: string;
  strategyId: DeploymentStrategyId;
  summary: string;
  releaseId: string;
  steps: DeployStep[];
  rollbackSteps: DeployStep[];
}

export type DeployRunStatus =
  | 'draft'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'retryable_paused';

export type DeployPhase =
  | 'idle'
  | 'resolving_source'
  | 'detecting_project'
  | 'probing_server'
  | 'selecting_strategy'
  | 'planning'
  | 'packaging'
  | 'uploading'
  | 'executing'
  | 'repairing'
  | 'verifying'
  | 'rolling_back'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'retryable_paused';

export type DeployStepRuntime = DeployStep & {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: number;
  finishedAt?: number;
  result?: string;
  error?: string;
};

export interface DeployLogEntry {
  id: string;
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  stepId?: string;
}

export interface DeployFailureEntry {
  attempt: number;
  failureClass: FailureClass;
  stepId?: string;
  message: string;
  repairSummary?: string;
  timestamp: number;
}

export interface DeployResumeState {
  nextStepIndex: number;
  nextStepId?: string;
  completedStepIds: string[];
  lockedStrategyId?: DeploymentStrategyId;
  sourceKey?: string;
}

export interface DeployDraft {
  profile: DeployProfile;
  projectSpec: ProjectSpec;
  serverSpec: ServerSpec;
  strategyId: DeploymentStrategyId;
  warnings: string[];
  missingInfo: string[];
  source?: DeploySource;
  resolvedCheckout?: ResolvedCheckout;
}

export interface DeployRunOutput {
  url?: string;
  healthCheckUrl?: string;
  releaseId?: string;
  strategyId?: DeploymentStrategyId;
  serviceName?: string;
  remoteRoot?: string;
  sourceUrl?: string;
}

export interface DeployRun {
  id: string;
  sessionId: string;
  serverProfileId: string;
  projectRoot: string;
  createdAt: number;
  updatedAt: number;
  status: DeployRunStatus;
  phase: DeployPhase;
  source?: DeploySource;
  resolvedCheckout?: ResolvedCheckout;
  chosenStrategy?: DeploymentStrategyId;
  attemptCount: number;
  failureHistory: DeployFailureEntry[];
  currentStep?: {
    index: number;
    id: string;
    label: string;
  };
  resumeState?: DeployResumeState;
  projectSpec?: ProjectSpec;
  serverSpec?: ServerSpec;
  profile?: DeployProfile;
  plan?: DeployPlan;
  steps: DeployStepRuntime[];
  logs: DeployLogEntry[];
  outputs: DeployRunOutput;
  warnings: string[];
  missingInfo: string[];
  error?: string;
  rollbackStatus?: 'not_needed' | 'pending' | 'running' | 'completed' | 'failed';
}

export interface CreateDeployDraftInput {
  serverProfileId: string;
  projectRoot: string;
  source?: DeploySource;
  appName?: string;
  domain?: string;
  preferredStrategy?: DeploymentStrategyId;
  runtimePort?: number;
  envVars?: Record<string, string>;
  installMissingDependencies?: boolean;
  enableHttps?: boolean;
  healthCheckPath?: string;
}

export interface StartDeployInput extends CreateDeployDraftInput {
  sessionId: string;
  resumeRunId?: string;
}
