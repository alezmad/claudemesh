# Homebrew formula template — lives in the `alezmad/homebrew-claudemesh` tap.
#
# The release-cli workflow bumps `version`, `url`, and `sha256` per platform
# via `brew bump-formula-pr`. This template is the source shape — copy it
# into the tap repo as `Formula/claudemesh.rb` when bootstrapping, then let
# CI keep it up to date.

class Claudemesh < Formula
  desc "Peer mesh for Claude Code sessions"
  homepage "https://claudemesh.com"
  version "1.0.0-alpha.28"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/alezmad/claudemesh/releases/download/cli-v#{version}/claudemesh-darwin-arm64"
      sha256 "REPLACED_BY_CI"
    else
      url "https://github.com/alezmad/claudemesh/releases/download/cli-v#{version}/claudemesh-darwin-x64"
      sha256 "REPLACED_BY_CI"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/alezmad/claudemesh/releases/download/cli-v#{version}/claudemesh-linux-arm64"
      sha256 "REPLACED_BY_CI"
    else
      url "https://github.com/alezmad/claudemesh/releases/download/cli-v#{version}/claudemesh-linux-x64"
      sha256 "REPLACED_BY_CI"
    end
  end

  def install
    bin.install Dir["*"].first => "claudemesh"
  end

  def caveats
    <<~EOS
      To enable click-to-launch from invite emails:
        claudemesh url-handler install

      To show live peer count in Claude Code:
        claudemesh install --status-line

      Shell completions:
        claudemesh completions zsh > "$(brew --prefix)/share/zsh/site-functions/_claudemesh"
    EOS
  end

  test do
    assert_match "claudemesh", shell_output("#{bin}/claudemesh --version")
  end
end
