# frozen_string_literal: true

# Canary bookmarks API entry point.
#
# Kept deliberately tiny: the in-memory store and the route handlers are what
# the build-plan sessions are expected to add (see ../specs). This module only
# exposes a health probe so the integration smoke spec has something to exercise
# before any feature session lands. Sessions own concrete files under app/ so
# they can add behaviour without colliding on this stub.

require 'sinatra/base'

module Bookmarks
  # Liveness probe used by the integration smoke spec.
  def self.health
    { 'status' => 'ok' }
  end
end
