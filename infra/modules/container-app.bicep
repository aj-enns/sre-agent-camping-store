@description('Location for resources')
param location string

@description('Container App Environment name')
param containerAppEnvName string

@description('Container App name')
param containerAppName string

@description('Log Analytics Workspace resource ID')
param logAnalyticsWorkspaceId string

@description('Application Insights connection string for API telemetry')
@secure()
param appInsightsConnectionString string

param appInsightsId string
param apiImage string
param frontendImage string
param frontendOrigin string
param websitePrincipalId string

// Container App Environment
resource containerAppEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: containerAppEnvName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'azure-monitor'
    }
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
  }
}

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'container-app-logs'
  scope: containerAppEnv
  properties: {
    workspaceId: logAnalyticsWorkspaceId
    logAnalyticsDestinationType: 'Dedicated'
    logs: [
      {
        category: 'ContainerAppConsoleLogs'
        enabled: true
      }
      {
        category: 'ContainerAppSystemLogs'
        enabled: true
      }
    ]
  }
}

resource appIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-app-${containerAppName}'
  location: location
}

resource telemetry 'Microsoft.Insights/components@2020-02-02' existing = {
  name: last(split(appInsightsId, '/'))
}

resource telemetryRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(telemetry.id, appIdentity.id, 'telemetry')
  scope: telemetry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '3913510d-42f4-4e42-8a64-420c390055eb')
    principalId: appIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource registryPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, appIdentity.id, 'pull')
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
    principalId: appIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource registryPush 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(websitePrincipalId)) {
  name: guid(acr.id, websitePrincipalId, 'push')
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '8311e382-0749-4cb8-b61a-304f252e45ec')
    principalId: websitePrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource websiteDeployRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(websitePrincipalId)) {
  name: guid(resourceGroup().id, websitePrincipalId, 'website-deploy')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '358470bc-b998-42bd-ab17-a7e34c199c0f')
    principalId: websitePrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource websiteReadRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(websitePrincipalId)) {
  name: guid(resourceGroup().id, websitePrincipalId, 'website-read')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'acdd72a7-3385-48ef-bd42-f606fba81ae7')
    principalId: websitePrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource websiteIdentityRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(websitePrincipalId)) {
  name: guid(appIdentity.id, websitePrincipalId, 'website-identity')
  scope: appIdentity
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'f1a07417-d97a-45cb-824c-7a7467783830')
    principalId: websitePrincipalId
    principalType: 'ServicePrincipal'
  }
}

var acrName = replace('acr${containerAppName}', '-', '')
resource acr 'Microsoft.ContainerRegistry/registries@2025-04-01' = {
  name: length(acrName) > 50 ? substring(acrName, 0, 50) : acrName
  location: location
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
    anonymousPullEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

// Images are supplied by the deployment workflow; first provision uses public bootstrap images.
resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: containerAppName
  location: location
  tags: {
    'azd-service-name': 'api'
  }
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${appIdentity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerAppEnv.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      registries: [
        {
          server: acr.properties.loginServer
          identity: appIdentity.id
        }
      ]
      secrets: [
        {
          name: 'appinsights-connection-string'
          value: appInsightsConnectionString
        }
      ]
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
      }
    }
    template: {
      containers: [
        {
          image: apiImage
          name: 'camping-api'
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
              secretRef: 'appinsights-connection-string'
            }
            {
              name: 'ASPNETCORE_URLS'
              value: 'http://+:8080'
            }
            {
              name: 'ASPNETCORE_ENVIRONMENT'
              value: 'Production'
            }
            {
              name: 'AZURE_CLIENT_ID'
              value: appIdentity.properties.clientId
            }
            {
              name: 'AllowedOrigins__0'
              value: frontendOrigin
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
  dependsOn: [
    registryPull
  ]
}

// Camping store frontend Container App
var frontendAppName = replace(containerAppName, 'camping', 'camping-fe')
resource frontendApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: frontendAppName
  location: location
  tags: {
    'azd-service-name': 'frontend'
  }
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${appIdentity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerAppEnv.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      registries: [
        {
          server: acr.properties.loginServer
          identity: appIdentity.id
        }
      ]
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
      }
    }
    template: {
      containers: [
        {
          image: frontendImage
          name: 'camping-frontend'
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            {
              name: 'REACT_APP_API_BASE_URL'
              value: 'https://${containerApp.properties.configuration.ingress.fqdn}/api'
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
  dependsOn: [
    registryPull
  ]
}

// Outputs
output containerAppId string = containerApp.id
output containerAppName string = containerApp.name
output containerAppUrl string = 'https://${containerApp.properties.configuration.ingress.fqdn}'
output frontendAppName string = frontendApp.name
output frontendAppUrl string = 'https://${frontendApp.properties.configuration.ingress.fqdn}'
output containerAppEnvId string = containerAppEnv.id
output containerAppEnvName string = containerAppEnv.name
output acrName string = acr.name
output acrLoginServer string = acr.properties.loginServer
