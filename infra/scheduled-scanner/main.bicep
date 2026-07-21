targetScope = 'resourceGroup'

@description('Azure region for the scheduled scanner and its private runtime resources.')
param location string = resourceGroup().location

@description('Existing isolated Azure Storage account that contains scanner cache tables.')
param reportCacheStorageAccountName string

@description('Microsoft 365 tenant that owns the allowlisted SharePoint Site.')
@secure()
param scannerTenantId string

@description('Multi-tenant scanner application client ID hosted in the Azure subscription tenant.')
@secure()
param scannerClientId string

@description('Canonical Graph Site ID for the bounded scheduled pilot.')
@secure()
param allowedSiteId string

@allowed([
  'single-site'
  'registry'
])
@description('Fail-closed scanner scope mode. Keep single-site until the reviewed registry is ready.')
param scannerScopeMode string = 'single-site'

@description('Comma-separated exact document library names permitted for this pilot.')
param allowedLibraryNames string = 'Secret,Confidential'

@description('Comma-separated immutable sensitivity label IDs included in report counts.')
@secure()
param reportableLabelIds string

@description('Optional JSON object mapping approved label IDs to display names.')
@secure()
param labelDisplayNamesJson string

@minValue(1)
@maxValue(20)
@description('Maximum concurrent Graph item requests per Site worker.')
param maxConcurrency int = 4

@minValue(0)
@maxValue(10)
@description('Maximum retry attempts for retryable Graph requests.')
param maxRetries int = 3

@description('Nightly incremental schedule in six-field NCRONTAB UTC format.')
param nightlySchedule string = '0 0 18 * * *'

@description('Weekly reconciliation schedule in six-field NCRONTAB UTC format.')
param reconciliationSchedule string = '0 0 19 * * 6'

@description('Keep both timer triggers disabled until the bounded manual proof succeeds.')
param schedulesDisabled bool = true

@description('Create RBAC assignments. Set false only when an authorized administrator applies them separately.')
param assignManagedIdentityRoles bool = true

var suffix = take(uniqueString(subscription().id, resourceGroup().id, location, 'scanner'), 9)
var functionAppName = 'func-sp-sens-scan-${suffix}'
var functionPlanName = 'plan-sp-sens-scan-${suffix}'
var hostStorageAccountName = 'stfnscan${suffix}'
var hostIdentityName = 'id-sp-sens-scan-host'
var scannerIdentityName = 'id-sp-sens-scan-workload'
var logAnalyticsName = 'log-sp-sens-scan-${suffix}'
var applicationInsightsName = 'appi-sp-sens-scan-${suffix}'
var deploymentContainerName = 'app-package-${suffix}'
var jobQueueName = 'sensitivity-scan-jobs'

var storageBlobDataOwnerRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
)
var storageQueueDataContributorRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
)
var storageTableDataContributorRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
)
var monitoringMetricsPublisherRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '3913510d-42f4-4e42-8a64-420c390055eb'
)

resource reportCache 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: reportCacheStorageAccountName
}

resource hostStorage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: hostStorageAccountName
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Enabled'
    supportsHttpsTrafficOnly: true
  }
}

resource hostBlobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: hostStorage
  name: 'default'
}

resource deploymentContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: hostBlobService
  name: deploymentContainerName
  properties: {
    publicAccess: 'None'
  }
}

resource hostQueueService 'Microsoft.Storage/storageAccounts/queueServices@2023-05-01' = {
  parent: hostStorage
  name: 'default'
}

resource jobQueue 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = {
  parent: hostQueueService
  name: jobQueueName
}

resource hostIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: hostIdentityName
  location: location
}

resource scannerIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: scannerIdentityName
  location: location
}

resource hostBlobOwnerRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (assignManagedIdentityRoles) {
  name: guid(hostStorage.id, hostIdentity.id, storageBlobDataOwnerRoleId)
  scope: hostStorage
  properties: {
    principalId: hostIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageBlobDataOwnerRoleId
  }
}

resource hostQueueContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (assignManagedIdentityRoles) {
  name: guid(hostStorage.id, hostIdentity.id, storageQueueDataContributorRoleId)
  scope: hostStorage
  properties: {
    principalId: hostIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageQueueDataContributorRoleId
  }
}

resource hostTableContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (assignManagedIdentityRoles) {
  name: guid(hostStorage.id, hostIdentity.id, storageTableDataContributorRoleId)
  scope: hostStorage
  properties: {
    principalId: hostIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageTableDataContributorRoleId
  }
}

resource scannerCacheContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (assignManagedIdentityRoles) {
  name: guid(reportCache.id, scannerIdentity.id, storageTableDataContributorRoleId)
  scope: reportCache
  properties: {
    principalId: scannerIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageTableDataContributorRoleId
  }
}

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    retentionInDays: 30
    features: {
      searchVersion: 1
    }
    sku: {
      name: 'PerGB2018'
    }
  }
}

resource applicationInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: applicationInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    DisableLocalAuth: true
    WorkspaceResourceId: logAnalytics.id
  }
}

resource monitoringPublisherRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (assignManagedIdentityRoles) {
  name: guid(applicationInsights.id, hostIdentity.id, monitoringMetricsPublisherRoleId)
  scope: applicationInsights
  properties: {
    principalId: hostIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: monitoringMetricsPublisherRoleId
  }
}

resource functionPlan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: functionPlanName
  location: location
  kind: 'functionapp'
  sku: {
    name: 'FC1'
    tier: 'FlexConsumption'
  }
  properties: {
    reserved: true
  }
}

resource functionApp 'Microsoft.Web/sites@2024-04-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${hostIdentity.id}': {}
      '${scannerIdentity.id}': {}
    }
  }
  properties: {
    httpsOnly: true
    publicNetworkAccess: 'Enabled'
    serverFarmId: functionPlan.id
    siteConfig: {
      ftpsState: 'Disabled'
      http20Enabled: true
      minTlsVersion: '1.2'
    }
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${hostStorage.properties.primaryEndpoints.blob}${deploymentContainer.name}'
          authentication: {
            type: 'UserAssignedIdentity'
            userAssignedIdentityResourceId: hostIdentity.id
          }
        }
      }
      runtime: {
        name: 'node'
        version: '22'
      }
      scaleAndConcurrency: {
        maximumInstanceCount: 5
        instanceMemoryMB: 2048
      }
    }
  }

  resource appSettings 'config' = {
    name: 'appsettings'
    properties: {
      APPLICATIONINSIGHTS_AUTHENTICATION_STRING: 'ClientId=${hostIdentity.properties.clientId};Authorization=AAD'
      APPLICATIONINSIGHTS_CONNECTION_STRING: applicationInsights.properties.ConnectionString
      AzureWebJobsStorage__accountName: hostStorage.name
      AzureWebJobsStorage__clientId: hostIdentity.properties.clientId
      AzureWebJobsStorage__credential: 'managedidentity'
      FUNCTIONS_EXTENSION_VERSION: '~4'
      FUNCTIONS_NODE_BLOCK_ON_ENTRY_POINT_ERROR: '1'
      'AzureWebJobs.nightlySchedule.Disabled': string(schedulesDisabled)
      'AzureWebJobs.weeklyReconciliation.Disabled': string(schedulesDisabled)
      SCANNER_JOB_QUEUE_NAME: jobQueue.name
      SCANNER_HOST_STORAGE_ACCOUNT_NAME: hostStorage.name
      SCANNER_HOST_MANAGED_IDENTITY_CLIENT_ID: hostIdentity.properties.clientId
      SCANNER_AUTH_MODE: 'federated-identity'
      SCANNER_TENANT_ID: scannerTenantId
      SCANNER_CLIENT_ID: scannerClientId
      SCANNER_MANAGED_IDENTITY_CLIENT_ID: scannerIdentity.properties.clientId
      SCANNER_SCOPE_MODE: scannerScopeMode
      SCANNER_BASELINE_WINDOW_OPEN: 'false'
      SCANNER_ALLOWED_SITE_ID: allowedSiteId
      SCANNER_ALLOWED_LIBRARY_NAMES: allowedLibraryNames
      SCANNER_REPORTABLE_LABEL_IDS: reportableLabelIds
      SCANNER_LABEL_DISPLAY_NAMES_JSON: labelDisplayNamesJson
      SCANNER_MAX_CONCURRENCY: string(maxConcurrency)
      SCANNER_MAX_RETRIES: string(maxRetries)
      SCANNER_NIGHTLY_SCHEDULE: nightlySchedule
      SCANNER_RECONCILIATION_SCHEDULE: reconciliationSchedule
      AZURE_STORAGE_ACCOUNT_NAME: reportCache.name
      AZURE_STORAGE_TENANT_ID: subscription().tenantId
      AZURE_STORAGE_MANAGED_IDENTITY_CLIENT_ID: scannerIdentity.properties.clientId
      AZURE_TABLE_AUTH_MODE: 'managed-identity'
      AZURE_TABLE_INVENTORY_NAME: 'SensitivityInventory'
      AZURE_TABLE_SCAN_RUN_NAME: 'SensitivityScanRuns'
      AZURE_TABLE_DELTA_STATE_NAME: 'SensitivityDeltaState'
      AZURE_TABLE_SITE_SUMMARY_NAME: 'SiteLabelSummary'
      AZURE_TABLE_SITE_NAME: 'ScannerSites'
    }
  }
}

output functionAppName string = functionApp.name
output functionAppHostname string = functionApp.properties.defaultHostName
output applicationInsightsName string = applicationInsights.name
output hostStorageAccountName string = hostStorage.name
output jobQueueName string = jobQueue.name
output hostIdentityClientId string = hostIdentity.properties.clientId
output hostIdentityPrincipalId string = hostIdentity.properties.principalId
output scannerIdentityClientId string = scannerIdentity.properties.clientId
output scannerIdentityPrincipalId string = scannerIdentity.properties.principalId
output scannerIdentityResourceId string = scannerIdentity.id
output schedulesDisabled bool = schedulesDisabled
output managedIdentityRolesCreated bool = assignManagedIdentityRoles
