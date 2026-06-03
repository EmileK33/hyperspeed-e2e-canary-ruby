# frozen_string_literal: true

# Shared RSpec configuration — the Ruby analog of the node fixture's
# vitest.workspace.ts registry. Owned by the Phase 0 integration-harness session
# and declared `single-owner-glob` so parallel feature sessions never edit it
# (the #144 ecosystem-adapter must teach `impliedSharedFiles` that spec_helper.rb
# is Ruby's shared test registry, the way it knows vitest.workspace.ts for node).

require 'rspec'

RSpec.configure do |config|
  config.expect_with :rspec do |c|
    c.syntax = :expect
  end
  config.order = :random
end
