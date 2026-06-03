```json
{
  "runtimes": [
    { "name": "ruby", "version": "3.3" }
  ],
  "hostBinaries": ["git", "gh", "claude", "bundle"],
  "workspaceInstall": [
    { "cmd": "bundle install --path vendor/bundle", "marker": "vendor/bundle" }
  ],
  "services": [
    {
      "name": "postgres",
      "image": "postgres:16",
      "ports": ["5432:5432"],
      "env": {
        "POSTGRES_USER": "postgres",
        "POSTGRES_PASSWORD": "postgres",
        "POSTGRES_DB": "canary_test"
      },
      "mechanism": "native"
    }
  ],
  "projectManifest": {
    "path": "Gemfile",
    "ecosystem": "ruby",
    "content": "source 'https://rubygems.org'\n\nruby '3.3'\n\ngem 'sinatra'\ngem 'pg'\n\ngroup :development, :test do\n  gem 'rspec'\n  gem 'rack-test'\nend\n"
  }
}
```