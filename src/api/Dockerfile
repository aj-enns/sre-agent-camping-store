FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /app

ARG NUGET_SOURCE=https://api.nuget.org/v3/index.json
COPY *.csproj ./
RUN dotnet restore --source "$NUGET_SOURCE"

COPY . ./
RUN dotnet publish -c Release -o out --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:9.0
WORKDIR /app
COPY --from=build /app/out .

# v1 = healthy; v2 = payment gateway misconfigured (used for the bad-deploy scenario)
ARG API_VERSION=v1

EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080
ENV ASPNETCORE_ENVIRONMENT=Production
ENV API_VERSION=${API_VERSION}

ENTRYPOINT ["dotnet", "CampingApi.dll"]
