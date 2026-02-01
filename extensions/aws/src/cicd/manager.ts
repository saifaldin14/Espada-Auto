/**
 * AWS CI/CD Manager
 *
 * Provides comprehensive CI/CD pipeline management including:
 * - CodePipeline creation, execution, and monitoring
 * - CodeBuild project and build management
 * - CodeDeploy application and deployment orchestration
 * - Blue/green deployment configuration
 * - Pipeline templates for common patterns
 */

import {
  CodePipelineClient,
  ListPipelinesCommand,
  GetPipelineCommand,
  CreatePipelineCommand,
  UpdatePipelineCommand,
  DeletePipelineCommand,
  StartPipelineExecutionCommand,
  StopPipelineExecutionCommand,
  RetryStageExecutionCommand,
  ListPipelineExecutionsCommand,
  GetPipelineExecutionCommand,
  GetPipelineStateCommand,
  ListActionExecutionsCommand,
  EnableStageTransitionCommand,
  DisableStageTransitionCommand,
  type PipelineDeclaration,
  type StageDeclaration,
  type ActionDeclaration,
} from '@aws-sdk/client-codepipeline';

import {
  CodeBuildClient,
  ListProjectsCommand,
  BatchGetProjectsCommand,
  CreateProjectCommand,
  UpdateProjectCommand,
  DeleteProjectCommand,
  StartBuildCommand,
  StopBuildCommand,
  RetryBuildCommand,
  ListBuildsCommand,
  ListBuildsForProjectCommand,
  BatchGetBuildsCommand,
  type Project,
  type Build,
} from '@aws-sdk/client-codebuild';

import {
  CodeDeployClient,
  ListApplicationsCommand,
  GetApplicationCommand,
  CreateApplicationCommand,
  DeleteApplicationCommand,
  ListDeploymentGroupsCommand,
  GetDeploymentGroupCommand,
  CreateDeploymentGroupCommand,
  UpdateDeploymentGroupCommand,
  DeleteDeploymentGroupCommand,
  CreateDeploymentCommand,
  GetDeploymentCommand,
  ListDeploymentsCommand,
  StopDeploymentCommand,
  ContinueDeploymentCommand,
  ListDeploymentConfigsCommand,
  GetDeploymentConfigCommand,
  CreateDeploymentConfigCommand,
  DeleteDeploymentConfigCommand,
  type DeploymentGroupInfo as AWSDeploymentGroupInfo,
  type DeploymentInfo as AWSDeploymentInfo,
} from '@aws-sdk/client-codedeploy';

import {
  CloudWatchLogsClient,
  GetLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs';

import {
  CICDManagerConfig,
  CICDOperationResult,
  CICDManager,
  PipelineInfo,
  PipelineSummary,
  StageInfo,
  ActionInfo,
  ArtifactStoreInfo,
  PipelineExecutionSummary,
  PipelineExecutionDetail,
  StageState,
  ActionExecutionDetail,
  BuildProjectInfo,
  BuildInfo,
  BuildSourceInfo,
  BuildArtifactInfo,
  BuildEnvironmentInfo,
  ApplicationInfo,
  DeploymentGroupInfo,
  DeploymentInfo,
  DeploymentConfigInfo,
  PipelineTemplate,
  ListPipelinesOptions,
  CreatePipelineOptions,
  UpdatePipelineOptions,
  StartPipelineExecutionOptions,
  StopPipelineExecutionOptions,
  RetryStageExecutionOptions,
  ListPipelineExecutionsOptions,
  ListActionExecutionsOptions,
  ListBuildProjectsOptions,
  CreateBuildProjectOptions,
  UpdateBuildProjectOptions,
  StartBuildOptions,
  ListBuildsOptions,
  ListBuildsForProjectOptions,
  ListApplicationsOptions,
  CreateApplicationOptions,
  ListDeploymentGroupsOptions,
  CreateDeploymentGroupOptions,
  UpdateDeploymentGroupOptions,
  CreateDeploymentOptions,
  ListDeploymentsOptions,
  ListDeploymentConfigsOptions,
  CreateDeploymentConfigOptions,
  BlueGreenDeploymentOptions,
  PIPELINE_TEMPLATES,
} from './types.js';

/**
 * Create a CI/CD Manager instance
 */
export function createCICDManager(config: CICDManagerConfig = {}): CICDManager {
  const defaultRegion = config.defaultRegion ?? 'us-east-1';

  // Create AWS clients
  const createPipelineClient = (region?: string) => new CodePipelineClient({
    region: region ?? defaultRegion,
    credentials: config.credentials,
  });

  const createBuildClient = (region?: string) => new CodeBuildClient({
    region: region ?? defaultRegion,
    credentials: config.credentials,
  });

  const createDeployClient = (region?: string) => new CodeDeployClient({
    region: region ?? defaultRegion,
    credentials: config.credentials,
  });

  const createLogsClient = (region?: string) => new CloudWatchLogsClient({
    region: region ?? defaultRegion,
    credentials: config.credentials,
  });

  const pipelineClient = createPipelineClient();
  const buildClient = createBuildClient();
  const deployClient = createDeployClient();
  const logsClient = createLogsClient();

  // Helper to convert AWS pipeline to our format
  const convertPipeline = (pipeline: PipelineDeclaration): PipelineInfo => ({
    pipelineName: pipeline.name ?? '',
    roleArn: pipeline.roleArn ?? '',
    artifactStore: pipeline.artifactStore ? {
      type: pipeline.artifactStore.type as ArtifactStoreInfo['type'],
      location: pipeline.artifactStore.location ?? '',
      encryptionKey: pipeline.artifactStore.encryptionKey ? {
        id: pipeline.artifactStore.encryptionKey.id ?? '',
        type: 'KMS',
      } : undefined,
    } : { type: 'S3', location: '' },
    stages: (pipeline.stages ?? []).map(stage => convertStage(stage)),
    version: pipeline.version ?? 1,
    executionMode: pipeline.executionMode as PipelineInfo['executionMode'],
    pipelineType: pipeline.pipelineType as PipelineInfo['pipelineType'],
    variables: pipeline.variables?.map(v => ({
      name: v.name ?? '',
      defaultValue: v.defaultValue,
      description: v.description,
    })),
    triggers: pipeline.triggers?.map(t => ({
      providerType: t.providerType as 'CodeStarSourceConnection',
      gitConfiguration: {
        sourceActionName: t.gitConfiguration?.sourceActionName ?? '',
        push: t.gitConfiguration?.push?.map(p => ({
          branches: p.branches ? {
            includes: p.branches.includes,
            excludes: p.branches.excludes,
          } : undefined,
          filePaths: p.filePaths ? {
            includes: p.filePaths.includes,
            excludes: p.filePaths.excludes,
          } : undefined,
          tags: p.tags ? {
            includes: p.tags.includes,
            excludes: p.tags.excludes,
          } : undefined,
        })),
        pullRequest: t.gitConfiguration?.pullRequest?.map(pr => ({
          branches: pr.branches ? {
            includes: pr.branches.includes,
            excludes: pr.branches.excludes,
          } : undefined,
          filePaths: pr.filePaths ? {
            includes: pr.filePaths.includes,
            excludes: pr.filePaths.excludes,
          } : undefined,
          events: pr.events as ('OPEN' | 'UPDATED' | 'CLOSED')[],
        })),
      },
    })),
  });

  const convertStage = (stage: StageDeclaration): StageInfo => ({
    stageName: stage.name ?? '',
    actions: (stage.actions ?? []).map(action => convertAction(action)),
    blockers: stage.blockers?.map(b => ({
      name: b.name ?? '',
      type: b.type as 'Schedule',
    })),
  });

  const convertAction = (action: ActionDeclaration): ActionInfo => ({
    actionName: action.name ?? '',
    actionTypeId: {
      category: action.actionTypeId?.category as ActionInfo['actionTypeId']['category'],
      owner: action.actionTypeId?.owner as ActionInfo['actionTypeId']['owner'],
      provider: action.actionTypeId?.provider ?? '',
      version: action.actionTypeId?.version ?? '1',
    },
    runOrder: action.runOrder,
    configuration: action.configuration,
    inputArtifacts: action.inputArtifacts?.map(a => a.name ?? ''),
    outputArtifacts: action.outputArtifacts?.map(a => a.name ?? ''),
    region: action.region,
    namespace: action.namespace,
    roleArn: action.roleArn,
  });

  // Helper to convert our format to AWS pipeline
  const convertToAWSPipeline = (options: CreatePipelineOptions): PipelineDeclaration => ({
    name: options.pipelineName,
    roleArn: options.roleArn,
    artifactStore: {
      type: options.artifactStore.type,
      location: options.artifactStore.location,
      encryptionKey: options.artifactStore.encryptionKey ? {
        id: options.artifactStore.encryptionKey.id,
        type: options.artifactStore.encryptionKey.type,
      } : undefined,
    },
    stages: options.stages.map(stage => ({
      name: stage.stageName,
      actions: stage.actions.map(action => ({
        name: action.actionName,
        actionTypeId: {
          category: action.actionTypeId.category,
          owner: action.actionTypeId.owner,
          provider: action.actionTypeId.provider,
          version: action.actionTypeId.version,
        },
        runOrder: action.runOrder,
        configuration: action.configuration,
        inputArtifacts: action.inputArtifacts?.map(name => ({ name })),
        outputArtifacts: action.outputArtifacts?.map(name => ({ name })),
        region: action.region,
        namespace: action.namespace,
        roleArn: action.roleArn,
      })),
      blockers: stage.blockers?.map(b => ({
        name: b.name,
        type: b.type,
      })),
    })),
    executionMode: options.executionMode,
    pipelineType: options.pipelineType,
    variables: options.variables?.map(v => ({
      name: v.name,
      defaultValue: v.defaultValue,
      description: v.description,
    })),
    triggers: options.triggers?.map(t => ({
      providerType: t.providerType,
      gitConfiguration: {
        sourceActionName: t.gitConfiguration.sourceActionName,
        push: t.gitConfiguration.push?.map(p => ({
          branches: p.branches,
          filePaths: p.filePaths,
          tags: p.tags,
        })),
        pullRequest: t.gitConfiguration.pullRequest?.map(pr => ({
          branches: pr.branches,
          filePaths: pr.filePaths,
          events: pr.events,
        })),
      },
    })),
  });

  // Helper to convert AWS build project to our format
  const convertBuildProject = (project: Project): BuildProjectInfo => ({
    name: project.name ?? '',
    arn: project.arn,
    description: project.description,
    source: {
      type: project.source?.type as BuildSourceInfo['type'],
      location: project.source?.location,
      gitCloneDepth: project.source?.gitCloneDepth,
      gitSubmodulesConfig: project.source?.gitSubmodulesConfig ? {
        fetchSubmodules: project.source.gitSubmodulesConfig.fetchSubmodules ?? false,
      } : undefined,
      buildspec: project.source?.buildspec,
      auth: project.source?.auth ? {
        type: project.source.auth.type as 'OAUTH' | 'CODECONNECTIONS',
        resource: project.source.auth.resource,
      } : undefined,
      reportBuildStatus: project.source?.reportBuildStatus,
      buildStatusConfig: project.source?.buildStatusConfig ? {
        context: project.source.buildStatusConfig.context,
        targetUrl: project.source.buildStatusConfig.targetUrl,
      } : undefined,
      insecureSsl: project.source?.insecureSsl,
      sourceIdentifier: project.source?.sourceIdentifier,
    },
    artifacts: {
      type: project.artifacts?.type as BuildArtifactInfo['type'],
      location: project.artifacts?.location,
      path: project.artifacts?.path,
      namespaceType: project.artifacts?.namespaceType as 'NONE' | 'BUILD_ID',
      name: project.artifacts?.name,
      packaging: project.artifacts?.packaging as 'NONE' | 'ZIP',
      overrideArtifactName: project.artifacts?.overrideArtifactName,
      encryptionDisabled: project.artifacts?.encryptionDisabled,
      artifactIdentifier: project.artifacts?.artifactIdentifier,
      bucketOwnerAccess: project.artifacts?.bucketOwnerAccess as 'NONE' | 'READ_ONLY' | 'FULL',
    },
    environment: {
      type: project.environment?.type as BuildEnvironmentInfo['type'],
      image: project.environment?.image ?? '',
      computeType: project.environment?.computeType as BuildEnvironmentInfo['computeType'],
      environmentVariables: project.environment?.environmentVariables?.map(ev => ({
        name: ev.name ?? '',
        value: ev.value ?? '',
        type: ev.type as 'PLAINTEXT' | 'PARAMETER_STORE' | 'SECRETS_MANAGER',
      })),
      privilegedMode: project.environment?.privilegedMode,
      certificate: project.environment?.certificate,
      registryCredential: project.environment?.registryCredential ? {
        credential: project.environment.registryCredential.credential ?? '',
        credentialProvider: 'SECRETS_MANAGER',
      } : undefined,
      imagePullCredentialsType: project.environment?.imagePullCredentialsType as 'CODEBUILD' | 'SERVICE_ROLE',
    },
    serviceRole: project.serviceRole ?? '',
    timeoutInMinutes: project.timeoutInMinutes ?? 60,
    queuedTimeoutInMinutes: project.queuedTimeoutInMinutes,
    encryptionKey: project.encryptionKey,
    tags: project.tags?.reduce<Record<string, string>>((acc, t) => ({ ...acc, [t.key ?? '']: t.value ?? '' }), {}),
    created: project.created,
    lastModified: project.lastModified,
    vpcConfig: project.vpcConfig ? {
      vpcId: project.vpcConfig.vpcId ?? '',
      subnets: project.vpcConfig.subnets ?? [],
      securityGroupIds: project.vpcConfig.securityGroupIds ?? [],
    } : undefined,
    badge: project.badge ? {
      badgeEnabled: project.badge.badgeEnabled ?? false,
      badgeRequestUrl: project.badge.badgeRequestUrl,
    } : undefined,
    logsConfig: project.logsConfig ? {
      cloudWatchLogs: project.logsConfig.cloudWatchLogs ? {
        status: project.logsConfig.cloudWatchLogs.status as 'ENABLED' | 'DISABLED',
        groupName: project.logsConfig.cloudWatchLogs.groupName,
        streamName: project.logsConfig.cloudWatchLogs.streamName,
      } : undefined,
      s3Logs: project.logsConfig.s3Logs ? {
        status: project.logsConfig.s3Logs.status as 'ENABLED' | 'DISABLED',
        location: project.logsConfig.s3Logs.location,
        encryptionDisabled: project.logsConfig.s3Logs.encryptionDisabled,
        bucketOwnerAccess: project.logsConfig.s3Logs.bucketOwnerAccess as 'NONE' | 'READ_ONLY' | 'FULL',
      } : undefined,
    } : undefined,
    concurrentBuildLimit: project.concurrentBuildLimit,
    projectVisibility: project.projectVisibility as 'PUBLIC_READ' | 'PRIVATE',
    publicProjectAlias: project.publicProjectAlias,
    resourceAccessRole: project.resourceAccessRole,
  });

  // Helper to convert AWS build to our format
  const convertBuild = (build: Build): BuildInfo => ({
    id: build.id ?? '',
    arn: build.arn,
    buildNumber: build.buildNumber,
    startTime: build.startTime,
    endTime: build.endTime,
    currentPhase: build.currentPhase as BuildInfo['currentPhase'],
    buildStatus: build.buildStatus as BuildInfo['buildStatus'],
    sourceVersion: build.sourceVersion,
    resolvedSourceVersion: build.resolvedSourceVersion,
    projectName: build.projectName ?? '',
    phases: (build.phases ?? []).map(phase => ({
      phaseType: phase.phaseType as BuildInfo['phases'][0]['phaseType'],
      phaseStatus: phase.phaseStatus as BuildInfo['phases'][0]['phaseStatus'],
      startTime: phase.startTime,
      endTime: phase.endTime,
      durationInSeconds: phase.durationInSeconds,
      contexts: phase.contexts?.map(c => ({
        statusCode: c.statusCode,
        message: c.message,
      })),
    })),
    source: build.source ? {
      type: build.source.type as BuildSourceInfo['type'],
      location: build.source.location,
      gitCloneDepth: build.source.gitCloneDepth,
      buildspec: build.source.buildspec,
      reportBuildStatus: build.source.reportBuildStatus,
      insecureSsl: build.source.insecureSsl,
    } : undefined,
    artifacts: build.artifacts ? {
      location: build.artifacts.location,
      sha256sum: build.artifacts.sha256sum,
      md5sum: build.artifacts.md5sum,
      overrideArtifactName: build.artifacts.overrideArtifactName,
      encryptionDisabled: build.artifacts.encryptionDisabled,
      artifactIdentifier: build.artifacts.artifactIdentifier,
      bucketOwnerAccess: build.artifacts.bucketOwnerAccess as 'NONE' | 'READ_ONLY' | 'FULL',
    } : undefined,
    environment: {
      type: build.environment?.type as BuildEnvironmentInfo['type'],
      image: build.environment?.image ?? '',
      computeType: build.environment?.computeType as BuildEnvironmentInfo['computeType'],
      environmentVariables: build.environment?.environmentVariables?.map(ev => ({
        name: ev.name ?? '',
        value: ev.value ?? '',
        type: ev.type as 'PLAINTEXT' | 'PARAMETER_STORE' | 'SECRETS_MANAGER',
      })),
      privilegedMode: build.environment?.privilegedMode,
      certificate: build.environment?.certificate,
      imagePullCredentialsType: build.environment?.imagePullCredentialsType as 'CODEBUILD' | 'SERVICE_ROLE',
    },
    serviceRole: build.serviceRole,
    logs: build.logs ? {
      groupName: build.logs.groupName,
      streamName: build.logs.streamName,
      deepLink: build.logs.deepLink,
      s3DeepLink: build.logs.s3DeepLink,
      cloudWatchLogsArn: build.logs.cloudWatchLogsArn,
      s3LogsArn: build.logs.s3LogsArn,
    } : undefined,
    timeoutInMinutes: build.timeoutInMinutes,
    queuedTimeoutInMinutes: build.queuedTimeoutInMinutes,
    buildComplete: build.buildComplete ?? false,
    initiator: build.initiator,
    vpcConfig: build.vpcConfig ? {
      vpcId: build.vpcConfig.vpcId ?? '',
      subnets: build.vpcConfig.subnets ?? [],
      securityGroupIds: build.vpcConfig.securityGroupIds ?? [],
    } : undefined,
    encryptionKey: build.encryptionKey,
    exportedEnvironmentVariables: build.exportedEnvironmentVariables?.map(ev => ({
      name: ev.name ?? '',
      value: ev.value ?? '',
    })),
    reportArns: build.reportArns,
    buildBatchArn: build.buildBatchArn,
  });

  // Helper to convert AWS deployment group to our format
  const convertDeploymentGroup = (dg: AWSDeploymentGroupInfo): DeploymentGroupInfo => ({
    applicationName: dg.applicationName ?? '',
    deploymentGroupId: dg.deploymentGroupId ?? '',
    deploymentGroupName: dg.deploymentGroupName ?? '',
    deploymentConfigName: dg.deploymentConfigName,
    ec2TagFilters: dg.ec2TagFilters?.map(f => ({
      key: f.Key,
      value: f.Value,
      type: f.Type as 'KEY_ONLY' | 'VALUE_ONLY' | 'KEY_AND_VALUE',
    })),
    autoScalingGroups: dg.autoScalingGroups?.map(asg => ({
      name: asg.name,
      hook: asg.hook,
    })),
    serviceRoleArn: dg.serviceRoleArn ?? '',
    triggerConfigurations: dg.triggerConfigurations?.map(t => ({
      triggerName: t.triggerName ?? '',
      triggerTargetArn: t.triggerTargetArn,
      triggerEvents: t.triggerEvents as DeploymentGroupInfo['triggerConfigurations'] extends (infer U)[] | undefined ? U extends { triggerEvents?: infer E } ? E : never : never,
    })),
    alarmConfiguration: dg.alarmConfiguration ? {
      enabled: dg.alarmConfiguration.enabled ?? false,
      ignorePollAlarmFailure: dg.alarmConfiguration.ignorePollAlarmFailure,
      alarms: dg.alarmConfiguration.alarms?.map(a => ({ name: a.name ?? '' })),
    } : undefined,
    autoRollbackConfiguration: dg.autoRollbackConfiguration ? {
      enabled: dg.autoRollbackConfiguration.enabled ?? false,
      events: dg.autoRollbackConfiguration.events as DeploymentGroupInfo['autoRollbackConfiguration'] extends { events?: infer E } | undefined ? E : never,
    } : undefined,
    deploymentStyle: dg.deploymentStyle ? {
      deploymentType: dg.deploymentStyle.deploymentType as 'IN_PLACE' | 'BLUE_GREEN',
      deploymentOption: dg.deploymentStyle.deploymentOption as 'WITH_TRAFFIC_CONTROL' | 'WITHOUT_TRAFFIC_CONTROL',
    } : undefined,
    outdatedInstancesStrategy: dg.outdatedInstancesStrategy as 'UPDATE' | 'IGNORE',
    blueGreenDeploymentConfiguration: dg.blueGreenDeploymentConfiguration ? {
      terminateBlueInstancesOnDeploymentSuccess: dg.blueGreenDeploymentConfiguration.terminateBlueInstancesOnDeploymentSuccess ? {
        action: dg.blueGreenDeploymentConfiguration.terminateBlueInstancesOnDeploymentSuccess.action as 'TERMINATE' | 'KEEP_ALIVE',
        terminationWaitTimeInMinutes: dg.blueGreenDeploymentConfiguration.terminateBlueInstancesOnDeploymentSuccess.terminationWaitTimeInMinutes,
      } : undefined,
      deploymentReadyOption: dg.blueGreenDeploymentConfiguration.deploymentReadyOption ? {
        actionOnTimeout: dg.blueGreenDeploymentConfiguration.deploymentReadyOption.actionOnTimeout as 'CONTINUE_DEPLOYMENT' | 'STOP_DEPLOYMENT',
        waitTimeInMinutes: dg.blueGreenDeploymentConfiguration.deploymentReadyOption.waitTimeInMinutes,
      } : undefined,
      greenFleetProvisioningOption: dg.blueGreenDeploymentConfiguration.greenFleetProvisioningOption ? {
        action: dg.blueGreenDeploymentConfiguration.greenFleetProvisioningOption.action as 'DISCOVER_EXISTING' | 'COPY_AUTO_SCALING_GROUP',
      } : undefined,
    } : undefined,
    loadBalancerInfo: dg.loadBalancerInfo ? {
      elbInfoList: dg.loadBalancerInfo.elbInfoList?.map(elb => ({ name: elb.name ?? '' })),
      targetGroupInfoList: dg.loadBalancerInfo.targetGroupInfoList?.map(tg => ({ name: tg.name ?? '' })),
      targetGroupPairInfoList: dg.loadBalancerInfo.targetGroupPairInfoList?.map(tgp => ({
        targetGroups: tgp.targetGroups?.map(tg => ({ name: tg.name ?? '' })),
        prodTrafficRoute: tgp.prodTrafficRoute ? { listenerArns: tgp.prodTrafficRoute.listenerArns ?? [] } : undefined,
        testTrafficRoute: tgp.testTrafficRoute ? { listenerArns: tgp.testTrafficRoute.listenerArns ?? [] } : undefined,
      })),
    } : undefined,
    lastSuccessfulDeployment: dg.lastSuccessfulDeployment ? {
      deploymentId: dg.lastSuccessfulDeployment.deploymentId,
      status: dg.lastSuccessfulDeployment.status as DeploymentGroupInfo['lastSuccessfulDeployment'] extends { status?: infer S } | undefined ? S : never,
      endTime: dg.lastSuccessfulDeployment.endTime,
      createTime: dg.lastSuccessfulDeployment.createTime,
    } : undefined,
    lastAttemptedDeployment: dg.lastAttemptedDeployment ? {
      deploymentId: dg.lastAttemptedDeployment.deploymentId,
      status: dg.lastAttemptedDeployment.status as DeploymentGroupInfo['lastAttemptedDeployment'] extends { status?: infer S } | undefined ? S : never,
      endTime: dg.lastAttemptedDeployment.endTime,
      createTime: dg.lastAttemptedDeployment.createTime,
    } : undefined,
    computePlatform: dg.computePlatform as DeploymentGroupInfo['computePlatform'],
    ecsServices: dg.ecsServices?.map(svc => ({
      serviceName: svc.serviceName ?? '',
      clusterName: svc.clusterName ?? '',
    })),
    terminationHookEnabled: dg.terminationHookEnabled,
  });

  // Helper to convert AWS deployment to our format
  const convertDeployment = (deployment: AWSDeploymentInfo): DeploymentInfo => ({
    applicationName: deployment.applicationName ?? '',
    deploymentGroupName: deployment.deploymentGroupName ?? '',
    deploymentConfigName: deployment.deploymentConfigName,
    deploymentId: deployment.deploymentId ?? '',
    previousRevision: deployment.previousRevision ? {
      revisionType: deployment.previousRevision.revisionType as 'S3' | 'GitHub' | 'String' | 'AppSpecContent',
      s3Location: deployment.previousRevision.s3Location ? {
        bucket: deployment.previousRevision.s3Location.bucket ?? '',
        key: deployment.previousRevision.s3Location.key ?? '',
        bundleType: deployment.previousRevision.s3Location.bundleType as 'tar' | 'tgz' | 'zip' | 'YAML' | 'JSON',
        version: deployment.previousRevision.s3Location.version,
        eTag: deployment.previousRevision.s3Location.eTag,
      } : undefined,
      gitHubLocation: deployment.previousRevision.gitHubLocation ? {
        repository: deployment.previousRevision.gitHubLocation.repository ?? '',
        commitId: deployment.previousRevision.gitHubLocation.commitId ?? '',
      } : undefined,
    } : undefined,
    revision: deployment.revision ? {
      revisionType: deployment.revision.revisionType as 'S3' | 'GitHub' | 'String' | 'AppSpecContent',
      s3Location: deployment.revision.s3Location ? {
        bucket: deployment.revision.s3Location.bucket ?? '',
        key: deployment.revision.s3Location.key ?? '',
        bundleType: deployment.revision.s3Location.bundleType as 'tar' | 'tgz' | 'zip' | 'YAML' | 'JSON',
        version: deployment.revision.s3Location.version,
        eTag: deployment.revision.s3Location.eTag,
      } : undefined,
      gitHubLocation: deployment.revision.gitHubLocation ? {
        repository: deployment.revision.gitHubLocation.repository ?? '',
        commitId: deployment.revision.gitHubLocation.commitId ?? '',
      } : undefined,
    } : undefined,
    status: deployment.status as DeploymentInfo['status'],
    errorInformation: deployment.errorInformation ? {
      code: deployment.errorInformation.code,
      message: deployment.errorInformation.message,
    } : undefined,
    createTime: deployment.createTime,
    startTime: deployment.startTime,
    completeTime: deployment.completeTime,
    deploymentOverview: deployment.deploymentOverview ? {
      Pending: deployment.deploymentOverview.Pending,
      InProgress: deployment.deploymentOverview.InProgress,
      Succeeded: deployment.deploymentOverview.Succeeded,
      Failed: deployment.deploymentOverview.Failed,
      Skipped: deployment.deploymentOverview.Skipped,
      Ready: deployment.deploymentOverview.Ready,
    } : undefined,
    description: deployment.description,
    creator: deployment.creator as DeploymentInfo['creator'],
    ignoreApplicationStopFailures: deployment.ignoreApplicationStopFailures,
    autoRollbackConfiguration: deployment.autoRollbackConfiguration ? {
      enabled: deployment.autoRollbackConfiguration.enabled ?? false,
      events: deployment.autoRollbackConfiguration.events as DeploymentInfo['autoRollbackConfiguration'] extends { events?: infer E } | undefined ? E : never,
    } : undefined,
    updateOutdatedInstancesOnly: deployment.updateOutdatedInstancesOnly,
    rollbackInfo: deployment.rollbackInfo ? {
      rollbackDeploymentId: deployment.rollbackInfo.rollbackDeploymentId,
      rollbackTriggeringDeploymentId: deployment.rollbackInfo.rollbackTriggeringDeploymentId,
      rollbackMessage: deployment.rollbackInfo.rollbackMessage,
    } : undefined,
    deploymentStyle: deployment.deploymentStyle ? {
      deploymentType: deployment.deploymentStyle.deploymentType as 'IN_PLACE' | 'BLUE_GREEN',
      deploymentOption: deployment.deploymentStyle.deploymentOption as 'WITH_TRAFFIC_CONTROL' | 'WITHOUT_TRAFFIC_CONTROL',
    } : undefined,
    computePlatform: deployment.computePlatform as DeploymentInfo['computePlatform'],
    externalId: deployment.externalId,
  });

  return {
    // =========================================================================
    // Pipeline Operations
    // =========================================================================

    async listPipelines(options?: ListPipelinesOptions): Promise<CICDOperationResult<{ pipelines: PipelineSummary[]; nextToken?: string }>> {
      try {
        const response = await pipelineClient.send(new ListPipelinesCommand({
          maxResults: options?.maxResults,
          nextToken: options?.nextToken,
        }));

        return {
          success: true,
          data: {
            pipelines: (response.pipelines ?? []).map(p => ({
              pipelineName: p.name ?? '',
              version: p.version ?? 1,
              created: p.created,
              updated: p.updated,
              pipelineType: p.pipelineType as PipelineSummary['pipelineType'],
              executionMode: p.executionMode as PipelineSummary['executionMode'],
            })),
            nextToken: response.nextToken,
          },
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    async getPipeline(pipelineName: string): Promise<CICDOperationResult<PipelineInfo>> {
      try {
        const response = await pipelineClient.send(new GetPipelineCommand({
          name: pipelineName,
        }));

        if (!response.pipeline) {
          return { success: false, error: 'Pipeline not found' };
        }

        const pipelineInfo = convertPipeline(response.pipeline);
        pipelineInfo.pipelineArn = response.metadata?.pipelineArn;
        pipelineInfo.created = response.metadata?.created;
        pipelineInfo.updated = response.metadata?.updated;

        return { success: true, data: pipelineInfo };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    async createPipeline(options: CreatePipelineOptions): Promise<CICDOperationResult<{ pipelineArn: string; version: number }>> {
      try {
        const pipeline = convertToAWSPipeline(options);
        const response = await pipelineClient.send(new CreatePipelineCommand({
          pipeline,
          tags: options.tags ? Object.entries(options.tags).map(([key, value]) => ({ key, value })) : undefined,
        }));

        return {
          success: true,
          data: {
            pipelineArn: response.pipeline?.name ? `arn:aws:codepipeline:${defaultRegion}:*:${response.pipeline.name}` : '',
            version: response.pipeline?.version ?? 1,
          },
          message: `Pipeline ${options.pipelineName} created successfully`,
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    async updatePipeline(options: UpdatePipelineOptions): Promise<CICDOperationResult<{ pipelineArn: string; version: number }>> {
      try {
        const pipeline: PipelineDeclaration = {
          name: options.pipeline.pipelineName,
          roleArn: options.pipeline.roleArn,
          artifactStore: {
            type: options.pipeline.artifactStore.type,
            location: options.pipeline.artifactStore.location,
            encryptionKey: options.pipeline.artifactStore.encryptionKey ? {
              id: options.pipeline.artifactStore.encryptionKey.id,
              type: options.pipeline.artifactStore.encryptionKey.type,
            } : undefined,
          },
          stages: options.pipeline.stages.map(stage => ({
            name: stage.stageName,
            actions: stage.actions.map(action => ({
              name: action.actionName,
              actionTypeId: {
                category: action.actionTypeId.category,
                owner: action.actionTypeId.owner,
                provider: action.actionTypeId.provider,
                version: action.actionTypeId.version,
              },
              runOrder: action.runOrder,
              configuration: action.configuration,
              inputArtifacts: action.inputArtifacts?.map(name => ({ name })),
              outputArtifacts: action.outputArtifacts?.map(name => ({ name })),
              region: action.region,
              namespace: action.namespace,
              roleArn: action.roleArn,
            })),
          })),
          version: options.pipeline.version,
          executionMode: options.pipeline.executionMode,
          pipelineType: options.pipeline.pipelineType,
        };

        const response = await pipelineClient.send(new UpdatePipelineCommand({ pipeline }));

        return {
          success: true,
          data: {
            pipelineArn: response.pipeline?.name ? `arn:aws:codepipeline:${defaultRegion}:*:${response.pipeline.name}` : '',
            version: response.pipeline?.version ?? 1,
          },
          message: `Pipeline ${options.pipeline.pipelineName} updated successfully`,
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    async deletePipeline(pipelineName: string): Promise<CICDOperationResult<void>> {
      try {
        await pipelineClient.send(new DeletePipelineCommand({ name: pipelineName }));
        return { success: true, message: `Pipeline ${pipelineName} deleted successfully` };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    // =========================================================================
    // Pipeline Execution
    // =========================================================================

    async startPipelineExecution(options: StartPipelineExecutionOptions): Promise<CICDOperationResult<{ pipelineExecutionId: string }>> {
      try {
        const response = await pipelineClient.send(new StartPipelineExecutionCommand({
          name: options.pipelineName,
          clientRequestToken: options.clientRequestToken,
          sourceRevisions: options.sourceRevisions?.map(sr => ({
            actionName: sr.actionName,
            revisionType: sr.revisionType,
            revisionValue: sr.revisionValue,
          })),
          variables: options.variables?.map(v => ({
            name: v.name,
            value: v.value,
          })),
        }));

        return {
          success: true,
          data: { pipelineExecutionId: response.pipelineExecutionId ?? '' },
          message: `Pipeline ${options.pipelineName} execution started`,
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    async stopPipelineExecution(options: StopPipelineExecutionOptions): Promise<CICDOperationResult<{ pipelineExecutionId: string }>> {
      try {
        const response = await pipelineClient.send(new StopPipelineExecutionCommand({
          pipelineName: options.pipelineName,
          pipelineExecutionId: options.pipelineExecutionId,
          abandon: options.abandon,
          reason: options.reason,
        }));

        return {
          success: true,
          data: { pipelineExecutionId: response.pipelineExecutionId ?? '' },
          message: `Pipeline execution ${options.pipelineExecutionId} stopped`,
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    async retryStageExecution(options: RetryStageExecutionOptions): Promise<CICDOperationResult<{ pipelineExecutionId: string }>> {
      try {
        const response = await pipelineClient.send(new RetryStageExecutionCommand({
          pipelineName: options.pipelineName,
          stageName: options.stageName,
          pipelineExecutionId: options.pipelineExecutionId,
          retryMode: options.retryMode,
        }));

        return {
          success: true,
          data: { pipelineExecutionId: response.pipelineExecutionId ?? '' },
          message: `Stage ${options.stageName} retry started`,
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    async listPipelineExecutions(options: ListPipelineExecutionsOptions): Promise<CICDOperationResult<{ executions: PipelineExecutionSummary[]; nextToken?: string }>> {
      try {
        const response = await pipelineClient.send(new ListPipelineExecutionsCommand({
          pipelineName: options.pipelineName,
          maxResults: options.maxResults,
          nextToken: options.nextToken,
          filter: options.filter ? {
            succeededInStage: options.filter.succeededInStage ? {
              stageName: options.filter.succeededInStage.stageName,
            } : undefined,
          } : undefined,
        }));

        return {
          success: true,
          data: {
            executions: (response.pipelineExecutionSummaries ?? []).map(e => ({
              pipelineExecutionId: e.pipelineExecutionId ?? '',
              status: e.status as PipelineExecutionSummary['status'],
              startTime: e.startTime,
              lastUpdateTime: e.lastUpdateTime,
              sourceRevisions: e.sourceRevisions?.map(sr => ({
                actionName: sr.actionName ?? '',
                revisionId: sr.revisionId,
                revisionSummary: sr.revisionSummary,
                revisionUrl: sr.revisionUrl,
              })),
              trigger: e.trigger ? {
                triggerType: e.trigger.triggerType ?? '',
                triggerDetail: e.trigger.triggerDetail,
              } : undefined,
              stopTrigger: e.stopTrigger ? {
                reason: e.stopTrigger.reason,
              } : undefined,
            })),
            nextToken: response.nextToken,
          },
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    async getPipelineExecution(pipelineName: string, pipelineExecutionId: string): Promise<CICDOperationResult<PipelineExecutionDetail>> {
      try {
        const response = await pipelineClient.send(new GetPipelineExecutionCommand({
          pipelineName,
          pipelineExecutionId,
        }));

        if (!response.pipelineExecution) {
          return { success: false, error: 'Pipeline execution not found' };
        }

        return {
          success: true,
          data: {
            pipelineExecutionId: response.pipelineExecution.pipelineExecutionId ?? '',
            pipelineName: response.pipelineExecution.pipelineName ?? '',
            pipelineVersion: response.pipelineExecution.pipelineVersion ?? 1,
            status: response.pipelineExecution.status as PipelineExecutionDetail['status'],
            statusSummary: response.pipelineExecution.statusSummary,
            artifactRevisions: response.pipelineExecution.artifactRevisions?.map(ar => ({
              name: ar.name ?? '',
              revisionId: ar.revisionId,
              revisionChangeIdentifier: ar.revisionChangeIdentifier,
              revisionSummary: ar.revisionSummary,
              created: ar.created,
              revisionUrl: ar.revisionUrl,
            })),
            variables: response.pipelineExecution.variables?.map(v => ({
              name: v.name ?? '',
              resolvedValue: v.resolvedValue ?? '',
            })),
          },
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    async getPipelineState(pipelineName: string): Promise<CICDOperationResult<{ stages: StageState[]; created?: Date; updated?: Date }>> {
      try {
        const response = await pipelineClient.send(new GetPipelineStateCommand({
          name: pipelineName,
        }));

        return {
          success: true,
          data: {
            stages: (response.stageStates ?? []).map(s => ({
              stageName: s.stageName ?? '',
              inboundExecution: s.inboundExecution ? {
                pipelineExecutionId: s.inboundExecution.pipelineExecutionId ?? '',
                status: s.inboundExecution.status as StageState['inboundExecution'] extends { status: infer S } | undefined ? S : never,
              } : undefined,
              inboundTransitionState: s.inboundTransitionState ? {
                enabled: s.inboundTransitionState.enabled ?? false,
                lastChangedBy: s.inboundTransitionState.lastChangedBy,
                lastChangedAt: s.inboundTransitionState.lastChangedAt,
                disabledReason: s.inboundTransitionState.disabledReason,
              } : undefined,
              actionStates: (s.actionStates ?? []).map(a => ({
                actionName: a.actionName ?? '',
                currentRevision: a.currentRevision ? {
                  revisionId: a.currentRevision.revisionId ?? '',
                  revisionChangeId: a.currentRevision.revisionChangeId,
                  created: a.currentRevision.created,
                } : undefined,
                latestExecution: a.latestExecution ? {
                  actionExecutionId: a.latestExecution.actionExecutionId ?? '',
                  status: a.latestExecution.status as StageState['actionStates'][0]['latestExecution'] extends { status: infer S } | undefined ? S : never,
                  summary: a.latestExecution.summary,
                  lastStatusChange: a.latestExecution.lastStatusChange,
                  token: a.latestExecution.token,
                  lastUpdatedBy: a.latestExecution.lastUpdatedBy,
                  externalExecutionId: a.latestExecution.externalExecutionId,
                  externalExecutionUrl: a.latestExecution.externalExecutionUrl,
                  percentComplete: a.latestExecution.percentComplete,
                  errorDetails: a.latestExecution.errorDetails ? {
                    code: a.latestExecution.errorDetails.code,
                    message: a.latestExecution.errorDetails.message,
                  } : undefined,
                } : undefined,
                entityUrl: a.entityUrl,
                revisionUrl: a.revisionUrl,
              })),
              latestExecution: s.latestExecution ? {
                pipelineExecutionId: s.latestExecution.pipelineExecutionId ?? '',
                status: s.latestExecution.status as StageState['latestExecution'] extends { status: infer S } | undefined ? S : never,
              } : undefined,
            })),
            created: response.created,
            updated: response.updated,
          },
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    // =========================================================================
    // Action Executions
    // =========================================================================

    async listActionExecutions(options: ListActionExecutionsOptions): Promise<CICDOperationResult<{ actionExecutions: ActionExecutionDetail[]; nextToken?: string }>> {
      try {
        const response = await pipelineClient.send(new ListActionExecutionsCommand({
          pipelineName: options.pipelineName,
          filter: options.filter ? {
            pipelineExecutionId: options.filter.pipelineExecutionId,
            latestInPipelineExecution: options.filter.latestInPipelineExecution ? {
              pipelineExecutionId: options.filter.latestInPipelineExecution.pipelineExecutionId,
              startTimeRange: options.filter.latestInPipelineExecution.startTimeRange,
            } : undefined,
          } : undefined,
          maxResults: options.maxResults,
          nextToken: options.nextToken,
        }));

        return {
          success: true,
          data: {
            actionExecutions: (response.actionExecutionDetails ?? []).map(ae => ({
              pipelineExecutionId: ae.pipelineExecutionId ?? '',
              actionExecutionId: ae.actionExecutionId ?? '',
              pipelineVersion: ae.pipelineVersion ?? 1,
              stageName: ae.stageName ?? '',
              actionName: ae.actionName ?? '',
              startTime: ae.startTime,
              lastUpdateTime: ae.lastUpdateTime,
              status: ae.status as ActionExecutionDetail['status'],
              input: ae.input ? {
                actionTypeId: {
                  category: ae.input.actionTypeId?.category as ActionInfo['actionTypeId']['category'],
                  owner: ae.input.actionTypeId?.owner as ActionInfo['actionTypeId']['owner'],
                  provider: ae.input.actionTypeId?.provider ?? '',
                  version: ae.input.actionTypeId?.version ?? '1',
                },
                configuration: ae.input.configuration,
                resolvedConfiguration: ae.input.resolvedConfiguration,
                roleArn: ae.input.roleArn,
                region: ae.input.region,
                inputArtifacts: ae.input.inputArtifacts?.map(ia => ({
                    name: ia.name ?? '',
                    s3location: ia.s3location ? {
                      bucket: ia.s3location.bucket ?? '',
                      key: ia.s3location.key ?? '',
                    } : undefined,
                  })),
                namespace: ae.input.namespace,
              } : undefined,
              output: ae.output ? {
                outputArtifacts: ae.output.outputArtifacts?.map(oa => ({
                  name: oa.name ?? '',
                  s3location: oa.s3location ? {
                    bucket: oa.s3location.bucket ?? '',
                    key: oa.s3location.key ?? '',
                  } : undefined,
                })),
                executionResult: ae.output.executionResult ? {
                  externalExecutionId: ae.output.executionResult.externalExecutionId,
                  externalExecutionSummary: ae.output.executionResult.externalExecutionSummary,
                  externalExecutionUrl: ae.output.executionResult.externalExecutionUrl,
                } : undefined,
                outputVariables: ae.output.outputVariables,
              } : undefined,
            })),
            nextToken: response.nextToken,
          },
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    // =========================================================================
    // Stage Transitions
    // =========================================================================

    async enableStageTransition(pipelineName: string, stageName: string, transitionType: 'Inbound' | 'Outbound'): Promise<CICDOperationResult<void>> {
      try {
        await pipelineClient.send(new EnableStageTransitionCommand({
          pipelineName,
          stageName,
          transitionType,
        }));
        return { success: true, message: `Stage transition enabled for ${stageName}` };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    async disableStageTransition(pipelineName: string, stageName: string, transitionType: 'Inbound' | 'Outbound', reason: string): Promise<CICDOperationResult<void>> {
      try {
        await pipelineClient.send(new DisableStageTransitionCommand({
          pipelineName,
          stageName,
          transitionType,
          reason,
        }));
        return { success: true, message: `Stage transition disabled for ${stageName}` };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    // =========================================================================
    // Build Projects
    // =========================================================================

    async listBuildProjects(options?: ListBuildProjectsOptions): Promise<CICDOperationResult<{ projects: string[]; nextToken?: string }>> {
      try {
        const response = await buildClient.send(new ListProjectsCommand({
          sortBy: options?.sortBy,
          sortOrder: options?.sortOrder,
          nextToken: options?.nextToken,
        }));

        return {
          success: true,
          data: {
            projects: response.projects ?? [],
            nextToken: response.nextToken,
          },
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    async getBuildProject(projectName: string): Promise<CICDOperationResult<BuildProjectInfo>> {
      try {
        const response = await buildClient.send(new BatchGetProjectsCommand({
          names: [projectName],
        }));

        if (!response.projects || response.projects.length === 0) {
          return { success: false, error: 'Build project not found' };
        }

        return { success: true, data: convertBuildProject(response.projects[0]) };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    async getBuildProjects(projectNames: string[]): Promise<CICDOperationResult<BuildProjectInfo[]>> {
      try {
        const response = await buildClient.send(new BatchGetProjectsCommand({
          names: projectNames,
        }));

        return {
          success: true,
          data: (response.projects ?? []).map(p => convertBuildProject(p)),
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    async createBuildProject(options: CreateBuildProjectOptions): Promise<CICDOperationResult<BuildProjectInfo>> {
      try {
        const response = await buildClient.send(new CreateProjectCommand({
          name: options.name,
          description: options.description,
          source: {
            type: options.source.type,
            location: options.source.location,
            gitCloneDepth: options.source.gitCloneDepth,
            gitSubmodulesConfig: options.source.gitSubmodulesConfig ? {
              fetchSubmodules: options.source.gitSubmodulesConfig.fetchSubmodules,
            } : undefined,
            buildspec: options.source.buildspec,
            auth: options.source.auth ? {
              type: options.source.auth.type,
              resource: options.source.auth.resource,
            } : undefined,
            reportBuildStatus: options.source.reportBuildStatus,
            buildStatusConfig: options.source.buildStatusConfig ? {
              context: options.source.buildStatusConfig.context,
              targetUrl: options.source.buildStatusConfig.targetUrl,
            } : undefined,
            insecureSsl: options.source.insecureSsl,
            sourceIdentifier: options.source.sourceIdentifier,
          },
          artifacts: {
            type: options.artifacts.type,
            location: options.artifacts.location,
            path: options.artifacts.path,
            namespaceType: options.artifacts.namespaceType,
            name: options.artifacts.name,
            packaging: options.artifacts.packaging,
            overrideArtifactName: options.artifacts.overrideArtifactName,
            encryptionDisabled: options.artifacts.encryptionDisabled,
            artifactIdentifier: options.artifacts.artifactIdentifier,
            bucketOwnerAccess: options.artifacts.bucketOwnerAccess,
          },
          environment: {
            type: options.environment.type,
            image: options.environment.image,
            computeType: options.environment.computeType,
            environmentVariables: options.environment.environmentVariables?.map(ev => ({
              name: ev.name,
              value: ev.value,
              type: ev.type,
            })),
            privilegedMode: options.environment.privilegedMode,
            certificate: options.environment.certificate,
            registryCredential: options.environment.registryCredential ? {
              credential: options.environment.registryCredential.credential,
              credentialProvider: options.environment.registryCredential.credentialProvider,
            } : undefined,
            imagePullCredentialsType: options.environment.imagePullCredentialsType,
          },
          serviceRole: options.serviceRole,
          timeoutInMinutes: options.timeoutInMinutes,
          queuedTimeoutInMinutes: options.queuedTimeoutInMinutes,
          encryptionKey: options.encryptionKey,
          tags: options.tags ? Object.entries(options.tags).map(([key, value]) => ({ key, value })) : undefined,
          vpcConfig: options.vpcConfig ? {
            vpcId: options.vpcConfig.vpcId,
            subnets: options.vpcConfig.subnets,
            securityGroupIds: options.vpcConfig.securityGroupIds,
          } : undefined,
          badgeEnabled: options.badgeEnabled,
          logsConfig: options.logsConfig ? {
            cloudWatchLogs: options.logsConfig.cloudWatchLogs ? {
              status: options.logsConfig.cloudWatchLogs.status,
              groupName: options.logsConfig.cloudWatchLogs.groupName,
              streamName: options.logsConfig.cloudWatchLogs.streamName,
            } : undefined,
            s3Logs: options.logsConfig.s3Logs ? {
              status: options.logsConfig.s3Logs.status,
              location: options.logsConfig.s3Logs.location,
              encryptionDisabled: options.logsConfig.s3Logs.encryptionDisabled,
              bucketOwnerAccess: options.logsConfig.s3Logs.bucketOwnerAccess,
            } : undefined,
          } : undefined,
          concurrentBuildLimit: options.concurrentBuildLimit,
        }));

        if (!response.project) {
          return { success: false, error: 'Failed to create build project' };
        }

        return {
          success: true,
          data: convertBuildProject(response.project),
          message: `Build project ${options.name} created successfully`,
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    async updateBuildProject(options: UpdateBuildProjectOptions): Promise<CICDOperationResult<BuildProjectInfo>> {
      try {
        const response = await buildClient.send(new UpdateProjectCommand({
          name: options.name,
          description: options.description,
          source: options.source ? {
            type: options.source.type,
            location: options.source.location,
            gitCloneDepth: options.source.gitCloneDepth,
            buildspec: options.source.buildspec,
            reportBuildStatus: options.source.reportBuildStatus,
            insecureSsl: options.source.insecureSsl,
          } : undefined,
          artifacts: options.artifacts ? {
            type: options.artifacts.type,
            location: options.artifacts.location,
            path: options.artifacts.path,
            namespaceType: options.artifacts.namespaceType,
            name: options.artifacts.name,
            packaging: options.artifacts.packaging,
            overrideArtifactName: options.artifacts.overrideArtifactName,
            encryptionDisabled: options.artifacts.encryptionDisabled,
          } : undefined,
          environment: options.environment ? {
            type: options.environment.type,
            image: options.environment.image,
            computeType: options.environment.computeType,
            environmentVariables: options.environment.environmentVariables?.map(ev => ({
              name: ev.name,
              value: ev.value,
              type: ev.type,
            })),
            privilegedMode: options.environment.privilegedMode,
          } : undefined,
          serviceRole: options.serviceRole,
          timeoutInMinutes: options.timeoutInMinutes,
          queuedTimeoutInMinutes: options.queuedTimeoutInMinutes,
          encryptionKey: options.encryptionKey,
          tags: options.tags ? Object.entries(options.tags).map(([key, value]) => ({ key, value })) : undefined,
          concurrentBuildLimit: options.concurrentBuildLimit,
        }));

        if (!response.project) {
          return { success: false, error: 'Failed to update build project' };
        }

        return {
          success: true,
          data: convertBuildProject(response.project),
          message: `Build project ${options.name} updated successfully`,
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    async deleteBuildProject(projectName: string): Promise<CICDOperationResult<void>> {
      try {
        await buildClient.send(new DeleteProjectCommand({ name: projectName }));
        return { success: true, message: `Build project ${projectName} deleted successfully` };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    // =========================================================================
    // Builds
    // =========================================================================

    async startBuild(options: StartBuildOptions): Promise<CICDOperationResult<BuildInfo>> {
      try {
        const response = await buildClient.send(new StartBuildCommand({
          projectName: options.projectName,
          sourceVersion: options.sourceVersion,
          artifactsOverride: options.artifactsOverride ? {
            type: options.artifactsOverride.type,
            location: options.artifactsOverride.location,
            path: options.artifactsOverride.path,
            namespaceType: options.artifactsOverride.namespaceType,
            name: options.artifactsOverride.name,
            packaging: options.artifactsOverride.packaging,
            overrideArtifactName: options.artifactsOverride.overrideArtifactName,
            encryptionDisabled: options.artifactsOverride.encryptionDisabled,
          } : undefined,
          environmentVariablesOverride: options.environmentVariablesOverride?.map(ev => ({
            name: ev.name,
            value: ev.value,
            type: ev.type,
          })),
          sourceTypeOverride: options.sourceTypeOverride,
          sourceLocationOverride: options.sourceLocationOverride,
          gitCloneDepthOverride: options.gitCloneDepthOverride,
          buildspecOverride: options.buildspecOverride,
          insecureSslOverride: options.insecureSslOverride,
          reportBuildStatusOverride: options.reportBuildStatusOverride,
          environmentTypeOverride: options.environmentTypeOverride,
          imageOverride: options.imageOverride,
          computeTypeOverride: options.computeTypeOverride,
          certificateOverride: options.certificateOverride,
          serviceRoleOverride: options.serviceRoleOverride,
          privilegedModeOverride: options.privilegedModeOverride,
          timeoutInMinutesOverride: options.timeoutInMinutesOverride,
          queuedTimeoutInMinutesOverride: options.queuedTimeoutInMinutesOverride,
          encryptionKeyOverride: options.encryptionKeyOverride,
          idempotencyToken: options.idempotencyToken,
          debugSessionEnabled: options.debugSessionEnabled,
        }));

        if (!response.build) {
          return { success: false, error: 'Failed to start build' };
        }

        return {
          success: true,
          data: convertBuild(response.build),
          message: `Build started for project ${options.projectName}`,
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    async stopBuild(buildId: string): Promise<CICDOperationResult<BuildInfo>> {
      try {
        const response = await buildClient.send(new StopBuildCommand({ id: buildId }));

        if (!response.build) {
          return { success: false, error: 'Failed to stop build' };
        }

        return {
          success: true,
          data: convertBuild(response.build),
          message: `Build ${buildId} stopped`,
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    async retryBuild(buildId: string): Promise<CICDOperationResult<BuildInfo>> {
      try {
        const response = await buildClient.send(new RetryBuildCommand({ id: buildId }));

        if (!response.build) {
          return { success: false, error: 'Failed to retry build' };
        }

        return {
          success: true,
          data: convertBuild(response.build),
          message: `Build ${buildId} retried`,
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    async listBuilds(options?: ListBuildsOptions): Promise<CICDOperationResult<{ buildIds: string[]; nextToken?: string }>> {
      try {
        const response = await buildClient.send(new ListBuildsCommand({
          sortOrder: options?.sortOrder,
          nextToken: options?.nextToken,
        }));

        return {
          success: true,
          data: {
            buildIds: response.ids ?? [],
            nextToken: response.nextToken,
          },
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    async listBuildsForProject(options: ListBuildsForProjectOptions): Promise<CICDOperationResult<{ buildIds: string[]; nextToken?: string }>> {
      try {
        const response = await buildClient.send(new ListBuildsForProjectCommand({
          projectName: options.projectName,
          sortOrder: options.sortOrder,
          nextToken: options.nextToken,
        }));

        return {
          success: true,
          data: {
            buildIds: response.ids ?? [],
            nextToken: response.nextToken,
          },
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    async getBuild(buildId: string): Promise<CICDOperationResult<BuildInfo>> {
      try {
        const response = await buildClient.send(new BatchGetBuildsCommand({
          ids: [buildId],
        }));

        if (!response.builds || response.builds.length === 0) {
          return { success: false, error: 'Build not found' };
        }

        return { success: true, data: convertBuild(response.builds[0]) };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    async getBuilds(buildIds: string[]): Promise<CICDOperationResult<BuildInfo[]>> {
      try {
        const response = await buildClient.send(new BatchGetBuildsCommand({
          ids: buildIds,
        }));

        return {
          success: true,
          data: (response.builds ?? []).map(b => convertBuild(b)),
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    async getBuildLogs(buildId: string): Promise<CICDOperationResult<{ logGroupName?: string; logStreamName?: string; deepLink?: string; logs?: string }>> {
      try {
        // First get the build to find the log location
        const buildResult = await this.getBuild(buildId);
        if (!buildResult.success || !buildResult.data) {
          return { success: false, error: buildResult.error ?? 'Build not found' };
        }

        const logs = buildResult.data.logs;
        if (!logs) {
          return { success: false, error: 'Build logs not available' };
        }

        let logContent: string | undefined;

        // Try to fetch CloudWatch logs if available
        if (logs.groupName && logs.streamName) {
          try {
            const logResponse = await logsClient.send(new GetLogEventsCommand({
              logGroupName: logs.groupName,
              logStreamName: logs.streamName,
              startFromHead: true,
            }));

            logContent = logResponse.events?.map(e => e.message).join('\n');
          } catch {
            // CloudWatch logs may not be accessible
          }
        }

        return {
          success: true,
          data: {
            logGroupName: logs.groupName,
            logStreamName: logs.streamName,
            deepLink: logs.deepLink,
            logs: logContent,
          },
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    // =========================================================================
    // CodeDeploy Applications
    // =========================================================================

    async listApplications(options?: ListApplicationsOptions): Promise<CICDOperationResult<{ applications: string[]; nextToken?: string }>> {
      try {
        const response = await deployClient.send(new ListApplicationsCommand({
          nextToken: options?.nextToken,
        }));

        return {
          success: true,
          data: {
            applications: response.applications ?? [],
            nextToken: response.nextToken,
          },
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    async getApplication(applicationName: string): Promise<CICDOperationResult<ApplicationInfo>> {
      try {
        const response = await deployClient.send(new GetApplicationCommand({
          applicationName,
        }));

        if (!response.application) {
          return { success: false, error: 'Application not found' };
        }

        return {
          success: true,
          data: {
            applicationId: response.application.applicationId ?? '',
            applicationName: response.application.applicationName ?? '',
            createTime: response.application.createTime,
            linkedToGitHub: response.application.linkedToGitHub,
            gitHubAccountName: response.application.gitHubAccountName,
            computePlatform: response.application.computePlatform as ApplicationInfo['computePlatform'],
          },
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    async createApplication(options: CreateApplicationOptions): Promise<CICDOperationResult<{ applicationId: string }>> {
      try {
        const response = await deployClient.send(new CreateApplicationCommand({
          applicationName: options.applicationName,
          computePlatform: options.computePlatform,
          tags: options.tags ? Object.entries(options.tags).map(([Key, Value]) => ({ Key, Value })) : undefined,
        }));

        return {
          success: true,
          data: { applicationId: response.applicationId ?? '' },
          message: `Application ${options.applicationName} created successfully`,
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    async deleteApplication(applicationName: string): Promise<CICDOperationResult<void>> {
      try {
        await deployClient.send(new DeleteApplicationCommand({ applicationName }));
        return { success: true, message: `Application ${applicationName} deleted successfully` };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    // =========================================================================
    // Deployment Groups
    // =========================================================================

    async listDeploymentGroups(options: ListDeploymentGroupsOptions): Promise<CICDOperationResult<{ deploymentGroups: string[]; nextToken?: string }>> {
      try {
        const response = await deployClient.send(new ListDeploymentGroupsCommand({
          applicationName: options.applicationName,
          nextToken: options.nextToken,
        }));

        return {
          success: true,
          data: {
            deploymentGroups: response.deploymentGroups ?? [],
            nextToken: response.nextToken,
          },
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    async getDeploymentGroup(applicationName: string, deploymentGroupName: string): Promise<CICDOperationResult<DeploymentGroupInfo>> {
      try {
        const response = await deployClient.send(new GetDeploymentGroupCommand({
          applicationName,
          deploymentGroupName,
        }));

        if (!response.deploymentGroupInfo) {
          return { success: false, error: 'Deployment group not found' };
        }

        return { success: true, data: convertDeploymentGroup(response.deploymentGroupInfo) };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    async createDeploymentGroup(options: CreateDeploymentGroupOptions): Promise<CICDOperationResult<{ deploymentGroupId: string }>> {
      try {
        const response = await deployClient.send(new CreateDeploymentGroupCommand({
          applicationName: options.applicationName,
          deploymentGroupName: options.deploymentGroupName,
          deploymentConfigName: options.deploymentConfigName,
          ec2TagFilters: options.ec2TagFilters?.map(f => ({
            Key: f.key,
            Value: f.value,
            Type: f.type,
          })),
          autoScalingGroups: options.autoScalingGroups,
          serviceRoleArn: options.serviceRoleArn,
          triggerConfigurations: options.triggerConfigurations?.map(t => ({
            triggerName: t.triggerName,
            triggerTargetArn: t.triggerTargetArn,
            triggerEvents: t.triggerEvents,
          })),
          alarmConfiguration: options.alarmConfiguration ? {
            enabled: options.alarmConfiguration.enabled,
            ignorePollAlarmFailure: options.alarmConfiguration.ignorePollAlarmFailure,
            alarms: options.alarmConfiguration.alarms,
          } : undefined,
          autoRollbackConfiguration: options.autoRollbackConfiguration ? {
            enabled: options.autoRollbackConfiguration.enabled,
            events: options.autoRollbackConfiguration.events,
          } : undefined,
          outdatedInstancesStrategy: options.outdatedInstancesStrategy,
          deploymentStyle: options.deploymentStyle ? {
            deploymentType: options.deploymentStyle.deploymentType,
            deploymentOption: options.deploymentStyle.deploymentOption,
          } : undefined,
          blueGreenDeploymentConfiguration: options.blueGreenDeploymentConfiguration ? {
            terminateBlueInstancesOnDeploymentSuccess: options.blueGreenDeploymentConfiguration.terminateBlueInstancesOnDeploymentSuccess ? {
              action: options.blueGreenDeploymentConfiguration.terminateBlueInstancesOnDeploymentSuccess.action,
              terminationWaitTimeInMinutes: options.blueGreenDeploymentConfiguration.terminateBlueInstancesOnDeploymentSuccess.terminationWaitTimeInMinutes,
            } : undefined,
            deploymentReadyOption: options.blueGreenDeploymentConfiguration.deploymentReadyOption ? {
              actionOnTimeout: options.blueGreenDeploymentConfiguration.deploymentReadyOption.actionOnTimeout,
              waitTimeInMinutes: options.blueGreenDeploymentConfiguration.deploymentReadyOption.waitTimeInMinutes,
            } : undefined,
            greenFleetProvisioningOption: options.blueGreenDeploymentConfiguration.greenFleetProvisioningOption ? {
              action: options.blueGreenDeploymentConfiguration.greenFleetProvisioningOption.action,
            } : undefined,
          } : undefined,
          loadBalancerInfo: options.loadBalancerInfo ? {
            elbInfoList: options.loadBalancerInfo.elbInfoList,
            targetGroupInfoList: options.loadBalancerInfo.targetGroupInfoList,
            targetGroupPairInfoList: options.loadBalancerInfo.targetGroupPairInfoList?.map(tgp => ({
              targetGroups: tgp.targetGroups,
              prodTrafficRoute: tgp.prodTrafficRoute,
              testTrafficRoute: tgp.testTrafficRoute,
            })),
          } : undefined,
          ec2TagSet: options.ec2TagSet ? {
            ec2TagSetList: options.ec2TagSet.ec2TagSetList?.map(tags => tags.map(t => ({
              Key: t.key,
              Value: t.value,
              Type: t.type,
            }))),
          } : undefined,
          ecsServices: options.ecsServices?.map(svc => ({
            serviceName: svc.serviceName,
            clusterName: svc.clusterName,
          })),
          terminationHookEnabled: options.terminationHookEnabled,
          tags: options.tags ? Object.entries(options.tags).map(([Key, Value]) => ({ Key, Value })) : undefined,
        }));

        return {
          success: true,
          data: { deploymentGroupId: response.deploymentGroupId ?? '' },
          message: `Deployment group ${options.deploymentGroupName} created successfully`,
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    async updateDeploymentGroup(options: UpdateDeploymentGroupOptions): Promise<CICDOperationResult<void>> {
      try {
        await deployClient.send(new UpdateDeploymentGroupCommand({
          applicationName: options.applicationName,
          currentDeploymentGroupName: options.currentDeploymentGroupName,
          newDeploymentGroupName: options.newDeploymentGroupName,
          deploymentConfigName: options.deploymentConfigName,
          ec2TagFilters: options.ec2TagFilters?.map(f => ({
            Key: f.key,
            Value: f.value,
            Type: f.type,
          })),
          autoScalingGroups: options.autoScalingGroups,
          serviceRoleArn: options.serviceRoleArn,
          triggerConfigurations: options.triggerConfigurations?.map(t => ({
            triggerName: t.triggerName,
            triggerTargetArn: t.triggerTargetArn,
            triggerEvents: t.triggerEvents,
          })),
          alarmConfiguration: options.alarmConfiguration ? {
            enabled: options.alarmConfiguration.enabled,
            ignorePollAlarmFailure: options.alarmConfiguration.ignorePollAlarmFailure,
            alarms: options.alarmConfiguration.alarms,
          } : undefined,
          autoRollbackConfiguration: options.autoRollbackConfiguration ? {
            enabled: options.autoRollbackConfiguration.enabled,
            events: options.autoRollbackConfiguration.events,
          } : undefined,
          outdatedInstancesStrategy: options.outdatedInstancesStrategy,
          deploymentStyle: options.deploymentStyle ? {
            deploymentType: options.deploymentStyle.deploymentType,
            deploymentOption: options.deploymentStyle.deploymentOption,
          } : undefined,
          blueGreenDeploymentConfiguration: options.blueGreenDeploymentConfiguration ? {
            terminateBlueInstancesOnDeploymentSuccess: options.blueGreenDeploymentConfiguration.terminateBlueInstancesOnDeploymentSuccess ? {
              action: options.blueGreenDeploymentConfiguration.terminateBlueInstancesOnDeploymentSuccess.action,
              terminationWaitTimeInMinutes: options.blueGreenDeploymentConfiguration.terminateBlueInstancesOnDeploymentSuccess.terminationWaitTimeInMinutes,
            } : undefined,
            deploymentReadyOption: options.blueGreenDeploymentConfiguration.deploymentReadyOption ? {
              actionOnTimeout: options.blueGreenDeploymentConfiguration.deploymentReadyOption.actionOnTimeout,
              waitTimeInMinutes: options.blueGreenDeploymentConfiguration.deploymentReadyOption.waitTimeInMinutes,
            } : undefined,
            greenFleetProvisioningOption: options.blueGreenDeploymentConfiguration.greenFleetProvisioningOption ? {
              action: options.blueGreenDeploymentConfiguration.greenFleetProvisioningOption.action,
            } : undefined,
          } : undefined,
          loadBalancerInfo: options.loadBalancerInfo ? {
            elbInfoList: options.loadBalancerInfo.elbInfoList,
            targetGroupInfoList: options.loadBalancerInfo.targetGroupInfoList,
          } : undefined,
          ecsServices: options.ecsServices?.map(svc => ({
            serviceName: svc.serviceName,
            clusterName: svc.clusterName,
          })),
          terminationHookEnabled: options.terminationHookEnabled,
        }));

        return { success: true, message: `Deployment group ${options.currentDeploymentGroupName} updated successfully` };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    async deleteDeploymentGroup(applicationName: string, deploymentGroupName: string): Promise<CICDOperationResult<void>> {
      try {
        await deployClient.send(new DeleteDeploymentGroupCommand({
          applicationName,
          deploymentGroupName,
        }));
        return { success: true, message: `Deployment group ${deploymentGroupName} deleted successfully` };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    // =========================================================================
    // Deployments
    // =========================================================================

    async createDeployment(options: CreateDeploymentOptions): Promise<CICDOperationResult<{ deploymentId: string }>> {
      try {
        const response = await deployClient.send(new CreateDeploymentCommand({
          applicationName: options.applicationName,
          deploymentGroupName: options.deploymentGroupName,
          revision: options.revision ? {
            revisionType: options.revision.revisionType,
            s3Location: options.revision.s3Location ? {
              bucket: options.revision.s3Location.bucket,
              key: options.revision.s3Location.key,
              bundleType: options.revision.s3Location.bundleType,
              version: options.revision.s3Location.version,
              eTag: options.revision.s3Location.eTag,
            } : undefined,
            gitHubLocation: options.revision.gitHubLocation ? {
              repository: options.revision.gitHubLocation.repository,
              commitId: options.revision.gitHubLocation.commitId,
            } : undefined,
            string: options.revision.string ? {
              content: options.revision.string.content,
              sha256: options.revision.string.sha256,
            } : undefined,
            appSpecContent: options.revision.appSpecContent ? {
              content: options.revision.appSpecContent.content,
              sha256: options.revision.appSpecContent.sha256,
            } : undefined,
          } : undefined,
          deploymentConfigName: options.deploymentConfigName,
          description: options.description,
          ignoreApplicationStopFailures: options.ignoreApplicationStopFailures,
          targetInstances: options.targetInstances ? {
            tagFilters: options.targetInstances.tagFilters?.map(f => ({
              Key: f.key,
              Value: f.value,
              Type: f.type,
            })),
            autoScalingGroups: options.targetInstances.autoScalingGroups,
            ec2TagSet: options.targetInstances.ec2TagSet ? {
              ec2TagSetList: options.targetInstances.ec2TagSet.ec2TagSetList?.map(tags => tags.map(t => ({
                Key: t.key,
                Value: t.value,
                Type: t.type,
              }))),
            } : undefined,
          } : undefined,
          autoRollbackConfiguration: options.autoRollbackConfiguration ? {
            enabled: options.autoRollbackConfiguration.enabled,
            events: options.autoRollbackConfiguration.events,
          } : undefined,
          updateOutdatedInstancesOnly: options.updateOutdatedInstancesOnly,
          fileExistsBehavior: options.fileExistsBehavior,
          overrideAlarmConfiguration: options.overrideAlarmConfiguration ? {
            enabled: options.overrideAlarmConfiguration.enabled,
            ignorePollAlarmFailure: options.overrideAlarmConfiguration.ignorePollAlarmFailure,
            alarms: options.overrideAlarmConfiguration.alarms,
          } : undefined,
        }));

        return {
          success: true,
          data: { deploymentId: response.deploymentId ?? '' },
          message: `Deployment started for ${options.applicationName}`,
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    async getDeployment(deploymentId: string): Promise<CICDOperationResult<DeploymentInfo>> {
      try {
        const response = await deployClient.send(new GetDeploymentCommand({
          deploymentId,
        }));

        if (!response.deploymentInfo) {
          return { success: false, error: 'Deployment not found' };
        }

        return { success: true, data: convertDeployment(response.deploymentInfo) };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    async listDeployments(options?: ListDeploymentsOptions): Promise<CICDOperationResult<{ deployments: string[]; nextToken?: string }>> {
      try {
        const response = await deployClient.send(new ListDeploymentsCommand({
          applicationName: options?.applicationName,
          deploymentGroupName: options?.deploymentGroupName,
          externalId: options?.externalId,
          includeOnlyStatuses: options?.includeOnlyStatuses,
          createTimeRange: options?.createTimeRange ? {
            start: options.createTimeRange.start,
            end: options.createTimeRange.end,
          } : undefined,
          nextToken: options?.nextToken,
        }));

        return {
          success: true,
          data: {
            deployments: response.deployments ?? [],
            nextToken: response.nextToken,
          },
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    async stopDeployment(deploymentId: string, autoRollbackEnabled?: boolean): Promise<CICDOperationResult<{ status: string; statusMessage?: string }>> {
      try {
        const response = await deployClient.send(new StopDeploymentCommand({
          deploymentId,
          autoRollbackEnabled,
        }));

        return {
          success: true,
          data: {
            status: response.status ?? 'Unknown',
            statusMessage: response.statusMessage,
          },
          message: `Deployment ${deploymentId} stopped`,
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    async continueDeployment(deploymentId: string, deploymentWaitType?: 'READY_WAIT' | 'TERMINATION_WAIT'): Promise<CICDOperationResult<void>> {
      try {
        await deployClient.send(new ContinueDeploymentCommand({
          deploymentId,
          deploymentWaitType,
        }));
        return { success: true, message: `Deployment ${deploymentId} continued` };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    // =========================================================================
    // Deployment Configs
    // =========================================================================

    async listDeploymentConfigs(options?: ListDeploymentConfigsOptions): Promise<CICDOperationResult<{ deploymentConfigs: string[]; nextToken?: string }>> {
      try {
        const response = await deployClient.send(new ListDeploymentConfigsCommand({
          nextToken: options?.nextToken,
        }));

        return {
          success: true,
          data: {
            deploymentConfigs: response.deploymentConfigsList ?? [],
            nextToken: response.nextToken,
          },
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    async getDeploymentConfig(deploymentConfigName: string): Promise<CICDOperationResult<DeploymentConfigInfo>> {
      try {
        const response = await deployClient.send(new GetDeploymentConfigCommand({
          deploymentConfigName,
        }));

        if (!response.deploymentConfigInfo) {
          return { success: false, error: 'Deployment config not found' };
        }

        return {
          success: true,
          data: {
            deploymentConfigId: response.deploymentConfigInfo.deploymentConfigId ?? '',
            deploymentConfigName: response.deploymentConfigInfo.deploymentConfigName ?? '',
            minimumHealthyHosts: response.deploymentConfigInfo.minimumHealthyHosts ? {
              type: response.deploymentConfigInfo.minimumHealthyHosts.type as 'HOST_COUNT' | 'FLEET_PERCENT',
              value: response.deploymentConfigInfo.minimumHealthyHosts.value ?? 0,
            } : undefined,
            createTime: response.deploymentConfigInfo.createTime,
            computePlatform: response.deploymentConfigInfo.computePlatform as DeploymentConfigInfo['computePlatform'],
            trafficRoutingConfig: response.deploymentConfigInfo.trafficRoutingConfig ? {
              type: response.deploymentConfigInfo.trafficRoutingConfig.type as DeploymentConfigInfo['trafficRoutingConfig'] extends { type: infer T } | undefined ? T : never,
              timeBasedCanary: response.deploymentConfigInfo.trafficRoutingConfig.timeBasedCanary ? {
                canaryPercentage: response.deploymentConfigInfo.trafficRoutingConfig.timeBasedCanary.canaryPercentage ?? 0,
                canaryInterval: response.deploymentConfigInfo.trafficRoutingConfig.timeBasedCanary.canaryInterval ?? 0,
              } : undefined,
              timeBasedLinear: response.deploymentConfigInfo.trafficRoutingConfig.timeBasedLinear ? {
                linearPercentage: response.deploymentConfigInfo.trafficRoutingConfig.timeBasedLinear.linearPercentage ?? 0,
                linearInterval: response.deploymentConfigInfo.trafficRoutingConfig.timeBasedLinear.linearInterval ?? 0,
              } : undefined,
            } : undefined,
          },
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    async createDeploymentConfig(options: CreateDeploymentConfigOptions): Promise<CICDOperationResult<{ deploymentConfigId: string }>> {
      try {
        const response = await deployClient.send(new CreateDeploymentConfigCommand({
          deploymentConfigName: options.deploymentConfigName,
          minimumHealthyHosts: options.minimumHealthyHosts ? {
            type: options.minimumHealthyHosts.type,
            value: options.minimumHealthyHosts.value,
          } : undefined,
          trafficRoutingConfig: options.trafficRoutingConfig ? {
            type: options.trafficRoutingConfig.type,
            timeBasedCanary: options.trafficRoutingConfig.timeBasedCanary ? {
              canaryPercentage: options.trafficRoutingConfig.timeBasedCanary.canaryPercentage,
              canaryInterval: options.trafficRoutingConfig.timeBasedCanary.canaryInterval,
            } : undefined,
            timeBasedLinear: options.trafficRoutingConfig.timeBasedLinear ? {
              linearPercentage: options.trafficRoutingConfig.timeBasedLinear.linearPercentage,
              linearInterval: options.trafficRoutingConfig.timeBasedLinear.linearInterval,
            } : undefined,
          } : undefined,
          computePlatform: options.computePlatform,
        }));

        return {
          success: true,
          data: { deploymentConfigId: response.deploymentConfigId ?? '' },
          message: `Deployment config ${options.deploymentConfigName} created successfully`,
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    async deleteDeploymentConfig(deploymentConfigName: string): Promise<CICDOperationResult<void>> {
      try {
        await deployClient.send(new DeleteDeploymentConfigCommand({
          deploymentConfigName,
        }));
        return { success: true, message: `Deployment config ${deploymentConfigName} deleted successfully` };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    // =========================================================================
    // Blue/Green Deployments
    // =========================================================================

    async configureBlueGreenDeployment(options: BlueGreenDeploymentOptions): Promise<CICDOperationResult<void>> {
      try {
        // Get current deployment group
        const dgResult = await this.getDeploymentGroup(options.applicationName, options.deploymentGroupName);
        if (!dgResult.success || !dgResult.data) {
          return { success: false, error: dgResult.error ?? 'Deployment group not found' };
        }

        // Update with blue/green configuration
        await this.updateDeploymentGroup({
          applicationName: options.applicationName,
          currentDeploymentGroupName: options.deploymentGroupName,
          deploymentStyle: {
            deploymentType: 'BLUE_GREEN',
            deploymentOption: 'WITH_TRAFFIC_CONTROL',
          },
          blueGreenDeploymentConfiguration: {
            terminateBlueInstancesOnDeploymentSuccess: {
              action: 'TERMINATE',
              terminationWaitTimeInMinutes: options.terminationWaitTimeMinutes ?? 5,
            },
            deploymentReadyOption: {
              actionOnTimeout: 'CONTINUE_DEPLOYMENT',
              waitTimeInMinutes: 0,
            },
            greenFleetProvisioningOption: {
              action: 'COPY_AUTO_SCALING_GROUP',
            },
          },
        });

        // Create or update deployment config with traffic routing
        const configName = `${options.deploymentGroupName}-bluegreen-${options.trafficRoutingType.toLowerCase()}`;
        
        await this.createDeploymentConfig({
          deploymentConfigName: configName,
          trafficRoutingConfig: {
            type: options.trafficRoutingType,
            timeBasedCanary: options.trafficRoutingType === 'TimeBasedCanary' ? {
              canaryPercentage: options.canaryPercentage ?? 10,
              canaryInterval: options.canaryIntervalMinutes ?? 10,
            } : undefined,
            timeBasedLinear: options.trafficRoutingType === 'TimeBasedLinear' ? {
              linearPercentage: options.linearPercentage ?? 10,
              linearInterval: options.linearIntervalMinutes ?? 10,
            } : undefined,
          },
          computePlatform: dgResult.data.computePlatform,
        });

        return {
          success: true,
          message: `Blue/green deployment configured for ${options.deploymentGroupName} with ${options.trafficRoutingType} routing`,
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    // =========================================================================
    // Rollback
    // =========================================================================

    async rollbackDeployment(deploymentId: string): Promise<CICDOperationResult<{ deploymentId: string }>> {
      try {
        // Get the deployment to find the previous revision
        const deploymentResult = await this.getDeployment(deploymentId);
        if (!deploymentResult.success || !deploymentResult.data) {
          return { success: false, error: deploymentResult.error ?? 'Deployment not found' };
        }

        const deployment = deploymentResult.data;

        // If there's no previous revision, we can't rollback
        if (!deployment.previousRevision) {
          return { success: false, error: 'No previous revision available for rollback' };
        }

        // Create a new deployment with the previous revision
        const rollbackResult = await this.createDeployment({
          applicationName: deployment.applicationName,
          deploymentGroupName: deployment.deploymentGroupName,
          revision: deployment.previousRevision,
          description: `Rollback from deployment ${deploymentId}`,
          autoRollbackConfiguration: {
            enabled: true,
            events: ['DEPLOYMENT_FAILURE'],
          },
        });

        if (!rollbackResult.success) {
          return { success: false, error: rollbackResult.error };
        }

        return {
          success: true,
          data: { deploymentId: rollbackResult.data!.deploymentId },
          message: `Rollback deployment started from ${deploymentId}`,
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    // =========================================================================
    // Templates
    // =========================================================================

    async getPipelineTemplates(): Promise<CICDOperationResult<PipelineTemplate[]>> {
      return {
        success: true,
        data: PIPELINE_TEMPLATES,
      };
    },

    async getPipelineTemplate(templateId: string): Promise<CICDOperationResult<PipelineTemplate>> {
      const template = PIPELINE_TEMPLATES.find(t => t.id === templateId);
      if (!template) {
        return { success: false, error: `Template ${templateId} not found` };
      }
      return { success: true, data: template };
    },

    async createPipelineFromTemplate(
      templateId: string,
      pipelineName: string,
      roleArn: string,
      artifactBucket: string,
      parameters: Record<string, string>
    ): Promise<CICDOperationResult<{ pipelineArn: string; version: number }>> {
      const templateResult = await this.getPipelineTemplate(templateId);
      if (!templateResult.success || !templateResult.data) {
        return { success: false, error: templateResult.error };
      }

      const template = templateResult.data;

      // Validate required parameters
      const missingParams = template.requiredParameters.filter(
        p => !parameters[p.name] && !p.defaultValue
      );
      if (missingParams.length > 0) {
        return {
          success: false,
          error: `Missing required parameters: ${missingParams.map(p => p.name).join(', ')}`,
        };
      }

      // Build stages based on template
      const stages: StageInfo[] = [];

      // Source stage
      if (template.stages.find(s => s.actionType === 'Source')) {
        const sourceAction: ActionInfo = {
          actionName: 'Source',
          actionTypeId: {
            category: 'Source',
            owner: 'AWS',
            provider: template.sourceProvider === 'CodeStarSourceConnection' ? 'CodeStarSourceConnection' : template.sourceProvider,
            version: '1',
          },
          runOrder: 1,
          outputArtifacts: ['SourceOutput'],
          configuration: {},
        };

        if (template.sourceProvider === 'CodeStarSourceConnection') {
          sourceAction.configuration = {
            ConnectionArn: parameters.connectionArn,
            FullRepositoryId: parameters.repositoryId,
            BranchName: parameters.branchName ?? 'main',
            OutputArtifactFormat: 'CODE_ZIP',
          };
        } else if (template.sourceProvider === 'CodeCommit') {
          sourceAction.configuration = {
            RepositoryName: parameters.repositoryName,
            BranchName: parameters.branchName ?? 'main',
            PollForSourceChanges: 'false',
          };
        } else if (template.sourceProvider === 'S3') {
          sourceAction.configuration = {
            S3Bucket: parameters.sourceBucket,
            S3ObjectKey: parameters.sourceKey,
            PollForSourceChanges: 'false',
          };
        }

        stages.push({
          stageName: 'Source',
          actions: [sourceAction],
        });
      }

      // Build stage
      if (template.stages.find(s => s.actionType === 'Build')) {
        const buildAction: ActionInfo = {
          actionName: 'Build',
          actionTypeId: {
            category: 'Build',
            owner: 'AWS',
            provider: 'CodeBuild',
            version: '1',
          },
          runOrder: 1,
          inputArtifacts: ['SourceOutput'],
          outputArtifacts: ['BuildOutput'],
          configuration: {
            ProjectName: parameters.buildProjectName ?? `${pipelineName}-build`,
          },
        };

        stages.push({
          stageName: 'Build',
          actions: [buildAction],
        });
      }

      // Deploy stage(s)
      const deployStages = template.stages.filter(s => s.actionType === 'Deploy');
      for (const deployStage of deployStages) {
        const deployAction: ActionInfo = {
          actionName: 'Deploy',
          actionTypeId: {
            category: 'Deploy',
            owner: 'AWS',
            provider: template.deployTarget === 'ECS' ? 'ECS' : 
                      template.deployTarget === 'S3' ? 'S3' :
                      template.deployTarget === 'Lambda' ? 'Lambda' :
                      template.deployTarget === 'CloudFormation' ? 'CloudFormation' :
                      'CodeDeploy',
            version: '1',
          },
          runOrder: 1,
          inputArtifacts: ['BuildOutput'],
          configuration: {},
        };

        if (template.deployTarget === 'ECS') {
          deployAction.configuration = {
            ClusterName: parameters.ecsClusterName ?? parameters.devCluster,
            ServiceName: parameters.ecsServiceName ?? parameters.devService,
            FileName: 'imagedefinitions.json',
          };
        } else if (template.deployTarget === 'S3') {
          deployAction.configuration = {
            BucketName: parameters.deployBucket,
            Extract: parameters.extractArtifacts ?? 'true',
          };
        } else if (template.deployTarget === 'Lambda') {
          deployAction.configuration = {
            FunctionName: parameters.functionName,
            UserParameters: '{}',
          };
        } else if (template.deployTarget === 'CloudFormation') {
          deployAction.configuration = {
            ActionMode: 'CREATE_UPDATE',
            StackName: parameters.stackName,
            TemplatePath: 'SourceOutput::template.yaml',
            Capabilities: 'CAPABILITY_IAM,CAPABILITY_NAMED_IAM,CAPABILITY_AUTO_EXPAND',
          };
        } else if (template.deployTarget === 'EC2') {
          deployAction.configuration = {
            ApplicationName: parameters.applicationName,
            DeploymentGroupName: parameters.deploymentGroupName,
          };
        }

        stages.push({
          stageName: deployStage.name,
          actions: [deployAction],
        });
      }

      // Approval stages
      const approvalStages = template.stages.filter(s => s.actionType === 'Approval');
      for (const approvalStage of approvalStages) {
        const approvalAction: ActionInfo = {
          actionName: 'Approval',
          actionTypeId: {
            category: 'Approval',
            owner: 'AWS',
            provider: 'Manual',
            version: '1',
          },
          runOrder: 1,
          configuration: {
            CustomData: `Approve deployment to ${approvalStage.name.replace('Approve', '')}`,
            NotificationArn: parameters.notificationTopic,
          },
        };

        // Find the right position for approval stage
        const stageIndex = template.stages.findIndex(s => s.name === approvalStage.name);
        stages.splice(stageIndex, 0, {
          stageName: approvalStage.name,
          actions: [approvalAction],
        });
      }

      // Create the pipeline
      return this.createPipeline({
        pipelineName,
        roleArn,
        artifactStore: {
          type: 'S3',
          location: artifactBucket,
        },
        stages,
        pipelineType: 'V2',
        executionMode: 'QUEUED',
      });
    },
  };
}
