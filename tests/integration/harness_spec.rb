# frozen_string_literal: true

# Integration smoke spec for the canary bookmarks API.
#
# Owned by the Phase 0 integration-harness session. The runner's integration
# wave runs `bundle exec rspec tests/integration` against the host working tree;
# this spec must pass on a clean checkout so the harness's wave sequencing has a
# green baseline before any feature session adds real behaviour.

require_relative '../../app/app'

RSpec.describe 'canary integration smoke' do
  it 'exposes a healthy liveness probe' do
    expect(Bookmarks.health).to eq('status' => 'ok')
  end

  it 'has a green arithmetic baseline' do
    expect(1 + 1).to eq(2)
  end
end
