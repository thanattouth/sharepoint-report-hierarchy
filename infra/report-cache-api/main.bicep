targetScope = 'resourceGroup'

@description('Azure region for the report API and its private runtime resources.')
param location string = resourceGroup().location

@description('Existing isolated Azure Storage account that contains the report cache tables.')
param reportCacheStorageAccountName string

@description('Source Microsoft 365 tenant ID stored in report cache partition keys.')
@secure()
param reportCacheTenantId string

@description('Comma-separated immutable sensitivity label IDs included in report counts.')
@secure()
param reportableLabelIds string

@description('Canonical Graph Site ID for the bounded pilot Site.')
@secure()
param pilotSiteId string

@description('Display name for the bounded pilot Site.')
@secure()
param pilotSiteName string

@description('SharePoint hostname for the bounded pilot Site.')
@secure()
param pilotSiteHostname string

@description('Server-relative path for the bounded pilot Site.')
@secure()
param pilotSitePath string

@description('Existing business hierarchy node ID mapped to the bounded pilot Site.')
@secure()
param pilotSiteNodeId string

@description('Comma-separated fixture UPNs permitted only for the no-login pilot proof.')
@secure()
param pilotAllowedUpns string

@description('Maximum number of Sites whose detail partitions may be loaded without an explicit Site selection.')
@minValue(1)
@maxValue(100)
param maxDetailSites int = 25

@description('Create RBAC assignments. Set false only when an authorized administrator will apply them separately.')
param assignManagedIdentityRoles bool = true

var suffix = take(uniqueString(subscription().id, resourceGroup().id, location), 9)
var functionAppName = 'func-sp-sens-report-${suffix}'
var functionPlanName = 'plan-sp-sens-report-${suffix}'
var hostStorageAccountName = 'stfnreport${suffix}'
var hostIdentityName = 'id-sp-sens-report-host'
var reportReaderIdentityName = 'id-sp-sens-report-reader'
var logAnalyticsName = 'log-sp-sens-report-${suffix}'
var applicationInsightsName = 'appi-sp-sens-report-${suffix}'
var deploymentContainerName = 'app-package-${suffix}'

var storageBlobDataOwnerRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
)
var storageTableDataContributorRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
)
var storageTableDataReaderRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '76199698-9eea-4c19-bc75-cec21354c6b6'
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

resource hostIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: hostIdentityName
  location: location
}

resource reportReaderIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: reportReaderIdentityName
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

resource hostTableContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (assignManagedIdentityRoles) {
  name: guid(hostStorage.id, hostIdentity.id, storageTableDataContributorRoleId)
  scope: hostStorage
  properties: {
    principalId: hostIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageTableDataContributorRoleId
  }
}

resource reportCacheReaderRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (assignManagedIdentityRoles) {
  name: guid(reportCache.id, reportReaderIdentity.id, storageTableDataReaderRoleId)
  scope: reportCache
  properties: {
    principalId: reportReaderIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageTableDataReaderRoleId
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
      '${reportReaderIdentity.id}': {}
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
        maximumInstanceCount: 20
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
      REPORT_DATA_SOURCE: 'azure-table'
      REPORT_SITE_SOURCE: 'mapping-table'
      REPORT_HIERARCHY_SOURCE: 'table'
      REPORT_CACHE_TENANT_ID: reportCacheTenantId
      REPORT_REPORTABLE_LABEL_IDS: reportableLabelIds
      REPORT_PILOT_SITE_ID: pilotSiteId
      REPORT_PILOT_SITE_NAME: pilotSiteName
      REPORT_PILOT_SITE_HOSTNAME: pilotSiteHostname
      REPORT_PILOT_SITE_PATH: pilotSitePath
      REPORT_PILOT_SITE_NODE_ID: pilotSiteNodeId
      REPORT_PILOT_ALLOWED_UPNS: pilotAllowedUpns
      REPORT_MAX_DETAIL_SITES: string(maxDetailSites)
      AZURE_STORAGE_ACCOUNT_NAME: reportCache.name
      AZURE_STORAGE_TENANT_ID: subscription().tenantId
      AZURE_STORAGE_MANAGED_IDENTITY_CLIENT_ID: reportReaderIdentity.properties.clientId
      AZURE_TABLE_AUTH_MODE: 'managed-identity'
      AZURE_TABLE_INVENTORY_NAME: 'SensitivityInventory'
      AZURE_TABLE_SCAN_RUN_NAME: 'SensitivityScanRuns'
      AZURE_TABLE_DELTA_STATE_NAME: 'SensitivityDeltaState'
      AZURE_TABLE_SITE_SUMMARY_NAME: 'SiteLabelSummary'
      AZURE_TABLE_SITE_NAME: 'ScannerSites'
      AZURE_TABLE_SITE_MAPPING_NAME: 'HierarchySitePlacements'
      AZURE_TABLE_HIERARCHY_NODE_NAME: 'HierarchyNodes'
      AZURE_TABLE_SCOPE_ASSIGNMENT_NAME: 'ScopeAssignments'
      AZURE_TABLE_SITE_MAPPING_AUDIT_NAME: 'HierarchySiteMappingAudit'
    }
  }
}

output functionAppName string = functionApp.name
output functionAppHostname string = functionApp.properties.defaultHostName
output applicationInsightsName string = applicationInsights.name
output hostStorageAccountName string = hostStorage.name
output hostIdentityPrincipalId string = hostIdentity.properties.principalId
output reportReaderIdentityClientId string = reportReaderIdentity.properties.clientId
output reportReaderIdentityPrincipalId string = reportReaderIdentity.properties.principalId
output managedIdentityRolesCreated bool = assignManagedIdentityRoles
