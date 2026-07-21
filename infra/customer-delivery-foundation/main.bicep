targetScope = 'subscription'

@description('Customer delivery deployment name used for the resource-group module deployment.')
param deploymentName string

@description('Azure region for the isolated customer deployment.')
param location string

@description('Dedicated resource group for the customer deployment.')
param resourceGroupName string

@description('Globally unique Storage account name for report cache and configuration tables.')
param storageAccountName string

@description('Create the initial Table data-plane role assignment when the deployer is authorized.')
param assignTableDataRole bool = false

@description('Object ID that receives the initial Table role. Ignored when assignTableDataRole is false.')
param tableDataPrincipalId string = '00000000-0000-0000-0000-000000000000'

@description('Principal type for the initial Table role.')
param tableDataPrincipalType ('User' | 'ServicePrincipal') = 'ServicePrincipal'

@description('Customer-owned resource tags.')
param tags object

resource customerResourceGroup 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

module reportCache '../azure-table-pilot/main.bicep' = {
  name: '${deploymentName}-report-cache'
  scope: customerResourceGroup
  params: {
    storageAccountName: storageAccountName
    tableDataPrincipalId: tableDataPrincipalId
    tableDataPrincipalType: tableDataPrincipalType
    assignTableDataRole: assignTableDataRole
    location: location
  }
}

output resourceGroupName string = customerResourceGroup.name
output resourceGroupId string = customerResourceGroup.id
output storageAccountName string = reportCache.outputs.storageAccountName
output tableEndpoint string = reportCache.outputs.tableEndpoint
output rbacManagedByDeployment bool = reportCache.outputs.tableDataRoleAssignmentManagedByDeployment
