# Canary Bundler project for HyperSpeed build-plan fixture-matrix validation
# (issue #143). Tiny Sinatra bookmarks API used as the Ruby target fixture for
# run-canary.mjs --fixture ruby. Ruby is the foreign-ecosystem proof cell for
# the #144 ecosystem-adapter — fail-closed on the generation side today.
source 'https://rubygems.org'

ruby '~> 3.3'

gem 'sinatra', '~> 4.0'
gem 'pg', '~> 1.5'

group :development, :test do
  gem 'rspec', '~> 3.13'
  gem 'rack-test', '~> 2.1'
gem 'rake'
gem 'colorize'
gem 'tilt'
end
