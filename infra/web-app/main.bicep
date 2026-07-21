targetScope = 'resourceGroup'

@description('Azure region for the customer-owned report web application.')
param location string = resourceGroup().location

@description('Globally unique Linux Web App name.')
param appServiceName string

@description('Dedicated App Service plan name.')
param appServicePlanName string

@description('B1 for delivery rehearsal; S1 or P0v3 for production capacity.')
@allowed([
  'B1'
  'S1'
  'P0v3'
])
param skuName string = 'B1'

@description('Customer-owned Key Vault containing web runtime secrets.')
param keyVaultName string

@description('Object ID of the delivery operator granted Key Vault Secrets Officer.')
param operatorPrincipalId string

@description('Single-tenant Entra tenant ID.')
param entraTenantId string

@description('Single-tenant report Web application client ID.')
param entraClientId string

@description('Exact public origin used by OIDC and mutation-origin validation.')
param webOrigin string

@description('Enable the delegated Entra security-group picker after admin consent.')
param groupPickerEnabled bool = false

@description('Report API Function App name.')
param reportApiFunctionAppName string

@description('Configuration Admin API Function App name.')
param configurationAdminFunctionAppName string

param tags object = {}

var skuTier = skuName == 'B1' ? 'Basic' : skuName == 'S1' ? 'Standard' : 'PremiumV3'
var suffix = take(uniqueString(subscription().id, resourceGroup().id, appServiceName), 9)
var logAnalyticsName = 'log-sp-sens-web-${suffix}'
var applicationInsightsName = 'appi-sp-sens-web-${suffix}'
var keyVaultSecretsUserRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '4633458b-17de-408a-b874-0445c86b69e6'
)
var keyVaultSecretsOfficerRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'
)

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  tags: tags
  properties: {
    tenantId: tenant().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enablePurgeProtection: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Allow'
    }
  }
}

resource appServicePlan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: appServicePlanName
  location: location
  tags: tags
  kind: 'linux'
  sku: {
    name: skuName
    tier: skuTier
    capacity: 1
  }
  properties: {
    reserved: true
  }
}

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  tags: tags
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
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

resource webApp 'Microsoft.Web/sites@2024-04-01' = {
  name: appServiceName
  location: location
  tags: tags
  kind: 'app,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    httpsOnly: true
    publicNetworkAccess: 'Enabled'
    serverFarmId: appServicePlan.id
    clientAffinityEnabled: false
    siteConfig: {
      alwaysOn: true
      appCommandLine: 'node server.js'
      ftpsState: 'Disabled'
      healthCheckPath: '/auth/signed-out'
      http20Enabled: true
      linuxFxVersion: 'NODE|22-lts'
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      use32BitWorkerProcess: false
    }
  }

  resource appSettings 'config' = {
    name: 'appsettings'
    properties: {
      APPLICATIONINSIGHTS_CONNECTION_STRING: applicationInsights.properties.ConnectionString
      CONFIG_ADMIN_API_BASE_URL: 'https://${configurationAdminFunctionAppName}.azurewebsites.net/api'
      CONFIG_ADMIN_API_FUNCTION_KEY: '@Microsoft.KeyVault(SecretUri=${keyVault.properties.vaultUri}secrets/config-admin-api-function-key)'
      CONFIG_ADMIN_API_TIMEOUT_MS: '10000'
      ENTRA_AUTH_ALLOWED_ORIGINS: webOrigin
      ENTRA_AUTH_CLIENT_ID: entraClientId
      ENTRA_AUTH_CLIENT_SECRET: '@Microsoft.KeyVault(SecretUri=${keyVault.properties.vaultUri}secrets/entra-client-secret)'
      ENTRA_AUTH_GROUP_PICKER_ENABLED: string(groupPickerEnabled)
      ENTRA_AUTH_SESSION_HOURS: '8'
      ENTRA_AUTH_SESSION_SECRET: '@Microsoft.KeyVault(SecretUri=${keyVault.properties.vaultUri}secrets/entra-session-secret)'
      ENTRA_AUTH_TENANT_ID: entraTenantId
      NEXT_TELEMETRY_DISABLED: '1'
      NODE_ENV: 'production'
      REPORT_API_BASE_URL: 'https://${reportApiFunctionAppName}.azurewebsites.net/api'
      REPORT_API_FUNCTION_KEY: '@Microsoft.KeyVault(SecretUri=${keyVault.properties.vaultUri}secrets/report-api-function-key)'
      REPORT_API_TIMEOUT_MS: '10000'
      REPORT_DATA_SOURCE: 'azure-api'
      WEBSITE_HEALTHCHECK_MAXPINGFAILURES: '5'
      WEBSITE_HTTPLOGGING_RETENTION_DAYS: '7'
      WEBSITE_NODE_DEFAULT_VERSION: '~22'
      WEBSITE_RUN_FROM_PACKAGE: '1'
    }
  }

  resource webConfig 'config' = {
    name: 'web'
    properties: {
      alwaysOn: true
      appCommandLine: 'node server.js'
      ftpsState: 'Disabled'
      healthCheckPath: '/auth/signed-out'
      http20Enabled: true
      linuxFxVersion: 'NODE|22-lts'
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
    }
  }

  resource logs 'config' = {
    name: 'logs'
    properties: {
      applicationLogs: {
        fileSystem: {
          level: 'Information'
        }
      }
      detailedErrorMessages: {
        enabled: false
      }
      failedRequestsTracing: {
        enabled: true
      }
      httpLogs: {
        fileSystem: {
          enabled: true
          retentionInDays: 7
          retentionInMb: 35
        }
      }
    }
  }
}

resource webSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, webApp.id, keyVaultSecretsUserRoleId)
  scope: keyVault
  properties: {
    principalId: webApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: keyVaultSecretsUserRoleId
  }
}

resource operatorSecretsOfficer 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, operatorPrincipalId, keyVaultSecretsOfficerRoleId)
  scope: keyVault
  properties: {
    principalId: operatorPrincipalId
    principalType: 'User'
    roleDefinitionId: keyVaultSecretsOfficerRoleId
  }
}

output appServiceName string = webApp.name
output appServiceHostname string = webApp.properties.defaultHostName
output appServicePrincipalId string = webApp.identity.principalId
output appServicePlanName string = appServicePlan.name
output keyVaultName string = keyVault.name
output keyVaultUri string = keyVault.properties.vaultUri
output applicationInsightsName string = applicationInsights.name
