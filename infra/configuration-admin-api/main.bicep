targetScope = 'resourceGroup'

@description('Azure region for the Configuration Admin API and private runtime resources.')
param location string = resourceGroup().location

@description('Existing isolated Azure Storage account containing configuration and ScannerSites tables.')
param reportCacheStorageAccountName string

@description('Source Microsoft 365 tenant ID used as the configuration partition key.')
@secure()
param reportCacheTenantId string

@description('Comma-separated pilot administrator UPNs accepted only behind the Function-key boundary.')
@secure()
param allowedActors string

@description('Create exact-scope RBAC assignments. Set false when an authorized administrator applies them separately.')
param assignManagedIdentityRoles bool = false

var suffix = take(uniqueString(subscription().id, resourceGroup().id, location, 'configuration-admin'), 9)
var functionAppName = 'func-sp-sens-config-${suffix}'
var functionPlanName = 'plan-sp-sens-config-${suffix}'
var hostStorageAccountName = 'stfnconfig${suffix}'
var hostIdentityName = 'id-sp-sens-config-host'
var configurationWriterIdentityName = 'id-sp-sens-config-writer'
var logAnalyticsName = 'log-sp-sens-config-${suffix}'
var applicationInsightsName = 'appi-sp-sens-config-${suffix}'
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

resource reportCacheTableService 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' existing = {
  parent: reportCache
  name: 'default'
}

resource hierarchyNodes 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' existing = {
  parent: reportCacheTableService
  name: 'HierarchyNodes'
}

resource scopeAssignments 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' existing = {
  parent: reportCacheTableService
  name: 'ScopeAssignments'
}

resource hierarchySitePlacements 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' existing = {
  parent: reportCacheTableService
  name: 'HierarchySitePlacements'
}

resource hierarchySiteMappingAudit 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' existing = {
  parent: reportCacheTableService
  name: 'HierarchySiteMappingAudit'
}

resource scannerSites 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' existing = {
  parent: reportCacheTableService
  name: 'ScannerSites'
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

resource configurationWriterIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: configurationWriterIdentityName
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

resource hierarchyNodeContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (assignManagedIdentityRoles) {
  name: guid(hierarchyNodes.id, configurationWriterIdentity.id, storageTableDataContributorRoleId)
  scope: hierarchyNodes
  properties: {
    principalId: configurationWriterIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageTableDataContributorRoleId
  }
}

resource scopeAssignmentContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (assignManagedIdentityRoles) {
  name: guid(scopeAssignments.id, configurationWriterIdentity.id, storageTableDataContributorRoleId)
  scope: scopeAssignments
  properties: {
    principalId: configurationWriterIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageTableDataContributorRoleId
  }
}

resource hierarchySitePlacementContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (assignManagedIdentityRoles) {
  name: guid(hierarchySitePlacements.id, configurationWriterIdentity.id, storageTableDataContributorRoleId)
  scope: hierarchySitePlacements
  properties: {
    principalId: configurationWriterIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageTableDataContributorRoleId
  }
}

resource hierarchySiteMappingAuditContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (assignManagedIdentityRoles) {
  name: guid(hierarchySiteMappingAudit.id, configurationWriterIdentity.id, storageTableDataContributorRoleId)
  scope: hierarchySiteMappingAudit
  properties: {
    principalId: configurationWriterIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageTableDataContributorRoleId
  }
}

resource scannerSitesReaderRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (assignManagedIdentityRoles) {
  name: guid(scannerSites.id, configurationWriterIdentity.id, storageTableDataReaderRoleId)
  scope: scannerSites
  properties: {
    principalId: configurationWriterIdentity.properties.principalId
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
      '${configurationWriterIdentity.id}': {}
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
        maximumInstanceCount: 10
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
      REPORT_CACHE_TENANT_ID: reportCacheTenantId
      CONFIG_ADMIN_ALLOWED_ACTORS: allowedActors
      AZURE_STORAGE_ACCOUNT_NAME: reportCache.name
      AZURE_STORAGE_TENANT_ID: subscription().tenantId
      AZURE_STORAGE_MANAGED_IDENTITY_CLIENT_ID: configurationWriterIdentity.properties.clientId
      AZURE_TABLE_AUTH_MODE: 'managed-identity'
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
output configurationWriterIdentityPrincipalId string = configurationWriterIdentity.properties.principalId
output configurationWriterIdentityClientId string = configurationWriterIdentity.properties.clientId
output hierarchyNodesScope string = hierarchyNodes.id
output scopeAssignmentsScope string = scopeAssignments.id
output hierarchySitePlacementsScope string = hierarchySitePlacements.id
output hierarchySiteMappingAuditScope string = hierarchySiteMappingAudit.id
output scannerSitesScope string = scannerSites.id
output roleAssignmentsManagedByDeployment bool = assignManagedIdentityRoles
