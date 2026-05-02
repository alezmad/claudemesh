/**
 * `claudemesh completions <shell>` — emit a completion script for bash / zsh / fish.
 *
 * Users pipe it into their shell's completion system:
 *   bash: claudemesh completions bash > /etc/bash_completion.d/claudemesh
 *   zsh:  claudemesh completions zsh > ~/.zfunc/_claudemesh  (add $fpath)
 *   fish: claudemesh completions fish > ~/.config/fish/completions/claudemesh.fish
 */

import { EXIT } from "~/constants/exit-codes.js";
import { render } from "~/ui/render.js";

const COMMANDS = [
  "create", "new", "join", "add", "launch", "connect", "disconnect",
  "list", "ls", "delete", "rm", "rename", "share", "invite",
  "peers", "send", "inbox", "state", "info",
  "remember", "recall", "remind", "profile", "status",
  "login", "register", "logout", "whoami",
  "install", "uninstall", "doctor", "sync",
  "completions", "verify", "url-handler",
  "help",
];

const FLAGS = [
  "--help", "-h", "--version", "-V", "--json", "--yes", "-y",
  "--quiet", "-q", "--mesh", "--name", "--join", "--resume",
];

function bash(): string {
  return `# claudemesh bash completion
_claudemesh_complete() {
  local cur prev words cword
  _init_completion || return

  local commands="${COMMANDS.join(" ")}"
  local flags="${FLAGS.join(" ")}"

  if [[ \${cword} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
    return 0
  fi

  case "\${cur}" in
    -*)
      COMPREPLY=( $(compgen -W "\${flags}" -- "\${cur}") )
      return 0
      ;;
  esac
}
complete -F _claudemesh_complete claudemesh
`;
}

function zsh(): string {
  return `#compdef claudemesh
# claudemesh zsh completion

_claudemesh() {
  local -a commands flags
  commands=(
${COMMANDS.map((c) => `    '${c}'`).join("\n")}
  )
  flags=(
${FLAGS.map((f) => `    '${f}'`).join("\n")}
  )

  if (( CURRENT == 2 )); then
    _describe 'command' commands
    return
  fi

  case $words[2] in
    join|add|launch|connect)
      _arguments '--name[display name]' '--join[invite url]' '-y[non-interactive]' '--mesh[mesh slug]'
      ;;
    share|invite)
      _arguments '--mesh[mesh slug]' '--json[machine-readable]'
      ;;
    *)
      _values 'flag' $flags
      ;;
  esac
}
compdef _claudemesh claudemesh
`;
}

function fish(): string {
  const cmdLines = COMMANDS.map(
    (c) => `complete -c claudemesh -n '__fish_use_subcommand' -a '${c}'`,
  ).join("\n");
  return `# claudemesh fish completion
${cmdLines}
complete -c claudemesh -l help -s h -d 'show help'
complete -c claudemesh -l version -s V -d 'show version'
complete -c claudemesh -l json -d 'machine-readable output'
complete -c claudemesh -l yes -s y -d 'skip confirmations'
complete -c claudemesh -l mesh -d 'mesh slug'
complete -c claudemesh -l name -d 'display name'
complete -c claudemesh -l join -d 'invite url'
`;
}

export async function runCompletions(shell: string | undefined): Promise<number> {
  if (!shell) {
    render.err("Usage: claudemesh completions <bash|zsh|fish>");
    return EXIT.INVALID_ARGS;
  }
  switch (shell.toLowerCase()) {
    case "bash":
      process.stdout.write(bash());
      return EXIT.SUCCESS;
    case "zsh":
      process.stdout.write(zsh());
      return EXIT.SUCCESS;
    case "fish":
      process.stdout.write(fish());
      return EXIT.SUCCESS;
    default:
      render.err(`Unsupported shell: ${shell}`, "use bash, zsh, or fish.");
      return EXIT.INVALID_ARGS;
  }
}
