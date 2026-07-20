targetScope = 'resourceGroup'

@description('Globally unique storage account name (3-24 lowercase alphanumeric characters).')
@minLength(3)
@maxLength(24)
param storageAccountName string

@description('Object ID granted Table data-plane access in the storage subscription tenant.')
param tableDataPrincipalId string

@description('Principal type. User is allowed only for the bounded local pilot; production uses ServicePrincipal for managed identity.')
param tableDataPrincipalType ('User' | 'ServicePrincipal') = 'ServicePrincipal'

@description('Create the Table data role assignment. Set false only when RBAC is handled separately by an authorized subscription owner.')
param assignTableDataRole bool = true

@description('Resource location for the isolated pilot cache.')
param location string = resourceGroup().location

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource tableService 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource inventoryTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tableService
  name: 'SensitivityInventory'
}

resource scanRunTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tableService
  name: 'SensitivityScanRuns'
}

resource deltaStateTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tableService
  name: 'SensitivityDeltaState'
}

resource siteLabelSummaryTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tableService
  name: 'SiteLabelSummary'
}

resource scannerSiteTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tableService
  name: 'ScannerSites'
}

resource hierarchySiteMappingTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tableService
  name: 'HierarchySiteMappings'
}

var storageTableDataContributorRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
)

resource tableDataRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (assignTableDataRole) {
  name: guid(storage.id, tableDataPrincipalId, storageTableDataContributorRoleId)
  scope: storage
  properties: {
    principalId: tableDataPrincipalId
    principalType: tableDataPrincipalType
    roleDefinitionId: storageTableDataContributorRoleId
  }
}

output storageAccountName string = storage.name
output tableEndpoint string = storage.properties.primaryEndpoints.table
output inventoryTableName string = inventoryTable.name
output scanRunTableName string = scanRunTable.name
output deltaStateTableName string = deltaStateTable.name
output siteLabelSummaryTableName string = siteLabelSummaryTable.name
output scannerSiteTableName string = scannerSiteTable.name
output hierarchySiteMappingTableName string = hierarchySiteMappingTable.name
output tableDataRoleAssignmentManagedByDeployment bool = assignTableDataRole
