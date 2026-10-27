using './main.bicep'

param environmentName = readEnvironmentVariable('AZURE_ENV_NAME', 'srelab')
param location = readEnvironmentVariable('AZURE_LOCATION', 'eastus2')
param resourceGroupName = readEnvironmentVariable('AZURE_RESOURCE_GROUP', 'rg-${environmentName}')
param apiImage = readEnvironmentVariable('API_IMAGE', 'mcr.microsoft.com/dotnet/samples:aspnetapp')
param frontendImage = readEnvironmentVariable('FRONTEND_IMAGE', 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest')
param frontendOrigin = readEnvironmentVariable('FRONTEND_ORIGIN', '')
param websitePrincipalId = readEnvironmentVariable('WEBSITE_PRINCIPAL_ID', '')
param deployerPrincipalType = readEnvironmentVariable('AZURE_DEPLOYER_PRINCIPAL_TYPE', 'User')
